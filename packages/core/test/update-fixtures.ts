/**
 * Shared fixtures for the update-check tests (PB-1168, W4-A): a fake project
 * with a stack in node_modules, a managed CAD runtime record, and a stub of
 * the npm registry and OSV.dev. No test reaches the network.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpdateFetcher } from "../src/update/sources.js";

export const VULN_ID = "GHSA-35jh-r3h4-6jhm";
export const MAL_ID = "MAL-2025-0001";

const pkg = (dir: string, name: string, version: string, extra: Record<string, unknown> = {}) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version, ...extra }));
};

/** A project: stack 0.2.2 in node_modules, lodash 4.17.20 (vulnerable in the stub), a deny-listed name, a CAD runtime. */
export function makeProject(options: { lookalike?: boolean; runtime?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "pb-update-"));
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "secret-project-name", private: true }));
  const nm = join(root, "node_modules");
  pkg(join(nm, "@protoboardai", "core"), "@protoboardai/core", "0.2.2");
  pkg(join(nm, "@protoboardai", "cli"), "@protoboardai/cli", "0.2.2");
  pkg(join(nm, "@protoboardai", "ext-parts"), "@protoboardai/ext-parts", "0.2.2");
  pkg(join(nm, "@deltarobotics", "uhd"), "@deltarobotics/uhd", "0.3.0");
  pkg(join(nm, "lodash"), "lodash", "4.17.20");
  pkg(join(nm, "three"), "three", "0.187.0");
  pkg(join(nm, "three", "node_modules", "nested-dep"), "nested-dep", "1.0.0");
  pkg(join(nm, "my-private-thing"), "my-private-thing", "1.0.0", { private: true });
  if (options.lookalike) pkg(join(nm, "vaps-transform"), "vaps-transform", "1.0.0");
  if (options.runtime !== false) {
    mkdirSync(join(root, ".protoboard", "tools"), { recursive: true });
    writeFileSync(
      join(root, ".protoboard", "tools", "tools.json"),
      JSON.stringify({
        schema: "protoboard.tools/v0",
        runtimes: {
          cad: {
            kind: "python",
            dir: ".protoboard/tools/cad",
            packages: ["build123d==0.13.0", "numpy==2.5.3"],
            installed: { build123d: "0.13.0", numpy: "2.5.3", "cadquery-ocp": "7.8.1.1.post1", Pillow: "10.0.0" },
            interpreter: { path: ".protoboard/tools/cad/Scripts/python.exe", version: "3.12.4" },
            env: {},
            bin: ".protoboard/tools/cad/Scripts",
            provides: ["ext-parts#cad"],
            installedAt: "2026-11-01T00:00:00.000Z",
          },
        },
      }),
    );
  }
  return root;
}

export interface StubCalls {
  urls: string[];
  bodies: string[];
}

/**
 * The npm registry and OSV.dev, stubbed: @protoboardai/core has 0.2.3 on
 * `latest`, lodash 4.17.20 has VULN_ID (HIGH, fixed in 4.17.21), Pillow 10.0.0
 * has MAL_ID when `malicious` is set. Any other host throws (as a real
 * request would be refused by the allowlist before it is made).
 */
export function stubFetcher(options: { latest?: string; malicious?: boolean; failAll?: boolean } = {}): { fetcher: UpdateFetcher; calls: StubCalls } {
  const calls: StubCalls = { urls: [], bodies: [] };
  const fetcher: UpdateFetcher = async (url, init) => {
    calls.urls.push(url);
    if (init?.body) calls.bodies.push(init.body);
    if (options.failAll) throw new TypeError("fetch failed");
    const u = new URL(url);
    if (u.hostname === "registry.npmjs.org") {
      const m = /^\/-\/package\/(.+)\/dist-tags$/.exec(u.pathname);
      const name = m ? decodeURIComponent(m[1]) : "";
      if (name === "@protoboardai/core" || name === "@protoboardai/cli" || name === "@protoboardai/ext-parts") return new Response(JSON.stringify({ latest: options.latest ?? "0.2.3", beta: "0.3.0-beta.1" }), { status: 200 });
      return new Response("{}", { status: 404 });
    }
    if (u.hostname === "api.osv.dev" && u.pathname === "/v1/querybatch") {
      const q = JSON.parse(init?.body ?? "{}") as { queries: { package: { name: string; ecosystem: string }; version: string }[] };
      return new Response(
        JSON.stringify({
          results: q.queries.map((x) => {
            if (x.package.name === "lodash" && x.version === "4.17.20") return { vulns: [{ id: VULN_ID, modified: "2024-01-01T00:00:00Z" }] };
            if (options.malicious && x.package.name === "pillow" && x.package.ecosystem === "PyPI") return { vulns: [{ id: MAL_ID, modified: "2025-01-01T00:00:00Z" }] };
            return {};
          }),
        }),
        { status: 200 },
      );
    }
    if (u.hostname === "api.osv.dev" && u.pathname === `/v1/vulns/${VULN_ID}`)
      return new Response(JSON.stringify({ id: VULN_ID, summary: "Command Injection in lodash", aliases: ["CVE-2021-23337"], database_specific: { severity: "HIGH" }, affected: [{ package: { ecosystem: "npm", name: "lodash" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }] }), { status: 200 });
    if (u.hostname === "api.osv.dev" && u.pathname === `/v1/vulns/${MAL_ID}`) return new Response(JSON.stringify({ id: MAL_ID, summary: "Malicious code in pillow (lookalike test)", affected: [{ package: { ecosystem: "PyPI", name: "pillow" } }] }), { status: 200 });
    throw new Error(`stub: unexpected request ${url}`);
  };
  return { fetcher, calls };
}
