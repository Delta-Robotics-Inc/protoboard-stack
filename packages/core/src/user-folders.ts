/**
 * The user's Protoboard folders kept private (PB-1048): the CLI and the
 * extension tighten them to 0700 when they start, so a folder an earlier
 * version made 0755 is not left readable by other users.
 */
import { configDir } from "./account.js";
import { tightenDir } from "./private-dir.js";
import { stackHome } from "./stack.js";

/** `<config dir>` and `~/.protoboard` (as the environment names them), tightened to 0700 where they exist. Returns the ones changed. */
export function tightenUserFolders(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  return [configDir(env, platform), stackHome(env)].filter((dir) => tightenDir(dir, platform));
}
