/**
 * Which version of @deltarobotics/uhd publish-stack.mjs may publish (PB-941).
 *
 * UHD is public and released from its own repository: a tag v<version> marks
 * the release commit and UHD's CI publishes it to npmjs from the tag. A
 * registry of ours only mirrors UHD, under two rules:
 *
 *   - a plain version (0.3.0) is the build of the commit tagged v0.3.0, with
 *     no changes to tracked files, and nothing else;
 *   - any other build is a dev build, <next version>-dev.<short sha>
 *     (0.3.1-dev.1a2b3c4), which cannot be mistaken for a release. The packages
 *     that depend on UHD then pin that exact version, in their staged copies.
 *
 * A hosted registry enforces both. The local loopback registry stays
 * permissive (it is a scratch copy of the working tree) and says so.
 *
 * Everything here is pure except uhdGitState, which asks git.
 */
import { execFileSync } from "node:child_process";

export const UHD = "@deltarobotics/uhd";

/** The version after `version` for a build that is past its release: the next patch; a prerelease's own release. */
export function nextVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(version);
  if (!m) throw new Error(`${version} is not a version`);
  return m[4] ? `${m[1]}.${m[2]}.${m[3]}` : `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/**
 * The dev version of a build: `<base>-dev.<short sha>`. The sha is cut at 7
 * characters, or longer until it is a valid semver identifier (an all-digit
 * identifier may not start with 0).
 */
export function devVersion(base, sha) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error(`${sha} is not a commit id`);
  let n = 7;
  while (n < sha.length && /^0\d*$/.test(sha.slice(0, n))) n++;
  const id = sha.slice(0, n);
  return `${base.replace(/-.*$/, "")}-dev.${/^0\d*$/.test(id) ? `g${id}` : id}`;
}

/**
 * What to publish UHD as.
 *
 *   version    package.json's version in the uhd checkout
 *   hosted     the target is a hosted registry (not loopback)
 *   dev        --uhd-dev was given
 *   git        { head, tagCommit, dirty }: HEAD's commit id, the commit tagged
 *              v<version> (undefined when there is no such tag), and whether
 *              tracked files have changes; undefined when uhd is not a git checkout
 *
 * Returns { publishAs, dev, note? } or { refuse } (a message that says how to proceed).
 */
export function uhdPublishPlan({ version, hosted, dev, git }) {
  const tag = `v${version}`;
  if (!git) {
    if (hosted || dev) return { refuse: `the uhd checkout is not a git repository, so there is no telling which commit ${version} would be. Publish from a git checkout of uhd.` };
    return { publishAs: version, dev: false, note: `uhd is not a git checkout: ${version} goes to the local registry as it is on disk. A hosted registry would refuse it.` };
  }
  const short = git.head.slice(0, 7);
  const released = git.tagCommit === git.head && !git.dirty;
  const why = git.dirty
    ? `the uhd checkout has changes to tracked files`
    : git.tagCommit === undefined
      ? `uhd has no tag ${tag} (HEAD is ${short})`
      : `uhd's HEAD (${short}) is not the commit tagged ${tag} (${git.tagCommit.slice(0, 7)})`;
  // A build past its release is on the way to the next version; one before the tag is on the way to this one.
  const devAs = devVersion(git.tagCommit !== undefined && git.tagCommit !== git.head ? nextVersion(version) : version, git.head);

  if (dev) {
    if (released) return { refuse: `uhd's HEAD is ${tag} itself: publish it as ${version} (leave out --uhd-dev).` };
    if (git.dirty && hosted) return { refuse: `${why}, so ${devAs} would not be the build of ${short}. Commit the changes (or stash them), then run again.` };
    return { publishAs: devAs, dev: true, ...(git.dirty ? { note: `${why}: ${devAs} in the local registry is the working tree, not exactly ${short}.` } : {}) };
  }
  if (released) return { publishAs: version, dev: false };
  if (hosted) {
    return {
      refuse:
        `${why}, so this build is not ${UHD} ${version}. A hosted registry gets a plain version only from the commit tagged with it. Either\n` +
        (git.dirty ? `  - commit or stash the changes in uhd first, and then\n` : "") +
        (git.tagCommit === undefined
          ? `  - release UHD ${version} first (in uhd: merge to main and push the tag ${tag}; its CI publishes it), then check out ${tag} and run this again, or\n`
          : `  - check out the release (git -C uhd switch --detach ${tag}) and run this again, or\n`) +
        `  - pass --uhd-dev to publish this build as ${devAs}; the packages that depend on UHD then pin that exact version in what is published.`,
    };
  }
  return { publishAs: version, dev: false, note: `${why}: the local registry gets this build as ${version} all the same. A hosted registry would refuse it (--uhd-dev publishes it as ${devAs}).` };
}

/**
 * Pin a package's UHD dependency to an exact version, in place: every
 * dependency section that names UHD, and the toolchain version that
 * `protoboard init` writes into new projects. Returns the fields it changed.
 */
export function pinUhd(pkg, version) {
  const changed = [];
  for (const section of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"]) {
    if (pkg[section]?.[UHD] !== undefined && pkg[section][UHD] !== version) {
      pkg[section][UHD] = version;
      changed.push(section);
    }
  }
  if (pkg.protoboard?.toolchain?.uhd !== undefined && pkg.protoboard.toolchain.uhd !== version) {
    pkg.protoboard.toolchain.uhd = version;
    changed.push("protoboard.toolchain");
  }
  return changed;
}

/** The uhd checkout's HEAD, the commit its version's tag names, and whether tracked files changed; undefined outside git. */
export function uhdGitState(dir, version) {
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  let head;
  try {
    // the checkout's own repository, not one that happens to contain the folder
    if (git("rev-parse", "--show-prefix") !== "") return undefined;
    head = git("rev-parse", "HEAD");
  } catch {
    return undefined;
  }
  let tagCommit;
  try {
    tagCommit = git("rev-parse", "--verify", "--quiet", `refs/tags/v${version}^{commit}`);
  } catch {
    tagCommit = undefined;
  }
  const dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
  return { head, tagCommit: tagCommit || undefined, dirty };
}
