/**
 * A checkpoint's Git commit (Node only): `git add` and `git commit` of one board folder, with the message the board
 * service prepared. Only the board folder's paths are committed (other staged changes stay staged and out of the
 * commit); nothing is ever pushed. Hooks run as for any commit. Git runs without a shell.
 */
import { execFile } from "node:child_process";
import { relative, resolve, sep } from "node:path";

function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((ok, fail) => {
    execFile("git", args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) fail(new Error((String(stderr || "").trim() || err.message).split("\n").slice(0, 4).join("\n")));
      else ok({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export interface CommitResult {
  /** The new commit, short. */
  commit: string;
  /** Repository-relative paths the commit holds. */
  files: string[];
  /** The repository's top folder. */
  top: string;
}

/** Commit the board folder `dir` with `message`. Throws when the folder is not in a Git repository or nothing changed in it. */
export async function commitBoardFolder(dir: string, message: string): Promise<CommitResult> {
  const d = resolve(dir);
  let top: string;
  try {
    top = (await git(d, ["rev-parse", "--show-toplevel"])).stdout.trim();
  } catch {
    throw new Error("the board folder is not in a Git repository: a checkpoint is saved, but there is nothing to commit it to");
  }
  const rel = relative(resolve(top), d).split(sep).join("/") || ".";
  if (rel.startsWith("..")) throw new Error("the board folder is outside its repository");
  await git(top, ["add", "--", rel]);
  const files = (await git(top, ["diff", "--cached", "--name-only", "--", rel])).stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!files.length) throw new Error("nothing changed in the board folder since the last commit");
  // with paths, `git commit` takes only those paths (other staged changes stay staged and out of this commit)
  await git(top, ["commit", "-m", message, "--", rel]);
  const commit = (await git(top, ["rev-parse", "--short", "HEAD"])).stdout.trim();
  return { commit, files, top };
}
