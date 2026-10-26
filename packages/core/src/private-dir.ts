/**
 * The user's own Protoboard folders (PB-1048): `<config dir>` (sign-ins,
 * access records, agent launchers) and `~/.protoboard` (the stack copies, the
 * terminal command, downloads) are readable by the user only, 0700, also
 * when they were made earlier with a looser mode. Windows has no such modes:
 * there the folders are the user's profile's, and secrets are encrypted
 * (account.ts).
 */
import { chmodSync, lstatSync, mkdirSync } from "node:fs";

/** Makes `dir` (and its parents) and sets it to 0700 when it is a folder with another mode. Returns `dir`. */
export function ensurePrivateDir(dir: string, platform: NodeJS.Platform = process.platform): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  tightenDir(dir, platform);
  return dir;
}

/** Sets an existing folder to 0700 (not through a link, never on Windows); a missing one is left missing. True when it changed it. */
export function tightenDir(dir: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32") return false;
  try {
    const st = lstatSync(dir);
    if (!st.isDirectory() || (st.mode & 0o777) === 0o700) return false;
    chmodSync(dir, 0o700);
    return true;
  } catch {
    return false;
  }
}
