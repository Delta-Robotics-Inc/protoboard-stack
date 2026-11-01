/**
 * The reference tools this module ships (PB-1191): the two external programs
 * the round 2 lane reviewed, CNC Kitchen's ScanRuler and BumpMesh. Facts are
 * from `docs/specs/cad-view-research/review-round-1/round-2-notes/bumpmesh-scanruler.md`
 * (§1 repositories and licences, §4.3 the MCP server, §6.5 the registry entry),
 * read 2026-11-01. Both are AGPL-3.0-only: Protoboard links to them, hands
 * files to them and reads what they write; it never bundles, ports or hosts
 * them (§5).
 *
 * No physical reference is built in: a calibration cube's or a gauge block's
 * numbers must come from its own certificate or model file, so projects add
 * those in `parts/reference-tools/<id>.json` (docs/reference/reference-tools.md
 * has examples).
 */
import { EVIDENCE_LAYOUT, MEASURED_FROM_REFERENCE_TOOL, REFERENCE_TOOL_SCHEMA, type ReferenceTool } from "./types.js";

export const BUILTIN_REFERENCE_TOOLS: readonly ReferenceTool[] = [
  {
    schema: REFERENCE_TOOL_SCHEMA,
    id: "scanruler",
    name: "ScanRuler",
    kind: "software",
    description: "3D scan measurement and reverse engineering in the browser: feature fits, alignment, deviation maps, STEP export of a reverse-engineered body.",
    nominal: [],
    source: { origin: "builtin", maker: "Stefan Hermann (CNC Kitchen)", url: "https://github.com/CNCKitchen/ScanRuler" },
    evidence: { layout: EVIDENCE_LAYOUT, photos: false, measures: ["deviation-rms", "coverage", "noise-sigma"] },
    software: {
      homepage: "https://scanruler.com",
      repository: "https://github.com/CNCKitchen/ScanRuler",
      author: "Stefan Hermann (CNC Kitchen)",
      license: "AGPL-3.0-only",
      relationship: "reference",
      runs: "browser",
      // pinned, and with self-update off: the server updates itself from npm daily and can read and write any path (§4.3)
      mcp: { command: "npx", args: ["-y", "scanruler-mcp@0.5.0", "--no-update"], transport: "stdio" },
      reads: ["stl", "ply", "obj", "3mf", "step"],
      writes: ["step", "stl", "csv", "ply", "dxf", "svg", "scanruler"],
      handoffs: ["scan-to-part", "deviation-check"],
      // DEFAULT (round-2 Q2 open: measured, scanned or reverse-engineered): the brief's method name
      provenanceMethod: MEASURED_FROM_REFERENCE_TOOL,
      testedVersions: ["0.9.2"],
      notes: "Chrome and Edge ask a Local Network Access question; one tab per server; start scanruler-mcp with --out inside the project and treat its exports as untrusted until imported.",
    },
  },
  {
    schema: REFERENCE_TOOL_SCHEMA,
    id: "bumpmesh",
    name: "BumpMesh",
    kind: "software",
    description: "Surface textures on a mesh for printing; the textured 3MF is a print variant, never the part's body.",
    nominal: [],
    source: { origin: "builtin", maker: "Stefan Hermann (CNC Kitchen)", url: "https://github.com/CNCKitchen/stlTexturizer" },
    evidence: { layout: EVIDENCE_LAYOUT, photos: false },
    software: {
      homepage: "https://bumpmesh.com",
      repository: "https://github.com/CNCKitchen/stlTexturizer",
      author: "Stefan Hermann (CNC Kitchen)",
      license: "AGPL-3.0-only",
      relationship: "reference",
      runs: "browser",
      selfHost: "docker compose up -d (port 8080)",
      reads: ["stl", "obj", "3mf", "step"],
      writes: ["stl", "3mf", "bumpmesh"],
      handoffs: ["texture-print-variant"],
      provenanceMethod: "converted",
      testedVersions: ["1.5.1"],
      notes: "No open-by-URL entry point: the person drags the exported file in and drops the textured 3MF back (protoboard parts attach).",
    },
  },
];
