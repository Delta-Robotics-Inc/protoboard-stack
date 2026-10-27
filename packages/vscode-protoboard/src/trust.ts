/**
 * Whether the extension may run a project's code (PB-1048). Checking,
 * building and serving a project evaluates its TypeScript
 * (protoboard.config.ts, its model files), Initialize links it, and a project
 * can carry its own Protoboard CLI in node_modules. A folder cloned from
 * anywhere could do anything with that, so the extension asks once per
 * project folder before the first of these, and remembers the answer.
 *
 * The answers are kept in `<config dir>/trusted-projects.json` (0600 in the
 * 0700 config folder), by the project's real path: one list for VS Code,
 * Cursor and the rest, which a test or the QA driver can write before VS Code
 * starts. A Restricted Mode window never runs a project's code
 * (`untrustedWorkspaces.supported: false` in the manifest keeps the extension
 * off there; `isTrusted` is checked here too).
 *
 * No VS Code API here: the question is asked through `ask`.
 */
import { chmodSync, existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensurePrivateDir } from "@protoboardai/core/private-dir";

export const TRUST_FILE = "trusted-projects.json";
export const TRUST_SCHEMA = "protoboard.trusted-projects/v1";

export interface TrustRecord {
  trusted: boolean;
  /** When it was answered. */
  at: string;
}

export interface TrustFile {
  schema: typeof TRUST_SCHEMA;
  /** Real path of a project folder → the answer. */
  projects: Record<string, TrustRecord>;
}

/** What the person says: run it, do not, or nothing (the question was dismissed: asked again next time). */
export type TrustAnswer = "trust" | "refuse" | undefined;

export interface ProjectTrustOptions {
  /** The config folder (`configDir()`): where the answers are kept. */
  dir: () => string;
  /** Whether VS Code trusts the workspace (`vscode.workspace.isTrusted`). */
  workspaceTrusted: () => boolean;
  /** Asks about one project folder. */
  ask: (root: string) => Promise<TrustAnswer>;
  now?: () => Date;
}

/** A folder by its real path, so a link and its target are one project. */
export function trustKey(root: string): string {
  try {
    return realpathSync.native(resolve(root));
  } catch {
    return resolve(root);
  }
}

export class ProjectTrust {
  private readonly asking = new Map<string, Promise<boolean>>();
  constructor(private readonly o: ProjectTrustOptions) {}

  private file(): string {
    return join(this.o.dir(), TRUST_FILE);
  }

  read(): TrustFile {
    try {
      const f = JSON.parse(readFileSync(this.file(), "utf8")) as Partial<TrustFile>;
      if (f?.schema === TRUST_SCHEMA && f.projects && typeof f.projects === "object") return { schema: TRUST_SCHEMA, projects: f.projects };
    } catch {}
    return { schema: TRUST_SCHEMA, projects: {} };
  }

  /** The answer kept for a folder: true, false, or undefined when it was never answered. */
  answer(root: string): boolean | undefined {
    const r = this.read().projects[trustKey(root)];
    return typeof r?.trusted === "boolean" ? r.trusted : undefined;
  }

  /** Whether the project's code may run now: the workspace is trusted and the folder was trusted. Never asks. */
  isTrusted(root: string): boolean {
    return this.o.workspaceTrusted() && this.answer(root) === true;
  }

  /** Keeps an answer for a folder (or forgets it, with undefined). */
  set(root: string, trusted: boolean | undefined): void {
    const f = this.read();
    const key = trustKey(root);
    if (trusted === undefined) delete f.projects[key];
    else f.projects[key] = { trusted, at: (this.o.now?.() ?? new Date()).toISOString() };
    const dir = ensurePrivateDir(this.o.dir());
    const file = join(dir, TRUST_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  }

  /**
   * Whether the project's code may run, asking when the folder was never
   * answered. One question per folder at a time: callers that come while it
   * is open wait for the same answer. A dismissed question is not kept, so
   * it comes again the next time something needs to run.
   */
  ensure(root: string): Promise<boolean> {
    if (!this.o.workspaceTrusted()) return Promise.resolve(false);
    const kept = this.answer(root);
    if (kept !== undefined) return Promise.resolve(kept);
    const key = trustKey(root);
    let p = this.asking.get(key);
    if (!p) {
      p = (async () => {
        try {
          const a = await this.o.ask(root);
          if (a === undefined) return false;
          this.set(root, a === "trust");
          return a === "trust";
        } finally {
          this.asking.delete(key);
        }
      })();
      this.asking.set(key, p);
    }
    return p;
  }

  /** Every folder with an answer. */
  list(): { root: string; trusted: boolean; at: string }[] {
    return Object.entries(this.read().projects).map(([root, r]) => ({ root, trusted: r.trusted, at: r.at }));
  }

  /** Whether a trust file exists at all (for the log). */
  exists(): boolean {
    return existsSync(this.file());
  }
}

/** The question, for the modal: the project's name and what running it means. */
export function trustQuestion(name: string, root: string): { message: string; detail: string; trust: string; refuse: string } {
  return {
    message: `Run the code of "${name}"?`,
    detail:
      `Protoboard runs a project's code to check and show it. ` +
      `That code can do anything your account can, so allow it only for projects you trust.\n\n${root}`,
    trust: "Trust and Run",
    refuse: "Don't Run",
  };
}
