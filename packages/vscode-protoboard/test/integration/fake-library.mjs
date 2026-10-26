// A stand-in uhd-library/v1 library for the integration test, when no real
// one is given (PROTOBOARD_TEST_LIBRARY_URL): discovery, search with facets
// and cursors, and the taxonomy with counts. Read-only, in memory.
import { createServer } from "node:http";

const cats = ["actuator.motor.brushless", "actuator.motor.stepper", "sensor.motion", "sensor.environmental", "power.battery"];
const PARTS = Array.from({ length: 45 }, (_, i) => ({
  partId: `test-part-${String(i).padStart(2, "0")}`,
  name: `Test part ${i}`,
  manufacturer: "Acme",
  partNumber: `AC-${i}`,
  categories: [cats[i % cats.length]],
  tags: [],
  protocols: i % 2 ? ["i2c"] : ["power"],
  domains: ["electrical"],
  latestRevision: 1,
  recommendedRevision: 1,
}));
const TREE = [
  { id: "actuator", name: "Actuators", children: [{ id: "motor", name: "Motors", children: [{ id: "brushless", name: "Brushless" }, { id: "stepper", name: "Stepper" }] }] },
  { id: "sensor", name: "Sensors", children: [{ id: "motion", name: "Motion" }, { id: "environmental", name: "Environmental" }] },
  { id: "power", name: "Power", children: [{ id: "battery", name: "Batteries" }] },
];
const ancestors = (p) => p.split(".").map((_, i, a) => a.slice(0, i + 1).join("."));
const match = (p, q, skipTaxonomy) =>
  (!q.get("q") || q.get("q").toLowerCase().split(/\s+/).every((w) => `${p.partId} ${p.name}`.toLowerCase().includes(w))) &&
  (skipTaxonomy || !q.get("taxonomy") || p.categories.some((c) => ancestors(c).includes(q.get("taxonomy")))) &&
  (!q.get("protocol") || p.protocols.includes(q.get("protocol"))) &&
  (!q.get("domain") || p.domains.includes(q.get("domain")));
const count = (list, f) => list.reduce((o, p) => (f(p).forEach((v) => (o[v] = (o[v] ?? 0) + 1)), o), {});
const tree = (nodes, list, prefix = "") =>
  nodes.map((n) => {
    const path = prefix ? `${prefix}.${n.id}` : n.id;
    return { id: n.id, path, name: n.name, source: "uhd", count: list.filter((p) => p.categories.some((c) => ancestors(c).includes(path))).length, children: tree(n.children ?? [], list, path) };
  });

const discovery = (base) => ({
  protocol: "uhd-library/v1",
  name: "Test library",
  id: "testlib",
  version: "0.0.1",
  api: `${base}/v1`,
  envelopeSchemas: ["uhd.part-revision/v1"],
  uhdSchema: { min: "0.2.0", below: "0.3.0" },
  taxonomy: { id: "uhd", version: "1.0.0" },
  capabilities: ["facets", "taxonomy"],
  auth: { read: "none" },
  limits: { defaultPageSize: 50, maxPageSize: 200 },
});

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (v, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(v));
  };
  const q = url.searchParams;
  if (url.pathname === "/.well-known/uhd-library" || url.pathname === "/v1") return json(discovery(base));
  if (url.pathname === "/v1/parts") {
    const all = PARTS.filter((p) => match(p, q));
    const from = Number(q.get("cursor") ?? 0);
    const limit = Number(q.get("limit") ?? 50);
    return json({
      total: all.length,
      parts: all.slice(from, from + limit),
      nextCursor: from + limit < all.length ? String(from + limit) : null,
      ...(q.get("facets") === "true"
        ? { facets: { taxonomy: count(all, (p) => p.categories.flatMap(ancestors)), domain: count(all, (p) => p.domains), protocol: count(all, (p) => p.protocols), tag: {}, categories: {} } }
        : {}),
    });
  }
  if (url.pathname === "/v1/taxonomy") {
    const all = PARTS.filter((p) => match(p, q, true));
    return json({ taxonomy: { id: "uhd", version: "1.0.0", extensions: [], setAt: "" }, total: all.length, uncategorised: 0, nodes: tree(TREE, all), unknown: [] });
  }
  json({ error: { code: "NOT_FOUND", message: url.pathname } }, 404);
});
server.listen(0, "127.0.0.1", () => process.send?.({ url: `http://127.0.0.1:${server.address().port}` }));
process.on("disconnect", () => process.exit(0));
