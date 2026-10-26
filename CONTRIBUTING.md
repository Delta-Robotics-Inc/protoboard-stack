# Contributing to Protoboard Stack

Thanks for your interest in **Protoboard Stack**: the framework core, the `protoboard` CLI, the extensions, the viewer shells and the VS Code extension in this repository. It is open source under the [Apache License 2.0](LICENSE), and contributions are welcome.

## Code of conduct

Participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it. Report unacceptable behavior to **conduct@protoboard.ai**.

## Ways to contribute

- **Report bugs**: open an issue with what you ran, what you expected and what happened (the output of `protoboard doctor` helps).
- **Propose a feature or a change to how projects are described**: open an issue *before* opening a PR. Anything that changes the UHD data model belongs in [UHD](https://github.com/Delta-Robotics-Inc/uhd), not here.
- **Fix bugs and add tests**: small PRs are welcome without prior discussion.
- **Improve docs**: corrections and clarifications in `docs/`, the READMEs and the skills.
- **Write an extension**: an `ext-*` package is the way to add a tool (a circuit, firmware or CAD provider). See [docs/specs/architecture.md](docs/specs/architecture.md).

## Development setup

The stack builds against two repositories checked out beside it in one
workspace folder: `uhd/` and `uhd-viewer/`. The root `package.json` links
them (`file:../uhd`, `file:../uhd-viewer`); [docs/ci.md](docs/ci.md)
describes the layout. Node.js 22 or later.

```bash
mkdir protoboard && cd protoboard
git clone https://github.com/Delta-Robotics-Inc/uhd
git clone https://github.com/Delta-Robotics-Inc/uhd-viewer
git clone https://github.com/Delta-Robotics-Inc/protoboard-stack
(cd uhd && npm install && npm run build)
(cd uhd-viewer && npm install && npm run build)
cd protoboard-stack
npm install
```

A few tests run the hosted parts service itself and are left out unless a
checkout of it is beside the stack (`PROTOBOARD_CLOUD_DIR`); everything else,
the client included (`packages/cloud`), is in this repository.

### Common commands

```bash
npm run pb -- --help      # the CLI from source (tsx, no build step)
npm run typecheck         # strict TypeScript over core, the CLI, the extensions and the examples
npm test                  # the framework tests (vitest)
npm run lint:brand        # "Protoboard", with a lowercase b
npm run lint:scope        # the npm scope is @protoboardai
npm run lint:licence      # every published package carries LICENSE, NOTICE and "license": "Apache-2.0"
scripts/ci-stack.sh       # the whole CI flow, with uhd and uhd-viewer beside this repository
```

The VS Code extension has its own scripts in `packages/vscode-protoboard` (`npm run build`, `npm run test:integration`, `npm run package`); see its README.

## Versions

Every package of this repository (`packages/*`, `@protoboardai/*`) and the
VS Code extension share one version number and move together: an
extension-only fix bumps the whole stack. To bump, set the same version in
every `packages/*/package.json` and `protoboard-extension.json`, in the two
`"version"` lines at the top of `packages/vscode-protoboard/package-lock.json`,
and run `npm install` for the root lockfile. Internal ranges are `^<version>`,
and each extension declares `compatibility.protoboard: "^<version>"`. UHD
and the viewer are released from their own repositories and keep their own
numbers. The extension's build and the tests
(`packages/vscode-protoboard/test/versions.test.ts`) fail when one of them
was missed. A new minor line (0.2 → 0.3) also needs `protoboard upgrade` to
know what changed for existing projects (`packages/core/src/upgrade.ts`).

### Templates and part revisions

A template (`packages/core/templates/<id>/`) pins catalog part revisions
(`template.json`, `catalogParts`) that may be older than the library
recommends; a project started from it then shows those parts as updates.
`npm run templates:parts` lists what is behind. To bring a template up to
date, set those pins to the recommended revisions, check what each changed
in a scratch project made from the template (`protoboard parts update`),
make the same fix in the template's `files/` when `check` asks for one, and
prove it with `npx vitest run packages/core/test/templates.test.ts` and
`scripts/registry/smoke.sh` against a local registry
([docs/guides/local-registry.md](docs/guides/local-registry.md)).

## Pull request process

1. Fork the repo and create a feature branch off `main`.
2. Make your change. Keep PRs focused: one logical change per PR.
3. Add or update tests covering your change.
4. Run `npm run typecheck`, `npm test` and the lints above; all must pass.
5. **Sign off every commit** (below).
6. Open a PR describing what it changes and why; link any related issue.
7. A maintainer reviews it. Changes to the project format, the CLI's commands or the extension API may need some iteration before merge.

## Sign your work: the Developer Certificate of Origin

We use the **Developer Certificate of Origin (DCO) 1.1**, as the Linux kernel and many other projects do, instead of a contributor licence agreement. There is no CLA to sign.

The DCO is a short statement, in the [DCO](DCO) file, that you wrote the contribution or otherwise have the right to submit it under the project's open-source licence. You agree to it by adding a `Signed-off-by` line to each commit message, with your real name and an email address you can be reached at:

```
Signed-off-by: Jane Smith <jane.smith@example.com>
```

Git adds the line for you with `-s`:

```bash
git commit -s -m "Fix the BOM export's currency column"
```

If you forgot, `git commit --amend -s` signs the last commit, and `git rebase --signoff main` signs every commit on your branch. A PR whose commits are not all signed off cannot be merged.

## Licence of contributions: inbound = outbound

Contributions are accepted under the same licence the project is distributed under: the **Apache License 2.0**. Section 5 of the licence says that any contribution you intentionally submit is under its terms unless you explicitly state otherwise, and the DCO sign-off records that you have the right to submit it. You keep the copyright in your contribution; you do not assign it to Delta Robotics.

Please do not submit code you copied from a project under a licence that is incompatible with Apache-2.0 (for example GPL or AGPL code), and say so in the PR when a change includes or adapts third-party code under a compatible licence, so its notice can be added to `NOTICE`.

## The name and logo

The code is yours to use, change and fork under Apache-2.0. The name "Protoboard", its logo and the "0" mark are trademarks of Delta Robotics, Inc., and the licence does not grant them. A fork you distribute needs its own name. [TRADEMARKS.md](TRADEMARKS.md) says what is fine and what needs permission.

## Style

- TypeScript, strict mode. Match the surrounding code; no formatter is enforced.
- The brand is always written "Protoboard", with a lowercase b, in prose, code and identifiers (`npm run lint:brand`).
- Prefer tests over comments.
