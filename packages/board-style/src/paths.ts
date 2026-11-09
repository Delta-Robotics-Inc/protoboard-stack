/** Where each layer of the cascade keeps its files. */
import { homedir } from "node:os";
import { join } from "node:path";
import { boardKey, findProjectRoot } from "@protoboardai/board";

export type Scope = "board" | "project" | "user";

/** The per-user folder of style files: `<Protoboard config folder>/pcb-style` (the config folder as the CLI resolves it). */
export function userStyleDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const config = env.PROTOBOARD_CONFIG_DIR ? env.PROTOBOARD_CONFIG_DIR : platform === "win32" && env.APPDATA ? join(env.APPDATA, "protoboard") : join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "protoboard");
  return join(config, "pcb-style");
}

/** The project's style folder: `<project>/style/pcb` (committed). */
export const projectStyleDir = (projectRoot: string): string => join(projectRoot, "style", "pcb");

/** Where a board's own layer lives: `style.json` in the board folder (the board loader ignores other files there). */
export const boardStyleFile = (boardDir: string): string => join(boardDir, "style.json");

/** The files of each layer. */
export interface StylePlaces {
  user?: { dir: string; theme: string; decisions: string; examples: string; assets: string };
  project?: { root: string; dir: string; theme: string; decisions: string; examples: string; assets: string; guide: string };
  board?: { dir: string; key: string; theme: string };
}

/**
 * The places of a board's layers: the board folder (when given), the project root (given, else found from the board
 * folder as the board core finds it), the user folder (given, else the default; `false` leaves it out).
 */
export function stylePlaces(o: { boardDir?: string; projectRoot?: string; userDir?: string | false }): StylePlaces {
  const out: StylePlaces = {};
  const userDir = o.userDir === false ? undefined : (o.userDir ?? userStyleDir());
  if (userDir) out.user = { dir: userDir, theme: join(userDir, "theme.json"), decisions: join(userDir, "decisions.jsonl"), examples: join(userDir, "examples"), assets: join(userDir, "assets") };
  const root = o.projectRoot ?? (o.boardDir ? findProjectRoot(o.boardDir) : undefined);
  if (root) {
    const dir = projectStyleDir(root);
    out.project = { root, dir, theme: join(dir, "theme.json"), decisions: join(dir, "decisions.jsonl"), examples: join(dir, "examples"), assets: join(dir, "assets"), guide: join(dir, "STYLE.md") };
  }
  if (o.boardDir) out.board = { dir: o.boardDir, key: root ? boardKey(root, o.boardDir) : "board", theme: boardStyleFile(o.boardDir) };
  return out;
}
