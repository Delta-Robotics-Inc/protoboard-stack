/**
 * Project templates (PB-818): `protoboard init --template drone|wearable|iot`.
 * Each template writes a project whose only unresolved definitions are the
 * catalog parts it lists (vendored from the parts service at init), and the
 * vendoring works on a project that is not installed yet.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOOLCHAIN, initProject, listTemplates, loadProject, loadTemplate, readOrigins, vendorTemplateParts } from "../src/index.js";
import { Blobs, draft, startCloud, type CloudService } from "./cloud.js";
import { cloudCheckout } from "./cloud-checkout.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-templates");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe("project templates", () => {
  it("lists drone, wearable and iot, each derived from a reference project", () => {
    const ts = listTemplates();
    expect(ts.map((t) => t.id)).toEqual(["drone", "iot", "wearable"]);
    for (const t of ts) {
      expect(t.derivedFrom).toMatch(/^examples\//);
      expect(existsSync(join(HERE, "../../..", t.derivedFrom, "protoboard.config.ts"))).toBe(true);
      expect(t.extensions.every((e) => e.startsWith("@protoboardai/ext-"))).toBe(true);
      expect(t.catalogParts.every((p) => /^[a-z0-9-]+@\d+$/.test(p))).toBe(true);
    }
    // a project on ext-tscircuit overrides circuit-json to the version ext-tscircuit pins (see ProjectTemplate.overrides)
    const tscircuitPin = JSON.parse(readFileSync(join(HERE, "../../ext-tscircuit/package.json"), "utf8")).dependencies["circuit-json"];
    const linter = JSON.parse(readFileSync(join(HERE, "../../../package.json"), "utf8")).overrides["@tscircuit/pcb-trace-linter"];
    expect(linter).toMatch(/^https:\/\/codeload\.github\.com\/tscircuit\/pcb-trace-linter\/tar\.gz\/[0-9a-f]{40}$/);
    for (const t of ts) {
      const pkg = JSON.parse(readFileSync(join(HERE, "../../..", t.derivedFrom, "package.json"), "utf8"));
      const uses = t.extensions.includes("@protoboardai/ext-tscircuit");
      expect(t.overrides?.["circuit-json"], `template ${t.id}`).toBe(uses ? tscircuitPin : undefined);
      expect(pkg.overrides?.["circuit-json"], t.derivedFrom).toBe(uses ? tscircuitPin : undefined);
      // @tscircuit/capacity-autorouter asks for @tscircuit/pcb-trace-linter from GitHub (git+ssh in a lockfile):
      // a project on ext-tscircuit takes the workspace's HTTPS tarball instead, so installs need no SSH key (PB-809)
      expect(t.overrides?.["@tscircuit/pcb-trace-linter"], `template ${t.id}`).toBe(uses ? linter : undefined);
      expect(pkg.overrides?.["@tscircuit/pcb-trace-linter"], t.derivedFrom).toBe(uses ? linter : undefined);
      // and installs as the workspace does (legacy-peer-deps), so circuit-json sits at the top level.
      // The examples carry no .npmrc (inside the workspace npm ignores it, with a warning on every npx).
      expect(t.npmrc?.["legacy-peer-deps"], `template ${t.id}`).toBe(uses ? "true" : undefined);
    }
    expect(() => loadTemplate("submarine")).toThrow(/no project template "submarine" \(templates: drone, iot, wearable\)/);
  });

  for (const id of ["drone", "wearable", "iot"]) {
    it(`${id}: writes a project whose only unresolved definitions are its catalog parts`, async () => {
      const dir = join(TMP, id);
      rmSync(dir, { recursive: true, force: true });
      const r = initProject(dir, { template: id, name: `My ${id}` });
      const t = loadTemplate(id);
      expect(r.template?.id).toBe(id);
      expect(r.catalogParts).toEqual(t.catalogParts);
      for (const f of ["package.json", "tsconfig.json", ".gitignore", "AGENTS.md", "protoboard.config.ts", "src/system.uhd.ts", "docs/brief.md", "docs/product.json", "docs/decisions.md", "parts/origins.json"]) {
        expect(r.files, f).toContain(f);
      }
      // placeholders filled, suffixes dropped
      for (const f of walk(dir)) {
        expect(f.endsWith(".tmpl"), relative(dir, f)).toBe(false);
        if (/\.(ts|md|json)$/.test(f)) expect(readFileSync(f, "utf8"), relative(dir, f)).not.toMatch(/\{\{(id|name|CONST|snake)\}\}/);
      }
      // the package depends on versions of the stack and every extension it configures
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      expect(pkg.name).toBe(`my-${id}`);
      expect(Object.keys(pkg.dependencies).sort()).toEqual(["@deltarobotics/uhd", "@protoboardai/core", ...t.extensions, ...(t.dependencies ?? [])].sort());
      // the stack's packages by range; UHD and TypeScript pinned exactly (PB-910: part sources declare what they need)
      expect(Object.entries(pkg.dependencies).every(([k, v]) => (k === "@deltarobotics/uhd" ? /^\d+\.\d+\.\d+$/ : /^\^\d+\.\d+\.\d+$/).test(String(v)))).toBe(true);
      expect(pkg.dependencies["@deltarobotics/uhd"]).toBe(TOOLCHAIN.uhd);
      expect(pkg.devDependencies).toEqual({ "@protoboardai/cli": expect.stringMatching(/^\^/), "@types/node": expect.any(String), typescript: TOOLCHAIN.typescript });
      expect(pkg.scripts.typecheck).toBe("tsc --noEmit -p .");
      // both hosts in one command, and again at the end of every npm install (packages/cli/test/init-skills.test.ts)
      expect(pkg.scripts["skills:export"]).toBe("protoboard skills export --host all");
      expect(pkg.scripts.postinstall).toBe("protoboard skills export --host all --on-install || exit 0");
      expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(".claude/skills/");
      // npm overrides and settings the template's extensions need
      expect(pkg.overrides).toEqual(t.overrides);
      if (t.npmrc) expect(readFileSync(join(dir, ".npmrc"), "utf8")).toMatch(/^legacy-peer-deps=true$/m);
      else expect(existsSync(join(dir, ".npmrc"))).toBe(false);

      const p = await loadProject(dir, { checks: false });
      expect(p.rootDef?.id).toBe(`my-${id}`);
      expect(p.config.extensions).toEqual(t.extensions);
      const errors = p.diagnostics.filter((d) => d.severity === "error");
      expect(errors.every((d) => d.code === "PB_UNRESOLVED_DEFINITION"), JSON.stringify(errors.filter((d) => d.code !== "PB_UNRESOLVED_DEFINITION"), null, 1)).toBe(true);
      const missing = new Set(errors.map((d) => /references "([^"]+)"/.exec(d.message)?.[1]));
      expect([...missing].sort()).toEqual(t.catalogParts.map((x) => x.split("@")[0]).sort());
    });
  }

  it("writes the library's URL into the project when given one (protoboard init: the hosted library, PB-915)", async () => {
    for (const id of ["drone", undefined]) {
      const dir = join(TMP, `cloud-${id ?? "plain"}`);
      rmSync(dir, { recursive: true, force: true });
      initProject(dir, { ...(id ? { template: id } : {}), name: "Cloud Rig", cloudUrl: "https://parts.example/" });
      const text = readFileSync(join(dir, "protoboard.config.ts"), "utf8");
      expect(text).toContain('cloud: { url: "https://parts.example" },');
      expect(text).not.toContain("{{cloud}}");
      const p = await loadProject(dir, { checks: false });
      expect(p.config.cloud).toEqual({ url: "https://parts.example" });
    }
    // without one, nothing: the default applies (PROTOBOARD_CLOUD_URL, then localhost)
    expect(readFileSync(join(TMP, "drone", "protoboard.config.ts"), "utf8")).not.toMatch(/cloud:|\{\{cloud\}\}/);
  });

  it("refuses a folder that is not empty", () => {
    expect(() => initProject(join(TMP, "drone"), { template: "drone" })).toThrow(/is not empty/);
  });
});

// the real parts service, from a protoboard-cloud checkout (cloud-checkout.ts)
describe.skipIf(!cloudCheckout())("vendorTemplateParts", () => {
  let svc: CloudService;
  beforeAll(async () => {
    svc = await startCloud();
    const blobs = new Blobs();
    await svc.client.publish(
      draft(blobs, { id: "test-cell", name: "Test cell", interfaces: [{ id: "out", name: "Out", domain: "electrical", protocols: [{ type: "power", roles: ["source"] }] }] }, { files: { "parts/test-cell/body.glb": "cell body" } }),
      blobs.source,
    );
  });
  afterAll(async () => {
    await svc?.stop();
  });

  it("vendors pinned catalog parts into a new project before it is installed", async () => {
    const dir = join(TMP, "vendor");
    rmSync(dir, { recursive: true, force: true });
    initProject(dir, { template: "drone" });
    const r = await vendorTemplateParts(dir, ["test-cell@1"], { url: svc.url, env: {} });
    expect(r.service).toBe(svc.url);
    expect(r.results.map((x) => [x.id, x.revision, x.status])).toEqual([["test-cell", 1, "added"]]);
    expect(readOrigins(dir).definitions["test-cell"]).toMatchObject({ tier: "catalog", revision: 1, file: "parts/catalog/test-cell.json" });
    expect(existsSync(join(dir, "parts/catalog/test-cell.json"))).toBe(true);
  });

  it("fails clearly when the parts service cannot be reached", async () => {
    const dir = join(TMP, "offline");
    rmSync(dir, { recursive: true, force: true });
    initProject(dir, { template: "drone" });
    await expect(vendorTemplateParts(dir, ["test-cell@1"], { url: "http://127.0.0.1:9", env: {} })).rejects.toThrow();
    expect(existsSync(join(dir, "parts/catalog/test-cell.json"))).toBe(false);
  });
});

describe("the reference projects copied out of this repository (B16)", () => {
  it("type-check on their own: no tsconfig of theirs extends one of the repository's", () => {
    const examples = join(HERE, "../../../examples");
    for (const e of readdirSync(examples)) {
      const file = join(examples, e, "tsconfig.json");
      if (!existsSync(file)) continue;
      const t = JSON.parse(readFileSync(file, "utf8"));
      expect(t.extends, `${e}/tsconfig.json`).toBeUndefined();
      expect(t.compilerOptions?.module, `${e}/tsconfig.json`).toBe("NodeNext");
    }
  });
});
