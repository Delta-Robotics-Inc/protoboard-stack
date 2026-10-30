/**
 * protoboard: headless CLI over @protoboardai/core (docs/specs/core-cli-v0.md).
 * `--format json` gives machine output on every command; text is for people.
 */
import { notProvidedLines } from "./stack-messages.js";
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import meow from "meow";
import {
  CAPABILITIES,
  FRAMEWORK_VERSION,
  buildProvenance,
  fmtProvenance,
  listCapabilities,
  runCapabilityOperation,
  addParts,
  migrateParts,
  applyUpgrade,
  planUpgrade,
  checkPartUpdates,
  projectParts,
  withUpdates,
  type ProjectPart,
  type ProjectPartsReport,
  type UpdateReport,
  connectCloud,
  connectLibraries,
  declaredLibraries,
  personalLibraries,
  USER_LIBRARIES_ENV,
  discoverLibrary,
  listLibraries,
  readsNeed,
  loadConfig,
  parsePartRef,
  publishPart,
  revisionLabel,
  searchLibraries,
  LIBRARY_SORTS,
  isLibrarySort,
  libraryUsage,
  partPrices,
  libraryTaxonomy,
  originsPath,
  updatePart,
  withLibraryAdded,
  withLibraryMoved,
  withLibraryRemoved,
  writeLibraries,
  vendorOffers,
  type AddResult,
  exportSkills,
  addExtension,
  agentsSkillPaths,
  extensionPackage,
  partsToMigrate,
  refreshGuidance,
  withCurrentGuidance,
  readSkill,
  findOperation,
  listOperationRecords,
  installRuntimes,
  probeTools,
  resolveSkills,
  runtimeStatus,
  type RuntimeStatus,
  runOperation,
  type SkillHost,
  errorCount,
  findProjectRoot,
  initProject,
  listTemplates,
  vendorTemplateParts,
  inspectInstance,
  inspectProject,
  listArtifacts,
  loadProject,
  writeBuild,
  writeBundle,
  type Project,
  type ProjectDiagnostic,
  claudeCodeHost,
  claudeCodeJudge,
  loadSuites,
  runEvals,
  scriptedHost,
  type AgentHost,
  AccountError,
  accountPage,
  CredentialStore,
  accountStatus,
  accountTokensFor,
  accountService,
  unreachableService,
  signInUnreachable,
  CONFIG_FILE,
  cloudUrl,
  DEFAULT_CLOUD_URL,
  savedServices,
  unloadedProjectService,
  type AccountServiceSource,
  HOSTED_CLOUD_URL,
  configuredLibraries,
  loginWithBrowser,
  loginWithDevice,
  logout,
  serviceKey,
  ACCESS_EXIT_CODE,
  AccessError,
  OFFLINE_GRACE_DAYS,
  checkAccess,
  forgetAccess,
  type Access,
  carriedStack,
  installStack,
  globalStack,
  chooseStack,
  stackVersionMismatch,
  unfitReason,
  installedExtensions,
  unpackStackFrom,
  EDITOR_EXTENSION_DIRS,
  type StackChoice,
  type Stack,
  isStackPackage,
  linkProject,
  unlinkProject,
  linkSummary,
  listStacks,
  needsLink,
  packageState,
  projectDependencies,
  projectStackRange,
  readLinkRecord,
  stackHome,
  stackRangeFor,
  isAuthEnvName,
  tightenUserFolders,
  type LinkResult,
} from "@protoboardai/core";
import { openUrl } from "./openUrl.js";
import { commandGate, type GateEntry } from "./gate.js";
import { chooseOffer, findLine, formatBom, formatOffers, projectBom } from "./bom.js";
import { bomCsv } from "@protoboardai/core/bom";
import { writeBomSettings } from "@protoboardai/ext-sourcing/lib/cost.ts";

const cli = meow(
  `
  Usage
    $ protoboard <command> [options]

  Sign-in
    Local work needs no account: init, check, build, dev, layout, views, run, release and the rest.
    The Protoboard library does, browsing included: parts search, parts taxonomy, libraries,
    parts add, parts update, parts list --check, parts offers, parts prices and parts publish.
    Signed out, those stop with exit code 4 and one line saying to sign in with "protoboard login".
    CI: set PROTOBOARD_CLOUD_TOKEN (the service token), or "protoboard login --device".

  Commands
    init <dir>              Scaffold a portable Protoboard project; --template drone|wearable|iot starts from a
                            template derived from a reference project, and vendors its catalog parts from the
                            parts service (--no-parts skips that). The project's cloud.url is the hosted Protoboard
                            library (--url or PROTOBOARD_CLOUD_URL for another; --local for http://localhost:8787).
                            --list shows the templates; --name names the project (default: the folder name);
                            --registry <url> writes an .npmrc that takes @protoboardai/* and @deltarobotics/* from
                            that registry (default: the registry npm ran this CLI from, when it is not npmjs)
                            The project uses the Protoboard installed for your user (--stack global, the
                            default): its packages are links to the copy in ~/.protoboard/stack, so check, build,
                            dev and the viewer work with no npm install in the project. The copy is the one the
                            VS Code extension carries, or, for a CLI that npm installed, one this command installs
                            there once per version. --stack project (and --registry) installs the packages into
                            the project with npm instead: its npm install then exports its extensions' skills
                            to .claude/skills/ and lists them in AGENTS.md (a postinstall script; --no-skills
                            leaves it out). The last lines say how to open the project in a new VS Code window
    init --refresh-guidance [dir]
                            In an existing project: bring AGENTS.md's Protoboard guidance (the shared sections,
                            between its markers) to this version's and keep the project's own sections, write a
                            CLAUDE.md that imports AGENTS.md when there is none, and export the skills list;
                            lines elsewhere that contradict the guidance are reported, not rewritten
    upgrade [dir]           Move a project made by an earlier Protoboard (0.1.x) to this version: package.json's
                            @protoboardai/* ranges become ${stackRangeFor(FRAMEWORK_VERSION)} and its UHD and TypeScript pins this
                            stack's, its packages are linked again to a stack copy that fits, AGENTS.md and
                            CLAUDE.md get this version's guidance (init --refresh-guidance) and vendored parts
                            move to the current layout (parts migrate). Offline; --dry-run lists the changes and
                            writes nothing. Commit the project first, then run \`protoboard check\`
    inspect [instance]      System summary, or one instance's definition, origin, links, artifacts, diagnostics
    artifacts [instance]    Artifacts of the definitions in use (or of one instance), with the instances
                            using them and the file each resolves to
    check                   Resolve the project and run every available validator (exit 1 on errors)
    build                   Write .protoboard/build/resolved.json (derived data only)
    layout [level]          The diagram's layout measured, level by level, as the viewer draws it: line crossings,
                            overlapping cards, the longest row or column of cards (a strip), the aspect ratio and
                            lines under cards, with what to fix. A level is an instance path ("" is the top;
                            default: every level). --apply lays the level(s) out afresh, --tidy keeps the saved
                            arrangement and fixes it; either writes .protoboard/display.json where the result
                            reads better (--force: anyway). --pin <card> keeps a card where it is (repeatable;
                            remembered in the file). --check: exit 1 when a level still has something to fix.
                            check reports the levels of modules that need it as PB_DIAGRAM_LAYOUT (info)
    views check             The viewer's tabs for the root and every level with modules inside it (--module
                            <instance path or module id> for one), each opened once in a headless browser:
                            fails (exit 1) on a tab that throws, shows an empty state or draws nothing.
                            --out-dir <folder> keeps a PNG of every tab; --no-render only lists the tabs
    dev                     Serve the UHD viewer on the project: rebuilds on every source change, saves
                            diagram layout edits to .protoboard/display.json (--port, --host, --open, --no-watch)
    bom                     The bill of materials, by top-level module, in US dollars: what one unit needs, the
                            offer used for each line, what must be bought (whole packs, minimum orders), the
                            cost per unit and the cost of the order. --units <n> builds n (default: the
                            project's setting, else 1); --release <version> lists that release's ordering
                            list instead of the design; --format json carries everything, --format csv is the
                            export. Offline: prices are the offers the project holds
    bom units <n>           Set the units to build (parts/bom.json)
    bom offers <line>       The offers held for a line (its part id or ordering code), best first
    bom choose <line> <offer|supplier|auto>
                            Use that offer for the line (parts/bom.json); auto goes back to the best offer
    parts list              The project's parts: library parts (pinned revision; diverged when their vendored
                            files were edited), researched (parts/local) and designed (src/). Offline;
                            --check asks the libraries which have an update
    parts search [words]    Search every part library, results merged with the library each comes from
                            (--taxonomy, --domain, --protocol, --tag, --limit, --library; --facets adds counts;
                            --cursor <c> gives the next page, from the previous page's nextCursor).
                            --sort relevance|name|manufacturer|updated orders them, in a library that sorts
                            (relevance, the library's own ranking, is its default; --format json carries each
                            part's relevance value)
    parts taxonomy          The libraries' category taxonomy merged, with part counts over --domain,
                            --protocol, --tag and the words given
    parts add <id[@rev]...>
                            Vendor library revisions (default: the recommended one) with their closure and
                            files into parts/catalog, pinned in parts/origins.json. The part comes from the
                            first library that has it, unless --library names one or origins pins one. Its
                            .uhd.ts source comes too (linted, and checked to evaluate to the pinned
                            definition); --compiled vendors the definition JSON only
    parts migrate           Move vendored parts from the folder layout of 0.1.6 and earlier (which repeats the part
                            id in every path, too long for Windows in a nested project) to the short one; offline,
                            the pins stay. check reports PB_CATALOG_LAYOUT_EARLIER (info) while there are some
    parts update [id...]    Show the recommended revision of vendored parts and what it changes; writes nothing
    parts update <id> --to <rev|recommended>
                            Deliberately re-pin a vendored part (the replaced pin is kept as previous);
                            --library moves it to another library; --compiled as for add
    parts offers [id...]    Vendor the service's supplier offers for catalog parts into parts/offers.json
                            (what a release quotes offline; replaces those parts' entries)
    parts prices <id>       A library part's prices by source: each supplier's price breaks, stock, pack and
                            minimum order, the link and when it was observed (--mpn for one ordering code of a
                            series part). Needs a signed-in account; writes nothing
    parts publish <path>    Publish a project-researched part (parts/local) as its next catalog revision
                            (needs a publisher: signed in as one, or PROTOBOARD_CLOUD_TOKEN; --dry-run shows
                            the revision without publishing)
    login                   Sign in to Protoboard Cloud (the parts service at --url, else the project's
                            cloud.url, else the hosted Protoboard library): a browser sign-in, or
                            --device for agents and machines without a browser (a code to approve on the
                            sign-in site). The sign-in goes to Linux's keyring, Windows' DPAPI, else a file
                            only you can read; never to the project. Everything in the library needs it: search,
                            adding parts, prices and downloads
    logout                  Forget the sign-in for the service at --url
    whoami                  Who is signed in to the service at --url (--check asks the service)
    account                 Print the account page of the service at --url (the profile, sign-ins, sign out
                            everywhere, delete the account) and open it in the browser
    libraries               The project's part libraries in order (--check asks each for its discovery document)
    libraries add <id> <url> [--auth-env PROTOBOARD_<NAME>_TOKEN] [--position n]
                            Add a uhd-library/v1 library (last unless --position); with only <url>, its
                            discovery document suggests the id. --auth-env names the environment variable
                            holding its read token; tokens are never written to the project
    libraries remove <id>   Remove a library (parts vendored from it stay vendored)
    libraries move <id> <position|first|last|up|down>
                            Reorder: the first library that has a part id provides it.
                            Personal libraries (not in the project) come from PROTOBOARD_USER_LIBRARIES, a JSON
                            array of { id, url, authEnv? }; they are searched after the project's
    doctor                  Extensions, compatibility, tool availability, runtimes, skills, the sign-in and where
                            the stack's packages come from. Its Build line says whether this is a release or a
                            development build, and the commit it was built from when known
    stack                   Where this CLI and the project's packages come from: installed by npm, or links to a
                            stack copy in ~/.protoboard/stack (the copy the VS Code extension carries)
    stack link              Link the project's Protoboard packages to the Protoboard installed for your user: a
                            stack copy that fits the project (its range, its packages), this CLI's own version
                            first, and it says when it takes another (what Initialize does in VS Code, with no
                            npm and no registry); --force re-points links that lead to another copy; --carried
                            links the copy this CLI runs from whatever package.json asks. npm-installed packages
                            are never replaced. Every command warns when the project links to another version
    stack unpack [<extension folder | .vsix>]
                            Unpack the stack a Protoboard VS Code extension carries into ~/.protoboard/stack, as
                            the extension does when it starts (its archives checked against their digests), then
                            link the project to it when it fits. With no path: the installed extension of this
                            CLI's version, else the newest installed (\`protoboard stack\` lists them). A copy of
                            the same version from another build is replaced only with --replace
    setup                   Set up the rest of this machine, with no sign-in: install the Protoboard extension
                            (deltarobotics.vscode-protoboard) into VS Code, Cursor, Windsurf and VSCodium (those
                            whose command is found; it asks about each, --yes does not), from the Marketplace or
                            Open VSX through each editor's own command, or from --vsix <file> offline; then offer
                            to put the protoboard command on your PATH and to connect your agents (agents setup).
                            Never runs by itself
    stack install           Install the stack version package.json pins into ~/.protoboard/stack/<version> from a
                            registry (needs npm; --registry <url>), then link the project to it;
                            --from-vsix <extension folder | .vsix> is \`stack unpack\`
    tools                   Tool runtimes the extensions declare, and whether they are installed here
    tools install <cad|circuit|all>
                            Create the project's runtime in .protoboard/tools/ (a Python venv or Node
                            packages, exact pins from the extensions) and record it; probes, checks and
                            operations then use it without environment setup (--python <interpreter>
                            makes the venv; --clean starts over)
    skills                  List installed skills
    skills read <name> [file]
                            Print a skill's SKILL.md (or one of its files, such as references/<file>), by name:
                            how AGENTS.md tells an agent to read one, on any machine
    skills export --host <claude-code|agents-md|all>
                            Put the skills where an agent host discovers them: .claude/skills/ (claude-code),
                            a list in AGENTS.md (agents-md), or both (all). A project made by init runs it
                            at the end of npm install (--on-install: both, one line, never fails)
    extensions add <name...>
                            Add an extension to the project (ext-tscircuit, tscircuit and
                            @protoboardai/ext-tscircuit are one): package.json and protoboard.config.ts list it,
                            it is linked from the Protoboard installed for your user (no npm), and its skills
                            are exported. A project that installs its own packages (--stack project) fetches it
                            with its next npm install
    run <operation>         Run an extension operation (--input key=value; --authorize for external/physical)
    run <capability>:<op> --module <instance path or module id>
                            Run a capability operation (generate|export|extract|check, or one the
                            provider adds, such as circuit:lock) through the provider named by the
                            module's <capability>.config.ts; --force for one that takes it
    capabilities            Capabilities, their providers, and which modules use which provider
    operations              List operation records
    release [--version <v>]
                            Write the Manufacturing Package to release/<version>/ (@protoboardai/ext-release).
                            Refused while check reports errors, an output is stale or the project has
                            uncommitted changes (--allow-dirty records them; --check only reports)
    evals                   Run the eval cases that installed extensions ship in evals/: each trial works on
                            a scratch copy of the case's fixture, then is graded; scorecard and summary go to
                            .protoboard/evals/<run>/ (--extension, --case, --trials, --jobs, --host, --judge,
                            --model, --no-skills, --keep, --work-dir, --out-dir, --list, --ci)
    agents                  The agents found on this machine (Claude Code, Claude Desktop, Cursor, VS Code,
                            Windsurf, Codex, Gemini CLI, Cline) and whether each has Protoboard's MCP server
                            configured. Reads only
    agents setup            Add the MCP server to the agents' configuration, so an agent knows Protoboard from
                            the start. Asks about each agent; without a terminal, --agent <id> (repeatable) or
                            --all, with --yes. Changes only Protoboard's entry, keeps a copy of the file before
                            its first write, and says what it wrote where. With the first yes it also writes
                            Protoboard's launcher into its own folder. --scope project writes the project's
                            own file (.mcp.json, .cursor/mcp.json, .vscode/mcp.json, …)
    agents remove           Take the MCP server out again (the same options)
    agents config           The command, JSON and steps for any other MCP client. Prints only
    agents refresh          Write or update Protoboard's launcher (in its own folder; no agent's file), for a
                            client set up by hand from agents config
    mcp                     The Protoboard MCP server on stdio: what an agent starts (it takes no arguments)

  Options
    --format text|json      Output format (default text); --json is the same as --format json.
                            \`protoboard --version --json\` adds the build: commit, dirty, branch, source, release
    --cwd <dir>             Project directory (default: current)
    --url <service>         parts: the Protoboard library's URL (default PROTOBOARD_CLOUD_URL, then cloud.url in
                            protoboard.config.ts, then the hosted Protoboard library). Only parts commands,
                            init --template (its catalog parts) and login, logout and whoami use it.
    --library <id>          parts: the library to use (search: only that one)
    --compiled              parts add, parts update --to: vendor the definition JSON only, not its .uhd.ts
                            source
    --device                login: sign in with a code approved on another device (the default when this
                            terminal has no browser: no TTY, CI, SSH or no display)
    --severity <level>      check: lowest severity to print (error|warning|info, default warning)
    --module <ref>          run <capability>:<op>: instance path (board) or module id (watch-mainboard)
    --port <n>              dev: first port to try (default 5180; taken ports are skipped unless given)
    --host <addr>           dev: interface to bind (default 127.0.0.1)
    --open                  dev: open the viewer in the default browser
    --no-watch              dev: serve the current build without watching
    --host-origin <origin>  dev: origin of a window framing the viewer that may drive it and hear its
                            events (repeatable; scheme://* and * allowed; default: the page's own origin
                            and VS Code webviews)
    --allow-host <name>     dev: a Host name the server answers besides the loopback names, for a proxy that
                            forwards the external one (repeatable; * answers any: only behind a proxy that
                            authenticates, as a browser-hosted VS Code's)
    --python <path>         tools install: interpreter that creates a Python venv (default: the first
                            Python found that works; the ones refused are listed with the reason)
    --clean                 tools install: delete the runtime's folder first
    --version <v>           release: the release version (default: the root module's version)
    --allow-dirty           release: release from uncommitted changes (recorded in the manifest)
    --check                 release: run the preconditions only; write nothing. libraries: ask each
                            library for its discovery document. layout: exit 1 when a level has a warning
    --apply                 layout: lay the level(s) out afresh and write the display file where it reads better
    --tidy                  layout: start from the saved arrangement, fix what reads badly, and write it
    --pin <card>            layout: a card (node id on that level) that keeps its place (repeatable)
    --extension <id>        evals: one extension (@protoboardai/ext-parts, ext-parts or parts)
    --case <id>             evals: one case, a pattern with * (author-*), or several, comma-separated
    --trials <n>            evals: trials per case (default 1)
    --jobs <n>              evals: fixtures and trials to run at once, across cases, into one scorecard (default 1)
    --no-skills             init: no postinstall that exports the skills (npm run skills:export does it by
                            hand). evals: the ablation arm: no skills exported, their documents left out of
                            the module mirror, no Skill tool
    --on-install            skills export: what a project's postinstall runs: both hosts, one line of output,
                            nothing when no skill is installed, and never a failure
    --host <agent>          evals: scripted (default; replays each case's known-good steps) or claude-code
                            (Claude Code headless: claude -p, no MCP servers, no user settings, the case's
                            tools only, inside the scratch copy)
    --judge <judge>         evals: claude-code scores rubric graders (default: off, rubric graders skipped)
    --model <model>         evals: the model for the claude-code host and judge
    --keep                  evals: keep the fixture and trial directories
    --work-dir <dir>        evals: scratch folder (default: the system temp folder)
    --out-dir <dir>         evals: where scorecards go (default: .protoboard/evals in the project)
    --list                  evals: list the cases without running them
    --agent <id>            agents setup, remove: one agent (repeatable); the ids are in agents --format json
    --all                   agents setup, remove: every detected agent
    --yes                   agents setup, remove: do not ask (needs --agent or --all). setup: install the
                            extension into every editor found, and add the command to PATH, without asking
    --stack global|project  init: where the project's packages come from (default global: links to the Protoboard
                            installed for your user; project: installed into the project with npm)
    --vsix <file>           setup: install this extension package instead, offline (default: the extension by its
                            id, from the Marketplace or Open VSX)
    --editor <id>           setup: only this editor (code, cursor, windsurf or codium; repeatable)
    --no-agents             setup: leave the agents' configuration alone
    --scope user|project    agents: your own configuration (default) or the project's shared file. A project's
                            entry is "npx --no-install protoboard mcp" when the project depends on the CLI
                            (--portable forces that, --no-portable writes this machine's launcher)
    --ci                    evals: the CI hook: scripted host only, exit 1 on any failed trial or broken case
`,
  {
    importMeta: import.meta,
    // --version is the release version; `protoboard --version` alone prints the CLI's
    autoVersion: false,
    flags: {
      version: { type: "string" },
      release: { type: "string" },
      units: { type: "number" },
      allowDirty: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      tidy: { type: "boolean", default: false },
      pin: { type: "string", isMultiple: true },
      format: { type: "string", default: "text" },
      json: { type: "boolean", default: false },
      cwd: { type: "string" },
      url: { type: "string" },
      library: { type: "string" },
      taxonomy: { type: "string" },
      authEnv: { type: "string" },
      position: { type: "number" },
      to: { type: "string" },
      domain: { type: "string" },
      protocol: { type: "string" },
      tag: { type: "string" },
      limit: { type: "number" },
      cursor: { type: "string" },
      sort: { type: "string" },
      mpn: { type: "string" },
      days: { type: "number" },
      from: { type: "string" },
      facets: { type: "boolean", default: false },
      dryRun: { type: "boolean", default: false },
      severity: { type: "string", default: "warning" },
      host: { type: "string" },
      hostOrigin: { type: "string", isMultiple: true },
      allowHost: { type: "string", isMultiple: true },
      input: { type: "string", isMultiple: true },
      module: { type: "string" },
      authorize: { type: "boolean", default: false },
      python: { type: "string" },
      port: { type: "number" },
      open: { type: "boolean", default: false },
      watch: { type: "boolean", default: true },
      clean: { type: "boolean", default: false },
      extension: { type: "string" },
      case: { type: "string" },
      trials: { type: "number", default: 1 },
      jobs: { type: "number", default: 1 },
      skills: { type: "boolean", default: true },
      onInstall: { type: "boolean", default: false },
      judge: { type: "string" },
      model: { type: "string" },
      keep: { type: "boolean", default: false },
      workDir: { type: "string" },
      outDir: { type: "string" },
      list: { type: "boolean", default: false },
      template: { type: "string" },
      registry: { type: "string" },
      stack: { type: "string" },
      vsix: { type: "string" },
      carried: { type: "boolean", default: false },
      fromVsix: { type: "string" },
      replace: { type: "boolean", default: false },
      editor: { type: "string", isMultiple: true },
      agents: { type: "boolean", default: true },
      name: { type: "string" },
      parts: { type: "boolean", default: true },
      local: { type: "boolean", default: false },
      compiled: { type: "boolean", default: false },
      ci: { type: "boolean", default: false },
      device: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      agent: { type: "string", isMultiple: true },
      all: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      scope: { type: "string" },
      portable: { type: "boolean" },
      refreshGuidance: { type: "boolean", default: false },
      render: { type: "boolean", default: true },
      timeout: { type: "number" },
    },
  },
);

const [command, ...args] = cli.input;
// `--json` is the same as `--format json`
const json = cli.flags.format === "json" || cli.flags.json === true;

/** Where this CLI's build came from (build-info.ts): what dogfooding reports name, and doctor shows. */
const provenance = () => buildProvenance({ cliDir: fileURLToPath(new URL("..", import.meta.url)), version: String(cli.pkg.version), carried: carriedStack() });
const cwd = resolve(cli.flags.cwd ?? process.cwd());
const out = (data: unknown, text: () => string) => process.stdout.write(json ? JSON.stringify(data, null, 2) + "\n" : text() + "\n");

/** One runtime's state for doctor and `tools`. */
const fmtRuntime = (r: RuntimeStatus) =>
  [
    `  ${r.installed && !r.stale && !r.problems.length ? "✓" : "✗"} ${r.id.padEnd(10)} ${r.kind.padEnd(7)} ${
      r.problems.length ? "conflicting declarations" : r.installed ? (r.stale ? `installed with other pins; run \`protoboard tools install ${r.id}\`` : `installed in ${r.record!.dir}`) : `not installed; run \`protoboard tools install ${r.id}\``
    }`,
    `      ${r.packages.join(" ") || "(no packages)"}  for ${r.provides.join(", ")}`,
    ...r.problems.map((x) => `      ✗ ${x}`),
  ].join("\n");

const SEV_RANK = { error: 0, warning: 1, info: 2 } as const;
const fmtDiag = (d: ProjectDiagnostic) =>
  `${d.severity.toUpperCase().padEnd(7)} ${d.code}  ${d.message}${d.source ? `\n        at ${d.source.file}${d.source.line ? `:${d.source.line}` : ""}` : ""}  [${d.validator}]`;

function summaryLine(p: Project) {
  const c = (s: string) => p.diagnostics.filter((d) => d.severity === s).length;
  return `${c("error")} error(s), ${c("warning")} warning(s), ${c("info")} info`;
}

/**
 * The services a cloud command would use (gate.ts): for a library command the
 * project's libraries (or the one `--library` names), else the project's own
 * Protoboard service. A library whose token comes from the environment
 * (`authEnv`, set) is not asked: its token stands for the account.
 */
async function cloudServices(entry: GateEntry): Promise<string[]> {
  const own = await projectService();
  if (entry.uses !== "libraries" || !own.root || own.unread) return [own.url];
  try {
    const libs = configuredLibraries((await loadConfig(own.root)) ?? undefined, { url: cli.flags.url });
    const named = cli.flags.library ? libs.filter((l) => l.id === cli.flags.library) : libs;
    if (named.some((l) => isAuthEnvName(l.authEnv) && process.env[l.authEnv])) return [];
    return named.length ? [...new Set(named.map((l) => l.url))] : [own.url];
  } catch {
    return [own.url];
  }
}

/**
 * Before a cloud command (gate.ts): stop it, with one line and exit code 4,
 * when none of the services it uses accepts this machine's sign-in. A service
 * that cannot be reached, or signs no one in, lets the command go on. Local
 * commands never come here.
 */
async function requireCloud(entry: GateEntry): Promise<void> {
  // a command on the project's libraries outside a project stops on that ("no protoboard.config.ts"), which is the
  // more useful line; it reaches no library either way
  if (entry.uses === "libraries" && !findProjectRoot(cwd)) return;
  const services = await cloudServices(entry);
  if (!services.length) return;
  const answers = await Promise.all(services.map((s) => checkAccess(s)));
  if (answers.some((a) => a.allowed || a.reason === "unreachable")) return;
  throw new AccessError(answers[0]!, entry.what);
}

/** The service a new project's library is: --url, PROTOBOARD_CLOUD_URL, --local (this machine's), else the hosted one (PB-915). */
const initService = () => cloudUrl(undefined, cli.flags.url || process.env.PROTOBOARD_CLOUD_URL || (cli.flags.local ? DEFAULT_CLOUD_URL : HOSTED_CLOUD_URL));

/** The service whose sign-in an account command is about (`login`, `whoami`, `doctor`): the project's Protoboard library, or for `init` the new project's. */
async function gateService(): Promise<string> {
  if (command === "init") return initService();
  return (await projectService()).url;
}

/**
 * The service of the project here, for the sign-in: the one its configuration
 * names. A project whose configuration cannot be loaded (its packages are not
 * set up yet) does not send the sign-in to localhost (first builds review,
 * item 23): the `cloud.url` written in the file, else the service this
 * machine is signed in to, else the hosted library. `unread` says why the
 * configuration did not load.
 */
async function projectService(): Promise<{ url: string; source: AccountServiceSource; root?: string; unread?: string }> {
  const root = findProjectRoot(cwd);
  if (!root) return accountService(undefined, { url: cli.flags.url, inProject: false });
  try {
    return { ...accountService((await loadConfig(root)) ?? undefined, { url: cli.flags.url, inProject: true }), root };
  } catch (e) {
    let text: string | undefined;
    try {
      text = readFileSync(join(root, CONFIG_FILE), "utf8");
    } catch {
      text = undefined;
    }
    return { ...unloadedProjectService(text, { url: cli.flags.url, saved: savedServices({ also: [HOSTED_CLOUD_URL] }) }), root, unread: (e as Error).message.split("\n")[0]! };
  }
}

/** This CLI's own entry, and whether npm installed it (it sits in a `node_modules`), as opposed to running from the stack's repository. */
const SELF = realpathOr(fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url)));
const INSTALLED_BY_NPM = /[\\/]node_modules[\\/]@protoboardai[\\/]cli[\\/]bin[\\/]/.test(SELF);
function realpathOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * The user's global stack for a project (first builds review, D3): the copy
 * this CLI runs from (the VS Code extension's), else, for a CLI npm
 * installed, a copy in ~/.protoboard/stack that the project's range accepts
 * and that has all its packages. From the stack's own repository there is
 * none unless asked (`force`): its tests and examples install with npm.
 */
function globalStackFor(root: string, force = false): Stack | undefined {
  return stackChoiceFor(root, force).stack;
}

/**
 * Which copy a project would link to and why (PB-1024, PB-1037): one that
 * fits the project, this CLI's version first (the copy it runs from, when it
 * runs from one), saying when it falls back to another.
 */
function stackChoiceFor(root: string, force = false): StackChoice {
  if (!carriedStack() && !INSTALLED_BY_NPM && !force) return { rejected: [] };
  return chooseStack(root, { version: String(cli.pkg.version) });
}

/** Why no copy fits a project, for the error that says so. */
const noStackFits = (choice: StackChoice) =>
  `no Protoboard stack on this machine fits this project${choice.rejected.length ? ` (${choice.rejected.map((r) => `${r.version}: ${r.reason}`).join("; ")})` : ""}. \`protoboard stack unpack\` unpacks the stack an installed VS Code extension (or a .vsix) carries; \`protoboard stack install\` fetches the version package.json pins from a registry (it needs npm); the Protoboard VS Code extension carries one and needs neither (Initialize in its views). \`protoboard stack\` lists the copies in ${join(stackHome(), "stack")}`;

/**
 * A project that has no packages of its own gets them from the global stack
 * as links, said in one line (PB-929; D3). Nothing is fetched here: a project
 * whose stack is not on this machine is left as it is, and its commands say
 * what is missing.
 */
function linkIfCarried(): LinkResult | undefined {
  const root = findProjectRoot(cwd);
  if (!root || !needsLink(root)) return undefined;
  const stack = globalStackFor(root);
  return stack ? linkProject(root, stack) : undefined;
}

/** What `npm install` does in a linked project (npm 10 and 11, tried): said wherever links are made. */
const NPM_AND_LINKS = "A later `npm install` keeps each link whose version package.json accepts and adds what is missing; a package whose range asks for another version is fetched from a registry instead.";

/** The extension packages a stack copy carries. */
function listExtensionsIn(dir: string): string[] {
  try {
    return readdirSync(join(dir, "node_modules", "@protoboardai")).filter((n) => n.startsWith("ext-")).map((n) => `@protoboardai/${n}`).sort();
  } catch {
    return [];
  }
}

/** What a project's `npm install` would have run last: the skills of its extensions, exported. Never fails the command. */
async function exportSkillsAfterLink(root: string) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    if (!/skills export/.test(pkg.scripts?.postinstall ?? "")) return;
    const p = await loadProject(root, { checks: false });
    const declared = resolveSkills(p, p.extensions);
    const skills = declared.filter((s) => s.file);
    if (!skills.length) return;
    exportSkills(p, skills, "claude-code", declared);
    exportSkills(p, skills, "agents-md", declared);
    process.stderr.write(`protoboard: ${skills.length} skills of the project's extensions are in .claude/skills/ and listed in AGENTS.md\n`);
  } catch (e) {
    process.stderr.write(`protoboard: the extensions' skills were not exported (${(e as Error).message.split("\n")[0]}); run \`protoboard skills export --host all\` in the project\n`);
  }
}

/**
 * What doctor says about the project's own files (PB-1018): an AGENTS.md
 * whose skills list points at one machine's paths (written before 0.1.7), an
 * AGENTS.md that Claude Code does not read (no CLAUDE.md importing it), and
 * vendored parts in the folder layout of 0.1.6 and earlier.
 */
function projectGuidance(root: string, catalog?: string): { id: string; ok: boolean; message: string }[] {
  const out: { id: string; ok: boolean; message: string }[] = [];
  const agents = join(root, "AGENTS.md");
  if (existsSync(agents)) {
    const paths = agentsSkillPaths(readFileSync(agents, "utf8"));
    if (paths.length) out.push({ id: "agents-skill-paths", ok: false, message: `AGENTS.md lists its skills by paths on one machine (${paths.length}, such as ${paths[0]}), as Protoboard 0.1.6 and earlier wrote it; \`protoboard skills export --host agents-md\` rewrites the list with the skills' names` });
    const claude = join(root, "CLAUDE.md");
    if (!existsSync(claude)) out.push({ id: "claude-md", ok: false, message: "no CLAUDE.md beside AGENTS.md: Claude Code reads CLAUDE.md, not AGENTS.md; `protoboard init --refresh-guidance` writes one that imports AGENTS.md" });
    else if (!/^@AGENTS\.md\s*$/m.test(readFileSync(claude, "utf8"))) out.push({ id: "claude-md", ok: false, message: "CLAUDE.md does not import AGENTS.md: add the line `@AGENTS.md` to it, or Claude Code does not read this project's guidance" });
    const text = readFileSync(agents, "utf8");
    if (withCurrentGuidance(text).how !== "unchanged") out.push({ id: "agents-guidance", ok: false, message: "AGENTS.md does not carry this stack's Protoboard guidance (it was written by an earlier Protoboard, or edited inside it); `protoboard init --refresh-guidance` brings it up to date and keeps the project's own sections" });
  }
  const earlier = partsToMigrate(root, catalog);
  if (earlier.length) out.push({ id: "catalog-layout", ok: false, message: `${earlier.length} vendored part(s) in the folder layout of Protoboard 0.1.6 and earlier, whose paths can be too long for Windows; \`protoboard parts migrate\` moves them (offline)` });
  return out;
}

async function main() {
  // the user's Protoboard folders (sign-ins, the stack) are readable by the user only, also when an earlier version made them (PB-1048)
  try {
    tightenUserFolders();
  } catch {}
  // meow prints help only for a bare `--help`; `protoboard <command> --help` must not run the command
  // (what follows `--` is not an option: `parts search -- --help` searches for the word)
  const given = process.argv.slice(2);
  if ((given.includes("--") ? given.slice(0, given.indexOf("--")) : given).includes("--help")) cli.showHelp(0);
  if (!command && cli.flags.version !== undefined) {
    // the plain line stays the bare version (scripts read it); JSON adds where the build came from
    if (json) out(provenance(), () => "");
    else out({ version: cli.pkg.version }, () => String(cli.pkg.version));
    return;
  }
  // PB-929: a project without packages gets them from the stack copy this CLI runs from, before anything loads it:
  // its configuration, which names the service the sign-in is for, loads only with them
  // The account's own commands and `setup` do not: a sign-in is the user's, and its service is read without loading
  // the project (projectService), so asking who is signed in never changes a project (first builds review, item 23)
  // `upgrade` changes the ranges first and links after, so it does not link to a copy the old ranges choose
  const linked = command && !["init", "stack", "login", "logout", "whoami", "account", "setup", "upgrade"].includes(command) ? linkIfCarried() : undefined;
  // PB-1024: the CLI and the stack the project links to are different versions (`stack` says it in its own report)
  if (command && !["stack", "setup", "login", "logout", "whoami", "account", "upgrade"].includes(command)) {
    const root = findProjectRoot(cwd);
    const mismatch = root ? stackVersionMismatch(root, String(cli.pkg.version)) : undefined;
    if (mismatch) process.stderr.write(`protoboard: warning: ${mismatch}\n`);
  }
  // PB-928: only what uses the cloud needs a sign-in (gate.ts); local work never asks
  const gate = commandGate(command, args[0], { check: cli.flags.check });
  if (gate.gate === "cloud") {
    try {
      await requireCloud(gate);
    } catch (e) {
      // a refused command leaves the project as it was: the links made to read its configuration are taken back
      if (linked) unlinkProject(linked);
      throw e;
    }
  }
  if (linked) process.stderr.write(`protoboard: this project had no installed packages: ${linkSummary(linked)}. ${NPM_AND_LINKS}\n`);
  if (linked?.linked.length) await exportSkillsAfterLink(linked.root);
  switch (command) {
    case "init": {
      if (cli.flags.list) {
        const ts = listTemplates();
        out({ templates: ts }, () => ts.map((t) => `${t.id.padEnd(10)} ${t.title}\n${" ".repeat(11)}${t.description}\n${" ".repeat(11)}from ${t.derivedFrom}; extensions: ${t.extensions.join(", ")}`).join("\n") || "no templates installed");
        return;
      }
      if (cli.flags.refreshGuidance) {
        // an existing project's AGENTS.md and CLAUDE.md brought to this stack's guidance (F03), then its skills list
        const root = findProjectRoot(resolve(cwd, args[0] ?? "."));
        if (!root) throw new Error(`no protoboard.config.ts in ${resolve(cwd, args[0] ?? ".")} or its parents: --refresh-guidance works on an existing project`);
        const r = await refreshProjectGuidance(root);
        out(r, () => guidanceLines(r).join("\n"));
        return;
      }
      if (!args[0]) throw new Error("usage: protoboard init <dir> [--template <drone|wearable|iot>] [--name <name>] [--stack global|project] [--url <parts service> | --local] [--no-parts] [--no-skills]");
      if (cli.flags.stack !== undefined && cli.flags.stack !== "global" && cli.flags.stack !== "project") throw new Error(`--stack takes global (the default: the project uses the Protoboard installed for your user, with nothing installed into it) or project (its packages are installed into it with npm), not "${cli.flags.stack}"`);
      const service = initService();
      const r = initProject(args[0], { ...(cli.flags.template ? { template: cli.flags.template } : {}), ...(cli.flags.name ? { name: cli.flags.name } : {}), cloudUrl: service, skills: cli.flags.skills });
      // the stack's packages are private: a project made from a registry's CLI (npm exec, which sets
      // npm_config_registry) or given --registry installs them from the same registry
      const registry = cli.flags.registry ?? (process.env.npm_config_registry && !/registry\.npmjs\.org/.test(process.env.npm_config_registry) ? process.env.npm_config_registry : undefined);
      if (registry) {
        const url = new URL(registry).href;
        const npmrc = join(r.root, ".npmrc");
        const lines = `# The Protoboard Stack's packages come from this registry (docs/guides/local-registry.md in the stack repository).\n@protoboardai:registry=${url}\n@deltarobotics:registry=${url}\n`;
        // after the template's own settings, when it has some
        if (existsSync(npmrc)) appendFileSync(npmrc, lines);
        else {
          writeFileSync(npmrc, lines);
          r.files.push(".npmrc");
        }
      }
      // a template's starting system uses catalog parts: vendor them from the parts service now
      let vendored: Awaited<ReturnType<typeof vendorTemplateParts>> | undefined;
      let vendorError: string | undefined;
      // the one cloud step of init (gate.ts): signed out, the project is still made and its parts wait for a sign-in
      let partsSkipped: string | undefined;
      if (r.catalogParts.length && cli.flags.parts) {
        const access = await checkAccess(service);
        if (!access.allowed && access.reason !== "unreachable") partsSkipped = new AccessError(access, `The starting system's ${r.catalogParts.length} library part(s)`).message;
      }
      if (r.catalogParts.length && cli.flags.parts && !partsSkipped) {
        try {
          vendored = await vendorTemplateParts(r.root, r.catalogParts, { url: service, accountTokens: await signedIn([service]) });
          if (vendored.results.some((x) => x.status === "conflict")) vendorError = vendored.results.filter((x) => x.status === "conflict").map((x) => `${x.id}: ${x.message}`).join("; ");
        } catch (e) {
          vendorError = (e as Error).message;
        }
      }
      const addCommand = `protoboard parts add ${r.catalogParts.join(" ")}`;
      // how to run it in the project: the command on PATH when the project is linked to the user's stack, else the
      // scoped npm name; never a bare `npx protoboard`, which fetches an unrelated public package of that name
      const runIn = (command: string) => (link?.linked.length ? command : command.replace(/^protoboard /, "npx @protoboardai/cli "));
      if (vendorError) process.exitCode = 1;
      // Global by default (first builds review, D3): the project uses the Protoboard installed for the user, through
      // links, with no npm install into it. `--stack project` (or `--registry`, the registry route as it was) leaves
      // the packages to the project's own npm install.
      const stackMode: "global" | "project" = cli.flags.stack === "project" || (cli.flags.stack === undefined && (cli.flags.registry !== undefined || (!carriedStack() && !INSTALLED_BY_NPM))) ? "project" : "global";
      let link: LinkResult | undefined;
      let linkError: string | undefined;
      if (stackMode === "global") {
        try {
          // the copy this CLI runs from (the VS Code extension's), one already in ~/.protoboard/stack, or, for a CLI
          // npm installed, one installed there now from the registry npm uses: once per version, for every project
          let stack = globalStackFor(r.root, true);
          if (!stack && !carriedStack()) {
            process.stderr.write(`protoboard: setting up the Protoboard stack for your user in ${join(stackHome(), "stack")} (once per version, with npm; projects link to it)\n`);
            stack = installStack(r.root, { ...(registry ? { registry } : {}), log: (l) => process.stderr.write(`${l}\n`) });
          }
          if (!stack) throw new Error("this CLI's stack copy does not have every package the project names");
          link = linkProject(r.root, stack);
          if (cli.flags.skills && link.linked.length) await exportSkillsAfterLink(r.root);
        } catch (e) {
          linkError = (e as Error).message;
        }
      }
      // first builds review, item 35: how to open it, and what VS Code asks the first time
      const openIn = { command: "code", args: ["--new-window", r.root], note: "VS Code asks whether you trust the authors of the folder the first time it opens: say yes, or the Protoboard extension stays off in that window." };
      // the skills are read from the installed extension packages, so they are exported by the project's npm install
      const skillsLine = link?.linked.length
        ? cli.flags.skills
          ? "Skills: exported to .claude/skills/ and listed in AGENTS.md (`protoboard skills export --host all` does it again)."
          : "Skills: not exported (--no-skills); `protoboard skills export --host all` puts them in .claude/skills/ and lists them in AGENTS.md."
        : !cli.flags.skills
        ? "Skills: not exported at install (--no-skills); `npm run skills:export` after `npm install` puts them in .claude/skills/ and lists them in AGENTS.md."
        : r.template
          ? `Skills: \`npm install\` exports the skills of the project's ${r.template.extensions.length} extensions to .claude/skills/ and lists them in AGENTS.md (its postinstall; \`npm run skills:export\` does it again).`
          : "Skills: `npm install` exports the skills of the project's extension (@protoboardai/ext-hardware) to .claude/skills/ and lists them in AGENTS.md (`npm run skills:export` does it again).";
      out({ ...r, skills: link?.linked.length && cli.flags.skills ? "exported" : cli.flags.skills ? "postinstall" : "manual", stackMode, open: openIn, ...(link ? { stack: link } : {}), ...(linkError ? { stackError: linkError } : {}), ...(vendored ? { service: vendored.service, parts: vendored.results } : {}), ...(vendorError ? { partsError: vendorError, partsCommand: addCommand } : {}), ...(partsSkipped ? { partsSkipped, partsCommand: addCommand } : {}) }, () =>
        [
          `Created ${r.root}${r.template ? ` from the ${r.template.id} template (${r.template.derivedFrom})` : ""}`,
          ...r.files.map((f) => `  ${f}`),
          ...(r.kept ?? []).map((f) => `  ${f} (kept as it was)`),
          ...(r.notes ?? []).map((n) => `Note: ${n}`),
          ...(vendored ? ["", `Catalog parts from ${vendored.service}:`, fmtAdd(vendored.results, false)] : []),
          ...(vendorError
            ? ["", `The catalog parts of the starting system were not vendored: ${vendorError}`, `With the parts service reachable (signed in: \`protoboard login\`), run in the project:`, `  ${runIn(addCommand)}`]
            : partsSkipped
              ? ["", partsSkipped, "The project is made and works without them for now; after signing in, run in the project:", `  ${runIn(addCommand)}`]
              : r.catalogParts.length && !cli.flags.parts
              ? ["", "Catalog parts not vendored (--no-parts); run in the project:", `  ${runIn(addCommand)}`]
              : []),
          "",
          skillsLine,
          ...(link?.linked.length
            ? [
                `Packages: ${linkSummary(link)}. No npm install is needed. ${NPM_AND_LINKS}`,
                ...(link.notProvided.length ? [`  Not provided by the stack copy: ${link.notProvided.join(", ")} (only \`npm run typecheck\` needs them; \`npm install\` fetches them from the public npm registry and keeps the links).`] : []),
                `Next: cd ${relative(process.cwd(), r.root) || "."}, then \`protoboard check\` and \`protoboard build\`.`,
              ]
            : [
                ...(linkError
                  ? [
                      `The project was not set up with the Protoboard installed for your user: ${linkError}`,
                      "It can still be set up without npm: open it in VS Code with the Protoboard extension and choose Initialize, or run `protoboard stack install` here once the registry answers.",
                    ]
                  : []),
                ...(stackMode === "project" && !carriedStack() && !INSTALLED_BY_NPM && cli.flags.stack === undefined && cli.flags.registry === undefined ? ["Packages: this CLI runs from the stack's repository, so the project installs its own (an installed Protoboard sets a new project up with no npm install; --stack global asks for that here)."] : []),
                `Next: cd ${relative(process.cwd(), r.root) || "."} && npm install, then \`npx @protoboardai/cli check\` and \`npx @protoboardai/cli build\`.`,
              ]),
          "",
          `Open it in VS Code, in a new window: ${openIn.command} ${openIn.args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : JSON.stringify(a))).join(" ")}`,
          `  (or File > New Window, then Open Folder…). ${openIn.note}`,
        ].join("\n"),
      );
      return;
    }
    case "inspect": {
      const p = await loadProject(cwd);
      if (args[0] !== undefined) {
        const r = inspectInstance(p, args[0]);
        if (!r) throw new Error(`no instance "${args[0]}" (paths look like arm_fl/motor; see \`protoboard inspect\`)`);
        out(r, () =>
          [
            `${r.path}  ${r.name}  (${r.definition}, ${r.kind}${r.quantity > 1 ? ` ×${r.quantity}` : ""})`,
            `origin     ${r.origin.tier} ${r.origin.source.file}${r.origin.source.line ? `:${r.origin.source.line}` : ""}${r.origin.revision !== undefined ? ` @ ${revisionLabel(r.origin.revision)}` : ""}${r.origin.service ? ` (${r.origin.service})` : ""}`,
            r.origin.definitionSource ? `source     ${r.origin.definitionSource.file}` : "",
            r.manufacturer ? `part       ${r.manufacturer} ${r.partNumber ?? ""}` : "",
            `interfaces ${r.interfaces.map((i) => i.id + (i.geometry?.frame ? "◆" : "")).join(", ")}`,
            r.children.length ? `children   ${r.children.join(", ")}` : "",
            `links      ${r.links.map((l) => l.id).join(", ") || "—"}`,
            `artifacts  ${r.artifacts.map((a) => `${a.id}${a.present === true ? "" : a.present === "remote" ? " (url)" : " (missing)"}`).join(", ") || "—"}`,
            ...r.diagnostics.map(fmtDiag),
          ]
            .filter(Boolean)
            .join("\n"),
        );
        return;
      }
      const s = inspectProject(p);
      out(s, () =>
        [
          `${s.project}  (root ${s.root})`,
          `${s.instances} instances · ${s.definitions.used} definitions used (${s.definitions.tiers.catalog} catalog, ${s.definitions.tiers["project-researched"]} project-researched, ${s.definitions.tiers["project-specific"]} project-specific) · ${s.links} links`,
          `artifacts ${s.artifacts.present} present, ${s.artifacts.remote} remote (URL), ${s.artifacts.provenanceOnly} provenance-only, ${s.artifacts.missing} missing`,
          "",
          ...s.children.map((c) => `  ${c.path.padEnd(18)} ${c.definition}${c.quantity > 1 ? ` ×${c.quantity}` : ""}  [${c.kind}]`),
          "",
          ...s.checks.map((c) => `  ${c.status === "ran" ? "✓" : "–"} ${c.validator.padEnd(24)} ${c.status === "ran" ? `${c.counts.error}E ${c.counts.warning}W ${c.counts.info}I` : `skipped: ${c.reason}`}${c.status === "ran" && c.reason ? `  (${c.reason})` : ""}`),
          "",
          summaryLine(p),
        ].join("\n"),
      );
      return;
    }
    case "artifacts": {
      const p = await loadProject(cwd, { checks: false });
      const r = listArtifacts(p, args[0]);
      if (!r) throw new Error(`no instance "${args[0]}" (paths look like arm_fl/motor; see \`protoboard inspect\`)`);
      const where = (a: (typeof r)[number]) => (a.present === true ? a.resolved! : a.present === "remote" ? a.url! : a.present === "provenance" ? "(reference only)" : `${a.filePath} (missing)`);
      out({ artifacts: r }, () => r.map((a) => `${`${a.definition}#${a.id}`.padEnd(44)} ${(a.format ?? "").padEnd(6)} ${where(a)}\n${" ".repeat(45)}used by ${a.instances.join(", ") || "—"}`).join("\n") || "no artifacts");
      return;
    }
    case "check": {
      const p = await loadProject(cwd);
      // the diagram's levels of modules, as an agent should leave them (PB-1007): info, never a failure
      const { layoutDiagnostics } = await import("./layout.js");
      const layout = await layoutDiagnostics(p);
      p.diagnostics.push(...layout);
      if (p.rootDef) p.checks.push({ validator: "protoboard/layout", status: "ran", counts: { error: 0, warning: 0, info: layout.length } });
      const min = SEV_RANK[cli.flags.severity as keyof typeof SEV_RANK] ?? 1;
      const shown = p.diagnostics.filter((d) => SEV_RANK[d.severity] <= min).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
      out({ checks: p.checks, diagnostics: p.diagnostics }, () =>
        [
          ...shown.map(fmtDiag),
          "",
          ...p.checks.map((c) => `${c.status === "ran" ? "✓" : "–"} ${c.validator}${c.subject ? ` [${c.subject}]` : ""}${c.status === "skipped" ? ` (skipped: ${c.reason})` : c.reason ? ` (${c.reason})` : ""}`),
          summaryLine(p),
        ].join("\n"),
      );
      process.exitCode = errorCount(p) ? 1 : 0;
      return;
    }
    case "layout": {
      if (cli.flags.apply && cli.flags.tidy) throw new Error("give --apply or --tidy, not both");
      const p = await loadProject(cwd, { checks: false });
      const { runLayout, formatLayout } = await import("./layout.js");
      const r = await runLayout(p, {
        ...(args[0] !== undefined ? { level: args[0] } : {}),
        ...(cli.flags.apply ? { apply: "default" as const } : cli.flags.tidy ? { apply: "tidy" as const } : {}),
        ...(cli.flags.pin?.length ? { pin: cli.flags.pin.flatMap((x) => x.split(",").map((y) => y.trim()).filter(Boolean)) } : {}),
        force: cli.flags.force,
      });
      out(r, () => formatLayout(r));
      process.exitCode = cli.flags.check && r.warnings ? 1 : 0;
      return;
    }
    case "build": {
      const p = await loadProject(cwd);
      const r = writeBuild(p);
      const b = await writeBundle(p);
      out({ ...r, bundle: b }, () => `wrote ${r.file} (${r.bytes} bytes, ${r.digest.slice(0, 23)}…)\nwrote ${b.file} (UHD bundle for viewers, ${b.bytes} bytes)\n${summaryLine(p)}`);
      process.exitCode = errorCount(p) ? 1 : 0;
      return;
    }
    case "dev": {
      const root = findProjectRoot(cwd);
      if (!root) throw new Error(`no protoboard.config.ts in ${cwd} or its parents (run \`protoboard init\`)`);
      const { startDev } = await import("./dev/server.js");
      const clock = () => new Date().toTimeString().slice(0, 8);
      const dev = await startDev({
        root,
        port: cli.flags.port,
        strictPort: cli.flags.port !== undefined,
        host: cli.flags.host,
        watch: cli.flags.watch,
        hostOrigins: cli.flags.hostOrigin?.flatMap((o) => o.split(",").map((x) => x.trim()).filter(Boolean)),
        allowHosts: cli.flags.allowHost?.flatMap((o) => o.split(",").map((x) => x.trim()).filter(Boolean)),
        log: (e) =>
          json
            ? process.stdout.write(JSON.stringify({ time: new Date().toISOString(), ...e }) + "\n")
            : (e.level === "info" ? process.stdout : process.stderr).write(`${clock()} ${e.level === "info" ? "" : `${e.level.toUpperCase()} `}${e.message}\n`),
      });
      if (cli.flags.open) openUrl(dev.url);
      if (!json) process.stdout.write(`Press Ctrl+C to stop.\n`);
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        void dev.close().then(() => process.exit(0));
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return;
    }
    case "bom": {
      const p = await loadProject(cwd, { checks: false });
      const opts = { ...(cli.flags.release ? { release: cli.flags.release } : {}), ...(cli.flags.units !== undefined ? { units: cli.flags.units } : {}) };
      if (args[0] === "units") {
        const n = Number(args[1]);
        if (!Number.isInteger(n) || n < 1) throw new Error("usage: protoboard bom units <n> (a whole number, 1 or more)");
        const saved = writeBomSettings(p.root, { units: n });
        out(saved, () => `Units to build: ${saved.units} (parts/bom.json)`);
        return;
      }
      if (args[0] === "offers") {
        if (!args[1]) throw new Error("usage: protoboard bom offers <line>");
        const t = projectBom(p, opts);
        const line = findLine(t, args[1]);
        out({ line: line.key, units: t.units, needed: line.needed, chosen: line.chosen ?? null, choice: line.choice, offers: line.offers, quotes: line.quotes }, () => formatOffers(t, line));
        return;
      }
      if (args[0] === "choose") {
        if (!args[1] || !args[2]) throw new Error("usage: protoboard bom choose <line> <offer id | supplier | auto>");
        const r = chooseOffer(p, args[1], args.slice(2).join(" "));
        out(r, () => (r.offer ? `${r.line}: ${r.supplier} is used (${r.offer}; parts/bom.json)` : `${r.line}: the best offer by the rules is used again (parts/bom.json)`));
        return;
      }
      if (args[0]) throw new Error(`unknown bom command "${args[0]}"; use: bom, bom units <n>, bom offers <line>, bom choose <line> <offer|supplier|auto>`);
      const t = projectBom(p, opts);
      if (cli.flags.format === "csv") process.stdout.write(bomCsv(t));
      else out(t, () => formatBom(t));
      return;
    }
    case "parts": {
      await parts(args[0], args.slice(1));
      return;
    }
    case "login":
    case "logout":
    case "whoami":
    case "account": {
      await account(command);
      return;
    }
    case "libraries": {
      await libraries(args[0], args.slice(1));
      return;
    }
    case "doctor": {
      if (!findProjectRoot(cwd)) {
        // outside a project there is still a setup to explain: the sign-in, and which CLI and Node.js run
        const access = await checkAccess(await gateService());
        const packages = stackStatus();
        const note = `No project here (no protoboard.config.ts in ${cwd} or its parents): extensions, tools, runtimes and skills are reported inside a project (\`protoboard init\` makes one).`;
        const build = provenance();
        out({ framework: FRAMEWORK_VERSION, build, account: access, packages, project: null, note }, () => [`Protoboard ${FRAMEWORK_VERSION}`, `Build ${fmtProvenance(build)}`, "", "Account (the Protoboard library)", `  ${accessMark(access)} ${fmtAccess(access)}`, "", "Packages", ...fmtStack(packages).map((l) => `  ${l}`), "", note].join("\n"));
        return;
      }
      const p = await loadProject(cwd, { checks: false });
      // a runtime's first probe in this project is slow (a cold import): said on stderr before it blocks, once per
      // line (an operation of several extensions names the same tool)
      const saidOnce = new Set<string>();
      const tools = probeTools(p.extensions, {
        root: p.root,
        log: (line) => {
          if (saidOnce.has(line)) return;
          saidOnce.add(line);
          process.stderr.write(`${line}\n`);
        },
      });
      const runtimes = runtimeStatus(p.root, p.extensions);
      const skills = resolveSkills(p, p.extensions);
      const extDiags = p.diagnostics.filter((d) => d.validator === "protoboard/extensions");
      // the sign-in (PB-928) and where the packages come from (PB-929): what a broken setup most often is
      const access = await checkAccess(await gateService());
      const packages = stackStatus();
      const guidance = projectGuidance(p.root, p.config.catalog);
      const build = provenance();
      const data = {
        framework: FRAMEWORK_VERSION,
        build,
        account: access,
        packages,
        guidance,
        extensions: p.extensions.map((e) => ({
          id: e.manifest.id,
          version: e.manifest.version,
          compatibility: e.manifest.compatibility,
          operations: (e.manifest.operations ?? []).map((o) => ({ id: o.id, effect: o.effect })),
          checks: (e.manifest.checks ?? []).map((c) => c.id),
          ...(e.manifest.capabilities?.length ? { capabilities: e.manifest.capabilities.map((c) => c.id) } : {}),
        })),
        tools,
        runtimes: runtimes.map(({ record, ...r }) => ({ ...r, ...(record ? { dir: record.dir, installedAt: record.installedAt } : {}) })),
        skills: skills.map((s) => ({ id: s.id, extension: s.extension, found: !!s.file })),
        diagnostics: extDiags,
      };
      out(data, () =>
        [
          `Protoboard ${FRAMEWORK_VERSION} · ${p.name}`,
          `Build ${fmtProvenance(build)}`,
          "",
          "Account (the Protoboard library)",
          `  ${accessMark(access)} ${fmtAccess(access)}`,
          "",
          "Packages",
          ...fmtStack(packages).map((l) => `  ${l}`),
          "",
          "Extensions",
          ...(data.extensions.length
            ? data.extensions.map((e) => `  ✓ ${e.id}@${e.version}  ops: ${e.operations.map((o) => `${o.id} (${o.effect})`).join(", ") || "—"}  checks: ${e.checks.join(", ") || "—"}${e.capabilities ? `  provides: ${e.capabilities.join(", ")}` : ""}`)
            : ["  (none configured)"]),
          ...extDiags.map((d) => `  ✗ ${d.message}`),
          "",
          "Tools",
          ...(tools.length
            ? tools.map(
                (t) =>
                  `  ${t.available ? "✓" : "✗"} ${t.id.padEnd(20)} ${t.purpose}${t.source === "runtime" ? `  (project runtime ${t.runtime})` : t.source === "environment" ? "  (from the environment)" : ""}${t.note ? `  (${t.note})` : ""}${t.available ? "" : `\n      missing: ${t.detail}${t.install ? `\n      install: ${t.install}` : ""}`}`,
              )
            : ["  (no external tools required)"]),
          ...(runtimes.length ? ["", "Runtimes (.protoboard/tools)", ...runtimes.map(fmtRuntime)] : []),
          "",
          `Skills (${skills.length})`,
          ...skills.map((s) => `  ${s.file ? "✓" : "✗"} ${s.id.padEnd(24)} ${s.extension}`),
          ...(guidance.length ? ["", "Project files", ...guidance.map((g) => `  ${g.ok ? "✓" : "✗"} ${g.message}`)] : []),
        ].join("\n"),
      );
      process.exitCode = extDiags.some((d) => d.severity === "error") ? 1 : 0;
      return;
    }
    case "tools": {
      const p = await loadProject(cwd, { checks: false });
      if (args[0] === "install") {
        const ids = args.slice(1);
        if (!ids.length) throw new Error("usage: protoboard tools install <cad|circuit|all> [--python <interpreter>] [--clean]");
        const r = await installRuntimes(p.root, p.extensions, ids, {
          python: cli.flags.python,
          clean: cli.flags.clean,
          log: (line) => process.stderr.write(`${line}\n`),
        });
        out(r, () =>
          r
            .map((x) =>
              [
                `${x.status === "installed" ? "✓" : "✗"} ${x.id} (${x.kind}) ${x.status === "installed" ? `installed in ${x.dir}` : "failed"}${x.message ? `: ${x.message}` : ""}`,
                ...x.verified.map((v) => `    ${v.available ? "✓" : "✗"} ${v.tool}  ${v.detail ?? ""}`),
                ...(x.shadowed ?? []).map((v) => `    note: ${v.name} is set (${v.value}); doctor and operations use it instead of this runtime until you unset it`),
              ].join("\n"),
            )
            .join("\n"),
        );
        process.exitCode = r.every((x) => x.status === "installed") ? 0 : 1;
        return;
      }
      if (args[0] !== undefined) throw new Error("usage: protoboard tools [install <cad|circuit|all>]");
      const r = runtimeStatus(p.root, p.extensions);
      out(r, () => (r.length ? ["Runtimes (.protoboard/tools)", ...r.map(fmtRuntime)].join("\n") : "no extension in this project declares a managed runtime"));
      return;
    }
    case "extensions": {
      if (args[0] !== "add" || args.length < 2) throw new Error("usage: protoboard extensions add <name...>  (e.g. ext-tscircuit)");
      const root = findProjectRoot(cwd);
      if (!root) throw new Error(`no protoboard.config.ts in ${cwd} or its parents (run \`protoboard init\`)`);
      const wanted = args.slice(1).map(extensionPackage);
      // a project whose packages npm installed (a project-local stack) gets the extension from its own npm install;
      // every other project links it from the Protoboard installed for the user, which must carry it
      const local = packageState(root, "@protoboardai/core").state === "installed";
      const stack = local ? undefined : globalStackFor(root, true);
      if (!local) {
        if (!stack) throw new Error("the Protoboard installed for your user was not found for this project (`protoboard stack` says where it looks); nothing was changed");
        const missing = wanted.filter((w) => !existsSync(join(stack.dir, "node_modules", ...w.split("/"), "package.json")));
        if (missing.length) throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not in the Protoboard installed for your user (${stack.marker.version}, ${stack.dir}); nothing was changed. The extensions it has: ${listExtensionsIn(stack.dir).join(", ") || "none"}`);
      }
      const added: Awaited<ReturnType<typeof addExtension>>[] = [];
      for (const w of wanted) added.push(await addExtension(root, w, { fallbackRange: stackRangeFor(FRAMEWORK_VERSION) }));
      const link = stack ? linkProject(root, stack) : undefined;
      let skills: string | undefined;
      try {
        const p = await loadProject(root, { checks: false });
        const declared = resolveSkills(p, p.extensions);
        const found = declared.filter((x) => x.file);
        exportSkills(p, found, "claude-code", declared);
        exportSkills(p, found, "agents-md", declared);
        skills = `${found.length} skills in .claude/skills/ and listed in AGENTS.md`;
      } catch (e) {
        skills = `not exported (${(e as Error).message.split("\n")[0]}); \`protoboard skills export --host all\` does it`;
      }
      out({ added, ...(link ? { stack: link } : {}), local, skills }, () =>
        [
          ...added.map((a) => `${a.packageJson === "present" && a.config === "present" ? "·" : "✓"} ${a.package}: ${a.packageJson === "added" ? `package.json ${a.range}` : "already in package.json"}; ${a.config === "added" ? "listed in protoboard.config.ts" : "already listed in protoboard.config.ts"}`),
          link ? `Packages: ${linkSummary(link)}.` : "This project installs its own packages (a project-local stack): its next `npm install` fetches the extension. Ask the person before running it.",
          `Skills: ${skills}.`,
        ].join("\n"),
      );
      return;
    }
    case "skills": {
      if (args[0] === "export" && cli.flags.onInstall) {
        // a project's postinstall: both hosts, one line, and never a failed install
        try {
          const p = await loadProject(cwd, { checks: false });
          const declared = resolveSkills(p, p.extensions);
          const skills = declared.filter((s) => s.file);
          if (!skills.length) return;
          const { duplicates } = exportSkills(p, skills, "claude-code", declared);
          exportSkills(p, skills, "agents-md", declared);
          process.stdout.write(`protoboard: ${skills.length} skills of the installed extensions are in .claude/skills/ and listed in AGENTS.md (npm run skills:export does it again)${duplicates.length ? `; not exported: ${duplicates.join(", ")}, declared by two extensions (protoboard doctor)` : ""}\n`);
        } catch (e) {
          process.stdout.write(`protoboard: the extensions' skills were not exported (${(e as Error).message.split("\n")[0]}); run \`npm run skills:export\` in the project\n`);
        }
        return;
      }
      const p = await loadProject(cwd, { checks: false });
      const skills = resolveSkills(p, p.extensions);
      if (args[0] === "read") {
        // a skill by name, wherever this machine keeps it: what AGENTS.md tells an agent to run (PB-1018)
        if (!args[1] || args.length > 3) throw new Error("usage: protoboard skills read <name> [references/<file>]");
        const r = readSkill(skills, args[1], args[2]);
        out({ id: r.skill.id, extension: r.skill.extension, file: args[2] ?? "SKILL.md", files: r.files, text: r.text }, () => r.text.trimEnd() + (args[2] || !r.files.length ? "" : `\n\n---\nFiles of this skill (protoboard skills read ${r.skill.id} <file>): ${r.files.join(", ")}`));
        return;
      }
      if (args[0] === "export") {
        const host = cli.flags.host ?? "";
        if (!["claude-code", "agents-md", "all"].includes(host)) throw new Error("usage: protoboard skills export --host claude-code|agents-md|all");
        const hosts: SkillHost[] = host === "all" ? ["claude-code", "agents-md"] : [host as SkillHost];
        const each = hosts.map((h) => exportSkills(p, skills, h));
        const r = { written: each.flatMap((x) => x.written), skipped: [...new Set(each.flatMap((x) => x.skipped))], duplicates: [...new Set(each.flatMap((x) => x.duplicates))] };
        out(r, () => `${r.written.length} written${r.skipped.length ? `, ${r.skipped.length} skipped (not found: ${r.skipped.join(", ")})` : ""}${r.duplicates.length ? `, not exported: ${r.duplicates.join(", ")} (declared by two extensions: protoboard doctor)` : ""}\n${r.written.map((w) => `  ${w}`).join("\n")}`);
        return;
      }
      out(
        skills.map((s) => ({ ...s, file: s.file ? s.file : null })),
        () => skills.map((s) => `${s.id.padEnd(24)} ${s.summary}\n${" ".repeat(25)}${s.file ?? "(not found)"}${s.verifiedBy ? `  · verify: ${s.verifiedBy}` : ""}`).join("\n"),
      );
      return;
    }
    case "run": {
      if (!args[0]) throw new Error("usage: protoboard run <operation> [--input key=value] [--authorize]");
      const p = await loadProject(cwd);
      const inputs = Object.fromEntries((cli.flags.input ?? []).map((kv) => [kv.split("=")[0], kv.split("=").slice(1).join("=")]));
      const [capability, capOp] = args[0].split(":");
      if (capOp !== undefined && (CAPABILITIES as readonly string[]).includes(capability)) {
        const bound = p.capabilities.filter((b) => b.capability === capability).map((b) => b.module ?? b.config);
        if (!cli.flags.module) throw new Error(`usage: protoboard run ${args[0]} --module <instance path or module id>; modules with a ${capability} config: ${bound.join(", ") || "none"}`);
        // --force: for an operation that declares a force input (circuit:generate on a locked board)
        if (cli.flags.force && inputs.force === undefined) inputs.force = "true";
        const rec = await runCapabilityOperation(p, capability, capOp, cli.flags.module, inputs, { authorize: cli.flags.authorize });
        out(rec, () =>
          [
            `${rec.status.toUpperCase()}  ${rec.operation} ${rec.capability!.module} via ${rec.extension.id}  ${rec.summary}`,
            ...(rec.log ?? []).map((l) => `  ${l}`),
            ...rec.outputs.map((o) => `  → ${o.path} (${o.bytes} bytes)`),
            ...(rec.diagnostics ?? []).map(fmtDiag),
          ].join("\n"),
        );
        process.exitCode = rec.status === "succeeded" ? 0 : 1;
        return;
      }
      const found = findOperation(p.extensions, args[0]);
      if (!found) throw new Error(`no operation "${args[0]}" in the configured extensions (see \`protoboard doctor\`)`);
      const rec = await runOperation(p, found.ext, found.op, inputs, { authorize: cli.flags.authorize });
      // the operation's log (part-verify's findings, a thrown error's stack) is part of its answer, not only of the record
      out(rec, () => [`${rec.status.toUpperCase()}  ${found.ext.manifest.id}:${rec.operation}  ${rec.summary}`, ...(rec.log ?? []).map((l) => `  ${l}`), ...rec.outputs.map((o) => `  → ${o.path} (${o.bytes} bytes)`)].join("\n"));
      process.exitCode = rec.status === "succeeded" ? 0 : 1;
      return;
    }
    case "capabilities": {
      const p = await loadProject(cwd, { checks: false });
      const r = listCapabilities(p);
      const problems = p.diagnostics.filter((d) => d.validator === "protoboard/capabilities");
      out({ ...r, diagnostics: problems }, () =>
        [
          ...r.capabilities.flatMap((c) => [
            `${c.id}  (${c.operations.join(", ")}; outputs ${c.outputs.join(", ")})`,
            ...(c.providers.length ? c.providers.map((x) => `  provider ${x.extension}@${x.version}  native: ${x.native}/`) : ["  (no provider installed)"]),
            ...r.modules.filter((m) => m.capability === c.id).map((m) => `  ${m.status === "ready" ? "✓" : "✗"} ${(m.module ?? "?").padEnd(24)} ${m.provider}  ${m.config}${m.instances.length ? `  [${m.instances.join(", ")}]` : ""}${m.problem ? `\n      ${m.problem}` : ""}`),
          ]),
          ...problems.filter((d) => d.severity !== "error" || !r.modules.some((m) => m.problem === d.message)).map(fmtDiag),
        ].join("\n"),
      );
      process.exitCode = problems.some((d) => d.severity === "error") ? 1 : 0;
      return;
    }
    case "release": {
      const p = await loadProject(cwd);
      const found = findOperation(p.extensions, "release");
      if (!found) throw new Error("protoboard release needs @protoboardai/ext-release: npm install it and add it to extensions in protoboard.config.ts");
      const inputs: Record<string, string> = { "allow-dirty": String(cli.flags.allowDirty), check: String(cli.flags.check) };
      if (cli.flags.version) inputs.version = cli.flags.version;
      const rec = await runOperation(p, found.ext, found.op, inputs, { record: !cli.flags.check });
      const data = (rec.data ?? {}) as { diagnostics?: { severity: string; code: string; message: string }[]; documents?: { path: string; pages: number }[] };
      out(rec, () =>
        [
          `${rec.status.toUpperCase()}  release  ${rec.summary}`,
          ...(data.documents ?? []).map((d) => `  → ${d.path} (${d.pages} page${d.pages === 1 ? "" : "s"})`),
          ...(data.diagnostics ?? []).filter((d) => d.severity !== "info").map((d) => `${d.severity.toUpperCase().padEnd(7)} ${d.code}  ${d.message}`),
        ].join("\n"),
      );
      process.exitCode = rec.status === "succeeded" ? 0 : 1;
      return;
    }
    case "operations": {
      const p = await loadProject(cwd, { checks: false, extensions: false });
      const recs = listOperationRecords(p);
      out(recs, () => recs.map((r) => `${r.record.startedAt}  ${r.record.status.padEnd(9)} ${r.record.extension.id}:${r.record.operation}  ${r.record.summary}`).join("\n") || "no operation records");
      return;
    }
    case "evals": {
      await evals();
      return;
    }
    case "views": {
      if (args[0] !== "check") throw new Error("usage: protoboard views check [--module <instance path or module id>] [--out-dir <folder for PNGs>] [--no-render] [--timeout <s>]");
      const { viewsCheck, formatViewsCheck } = await import("./views-check.js");
      const r = await viewsCheck({ cwd, module: cli.flags.module, out: cli.flags.outDir, render: cli.flags.render, timeout: cli.flags.timeout, log: json ? undefined : (line) => process.stderr.write(line + "\n") });
      out(r, () => formatViewsCheck(r));
      process.exitCode = r.failed || (!r.rendered && cli.flags.render) ? 1 : 0;
      return;
    }
    case "upgrade": {
      await upgradeCommand(args[0]);
      return;
    }
    case "stack": {
      if (args[0] === "unpack") await stackUnpack(args[1]);
      else await stackCommand(args[0]);
      return;
    }
    case "agents": {
      const { agentsCommand, terminalConfirm } = await import("./agents.js");
      await agentsCommand(args[0], args.slice(1), { agent: cli.flags.agent, all: cli.flags.all, yes: cli.flags.yes, scope: cli.flags.scope, portable: process.argv.includes("--portable") ? true : process.argv.includes("--no-portable") ? false : undefined }, { json, cwd, version: String(cli.pkg.version), out, confirm: terminalConfirm() });
      return;
    }
    case "setup": {
      if (args.length) throw new Error("usage: protoboard setup [--vsix <file>] [--editor code|cursor|windsurf|codium]… [--yes] [--no-agents]");
      // no sign-in and no service: the editors install the extension from their own galleries (PB-1047)
      const { setupCommand, setupExitCode } = await import("./setup.js");
      const { agentsCommand, terminalConfirm } = await import("./agents.js");
      const confirm = terminalConfirm();
      const r = await setupCommand(
        { ...(cli.flags.vsix ? { vsix: cli.flags.vsix } : {}), yes: cli.flags.yes, ...(cli.flags.editor?.length ? { editor: cli.flags.editor } : {}), agents: cli.flags.agents },
        {
          json,
          cwd,
          out,
          log: (line) => process.stderr.write(`${line}\n`),
          ...(confirm ? { confirm } : {}),
          // the agents' set-up asks about each agent itself: never with this command's --yes
          agents: () => agentsCommand("setup", [], {}, { json, cwd, version: String(cli.pkg.version), out, confirm }),
        },
      );
      process.exitCode = process.exitCode || setupExitCode(r);
      return;
    }
    case "mcp": {
      // the server an agent starts: stdout is the protocol's
      const { serveStdio } = await import("./mcp/server.js");
      await serveStdio(cli.flags.cwd ? { cwd } : {});
      return;
    }
    default:
      cli.showHelp(command ? 2 : 0);
  }
}

/** The mark beside the account line: signed out is not a problem of the setup. */
const accessMark = (a: Access) => (a.allowed ? "✓" : a.reason === "signed-out" ? "–" : "✗");

/** The account line of `doctor` and `whoami`: the cloud's access, never a fault of the local setup. */
function fmtAccess(a: Access): string {
  if (!a.allowed && a.reason === "signed-out") return `not signed in to ${a.service}: local work needs no account; the library (searching it, its parts, prices and publishing) does (sign in with \`protoboard login\`)`;
  if (!a.allowed) return a.message ?? "not allowed";
  switch (a.via) {
    case "open-service":
      return `${a.service} signs no one in: no account is needed`;
    case "service-token":
      return "PROTOBOARD_CLOUD_TOKEN is set (the service token)";
    case "offline":
      return `signed in${a.email ? ` as ${a.email}` : ""}; ${a.service} cannot be reached, and its last confirmation (${a.verifiedAt?.slice(0, 10)}) is accepted until ${a.offlineUntil?.slice(0, 10)} (${OFFLINE_GRACE_DAYS} days)`;
    default:
      return `signed in${a.email ? ` as ${a.email}` : ""}; ${a.service} accepts the account${a.via === "recent" ? ` (confirmed ${a.verifiedAt?.slice(0, 16).replace("T", " ")} UTC)` : ""}`;
  }
}

/** Where this CLI and the project's packages come from (`protoboard stack`, `doctor`). */
function stackStatus() {
  const carried = carriedStack();
  const home = stackHome();
  const root = findProjectRoot(cwd);
  const deps = root ? projectDependencies(root) : {};
  return {
    cli: { version: String(cli.pkg.version), entry: fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url)), from: carried ? ("stack" as const) : ("npm" as const), ...(carried ? { stack: carried.dir, source: carried.marker.source } : {}) },
    node: { version: process.versions.node, path: process.execPath, ...(process.versions.electron ? { vscodeRuntime: true } : {}) },
    home,
    stacks: listStacks(home).map((s) => ({ version: s.marker.version, source: s.marker.source, dir: s.dir })),
    // PB-1024: the editors' Protoboard extensions, and whether the stack each carries is unpacked here
    extensions: installedExtensions(home).map((e) => ({ dir: e.dir, version: e.version, carries: e.carried?.version ?? null, unpacked: e.unpacked })),
    ...(root
      ? {
          project: {
            root,
            ...(projectStackRange(root) ? { range: projectStackRange(root) } : {}),
            ...(readLinkRecord(root) ? { link: readLinkRecord(root) } : {}),
            ...(stackVersionMismatch(root, String(cli.pkg.version)) ? { mismatch: stackVersionMismatch(root, String(cli.pkg.version)) } : {}),
            packages: Object.keys(deps)
              .filter(isStackPackage)
              .sort()
              .map((name) => ({ name, ...packageState(root, name) })),
          },
        }
      : {}),
  };
}

function fmtStack(s: ReturnType<typeof stackStatus>): string[] {
  const pk = s.project?.packages ?? [];
  const count = (state: string) => pk.filter((x) => x.state === state).length;
  return [
    `CLI ${s.cli.version}: ${s.cli.from === "stack" ? `the stack copy ${s.cli.stack} (${s.cli.source === "vsix" ? "carried by the VS Code extension" : "installed from a registry"})` : `installed by npm (${s.cli.entry})`}`,
    `Node.js ${s.node.version}${s.node.vscodeRuntime ? " (VS Code's own runtime)" : ""}: ${s.node.path}`,
    ...(s.project
      ? [
          `Project packages${s.project.range ? ` (package.json asks for ${s.project.range})` : ""}: ${[count("installed") && `${count("installed")} installed by npm`, count("linked") && `${count("linked")} linked to ${s.project.link?.stack ?? "a stack copy"}`, count("broken-link") && `${count("broken-link")} links to a copy that is gone (\`protoboard stack link\`)`, count("missing") && `${count("missing")} missing (\`npm install\`, or \`protoboard stack link\`)`].filter(Boolean).join(", ") || "none named"}`,
        ]
      : []),
    ...(s.project?.mismatch ? [`Warning: ${s.project.mismatch}`] : []),
    `Stack copies in ${join(s.home, "stack")}: ${s.stacks.map((x) => `${x.version} (${x.source === "vsix" ? "VS Code extension" : "registry"})`).join(", ") || "none"}`,
    ...s.extensions.map((e) =>
      e.carries === null
        ? `VS Code extension ${e.version} (${e.dir}): carries no stack`
        : e.unpacked
          ? `VS Code extension ${e.version} (${e.dir}): its stack ${e.carries} is unpacked`
          : `VS Code extension ${e.version} (${e.dir}): its stack ${e.carries} is not unpacked yet. \`protoboard stack unpack ${e.dir}\` unpacks it (the extension also does when VS Code starts it)`,
    ),
  ];
}

/** `init --refresh-guidance` (F03): AGENTS.md and CLAUDE.md brought to this stack's guidance, then the skills list. */
async function refreshProjectGuidance(root: string) {
  const r = refreshGuidance(root);
  let skills: string | undefined;
  try {
    const p = await loadProject(root, { checks: false });
    const declared = resolveSkills(p, p.extensions);
    const found = declared.filter((x) => x.file);
    if (found.length) {
      exportSkills(p, found, "claude-code", declared);
      exportSkills(p, found, "agents-md", declared);
      skills = `${found.length} skills of the project's extensions listed in AGENTS.md and copied to .claude/skills/`;
    }
  } catch (e) {
    skills = `the skills list was not refreshed (${(e as Error).message.split("\n")[0]}); run \`protoboard skills export --host all\``;
  }
  return { ...r, ...(skills ? { skills } : {}) };
}

function guidanceLines(r: Awaited<ReturnType<typeof refreshProjectGuidance>>): string[] {
  const said = { replaced: "its Protoboard guidance replaced with this stack's", inserted: "this stack's Protoboard guidance added", unchanged: "its Protoboard guidance already this stack's", written: "written, with this stack's Protoboard guidance" }[r.agents];
  return [`AGENTS.md: ${said}`, `CLAUDE.md: ${r.claude === "written" ? "written (it imports AGENTS.md)" : "kept as it was"}`, ...(r.skills ? [r.skills] : []), ...r.notes.map((n) => `note: ${n}`)];
}

/**
 * `protoboard upgrade [dir]` (PB-1051): a project made by an earlier stack line moved to this one, offline.
 * 1. package.json: the @protoboardai/* ranges and the toolchain pins (core's planUpgrade);
 * 2. the packages: linked again to a copy that fits the new ranges (a project whose packages npm installed is
 *    told to run npm install instead; nothing npm put there is replaced);
 * 3. AGENTS.md and CLAUDE.md: `init --refresh-guidance`;
 * 4. vendored parts: `parts migrate`.
 */
async function upgradeCommand(dir: string | undefined) {
  const root = findProjectRoot(resolve(cwd, dir ?? "."));
  if (!root) throw new Error(`no protoboard.config.ts in ${resolve(cwd, dir ?? ".")} or its parents: upgrade works on an existing project`);
  const plan = planUpgrade(root);
  const changeLines = plan.changes.map((c) => `  ${c.name}: ${c.from} → ${c.to} (${c.field})`);
  const keptLines = plan.kept.map((k) => `  ${k.name}: ${k.spec} kept (not a version range)`);
  if (cli.flags.dryRun) {
    out({ dryRun: true, ...plan }, () =>
      [plan.changes.length ? `package.json would change (${plan.from ?? "no stack range"} → ${plan.to}):` : `package.json already asks for ${plan.to}`, ...changeLines, ...keptLines, "then: the packages linked again, AGENTS.md and CLAUDE.md refreshed, vendored parts migrated. Nothing was written."].join("\n"),
    );
    return;
  }
  // package.json as it was: put back when the packages cannot be linked again, so a project is never left
  // asking for one version while its links lead to another (linkProject puts its own links back)
  const pkgFile = join(root, "package.json");
  const pkgBefore = readFileSync(pkgFile, "utf8");
  applyUpgrade(plan);
  // the packages: npm-installed ones are the project's; links (or none) are re-pointed to a copy the new ranges accept
  const names = Object.keys(projectDependencies(root)).filter(isStackPackage);
  const installed = names.filter((n) => packageState(root, n).state === "installed");
  let link: LinkResult | undefined;
  let linkNote: string | undefined;
  if (installed.length) linkNote = `${installed.length} package(s) were installed by npm: run \`npm install\` in the project to fetch ${plan.to}`;
  else {
    const choice = stackChoiceFor(root, true);
    if (choice.stack) {
      try {
        link = linkProject(root, choice.stack, { force: true });
      } catch (e) {
        writeFileSync(pkgFile, pkgBefore);
        throw new Error(`the packages could not be linked to the stack ${choice.stack.marker.version} (${(e as Error).message}); nothing was changed: package.json and the links are as they were`);
      }
    } else linkNote = noStackFits(choice);
  }
  // guidance and parts need the project's configuration to load: with packages that do not fit yet, say what to run
  const loads = !installed.length && Boolean(link);
  const guidance = await refreshProjectGuidance(root);
  let migrated: Awaited<ReturnType<typeof migrateParts>> | undefined;
  let migrateNote: string | undefined;
  if (loads) {
    try {
      migrated = migrateParts(await loadProject(root, { checks: false }));
    } catch (e) {
      migrateNote = `vendored parts were not migrated (${(e as Error).message.split("\n")[0]}); run \`protoboard parts migrate\``;
    }
  } else migrateNote = "vendored parts: run `protoboard parts migrate` once the packages are installed";
  const moved = migrated?.filter((x) => x.status === "moved") ?? [];
  const next = loads ? "protoboard check" : installed.length ? "npm install, then protoboard parts migrate and protoboard check" : "protoboard stack unpack (or stack install), then protoboard upgrade again";
  out({ ...plan, ...(link ? { link } : {}), ...(linkNote ? { linkNote } : {}), guidance, ...(migrated ? { migrated: moved.map((m) => m.id) } : {}), ...(migrateNote ? { migrateNote } : {}), next }, () =>
    [
      plan.changes.length ? `package.json: ${plan.from ?? "no stack range"} → ${plan.to}` : `package.json: already ${plan.to}`,
      ...changeLines,
      ...keptLines,
      link ? linkSummary(link) : `packages: ${linkNote}`,
      ...guidanceLines(guidance),
      migrated ? (moved.length ? `parts: ${moved.length} vendored part(s) moved to the current folder layout; parts/origins.json records the new paths` : "parts: every vendored part is in the current folder layout") : `parts: ${migrateNote}`,
      ...(migrated && migrateNote ? [`parts: ${migrateNote}`] : []),
      `Next: ${next}. Review the changes and commit them with the project.`,
    ].join("\n"),
  );
  if (link?.linked.length) await exportSkillsAfterLink(root);
}

/** `protoboard stack [link|install]` (PB-929). */
async function stackCommand(sub: string | undefined) {
  if (sub === undefined) {
    const s = stackStatus();
    out(s, () => fmtStack(s).join("\n"));
    return;
  }
  const root = findProjectRoot(cwd);
  if (!root) throw new Error(`no protoboard.config.ts in ${cwd} or its parents (run \`protoboard init\`)`);
  if (sub === "link") {
    // a copy that fits the project, this CLI's version first (D3: the user's global stack; PB-1024). --carried: the copy
    // this CLI runs from whatever package.json asks (the extension's "Update Project to the Stack This Extension Carries")
    let choice: StackChoice;
    if (cli.flags.carried) {
      const carried = carriedStack();
      if (!carried) throw new Error("--carried: this CLI does not run from a stack copy (it was installed by npm, or runs from the stack's repository)");
      choice = { stack: carried, preferred: carried.marker.version, rejected: [] };
    } else choice = stackChoiceFor(root, true);
    const stack = choice.stack;
    if (!stack) throw new Error(noStackFits(choice));
    const r = linkProject(root, stack, { force: cli.flags.force });
    const fallback = choice.fallback ? `${choice.fallback}; linked ${stack.marker.version} instead` : undefined;
    const mismatch = stackVersionMismatch(root, String(cli.pkg.version));
    if (fallback) process.stderr.write(`protoboard: ${fallback}\n`);
    else if (mismatch) process.stderr.write(`protoboard: warning: ${mismatch}\n`);
    out({ ...r, ...(choice.preferred ? { preferred: choice.preferred } : {}), ...(fallback ? { fallback } : {}), ...(mismatch ? { mismatch } : {}) }, () =>
      [
        linkSummary(r),
        ...notProvidedLines(root, r.notProvided),
        ...(r.range && r.satisfied === false ? [`package.json asks for ${r.range} and this copy is ${r.version}: \`protoboard stack install\` fetches a matching one from a registry, or change the ranges in package.json`] : []),
        ...(r.linked.length && r.made.length === 0 && r.version !== String(cli.pkg.version) && !cli.flags.force ? [`the links were there already; \`protoboard stack link --force\` re-points them to the copy chosen now`] : []),
      ].join("\n"),
    );
    if (r.linked.length) await exportSkillsAfterLink(root);
    return;
  }
  if (sub === "install" && cli.flags.fromVsix !== undefined) return stackUnpack(cli.flags.fromVsix);
  if (sub === "install") {
    const stack = installStack(root, { ...(cli.flags.registry ? { registry: cli.flags.registry } : {}), log: (l) => process.stderr.write(`${l}\n`) });
    const r = linkProject(root, stack, { force: true });
    out({ stack: stack.dir, version: stack.marker.version, link: r }, () => `installed stack ${stack.marker.version} in ${stack.dir}\n${linkSummary(r)}`);
    if (r.linked.length) await exportSkillsAfterLink(root);
    return;
  }
  throw new Error("usage: protoboard stack [link [--force] [--carried] | unpack [<extension folder | .vsix>] | install [--registry <url> | --from-vsix <extension folder | .vsix>]]");
}

/**
 * `protoboard stack unpack [<extension folder | .vsix>]` (PB-1024): the stack
 * a VS Code extension carries, unpacked into ~/.protoboard/stack with the
 * extension's own checked steps; then, in a project it fits, linked.
 */
async function stackUnpack(given: string | undefined) {
  const home = stackHome();
  let from = given ? resolve(cwd, given) : undefined;
  if (!from) {
    const found = installedExtensions(home).filter((e) => e.carried);
    const pick = found.find((e) => e.version === String(cli.pkg.version)) ?? found[0];
    if (!pick) throw new Error(`no Protoboard VS Code extension that carries a stack is installed in ${EDITOR_EXTENSION_DIRS.map((d) => `~/${d}`).join(", ")}: give its folder or a .vsix file (protoboard stack unpack <path>)`);
    from = pick.dir;
  }
  let last = -1;
  const r = await unpackStackFrom(from, home, {
    // a copy of the same version from another build is replaced only when asked (PB-1048)
    replace: cli.flags.replace,
    onProgress: (f, what) => {
      const pct = Math.floor(f * 10) * 10;
      if (pct !== last) process.stderr.write(`protoboard: ${what} (${pct}%)\n`);
      last = pct;
    },
  });
  const root = findProjectRoot(cwd);
  const unfit = root ? unfitReason(root, r.stack) : undefined;
  const link = root && !unfit ? linkProject(root, r.stack, { force: cli.flags.force }) : undefined;
  out({ version: r.version, stack: r.stack.dir, unpacked: r.unpacked, from, ...(link ? { link } : {}), ...(root && unfit ? { notLinked: unfit } : {}) }, () =>
    [
      r.unpacked ? `unpacked the Protoboard stack ${r.version} into ${r.stack.dir} (from ${from})` : `the Protoboard stack ${r.version} from ${from} is in ${r.stack.dir} already`,
      ...(link ? [linkSummary(link)] : []),
      ...(root && unfit ? [`this project was not linked to it: ${unfit}`] : []),
    ].join("\n"),
  );
  if (link?.linked.length) await exportSkillsAfterLink(link.root);
}

/** `protoboard evals`: discover the suites installed here, run them through one host, write the scorecard. */
async function evals() {
  const root = findProjectRoot(cwd) ?? cwd;
  if (cli.flags.list) {
    const suites = await loadSuites(cwd, { extension: cli.flags.extension, case: cli.flags.case });
    const rows = suites.flatMap((s) => s.cases.map((c) => ({ key: c.key, title: c.title, requires: c.requires ?? [], budget: c.budget, graders: c.graders.map((g) => g.kind) })));
    const problems = suites.flatMap((s) => s.problems.map((p) => ({ extension: s.extension, ...p })));
    out({ cases: rows, problems }, () =>
      [
        ...rows.map((r) => `${r.key}\n    ${r.title}  (${r.budget.turns} turns, ${r.budget.seconds} s; graders: ${r.graders.join(", ")}${r.requires.length ? `; needs ${r.requires.join(", ")}` : ""})`),
        ...problems.map((p) => `✗ ${p.extension} ${p.dir}: ${p.message}`),
        `${rows.length} case(s)`,
      ].join("\n"),
    );
    process.exitCode = problems.length ? 1 : 0;
    return;
  }
  const hostId = cli.flags.host ?? "scripted";
  if (!(cli.flags.jobs >= 1)) throw new Error("--jobs is a whole number, 1 or more");
  if (cli.flags.ci && (hostId !== "scripted" || cli.flags.judge)) throw new Error("--ci runs the scripted host only, without a judge (agent runs cost money and are not deterministic)");
  const hosts: Record<string, () => AgentHost> = { scripted: () => scriptedHost, "claude-code": () => claudeCodeHost({ model: cli.flags.model }) };
  if (!hosts[hostId]) throw new Error(`unknown host ${hostId}; use scripted or claude-code`);
  if (cli.flags.judge !== undefined && cli.flags.judge !== "claude-code") throw new Error(`unknown judge ${cli.flags.judge}; use claude-code`);
  const r = await runEvals({
    from: cwd,
    extension: cli.flags.extension,
    case: cli.flags.case,
    trials: cli.flags.trials,
    jobs: cli.flags.jobs,
    skills: cli.flags.skills,
    host: hosts[hostId](),
    judge: cli.flags.judge ? claudeCodeJudge({ model: cli.flags.model }) : undefined,
    cli: [process.execPath, fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url))],
    outDir: cli.flags.outDir ? resolve(cli.flags.outDir) : join(root, ".protoboard", "evals"),
    workDir: cli.flags.workDir ? resolve(cli.flags.workDir) : undefined,
    keep: cli.flags.keep,
    log: (line) => process.stderr.write(`${line}\n`),
  });
  out(r.scorecard, () => `${r.summary}\nScorecard: ${r.file}`);
  const t = r.scorecard.totals;
  process.exitCode = t.errors || r.scorecard.problems.length || t.passed < t.trials ? 1 : 0;
}

const fmtAdd = (r: AddResult[], showLibrary = false) =>
  r
    .map((x) => `${x.status.padEnd(10)} ${x.id}${x.revision ? `@${x.revision}` : ""}${showLibrary && x.library ? `  from ${x.library}` : ""}${x.requiredBy ? `  (for ${x.requiredBy})` : ""}${x.files ? `  ${x.files} file(s)` : ""}${x.message ? `\n           ${x.message}` : ""}`)
    .join("\n");

/** `parts search|add|update|offers|prices|publish` (and `usage`, for the library's publishers): the only commands that talk to part libraries. */
async function parts(sub: string | undefined, rest: string[]) {
  const usage = "usage: protoboard parts list [--check] | search [words] [--sort <order>] | taxonomy [words] | add <id[@rev]...> | update [id...] [--to <rev>] | offers [id...] | prices <id> [--mpn <code>] | publish <path> [--dry-run] | migrate";
  // `usage` is the library owners' command (publishers only): it works, and is left out of the help users read
  if (!["list", "search", "taxonomy", "add", "update", "offers", "prices", "usage", "publish", "migrate"].includes(sub ?? "")) throw new Error(usage);
  const p = await loadProject(cwd, { checks: sub === "publish" });
  if (sub === "list" && !cli.flags.check) return listParts(projectParts(p));
  if (sub === "migrate") {
    // offline: the vendored files move to the short layout, their bytes and pins stay (PB-1018)
    const r = migrateParts(p);
    const moved = r.filter((x) => x.status === "moved");
    out({ parts: r }, () =>
      moved.length
        ? [
            `${moved.length} vendored part(s) moved to the short folder layout; parts/origins.json records the new paths`,
            ...moved.map((x) => `  ${x.id}: ${x.fromFiles ?? x.from}/ → ${x.to}/ (${x.files} file(s))${x.missing?.length ? `; not there to move: ${x.missing.length} (\`protoboard parts add ${x.id}\` restores them)` : ""}${x.leftOver?.length ? `; left in ${x.from}/: ${x.leftOver.join(", ")}` : ""}`),
            "Commit the moves with parts/origins.json.",
          ].join("\n")
        : `every vendored part is already in the short folder layout (${r.length} checked)`,
    );
    return;
  }
  // the user's sign-ins (protoboard login) for these libraries, refreshed; never read from or written to the project
  const accountTokens = await signedIn(configuredLibraries(p.config, { url: cli.flags.url }).map((l) => l.url));
  const libs = connectLibraries(p.config, { url: cli.flags.url, accountTokens });
  const named = cli.flags.library;
  if (named && !libs.some((l) => l.id === named)) throw new Error(`no library "${named}" in protoboard.config.ts (configured: ${libs.map((l) => l.id).join(", ")}; \`protoboard libraries\`)`);
  const service = libs[0].url;
  switch (sub) {
    case "list": {
      // the libraries asked once each; a library that cannot answer leaves its parts as pinned
      const report = projectParts(p);
      const problems: string[] = [];
      const updates: UpdateReport[] = [];
      for (const lib of libs) {
        const ids = report.parts.filter((x) => x.tier === "catalog" && (x.library ?? DEFAULT_LIBRARY) === lib.id).map((x) => x.id);
        if (!ids.length) continue;
        try {
          updates.push(...(await checkPartUpdates(p, ids, lib)));
        } catch (e) {
          problems.push(`${lib.id}: ${(e as Error).message}`);
        }
      }
      return listParts(withUpdates(report, updates, new Date().toISOString(), problems));
    }
    case "search": {
      const asked = named ? libs.filter((l) => l.id === named) : libs;
      const sort = cli.flags.sort;
      if (sort !== undefined && !isLibrarySort(sort)) throw new Error(`--sort takes ${LIBRARY_SORTS.join(", ")}; not "${sort}"`);
      const r = await searchLibraries(asked, {
        ...(sort ? { sort } : {}),
        q: rest.join(" "),
        taxonomy: cli.flags.taxonomy,
        domain: cli.flags.domain,
        protocol: cli.flags.protocol,
        tag: cli.flags.tag,
        limit: cli.flags.limit,
        ...(cli.flags.cursor ? { cursor: cli.flags.cursor } : {}),
        ...(cli.flags.facets ? { facets: true } : {}),
      });
      const width = Math.max(...r.parts.map((x) => x.library.length), 0);
      out({ service: asked[0].url, ...r }, () =>
        [
          asked.length === 1 && !r.libraries[0].error
            ? `${r.total} part(s) at ${asked[0].url}${r.parts.length < r.total ? ` (showing ${r.parts.length})` : ""}`
            : `${r.total} part(s) in ${asked.length} libraries${r.parts.length < r.total ? ` (showing ${r.parts.length})` : ""}: ${r.libraries.map((l) => (l.error ? `${l.id} failed` : `${l.id} ${l.total}`)).join(", ")}`,
          ...r.parts.map(
            (x) =>
              `  ${x.library.padEnd(width)}  ${`${x.partId}@${x.recommendedRevision ?? x.latestRevision}`.padEnd(44)} ${[x.manufacturer, x.partNumber].filter(Boolean).join(" ").slice(0, 34).padEnd(34)}  ${x.protocols.join(",") || x.domains.join(",")}${x.shadowedBy ? `  (${x.shadowedBy} provides this id first)` : ""}`,
          ),
          ...r.libraries.filter((l) => l.error).map((l) => `  ${l.id}: ${l.error}`),
          ...(sort && r.libraries.some((l) => !l.error && !l.sorted) ? [`  not sorted by ${sort} (the library does not offer it; its own order): ${r.libraries.filter((l) => !l.error && !l.sorted).map((l) => l.id).join(", ")}`] : []),
          ...(r.nextCursor ? [`  more: --cursor ${r.nextCursor}${sort ? ` --sort ${sort}` : ""}`] : []),
        ].join("\n"),
      );
      return;
    }
    case "prices": {
      if (rest.length !== 1) throw new Error("usage: protoboard parts prices <id> [--mpn <ordering code>]");
      // offers are the Protoboard Cloud service's, not part of the library protocol
      const cloud = connectCloud(p.config, { url: cli.flags.url, accountTokens });
      const r = await partPrices(cloud, parsePartRef(rest[0]).partId, { ...(cli.flags.mpn ? { mpn: cli.flags.mpn } : {}) });
      const money = (n: number, currency?: string) => `${currency ?? ""} ${n}`.trim();
      out({ service: cloud.url, ...r }, () =>
        r.unavailable
          ? `no prices for ${r.partId}: ${r.unavailable.message}`
          : [
              `${r.partId}: ${r.sources.length} source(s), ${r.offers} offer(s) at ${cloud.url}`,
              ...r.sources.flatMap((s) => [
                `  ${s.supplier}${s.authorized ? " (authorized)" : ""}${s.from ? `  from ${money(s.from.unitPrice, s.from.currency)}` : ""}`,
                ...s.offers.map(
                  (o) =>
                    `    ${[o.mpn, o.sku && `sku ${o.sku}`, (o.priceBreaks ?? (o.unitPrice !== undefined ? [{ quantity: o.minQuantity ?? 1, unitPrice: o.unitPrice }] : [])).map((b) => `${b.quantity}+ ${money(b.unitPrice, o.currency)}`).join(", "), o.stock !== undefined && `${o.stock} in stock`, o.packaging, o.minQuantity !== undefined && `min ${o.minQuantity}`, `observed ${o.observedAt.slice(0, 10)}${o.stale ? " (stale)" : ""}`]
                      .filter(Boolean)
                      .join("  ")}${o.url ? `\n      ${o.url}` : ""}`,
                ),
              ]),
              ...(r.sources.length ? [] : ["  the library holds no offers for it"]),
            ].join("\n"),
      );
      process.exitCode = r.unavailable ? 1 : 0;
      return;
    }
    case "usage": {
      const cloud = connectCloud(p.config, { url: cli.flags.url, accountTokens });
      const r = await libraryUsage(cloud, { ...(cli.flags.days ? { days: cli.flags.days } : {}), ...(cli.flags.from ? { from: cli.flags.from } : {}), ...(cli.flags.to ? { to: cli.flags.to } : {}), ...(cli.flags.limit ? { limit: cli.flags.limit } : {}) });
      const width = Math.max(...r.parts.map((x) => x.partId.length), 8);
      out({ service: cloud.url, ...r }, () =>
        [
          `${cloud.url}  ${r.from} to ${r.to} (${r.days} day(s)): ${r.totals.adds} add(s) of ${r.totals.parts} part(s), ${r.totals.downloads} download(s)`,
          `  ${"part".padEnd(width)}  adds  downloads  as dependency  seed  relevance`,
          ...r.parts.map((x) => `  ${x.partId.padEnd(width)}  ${String(x.adds).padStart(4)}  ${String(x.downloads).padStart(9)}  ${String(x.asDependency).padStart(13)}  ${String(x.seed).padStart(4)}  ${String(x.relevance).padStart(9)}`),
          ...(r.parts.length ? [] : ["  no part was downloaded in this period"]),
          "  adds: a part added or updated in a project, once per account, revision and day; downloads: every request for the revision, looks included. Counts only: the library does not keep who.",
        ].join("\n"),
      );
      return;
    }
    case "taxonomy": {
      const asked = named ? libs.filter((l) => l.id === named) : libs;
      const r = await libraryTaxonomy(asked, { q: rest.join(" ") || undefined, domain: cli.flags.domain, protocol: cli.flags.protocol, tag: cli.flags.tag });
      const lines: string[] = [];
      const walk = (nodes: typeof r.nodes, depth: number) => {
        for (const n of nodes) {
          if (!n.count && depth > 0) continue;
          lines.push(`${"  ".repeat(depth + 1)}${n.path.padEnd(44 - depth * 2)} ${String(n.count).padStart(4)}  ${n.name}`);
          walk(n.children, depth + 1);
        }
      };
      walk(r.nodes, 0);
      out(r, () =>
        [
          `${r.total} part(s), ${r.uncategorised} without a category: ${r.libraries.map((l) => (l.error ? `${l.id} failed` : `${l.id} (${l.taxonomy!.id} ${l.taxonomy!.version})`)).join(", ")}`,
          ...lines,
          ...r.unknown.map((u) => `  not in the taxonomy: ${u.path} ${u.count}`),
          ...r.libraries.filter((l) => l.error).map((l) => `  ${l.id}: ${l.error}`),
        ].join("\n"),
      );
      return;
    }
    case "add": {
      if (!rest.length) throw new Error("usage: protoboard parts add <id[@rev]...> [--library <id>] [--compiled]");
      rest.forEach(parsePartRef);
      const r = await addParts(p, rest, libs, { ...(named ? { library: named } : {}), compiled: cli.flags.compiled });
      out({ service, results: r }, () => fmtAdd(r, libs.length > 1));
      process.exitCode = r.some((x) => x.status === "conflict") ? 1 : 0;
      return;
    }
    case "update": {
      if (cli.flags.to !== undefined) {
        if (rest.length !== 1) throw new Error("usage: protoboard parts update <id> --to <revision|recommended> [--library <id>]");
        const to = cli.flags.to === "recommended" ? "recommended" : Number(cli.flags.to);
        if (to !== "recommended" && !(Number.isInteger(to) && to >= 1)) throw new Error(`--to takes a revision number or "recommended", not "${cli.flags.to}"`);
        const r = await updatePart(p, rest[0], to, libs, { ...(named ? { library: named } : {}), compiled: cli.flags.compiled });
        out({ service, results: r }, () => fmtAdd(r, libs.length > 1));
        process.exitCode = r.some((x) => x.status === "conflict") ? 1 : 0;
        return;
      }
      const r = await checkPartUpdates(p, rest, libs);
      out({ service, parts: r }, () =>
        r.map((x) => `${x.status.padEnd(16)} ${x.id}${x.pinned !== undefined ? `  pinned ${revisionLabel(x.pinned)}` : ""}${x.recommended !== undefined ? `, recommended ${x.recommended}` : ""}${libs.length > 1 && x.library ? `  [${x.library}]` : ""}\n                 ${x.message}`).join("\n") || "no vendored parts",
      );
      process.exitCode = r.some((x) => x.status === "not-vendored") ? 1 : 0;
      return;
    }
    case "offers": {
      // offers are the Protoboard Cloud service's, not part of the library protocol
      const cloud = connectCloud(p.config, { url: cli.flags.url, accountTokens });
      const r = await vendorOffers(p, rest, cloud);
      out(r, () => [...r.map((x) => `${x.status.padEnd(12)} ${x.id}${x.status === "vendored" ? `  ${x.offers} offer(s)` : "  (not a catalog part; record its offers with ext-sourcing)"}`), `wrote parts/offers.json from ${cloud.url}`].join("\n"));
      return;
    }
    case "publish": {
      if (rest.length !== 1) throw new Error("usage: protoboard parts publish <parts/local/<file>.uhd.ts | part id> [--dry-run]");
      const cloud = connectCloud(p.config, { url: cli.flags.url, accountTokens });
      const r = await publishPart(p, rest[0], cloud, { cwd, dryRun: cli.flags.dryRun });
      out(r, () =>
        [
          r.message,
          `  ${r.artifacts.length} file(s), ${r.evidence.length} evidence file(s)${r.dependencies.length ? `, contains ${r.dependencies.map((d) => `${d.partId}@${d.revision}`).join(", ")}` : ""}`,
          ...r.missingArtifacts.map((m) => `  not carried: ${m.path} (${m.reason})`),
          ...(r.status === "published" ? [`  To use the catalog copy here: remove the parts/local source, then \`protoboard parts add ${r.id}@${r.revision}\`.`] : []),
        ].join("\n"),
      );
      return;
    }
  }
}

const DEFAULT_LIBRARY = "protoboard";

/** `parts list`: the project's parts by group, the way the Project parts view shows them. */
function listParts(r: ProjectPartsReport) {
  const groups: [string, ProjectPart[]][] = [
    ["Updates available", r.parts.filter((x) => x.status === "update-available")],
    ...[...new Set(r.parts.filter((x) => x.tier === "catalog" && x.status !== "update-available").map((x) => x.library ?? "library"))].map(
      (lib): [string, ProjectPart[]] => [`Library · ${lib}`, r.parts.filter((x) => x.tier === "catalog" && x.status !== "update-available" && (x.library ?? "library") === lib)],
    ),
    ["Project · researched", r.parts.filter((x) => x.tier === "project-researched")],
    ["Project · designed", r.parts.filter((x) => x.tier === "project-specific")],
  ];
  const mark: Record<ProjectPart["status"], string> = { pinned: " ", "up-to-date": "✓", "update-available": "U", diverged: "M", local: " ", designed: " " };
  out(r, () =>
    [
      `${r.counts.total} part(s): ${r.counts.library} from libraries, ${r.counts.researched} researched, ${r.counts.designed} designed${r.checked ? ` · ${r.counts.updates} update(s)` : " (not checked for updates: --check)"}${r.counts.diverged ? ` · ${r.counts.diverged} diverged` : ""}`,
      ...groups
        .filter(([, list]) => list.length)
        .flatMap(([title, list]) => [
          "",
          `${title} (${list.length})`,
          ...list.map(
            (x) =>
              `  ${mark[x.status]} ${x.name.padEnd(36)} ${[
                x.revision !== undefined ? `@${x.revision}${x.recommended !== undefined ? ` → @${x.recommended}` : ""}` : "",
                x.capability ? `${x.capability.capability} · ${x.capability.provider.replace(/^@[^/]+\/(ext-)?/, "")}` : "",
                x.status === "diverged" ? `edited: ${x.edited!.join(", ")}` : "",
                x.published ? `published @${x.published.revision}` : "",
                x.instances > 1 ? `×${x.instances}` : "",
              ]
                .filter(Boolean)
                .join("  ")}`,
          ),
        ]),
      ...(r.checked?.problems ?? []).map((m) => `  not checked: ${m}`),
    ].join("\n"),
  );
}

/** ID tokens for the services among `urls` the user is signed in to; a sign-in that stopped working is reported, not fatal (a library that signs no one in needs none). */
async function signedIn(urls: string[]): Promise<Map<string, string>> {
  const { tokens, problems } = await accountTokensFor(urls);
  for (const p of problems) process.stderr.write(`protoboard: not using the sign-in for ${p}\n`);
  return tokens;
}

/** Whether this terminal can show a browser sign-in: a person at a TTY with a display (not CI, not over SSH without one). */
function hasBrowser(): boolean {
  if (!process.stdout.isTTY || !process.stdin.isTTY || process.env.CI) return false;
  if (process.env.SSH_CONNECTION && !process.env.DISPLAY) return false;
  return process.platform !== "linux" || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/** `login`, `logout`, `whoami`: the user's Protoboard Cloud sign-in for the parts service at --url, else the project's, else the hosted library. */
async function account(sub: "login" | "logout" | "whoami" | "account") {
  const chosen = await projectService();
  const root = chosen.root;
  const service = serviceKey(chosen.url);
  // a config that does not load is said so, with the service used instead: the one its text names, else the user's own
  if (chosen.unread && chosen.source !== "flag" && chosen.source !== "environment") {
    const why = chosen.source === "project-file" ? "its cloud.url was read from the file as text" : chosen.source === "saved" ? "its cloud.url is not known: using the service this machine is signed in to" : "its cloud.url is not known: using the hosted Protoboard library";
    process.stderr.write(`protoboard: ${join(root!, CONFIG_FILE)} could not be loaded (${chosen.unread}), so ${why}, ${service}\n`);
  }
  const unreachable = (what: string) => unreachableService(service, what, chosen.source, root ? join(root, CONFIG_FILE) : undefined);
  const store = new CredentialStore();
  if (sub === "account") {
    // PB-1089: the page where the account is managed; the link always printed, the browser opened when there is one
    let url: string;
    try {
      url = await accountPage(service);
    } catch (e) {
      if (e instanceof AccountError && e.code === "UNREACHABLE") throw new Error(unreachable(e.message));
      if (e instanceof AccountError && e.code === "NO_SIGN_IN") {
        out({ service, url: null, message: e.message }, () => e.message);
        process.exitCode = 1;
        return;
      }
      throw e;
    }
    const opened = !json && hasBrowser() && openUrl(url);
    out({ service, url, opened }, () => `${url}${opened ? "" : "\nOpen it in a browser to manage your Protoboard account."}`);
    return;
  }
  if (sub === "logout") {
    const had = logout(service, { store });
    forgetAccess(service);
    out({ service, signedOut: had }, () => (had ? `Signed out of ${service}; the sign-in was removed from ${store.describe()}.` : `Not signed in to ${service}.`));
    return;
  }
  if (sub === "whoami") {
    const s = await accountStatus(service, { store, check: cli.flags.check });
    // PB-928: whether the library's account features (the cloud) may be used here; --check asks the service again
    const access = await checkAccess(service, { store, fresh: cli.flags.check });
    const accessLine = access.allowed || access.reason === "signed-out" ? [] : [`The Protoboard library: ✗ ${fmtAccess(access)}`];
    if (s.unreachable) {
      // the local sign-in is still reported; what the service thinks of it is unknown
      out({ ...s, access, source: chosen.source, message: unreachable(s.unreachable) }, () =>
        [unreachable(s.unreachable!), s.signedIn ? `The sign-in kept here for it is ${s.email ?? s.uid}${s.via === "device" ? " (device sign-in)" : ""}, in ${s.store}; whether the service accepts it is not known.` : "No sign-in is kept here for it.", ...accessLine].join("\n"),
      );
      process.exitCode = 1;
      return;
    }
    out({ ...s, access }, () =>
      [
        s.signedIn
          ? [`Signed in to ${service} as ${s.email ?? s.uid}${s.via === "device" ? " (device sign-in)" : ""}`, `  kept in ${s.store}`, ...(s.valid === undefined ? [] : [s.valid ? `  the service accepts it${s.distribution ? `; ${s.distribution === "all" ? "full" : "redistributable"} library` : ""}${s.publisher ? "; you may publish" : ""}` : `  ✗ ${s.problem}`])].join("\n")
          : s.needsAccount === false || access.via === "open-service"
            ? `${service} signs no one in: everything there is open, with no account (a parts service without sign-in).`
            : `Not signed in to ${service}. Local work (check, build, the viewer) needs no account; the Protoboard library (searching it, adding parts, prices and publishing) does: sign in with \`protoboard login\`.`,
        ...(access.via === "open-service" ? [] : accessLine),
      ].join("\n"),
    );
    process.exitCode = (s.signedIn && s.valid !== false) || (!s.signedIn && (s.needsAccount === false || access.via === "open-service")) ? 0 : 1;
    return;
  }
  const device = cli.flags.device || !hasBrowser();
  const log = (line: string) => process.stderr.write(`${line}\n`);
  try {
    const session = device
      ? await loginWithDevice(
          service,
          (prompt) => {
            if (json) process.stdout.write(JSON.stringify({ prompt: "approve this code", ...prompt }) + "\n");
            else
              log(
                [
                  "To sign in, open this page on any device and approve the code there:",
                  `  ${prompt.verificationUriComplete ?? prompt.verificationUri ?? "(the service named no page)"}`,
                  `  code: ${prompt.userCode}  (expires in ${Math.round(prompt.expiresIn / 60)} min)`,
                  "Waiting for approval…",
                ].join("\n"),
              );
          },
          // the platform only: the machine's name is the user's, and the approval page needs none of it (PB-1047)
          { store, client: `protoboard CLI (${process.platform})` },
        )
      : await loginWithBrowser(service, openUrl, { store, log });
    out({ service, signedIn: true, email: session.email, uid: session.uid, via: session.via, store: store.describe() }, () => `Signed in to ${service} as ${session.email ?? session.uid}. The sign-in is kept in ${store.describe()}, never in a project.`);
  } catch (e) {
    if (e instanceof AccountError && e.code === "NO_SIGN_IN") {
      out({ service, signedIn: false, message: e.message }, () => e.message);
      return;
    }
    if (e instanceof AccountError && e.code === "UNREACHABLE") throw new Error(signInUnreachable(service, e.message, chosen.source, root ? join(root, CONFIG_FILE) : undefined));
    throw e;
  }
}

/** `libraries [list] | add | remove | move`: the project's part libraries, in protoboard.config.ts. */
async function libraries(sub: string | undefined, rest: string[]) {
  const usage = "usage: protoboard libraries [list [--check]] | add <id> <url> [--auth-env NAME] [--position n] | add <url> | remove <id> | move <id> <position|first|last|up|down>";
  const root = findProjectRoot(cwd);
  if (!root) throw new Error(`no protoboard.config.ts in ${cwd} or its parents (run \`protoboard init\`)`);
  const config = await loadConfig(root);
  const show = async (check: boolean, done?: string) => {
    const list = await listLibraries(root, config2 ?? config, { check, url: cli.flags.url });
    const origins = relative(root, originsPath(root, (config2 ?? config).catalog)).split("\\").join("/");
    out({ ...(done ? { done } : {}), libraries: list, origins }, () =>
      [
        ...(done ? [done] : []),
        ...list.map((l) =>
          [
            `${String(l.position).padStart(2)}. ${l.id.padEnd(14)} ${l.url}${l.declared ? "" : l.personal ? "  (personal: PROTOBOARD_USER_LIBRARIES)" : "  (default: not listed in protoboard.config.ts)"}`,
            ...(l.authEnv ? [`      token from $${l.authEnv} (${process.env[l.authEnv] ? "set" : "not set"})`] : []),
            ...(l.pinned.length ? [`      ${l.pinned.length} vendored part(s) pinned to it`] : []),
            ...(l.discovery ? ["error" in l.discovery ? [`      ✗ ${l.discovery.error}`] : [`      ✓ ${l.discovery.name} ${l.discovery.version} (${l.discovery.protocol}, API ${l.discovery.api}, ${readsNeed(l.discovery)})`]] : []).flat(),
          ].join("\n"),
        ),
      ].join("\n"),
    );
  };
  let config2: typeof config | undefined;
  const save = async (list: ReturnType<typeof declaredLibraries>, done: string) => {
    await writeLibraries(root, list);
    config2 = { ...config, libraries: list };
    await show(false, done);
  };
  const current = declaredLibraries(config);
  // a personal library is not in protoboard.config.ts: say where it does come from
  const personalOnly = (id: string | undefined, verb: string) => {
    if (!id || current.some((l) => l.id === id)) return;
    if (!personalLibraries(process.env, current.map((l) => l.id)).libraries.some((l) => l.id === id)) return;
    throw new Error(
      `"${id}" is one of your personal libraries: it comes from ${USER_LIBRARIES_ENV} (a JSON array in your environment; VS Code sets it from the protoboard.libraries setting), not from protoboard.config.ts, so \`libraries ${verb}\` cannot change it. Edit ${USER_LIBRARIES_ENV} (or the setting) instead.`,
    );
  };
  switch (sub ?? "list") {
    case "list":
      return show(cli.flags.check);
    case "add": {
      let [id, url] = rest;
      if (rest.length === 1 && /^https?:\/\//.test(rest[0])) {
        // only a URL: the library's discovery document suggests its id
        url = rest[0];
        const found = await discoverLibrary(url);
        if (!found.document?.id) throw new Error(`${url} has no uhd-library/v1 discovery document with an id; name one: protoboard libraries add <id> ${url}`);
        id = found.document.id;
      }
      if (!id || !url || rest.length > 2) throw new Error(usage);
      const lib = { id, url: url.replace(/\/+$/, ""), ...(cli.flags.authEnv ? { authEnv: cli.flags.authEnv } : {}) };
      return save(withLibraryAdded(current, lib, cli.flags.position), `added library ${id}`);
    }
    case "remove": {
      if (rest.length !== 1) throw new Error(usage);
      personalOnly(rest[0], "remove");
      const pinned = (await listLibraries(root, config, { url: cli.flags.url })).find((l) => l.id === rest[0])?.pinned ?? [];
      return save(
        withLibraryRemoved(current, rest[0]),
        `removed library ${rest[0]}${pinned.length ? `; ${pinned.length} part(s) vendored from it stay vendored (${pinned.join(", ")}), but \`parts update\` cannot ask it until it is added back` : ""}`,
      );
    }
    case "move": {
      if (rest.length !== 2) throw new Error(usage);
      personalOnly(rest[0], "move");
      return save(withLibraryMoved(current, rest[0], rest[1]), `moved library ${rest[0]}`);
    }
    default:
      throw new Error(usage);
  }
}

main().catch((e: Error) => {
  if (e instanceof AccessError) {
    // PB-928: one line, and its own exit code so a script or the extension can tell it from a failed command
    if (json) process.stdout.write(JSON.stringify({ error: e.message, code: e.code, access: e.access }) + "\n");
    else process.stderr.write(`protoboard: ${e.message}\n`);
    process.exitCode = ACCESS_EXIT_CODE;
    return;
  }
  if (json) process.stdout.write(JSON.stringify({ error: e.message }) + "\n");
  else process.stderr.write(`protoboard: ${e.message}\n`);
  process.exitCode = 2;
});
