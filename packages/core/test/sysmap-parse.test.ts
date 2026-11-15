/**
 * The System Map's text readers (docs/specs/system-map.md, "Where items are
 * read from"): frontmatter, code and prose, the CLI's help and switch, the
 * MCP tool specs, the view tabs, the build-a-project stages, release notes.
 */
import { describe, expect, it } from "vitest";
import {
  boldIds,
  buildStages,
  bulletLine,
  builtinTabs,
  cliCases,
  cliHelp,
  cliMentions,
  docPaths,
  firstHeading,
  firstParagraph,
  frontmatter,
  importsOf,
  mcpTools,
  mdLines,
  operationMentions,
  releaseSections,
  short,
  specStatus,
  splitCode,
} from "../src/sysmap/parse.js";
import { majorityDiscipline, stageDiscipline } from "../src/sysmap/model.js";

describe("markdown", () => {
  it("reads frontmatter, single-line and folded", () => {
    const fm = frontmatter("---\r\nname: a-skill\r\ndescription: >\r\n  Two\r\n  lines\r\nversion: \"1.2.0\"\r\n---\r\n\r\n# Body\r\n");
    expect(fm?.fields).toEqual({ name: "a-skill", description: "Two lines", version: "1.2.0" });
    expect(fm?.body).toBe("\n# Body\n");
    expect(frontmatter("# no frontmatter")).toBeNull();
  });

  it("splits code from prose, and line by line marks table rows", () => {
    const md = "Run `protoboard check` and **x**.\n\n```sh\nprotoboard build\n```\n| **t** | `c` |\n";
    const { code, prose } = splitCode(md);
    expect(code).toEqual(["protoboard check", "protoboard build", "c"]);
    expect(prose).toContain("**x**");
    expect(prose).not.toContain("protoboard");
    const lines = mdLines(md);
    expect(lines.find((l) => l.table)?.code).toEqual(["c"]);
    expect(lines.find((l) => l.code.includes("protoboard build"))?.table).toBe(false);
  });

  it("finds ids in bold, doc paths, commands and operations", () => {
    expect(boldIds("**part-search** then **Not an id** and **x2**")).toEqual(["part-search", "x2"]);
    expect(docPaths("see docs/specs/atlas.md and ../../docs/guides/sop-format.md, not docs/references/x.md").sort()).toEqual(["docs/guides/sop-format.md", "docs/specs/atlas.md"]);
    expect(cliMentions("npx protoboard parts add x && protoboard check; protoboard.config.ts; npx @protoboardai/cli init d")).toEqual(["parts", "check", "init"]);
    const ops = operationMentions("protoboard run circuit:generate --module b; import x from \"node:fs\"; https://a.b; package:spec");
    expect(ops.qualified).toEqual(expect.arrayContaining(["circuit:generate", "node:fs", "package:spec"]));
    expect(ops.qualified).not.toContain("https:");
  });

  it("reads a doc's heading, first paragraph and status", () => {
    const md = "# Atlas: the index\n\nStatus: built. The rest.\n\nThe first real paragraph,\nwrapped.\n\n## Next\n";
    expect(firstHeading(md)).toBe("Atlas: the index");
    expect(firstParagraph(md)).toBe("The first real paragraph, wrapped.");
    expect(specStatus(md)).toBe("built");
  });

  it("cuts a summary to one plain line", () => {
    expect(short("design a custom PCB through the `circuit` capability: the board as a UHD module")).toBe("Design a custom PCB through the circuit capability");
    // a cut that would leave fewer than 24 characters is not made
    expect(short("`circuit` provider: PCBs from UHD boards")).toBe("Circuit provider: PCBs from UHD boards");
    expect(short("design a board — the long explanation that follows here")).toBe("Design a board — the long explanation that follows here");
    expect(short("x".repeat(200)).length).toBeLessThanOrEqual(150);
  });
});

describe("build-a-project and release notes", () => {
  it("reads the numbered stages under ## Steps only", () => {
    const md = "# Hub\n\n### 9. Not a stage\n\n## Steps\n\n### 0. Set up\n\ntext a\n\n### 1. Boards (circuit capability)\n\ntext b\n\n## Outputs\n\n### 2. After\n";
    expect(buildStages(md)).toEqual([
      { n: 0, title: "Set up", text: "\ntext a\n" },
      { n: 1, title: "Boards (circuit capability)", text: "\ntext b\n" },
    ]);
  });

  it("classifies stage headings, the first matching rule winning", () => {
    expect(stageDiscipline("Harness CAD")).toBe("cad");
    expect(stageDiscipline("System composition and harnesses")).toBe("system");
    expect(stageDiscipline("Boards (circuit capability)")).toBe("pcb");
    expect(stageDiscipline("Look, ask, agree how far to go, set up")).toBe("project");
    expect(stageDiscipline("Something new")).toBeUndefined();
  });

  it("reads release sections and a bullet's line", () => {
    const md = "# Notes\n\n## Unreleased\n\n- **Faster check.** It caches\n  across runs.\n- Plain bullet. Second sentence.\n\n### Sub\n\n- Under a sub-heading.\n\n## 0.3.0 (2026-11-11)\n\n- **Sign in by link.**\n\n## What is in it\n\n- not a release\n";
    const s = releaseSections(md);
    expect(s.map((x) => x.version)).toEqual(["unreleased", "0.3.0"]);
    expect(s[0].bullets).toEqual(["**Faster check.** It caches across runs.", "Plain bullet. Second sentence.", "Under a sub-heading."]);
    expect(bulletLine(s[0].bullets[0])).toBe("Faster check");
    expect(bulletLine(s[0].bullets[1])).toBe("Plain bullet");
  });

  it("takes the majority discipline, ties by island order or by list order", () => {
    expect(majorityDiscipline(["cad", "system", "cad"])).toBe("cad");
    expect(majorityDiscipline(["cad", "system"])).toBe("system");
    expect(majorityDiscipline(["cad", "system"], "first")).toBe("cad");
    expect(majorityDiscipline([null, undefined])).toBeUndefined();
  });
});

describe("TypeScript sources", () => {
  const INDEX = `const cli = meow(\`
  Usage
    $ protoboard <command>

  Commands
    init <dir>              Scaffold a project; --template drone
                            more about init
    parts list              The project's parts
    parts add <id>
                            Vendor library parts
    bom                     The bill of materials \${"x"}

  Options
\`);
async function main() {
  switch (command) {
    case "init": {
      switch (sub) {
        case "nested": {
          break;
        }
      }
      return;
    }
    case "login":
    case "logout": {
      await import("./login.js");
      return;
    }
    default:
      cli.showHelp();
  }
}
`;

  it("reads the help text, by command, the bare form's description first", () => {
    const h = cliHelp(INDEX);
    expect([...h.keys()]).toEqual(["init", "parts", "bom"]);
    expect(h.get("init")).toEqual({ forms: ["init <dir>"], description: "Scaffold a project; --template drone more about init" });
    expect(h.get("parts")).toEqual({ forms: ["parts list", "parts add <id>"], description: "The project's parts" });
    expect(h.get("bom")?.description).toBe("The bill of materials …");
  });

  it("reads the top-level cases only, fall-throughs sharing a block", () => {
    const c = cliCases(INDEX)!;
    expect([...c.keys()]).toEqual(["init", "login", "logout"]);
    expect(c.get("login")).toBe(c.get("logout"));
    expect(c.get("login")).toContain("./login.js");
    expect(cliCases("no switch here")).toBeNull();
    expect(importsOf(c.get("login")!)).toEqual(["./login.js"]);
  });

  it("reads MCP tool specs and the commands they run", () => {
    const src = `[
    tool({
      name: "project_check",
      title: "Check the project",
      description:
        "Run every validator. " +
        \`Reads \${X} only.\`,
      input: { name: z.string() },
      handler: async () => command(ctx, dir, cliArgs(["check"])),
    }),
    tool({
      name: "project_status",
      title: "Protoboard \\"status\\"",
      description: "Call this first.",
      handler: async () => [cliArgs(["whoami"]), cliArgs(["doctor"]), cliArgs(["whoami"])],
    }),
  ]`;
    const t = mcpTools(src);
    expect(t.map((x) => x.name)).toEqual(["project_check", "project_status"]);
    expect(t[0]).toMatchObject({ title: "Check the project", description: "Run every validator. Reads only.", commands: ["check"] });
    expect(t[1].commands).toEqual(["whoami", "doctor"]);
  });

  it("reads the built-in tabs", () => {
    const src = `export const BUILTIN_TABS: readonly TabRule[] = [\n  {\n    id: "diagram",\n    title: "Diagram",\n    description: "Modules and links.",\n  },\n  {\n    id: "3d",\n    title: "3D",\n  },\n];\n`;
    expect(builtinTabs(src)?.map((t) => [t.id, t.title, t.description])).toEqual([
      ["diagram", "Diagram", "Modules and links."],
      ["3d", "3D", ""],
    ]);
    expect(builtinTabs("const x = 1;")).toBeNull();
  });
});
