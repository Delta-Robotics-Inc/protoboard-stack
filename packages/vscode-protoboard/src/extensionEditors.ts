/**
 * Editors that Protoboard extensions provide (`contributes.editors`,
 * docs/specs/viewer-stack.md): one text-backed custom editor
 * (`protoboard.extensionEditor`) for every file an enabled extension of the
 * file's project claims. VS Code needs a custom editor's file patterns in
 * the manifest, so package.json declares the ones the extensions claim
 * today (`*.canvas`); which extension opens a file is the project's answer,
 * asked each time a tab opens (`protoboard editors --file`).
 *
 * The tab loads the extension's prebuilt page (one script, one stylesheet)
 * with the extension's package and the project as its only local roots,
 * under a nonce Content-Security-Policy with no network. What the page needs
 * of the extension's own code runs in a host process the tab starts
 * (`protoboard editors host`), never in VS Code's extension host: the page's
 * messages go to it and its messages come back, and both may call the
 * services this file offers (the text document, files, the clipboard,
 * webview URIs, the theme). The messages are @protoboardai/core's
 * editor-protocol. The process ends when the tab closes.
 *
 * Nothing runs in Restricted Mode, in a project whose code was not trusted,
 * or for a file no enabled extension claims: the tab says which, with Open
 * as Text. A file outside any Protoboard project opens as text at once.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import * as vscode from "vscode";
import {
  EDITOR_PROTOCOL,
  isEditorService,
  isEnvelope,
  themeKind,
  type DocumentChange,
  type DocumentChangeReason,
  type EditorContext,
  type EditorServiceName,
  type EditorTheme,
  type FromHost,
  type ToHost,
  type ToWebviewEnvelope,
} from "@protoboardai/core/editor-protocol";
import { parseJsonOutput, runCli, type CliCommand } from "./cli.js";
import { nonce } from "./html.js";
import { EXTENSION_EDITOR, FALLBACK_COMMANDS, REOPEN_AS_TEXT, editorHtml, fallbackHtml, fallbacks, guardedPath, type Fallback } from "./extensionEditorPage.js";

export { EXTENSION_EDITOR } from "./extensionEditorPage.js";

/** What the tabs need of the running extension; undefined in Restricted Mode. */
export interface ExtensionEditorsHost {
  log: vscode.LogOutputChannel;
  /** Whether the project's code may run, asking once per project (trust.ts). */
  ensureTrust(root: string): Promise<boolean>;
  /** The project's CLI (only after ensureTrust). */
  cli(root: string): CliCommand;
  env(): NodeJS.ProcessEnv;
}

/** What `protoboard editors --file <path> --format json` prints (packages/cli/src/editors.ts). */
interface EditorsReport {
  root: string;
  editors: { id: string; extension: string; package: string }[];
  file?: {
    relPath: string | null;
    editor: {
      id: string;
      title: string;
      extension: string;
      package: string;
      packageRoot: string;
      resolved: { script: string; style?: string; host?: { module: string; export: string }; missing: string[] };
    } | null;
  };
}
type Claim = NonNullable<NonNullable<EditorsReport["file"]>["editor"]>;

/** The project folder (the one with protoboard.config.ts) above a file. */
export function projectRootOf(file: string): string | undefined {
  for (let d = dirname(file); ; d = dirname(d)) {
    if (existsSync(join(d, "protoboard.config.ts"))) return d;
    if (dirname(d) === d) return undefined;
  }
}

const theme = (): EditorTheme => ({ kind: themeKind(vscode.window.activeColorTheme.kind), id: vscode.workspace.getConfiguration("workbench").get<string>("colorTheme") ?? "" });

/** What the integration test reads of a tab. */
export interface ExtensionEditorSnapshot {
  uri: string;
  state: "loading" | "editor" | "fallback";
  fallback?: string;
  editor?: string;
  extension?: string;
  host: "none" | "running" | "exited";
  pid?: number;
  csp: { directive: string; blocked: string }[];
  /** Messages from the page, and to it, oldest first (a test run only). */
  received: unknown[];
  posted: unknown[];
}

const GRACE_MS = 3000;

class EditorTab {
  state: ExtensionEditorSnapshot["state"] = "loading";
  fallback: Fallback | undefined;
  claim: Claim | undefined;
  context: EditorContext | undefined;
  proc: ChildProcess | undefined;
  hostState: ExtensionEditorSnapshot["host"] = "none";
  readonly csp: ExtensionEditorSnapshot["csp"] = [];
  readonly received: unknown[] = [];
  readonly posted: unknown[] = [];
  private subs: vscode.Disposable[] = [];
  /** Text an applyEdit of this tab is writing: the change it causes is `applied`. */
  private applying: string | undefined;
  private disposed = false;
  private stderr: string[] = [];
  private opening: Promise<void> | undefined;

  constructor(
    readonly document: vscode.TextDocument,
    readonly panel: vscode.WebviewPanel,
    readonly root: string,
    private readonly host: () => ExtensionEditorsHost | undefined,
    private readonly test: boolean,
  ) {
    panel.webview.onDidReceiveMessage((m: unknown) => void this.fromWebview(m));
  }

  private get log(): vscode.LogOutputChannel | undefined {
    return this.host()?.log;
  }

  private say(level: "info" | "warn" | "error", line: string) {
    this.log?.[level](`[${basename(this.document.uri.fsPath)}] ${line}`);
  }

  /** Open the tab: the editor, or the page that says why not. Again after trust is given. */
  open(): Promise<void> {
    this.opening ??= this.load().finally(() => (this.opening = undefined));
    return this.opening;
  }

  private show(f: Fallback) {
    this.subs.forEach((d) => d.dispose());
    this.subs = [];
    this.claim = undefined;
    this.state = "fallback";
    this.fallback = f;
    this.panel.webview.options = { enableScripts: false, enableCommandUris: [...FALLBACK_COMMANDS], localResourceRoots: [] };
    this.panel.webview.html = fallbackHtml(nonce(), f);
  }

  private async load(): Promise<void> {
    if (this.disposed || this.state === "editor") return;
    const uri = this.document.uri.toString();
    const live = this.host();
    if (!live) return this.show(fallbacks.restricted(uri));
    if (!(await live.ensureTrust(this.root))) return this.show(fallbacks.untrusted(uri, basename(this.root), this.root));
    let report: EditorsReport;
    try {
      const r = await runCli(live.cli(this.root), ["editors", "--file", this.document.uri.fsPath, "--format", "json"], { cwd: this.root, env: live.env() });
      report = parseJsonOutput<EditorsReport>(r, "protoboard editors");
    } catch (e) {
      this.say("error", (e as Error).message);
      return this.show(fallbacks.failed(uri, (e as Error).message));
    }
    if (this.disposed) return;
    const claim = report.file?.editor;
    if (!claim) return this.show(fallbacks.unclaimed(uri, basename(this.root), basename(this.document.uri.fsPath), [...new Set(report.editors.map((e) => e.extension))]));
    const rel = (p: string) => relative(this.root, p).split(sep).join("/");
    if (claim.resolved.missing.length) return this.show(fallbacks.notBuilt(uri, claim.extension, claim.resolved.missing.map(rel)));
    this.claim = claim;
    this.start(claim);
  }

  private start(claim: Claim) {
    const w = this.panel.webview;
    const pkg = vscode.Uri.file(claim.packageRoot);
    const project = vscode.Uri.file(this.root);
    w.options = { enableScripts: true, localResourceRoots: [pkg, project] };
    const file = this.document.uri.fsPath;
    this.context = {
      protocol: EDITOR_PROTOCOL,
      editor: claim.id,
      extension: claim.extension,
      package: claim.package,
      packageRoot: claim.packageRoot,
      root: this.root,
      file,
      relPath: relative(this.root, file).split(sep).join("/"),
      readOnly: false,
      theme: theme(),
      webview: { root: w.asWebviewUri(project).toString(), package: w.asWebviewUri(pkg).toString() },
    };
    this.state = "editor";
    this.fallback = undefined;
    w.html = editorHtml({
      cspSource: w.cspSource,
      nonce: nonce(),
      script: w.asWebviewUri(vscode.Uri.file(claim.resolved.script)).toString(),
      ...(claim.resolved.style ? { style: w.asWebviewUri(vscode.Uri.file(claim.resolved.style)).toString() } : {}),
      title: basename(file),
      test: this.test,
    });
    const key = this.document.uri.toString();
    this.subs.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== key || !e.contentChanges.length) return;
        const text = e.document.getText();
        const reason: DocumentChangeReason =
          e.reason === vscode.TextDocumentChangeReason.Undo ? "undo" : e.reason === vscode.TextDocumentChangeReason.Redo ? "redo" : this.applying === text ? "applied" : "change";
        this.documentChanged({ text, version: e.document.version, dirty: e.document.isDirty, reason });
      }),
      vscode.workspace.onDidSaveTextDocument((d) => d.uri.toString() === key && this.toHost({ t: "saved", version: d.version })),
      vscode.window.onDidChangeActiveColorTheme(() => this.themeChanged()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("workbench.colorTheme") && this.themeChanged()),
    );
    if (claim.resolved.host) this.startHost(claim);
  }

  private startHost(claim: Claim) {
    const live = this.host();
    if (!live || !this.context) return;
    const cli = live.cli(this.root);
    const proc = spawn(cli.command, [...cli.args, "editors", "host", claim.package, claim.id], { cwd: this.root, env: { ...live.env(), ...(cli.env ?? {}) }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.proc = proc;
    this.hostState = "running";
    this.say("info", `${claim.extension}'s editor ${claim.id}: host process ${proc.pid} started`);
    createInterface({ input: proc.stdout! }).on("line", (line) => {
      let m: FromHost;
      try {
        m = JSON.parse(line) as FromHost;
      } catch {
        this.say("warn", `host: not a protocol line: ${line.slice(0, 120)}`);
        return;
      }
      void this.fromHost(m);
    });
    createInterface({ input: proc.stderr! }).on("line", (line) => {
      if (!line.trim()) return;
      this.stderr = [...this.stderr.slice(-19), line];
      this.say("info", `host: ${line}`);
    });
    proc.stdin!.on("error", () => undefined);
    proc.on("error", (e) => this.hostEnded(null, e.message));
    proc.on("exit", (code) => this.hostEnded(code));
    this.toHost({ t: "init", ...this.context, document: { text: this.document.getText(), version: this.document.version, dirty: this.document.isDirty } });
    this.toWebview({ protoboard: "host", state: "running" });
  }

  private hostEnded(code: number | null, error?: string) {
    if (this.hostState === "exited") return;
    this.hostState = "exited";
    this.proc = undefined;
    // closed, or already showing why (a host that said it failed)
    if (this.disposed || this.state !== "editor") return;
    const why = error ?? `exit code ${code}${this.stderr.length ? `: ${this.stderr[this.stderr.length - 1]}` : ""}`;
    this.say("error", `host process ended (${why})`);
    this.toWebview({ protoboard: "host", state: "exited", message: why });
    this.show(fallbacks.failed(this.document.uri.toString(), `${this.claim?.extension ?? "The extension"}'s editor stopped: its host process ended (${why}).`));
  }

  private toHost(m: ToHost) {
    const stdin = this.proc?.stdin;
    if (stdin?.writable) stdin.write(JSON.stringify(m) + "\n");
  }

  private toWebview(m: unknown) {
    if (this.state !== "editor") return;
    if (this.test) this.posted.push(m);
    void this.panel.webview.postMessage(m);
  }

  private documentChanged(change: DocumentChange) {
    if (this.claim?.resolved.host) this.toHost({ t: "document", ...change });
    else this.toWebview({ protoboard: "document", ...change } satisfies ToWebviewEnvelope);
  }

  private themeChanged() {
    const t = theme();
    if (this.context) this.context.theme = t;
    this.toHost({ t: "theme", theme: t });
    this.toWebview({ protoboard: "theme", theme: t } satisfies ToWebviewEnvelope);
  }

  private async fromWebview(m: unknown) {
    if (this.test) this.received.push(m);
    if (this.state !== "editor") return;
    if (!isEnvelope(m)) {
      if (this.claim?.resolved.host) this.toHost({ t: "webview", message: m });
      return;
    }
    const e = m as { protoboard: string; id?: unknown; service?: unknown; args?: unknown; directive?: unknown; blocked?: unknown; source?: unknown };
    switch (e.protoboard) {
      case "hello":
        return this.toWebview({
          protoboard: "init",
          ...this.context!,
          host: !!this.claim?.resolved.host,
          ...(this.claim?.resolved.host ? {} : { document: { text: this.document.getText(), version: this.document.version, dirty: this.document.isDirty } }),
        } satisfies ToWebviewEnvelope);
      case "call": {
        const id = Number(e.id);
        try {
          this.toWebview({ protoboard: "reply", id, result: await this.service(e.service, e.args) });
        } catch (err) {
          this.toWebview({ protoboard: "reply", id, error: (err as Error).message });
        }
        return;
      }
      case "csp":
        this.csp.push({ directive: String(e.directive), blocked: String(e.blocked) });
        this.say("warn", `Content-Security-Policy blocked ${String(e.blocked)} (${String(e.directive)}${e.source ? `, ${String(e.source)}` : ""})`);
        return;
    }
  }

  private async fromHost(m: FromHost) {
    switch (m?.t) {
      case "webview":
        return this.toWebview(m.message);
      case "call":
        try {
          this.toHost({ t: "reply", id: m.id, result: await this.service(m.service, m.args) });
        } catch (err) {
          this.toHost({ t: "reply", id: m.id, error: (err as Error).message });
        }
        return;
      case "log":
        return this.say(m.level === "warning" ? "warn" : m.level === "error" ? "error" : "info", `host: ${m.text}`);
      case "failed":
        this.say("error", `host: ${m.message}`);
        this.show(fallbacks.failed(this.document.uri.toString(), m.message.split("\n")[0]));
        return this.stopHost();
    }
  }

  /** The services the page and the host may call (EditorServices). */
  private async service(name: unknown, raw: unknown): Promise<unknown> {
    if (!isEditorService(name)) throw new Error(`no service ${String(name)}`);
    const args = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const doc = this.document;
    const path = (p: unknown, packageToo = false) => guardedPath(this.root, p, packageToo ? this.claim?.packageRoot : undefined);
    switch (name as EditorServiceName) {
      case "document.applyEdit": {
        if (typeof args.text !== "string") throw new Error("document.applyEdit needs text");
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), args.text, { needsConfirmation: false, label: typeof args.label === "string" ? args.label : "Edit" });
        this.applying = args.text;
        try {
          return { applied: await vscode.workspace.applyEdit(edit), version: doc.version };
        } finally {
          this.applying = undefined;
        }
      }
      case "document.save":
        return { saved: await doc.save() };
      case "document.undo":
      case "document.redo":
        // VS Code's undo acts on the active editor: this tab
        if (!this.panel.active) this.panel.reveal(undefined, false);
        await vscode.commands.executeCommand(name === "document.undo" ? "undo" : "redo");
        return null;
      case "file.open": {
        const uri = vscode.Uri.file(path(args.path));
        const mode = args.mode;
        if (mode === "external") await vscode.env.openExternal(uri);
        else await vscode.commands.executeCommand("vscode.open", uri, { viewColumn: mode === "beside" ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, preview: mode === "preview" });
        return null;
      }
      case "file.reveal":
        await vscode.commands.executeCommand(args.where === "os" ? "revealFileInOS" : "revealInExplorer", vscode.Uri.file(path(args.path)));
        return null;
      case "clipboard.write":
        await vscode.env.clipboard.writeText(String(args.text ?? ""));
        return null;
      case "external.open": {
        const url = String(args.url ?? "");
        if (!/^https?:\/\//i.test(url)) throw new Error("only http and https addresses open outside");
        return { opened: await vscode.env.openExternal(vscode.Uri.parse(url, true)) };
      }
      case "webview.uri": {
        try {
          return { uri: this.panel.webview.asWebviewUri(vscode.Uri.file(path(args.path, true))).toString() };
        } catch {
          return { uri: null };
        }
      }
      case "ui.notify": {
        const text = `${this.claim?.title ?? "Editor"}: ${String(args.text ?? "")}`;
        if (args.level === "error") void vscode.window.showErrorMessage(text);
        else if (args.level === "warning") void vscode.window.showWarningMessage(text);
        else void vscode.window.showInformationMessage(text);
        return null;
      }
      case "ui.confirm": {
        const action = String(args.action ?? "OK");
        return { confirmed: (await vscode.window.showInformationMessage(String(args.message ?? ""), { modal: true }, action)) === action };
      }
    }
  }

  private stopHost() {
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) return;
    this.toHost({ t: "dispose" });
    proc.stdin?.end();
    const timer = setTimeout(() => {
      if (proc.exitCode !== null || proc.pid === undefined) return;
      // the host may have started processes of its own (a browser that renders previews): on Windows the tree goes
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => proc.kill());
      else proc.kill("SIGTERM");
    }, GRACE_MS);
    proc.once("exit", () => clearTimeout(timer));
  }

  snapshot(): ExtensionEditorSnapshot {
    return {
      uri: this.document.uri.toString(),
      state: this.state,
      ...(this.fallback ? { fallback: this.fallback.title } : {}),
      ...(this.claim ? { editor: this.claim.id, extension: this.claim.extension } : {}),
      host: this.hostState,
      ...(this.proc?.pid ? { pid: this.proc.pid } : {}),
      csp: [...this.csp],
      received: [...this.received],
      posted: [...this.posted],
    };
  }

  /** The tab closed (or the extension stops): the host is told, then ended. */
  dispose(): Promise<void> {
    this.disposed = true;
    this.subs.forEach((d) => d.dispose());
    this.subs = [];
    const proc = this.proc;
    const exited = proc && proc.exitCode === null ? new Promise<void>((r) => proc.once("exit", () => r())) : Promise.resolve();
    this.stopHost();
    return exited;
  }
}

export class ExtensionEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  private readonly tabs = new Set<EditorTab>();

  constructor(
    private readonly host: () => ExtensionEditorsHost | undefined,
    private readonly test: boolean,
  ) {}

  /** The editor, and the fallback page's Open as Text, in every window (Restricted Mode too: the tab says why nothing runs). */
  static register(context: vscode.ExtensionContext, host: () => ExtensionEditorsHost | undefined): ExtensionEditorProvider {
    const provider = new ExtensionEditorProvider(host, context.extensionMode === vscode.ExtensionMode.Test);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(EXTENSION_EDITOR, provider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }),
      vscode.commands.registerCommand(REOPEN_AS_TEXT, async (target?: unknown) => {
        const uri = typeof target === "string" ? vscode.Uri.parse(target, true) : target instanceof vscode.Uri ? target : provider.activeUri();
        if (!uri) return;
        // as Reopen Editor With does: the text editor takes the tab's place
        const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === EXTENSION_EDITOR && t.input.uri.toString() === uri.toString());
        await vscode.commands.executeCommand("vscode.openWith", uri, "default", { viewColumn: tabs[0]?.group.viewColumn ?? vscode.ViewColumn.Active });
        if (tabs.length) await vscode.window.tabGroups.close(tabs);
      }),
      provider,
    );
    return provider;
  }

  private activeUri(): vscode.Uri | undefined {
    for (const t of this.tabs) if (t.panel.active) return t.document.uri;
    return undefined;
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const root = document.uri.scheme === "file" ? projectRootOf(document.uri.fsPath) : undefined;
    if (!root) {
      // not a Protoboard project's file: nothing of Protoboard applies, so it opens as VS Code would open it
      panel.webview.html = fallbackHtml(nonce(), { title: basename(document.uri.fsPath), lead: "Opening as text…", actions: [] });
      void vscode.commands.executeCommand("vscode.openWith", document.uri, "default").then(() => panel.dispose());
      return;
    }
    const tab = new EditorTab(document, panel, root, this.host, this.test);
    this.tabs.add(tab);
    panel.onDidDispose(() => {
      this.tabs.delete(tab);
      void tab.dispose();
    });
    await tab.open();
  }

  /** Trust was given (the window, or a project's code): the tabs that said it was missing try again. */
  retry() {
    for (const t of this.tabs) if (t.state === "fallback") void t.open();
  }

  snapshot(): ExtensionEditorSnapshot[] {
    return [...this.tabs].map((t) => t.snapshot());
  }

  /** A test posts to a tab's page as its host would (a test hook's query). */
  post(uri: string, message: unknown): Thenable<boolean> | undefined {
    return [...this.tabs].find((t) => t.document.uri.toString() === uri)?.panel.webview.postMessage(message);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.tabs].map((t) => t.dispose()));
    this.tabs.clear();
  }
}
