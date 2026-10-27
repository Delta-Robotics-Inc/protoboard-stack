/**
 * Which CLI commands need the Protoboard cloud (PB-928, as changed on
 * 2026-10-21): the table the CLI asks before it runs a command.
 *
 * - `local`: works on the project on this machine, with no account and no
 *   service. Creating, modelling, checking, building, the viewer, layout,
 *   circuits and every other operation, releases, skills, tools, the stack.
 * - `cloud`: uses the library (as a user or a publisher). The library is the Protoboard cloud, and signed out there
 *   is no access to it at all: searching it and its
 *   category tree, the project's libraries, full revisions and their files,
 *   prices and offers, publishing. Signed out, the CLI stops with one line
 *   ("… needs a Protoboard account: sign in with `protoboard login`") and
 *   exit code 4, before anything changes. The service refuses the same
 *   requests on its own: this table only saves a round trip and words the
 *   refusal, since a fork can remove it.
 *
 * A library that signs no one in (a local parts service, or another
 * organisation's library read with its own token, `authEnv`) lets a
 * `libraries` command through: requireCloud in index.ts asks each library
 * the command uses.
 *
 * `init` is local; a template's library parts are its one cloud step, and
 * signed out it skips that step and says how to add them later.
 */
export type Gate = "local" | "cloud";

export interface GateEntry {
  gate: Gate;
  /** For a cloud command: what needs the cloud, as the refusal says it ("Adding library parts"). */
  what?: string;
  /**
   * For a cloud command: which services it uses. `libraries`: the project's
   * libraries (a part can come from any of them; `--library` names one).
   * `cloud`: the project's Protoboard service (prices, offers, publishing).
   */
  uses?: "libraries" | "cloud";
}

const LOCAL: GateEntry = { gate: "local" };

/** `parts <sub>`: the one command whose subcommands differ. */
const PARTS: Record<string, GateEntry> = {
  list: LOCAL,
  migrate: LOCAL,
  // browsing is the library too (PB-928, 2026-10-21; it was open before 0.2.0, PB-911)
  search: { gate: "cloud", what: "Searching the Protoboard library", uses: "libraries" },
  taxonomy: { gate: "cloud", what: "Browsing the Protoboard library's categories", uses: "libraries" },
  add: { gate: "cloud", what: "Adding library parts", uses: "libraries" },
  // an update check compares full revisions, which the service serves to signed-in accounts
  update: { gate: "cloud", what: "Updating library parts", uses: "libraries" },
  offers: { gate: "cloud", what: "Fetching offers from the Protoboard library", uses: "cloud" },
  prices: { gate: "cloud", what: "Prices from the Protoboard library", uses: "cloud" },
  publish: { gate: "cloud", what: "Publishing a part", uses: "cloud" },
  usage: { gate: "cloud", what: "The library's usage figures", uses: "cloud" },
};

/** Every command, by name; a command not listed is local. */
export const COMMAND_GATES: Readonly<Record<string, GateEntry>> = {
  init: LOCAL,
  upgrade: LOCAL,
  inspect: LOCAL,
  artifacts: LOCAL,
  check: LOCAL,
  layout: LOCAL,
  build: LOCAL,
  dev: LOCAL,
  bom: LOCAL,
  // by subcommand: commandGate below
  parts: LOCAL,
  login: LOCAL,
  logout: LOCAL,
  whoami: LOCAL,
  account: LOCAL,
  // the project's libraries are where its parts come from: with no account, none of them is the Protoboard library's to use
  libraries: { gate: "cloud", what: "Managing the project's libraries", uses: "libraries" },
  doctor: LOCAL,
  tools: LOCAL,
  extensions: LOCAL,
  skills: LOCAL,
  run: LOCAL,
  capabilities: LOCAL,
  release: LOCAL,
  operations: LOCAL,
  evals: LOCAL,
  views: LOCAL,
  stack: LOCAL,
  agents: LOCAL,
  setup: LOCAL,
  mcp: LOCAL,
};

/**
 * What a command line needs. `parts list --check` asks the libraries for
 * updates (full revisions), so it needs the cloud; `parts list` alone does not.
 */
export function commandGate(command: string | undefined, sub?: string, flags: { check?: boolean } = {}): GateEntry {
  if (!command) return LOCAL;
  if (command === "parts") {
    if (sub === "list" && flags.check) return { gate: "cloud", what: "Checking library parts for updates", uses: "libraries" };
    return PARTS[sub ?? ""] ?? LOCAL;
  }
  return COMMAND_GATES[command] ?? LOCAL;
}
