#!/usr/bin/env node
/**
 * The DCO check (.github/workflows/dco.yml; CONTRIBUTING.md, "Sign your
 * work"): every commit of a pull request carries a `Signed-off-by:` line
 * with the e-mail address of its author.
 *
 *   node .github/scripts/dco.mjs <base sha> <head sha>
 *
 * Merge commits are not checked (they add no work of their own), nor are
 * commits by GitHub's bots (Dependabot), whose author is `<name>[bot]`.
 * Exit 1, with each unsigned commit and how to sign it, when one is not.
 */
import { execFileSync } from "node:child_process";

const [base, head] = process.argv.slice(2);
if (!base || !head) {
  process.stderr.write("usage: dco.mjs <base sha> <head sha>\n");
  process.exit(2);
}

// one record per commit: sha, parents, author name, author e-mail, message
const log = execFileSync("git", ["log", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%B%x1e", `${base}..${head}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const commits = log
  .split("\x1e")
  .map((r) => r.replace(/^\n/, ""))
  .filter((r) => r.trim())
  .map((r) => {
    const [sha, parents, name, email, body] = r.split("\x1f");
    return { sha, merge: parents.trim().split(/\s+/).length > 1, name, email, body: body ?? "" };
  });

const bad = [];
let checked = 0;
for (const c of commits) {
  if (c.merge || /\[bot\]$/.test(c.name)) continue;
  checked++;
  const signers = [...c.body.matchAll(/^Signed-off-by:\s*(.+?)\s*<([^>]+)>\s*$/gim)].map((m) => ({ name: m[1], email: m[2] }));
  if (!signers.length) bad.push(`${c.sha.slice(0, 12)} ${c.name} <${c.email}>: no Signed-off-by line`);
  else if (!signers.some((s) => s.email.toLowerCase() === c.email.toLowerCase())) bad.push(`${c.sha.slice(0, 12)} ${c.name} <${c.email}>: signed off by ${signers.map((s) => `${s.name} <${s.email}>`).join(", ")}, not by its author's e-mail`);
}

if (bad.length) {
  for (const b of bad) process.stdout.write(`::error title=DCO sign-off missing::${b}\n`);
  process.stdout.write(
    [
      "",
      `${bad.length} of ${checked} commit(s) are not signed off by their author.`,
      "Every commit needs a line `Signed-off-by: Your Name <the e-mail of the commit's author>` (CONTRIBUTING.md, \"Sign your work\").",
      "Sign them and push again:",
      "  git commit --amend -s --no-edit        # the last commit",
      "  git rebase --signoff <the PR's base>   # every commit on the branch",
      "  git push --force-with-lease",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
process.stdout.write(`DCO: ${checked} commit(s) signed off by their authors${commits.length > checked ? ` (${commits.length - checked} merge or bot commit(s) not checked)` : ""}.\n`);
