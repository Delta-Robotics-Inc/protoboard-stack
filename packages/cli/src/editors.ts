/**
 * `protoboard editors`: the editors a project's extensions contribute
 * (`contributes.editors`), and `protoboard editors host`, the process an
 * editor's services run in.
 *
 * The shell (the VS Code extension's custom editor) asks `editors --file <path>
 * --format json` which editor opens a file, loads that editor's page in a
 * webview, and starts `editors host <package> <editor>` with pipes. This
 * process loads the editor's host entry the way operations are loaded (tsx,
 * so a TypeScript entry runs as it is) and speaks the shell side of
 * `@protoboardai/core/editor-protocol`: one JSON object per line on stdin and
 * stdout. Anything else the extension's code writes to stdout goes to stderr,
 * so the protocol's lines stay whole.
 */
import { createInterface } from "node:readline";
import { relative, resolve, sep } from "node:path";
import { editorFor, findProjectRoot, loadEditorHost, loadProjectExtensions, relativeInside, resolveEditors, type ProjectDiagnostic, type ResolvedEditor } from "@protoboardai/core";
import { EDITOR_PROTOCOL, webviewUri, type EditorHost, type EditorHostContext, type EditorInit, type FromHost, type ToHost } from "@protoboardai/core/editor-protocol";

export interface EditorsReport {
  root: string;
  editors: ResolvedEditor[];
  /** With `--file`: the editor that opens it (null: none of the enabled extensions claims it), and the file relative to the project. */
  file?: { path: string; relPath: string | null; editor: ResolvedEditor | null };
  diagnostics: ProjectDiagnostic[];
}

/** The editors of the project at `cwd`, and with `file` the one that opens it. */
export async function listEditors(cwd: string, file?: string): Promise<EditorsReport> {
  const root = findProjectRoot(file ? resolve(cwd, file, "..") : cwd);
  if (!root) throw new Error(`no protoboard.config.ts in ${file ? resolve(cwd, file, "..") : cwd} or its parents`);
  const loaded = await loadProjectExtensions(root);
  const { editors, diagnostics } = resolveEditors(loaded.extensions);
  const report: EditorsReport = { root, editors, diagnostics: [...loaded.diagnostics, ...diagnostics] };
  if (file) {
    const abs = resolve(cwd, file);
    report.file = { path: abs, relPath: relativeInside(root, abs) ?? null, editor: editorFor(editors, root, abs) ?? null };
  }
  return report;
}

export function formatEditors(r: EditorsReport): string {
  const lines = r.editors.length
    ? r.editors.map((e) => `  ${e.id.padEnd(16)} ${e.files.join(", ").padEnd(20)} ${e.extension}${e.resolved.host ? "  (host)" : ""}${e.resolved.missing.length ? `\n      missing: ${e.resolved.missing.map((m) => relative(r.root, m).split(sep).join("/")).join(", ")}` : ""}`)
    : ["  (none: no enabled extension contributes an editor)"];
  const file = r.file ? [`${r.file.relPath ?? r.file.path}: ${r.file.editor ? `opens in ${r.file.editor.extension}'s ${r.file.editor.title}` : "no enabled extension claims it"}`] : [];
  return [...file, "Editors", ...lines, ...r.diagnostics.map((d) => `  ${d.severity === "error" ? "✗" : "!"} ${d.message}`)].join("\n");
}

/** `protoboard.editor/v0` → 0. */
const major = (protocol: unknown): number | undefined => (typeof protocol === "string" ? Number(/\/v(\d+)$/.exec(protocol)?.[1]) : undefined);

/** The prefix a webview loads files under `folder` with, joined to the file's path in it; null outside every folder. */
function mapToWebview(init: EditorInit, abs: string): string | null {
  for (const [folder, prefix] of [
    [init.root, init.webview.root],
    [init.packageRoot, init.webview.package],
  ] as const) {
    const rel = relativeInside(folder, abs);
    if (rel !== undefined) return webviewUri(prefix, rel);
  }
  return null;
}

/**
 * The host process of one editor: reads the shell's lines from `input`,
 * writes its own to `output`, until the shell says `dispose` or closes the
 * pipe. Resolves with the exit code.
 */
export async function runEditorHost(o: {
  cwd: string;
  /** The extension's npm package or manifest id. */
  extension: string;
  editor: string;
  input: NodeJS.ReadableStream;
  /** Writes one protocol line (the real stdout). */
  send: (line: string) => void;
  log?: (line: string) => void;
}): Promise<number> {
  const send = (m: FromHost) => o.send(JSON.stringify(m) + "\n");
  const log = o.log ?? ((l: string) => process.stderr.write(`${l}\n`));
  const lines = createInterface({ input: o.input, crlfDelay: Infinity });
  const queue: ToHost[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  lines.on("line", (line) => {
    if (!line.trim()) return;
    try {
      queue.push(JSON.parse(line) as ToHost);
    } catch {
      log(`protoboard editors host: not a JSON line: ${line.slice(0, 80)}`);
      return;
    }
    wake?.();
  });
  lines.on("close", () => {
    closed = true;
    wake?.();
  });
  const next = async (): Promise<ToHost | undefined> => {
    while (!queue.length && !closed) await new Promise<void>((r) => (wake = r));
    wake = undefined;
    return queue.shift();
  };
  const fail = (message: string) => {
    send({ t: "failed", message });
    return 1;
  };

  const first = await next();
  if (!first) return 0;
  if (first.t !== "init") return fail(`the first line must be init, not ${first.t}`);
  const init: EditorInit = first;
  if (major(init.protocol) !== major(EDITOR_PROTOCOL)) return fail(`the shell speaks ${init.protocol}; this host speaks ${EDITOR_PROTOCOL}`);

  let editor: ResolvedEditor | undefined;
  try {
    const { editors } = await listEditors(o.cwd);
    editor = editors.find((e) => (e.package === o.extension || e.extension === o.extension) && e.id === o.editor);
  } catch (e) {
    return fail((e as Error).message);
  }
  if (!editor) return fail(`no enabled extension ${o.extension} contributes an editor ${o.editor}`);
  if (!editor.resolved.host) return fail(`${editor.extension}'s editor ${editor.id} declares no host`);

  let nextId = 1;
  const pending = new Map<number, { ok: (v: unknown) => void; no: (e: Error) => void }>();
  const context: EditorHostContext = {
    init,
    post: (message) => send({ t: "webview", message }),
    call: (service, args) =>
      new Promise((ok, no) => {
        const id = nextId++;
        pending.set(id, { ok: ok as (v: unknown) => void, no });
        send({ t: "call", id, service, args });
      }),
    webviewUri: (abs) => mapToWebview(init, abs),
    log: (level, text) => send({ t: "log", level, text }),
  };
  let host: EditorHost;
  try {
    const entry = await loadEditorHost(editor);
    host = (await entry(context)) ?? {};
  } catch (e) {
    return fail(`${editor.extension}'s editor host did not start: ${(e as Error).stack ?? (e as Error).message}`);
  }

  const handle = async (m: ToHost) => {
    switch (m.t) {
      case "webview":
        return host.webview?.(m.message);
      case "document": {
        const { t: _t, ...change } = m;
        return host.document?.(change);
      }
      case "saved":
        return host.saved?.(m.version);
      case "theme":
        return host.theme?.(m.theme);
      case "reply": {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error !== undefined) p?.no(new Error(m.error));
        else p?.ok(m.result ?? null);
        return;
      }
    }
  };
  for (;;) {
    const m = await next();
    if (!m || m.t === "dispose") break;
    // replies are settled at once; everything else in order, without waiting for the handler (it may call the shell and wait for a reply)
    if (m.t === "reply") void handle(m);
    else void Promise.resolve()
      .then(() => handle(m))
      .catch((e: Error) => send({ t: "log", level: "error", text: `${m.t}: ${e.stack ?? e.message}` }));
  }
  for (const p of pending.values()) p.no(new Error("the editor closed"));
  try {
    await host.dispose?.();
  } catch (e) {
    log(`protoboard editors host: dispose: ${(e as Error).message}`);
  }
  return 0;
}

/**
 * The CLI's entry for `editors host`: the protocol on the real stdout, and
 * every other write to stdout (console.log in the extension's code) moved to
 * stderr.
 */
export async function editorHostMain(cwd: string, extension: string | undefined, editor: string | undefined): Promise<never> {
  if (!extension || !editor) throw new Error("usage: protoboard editors host <extension package> <editor id>  (the shell starts it; it speaks JSON lines on stdin and stdout)");
  const out = process.stdout.write.bind(process.stdout) as (s: string) => boolean;
  const toStderr = ((chunk: unknown, ...rest: unknown[]) => (process.stderr.write as (...a: unknown[]) => boolean)(chunk, ...rest)) as typeof process.stdout.write;
  process.stdout.write = toStderr;
  console.log = console.info = console.debug = (...a: unknown[]) => void process.stderr.write(a.map(String).join(" ") + "\n");
  const code = await runEditorHost({ cwd, extension, editor, input: process.stdin, send: (line) => out(line) });
  // the extension's code may hold handles (a browser, a watcher): the editor is closed, so the process ends
  process.exit(code);
}
