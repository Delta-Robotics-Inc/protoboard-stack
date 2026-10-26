/**
 * A part's pages (PB-918) from one revision of it: what the cards' text
 * carousel and the part detail show beyond the overview. Specifications,
 * dimensions and interfaces come from the definition; pictures, the CAD
 * summary and the artifact list from the definition's artifacts and the
 * revision's files. Plain functions with no host API and no React, so the VS
 * Code extension and `protoboard dev` compute the same pages and the unit
 * tests run them directly.
 *
 * Only what the definition states is shown: a page with nothing to show is
 * left out by the views (`availablePages`), never drawn empty.
 */
import type { PartRevisionEnvelope } from "@protoboardai/cloud/client";
import { CARD_PAGES, type CardPageId, type PartArtifactGroup, type PartArtifactItem, type PartCadInfo, type PartFact, type PartImage, type PartOutline, type PartPages } from "./model.js";

type Def = Record<string, any>;
type Envelope = Pick<PartRevisionEnvelope, "artifacts" | "definition" | "revision"> & { evidence?: PartRevisionEnvelope["evidence"] };
type EnvFile = Envelope["artifacts"][number];

// ---------------------------------------------------------------- facts from a definition's own keys

/** A unit a key ends in (`max_power_W`, `hole_diameter_mm`), as it is written. Case matters: `_A` is amperes, `_a` is not. */
const UNITS: Record<string, string> = {
  mm: "mm", cm: "cm", m: "m", g: "g", kg: "kg",
  V: "V", mV: "mV", A: "A", mA: "mA", uA: "µA", nA: "nA", W: "W", mW: "mW",
  C: "°C", s: "s", ms: "ms", us: "µs", h: "h",
  Hz: "Hz", kHz: "kHz", MHz: "MHz", GHz: "GHz",
  ohm: "Ω", mohm: "mΩ", kohm: "kΩ",
  rpm: "rpm", mAh: "mAh", Wh: "Wh", N: "N", Nm: "N·m", deg: "°", dBm: "dBm", dB: "dB",
  hPa: "hPa", kPa: "kPa", bar: "bar", psi: "psi", pct: "%", percent: "%",
  uF: "µF", nF: "nF", pF: "pF", uH: "µH", mH: "mH",
  MB: "MB", GB: "GB", kbps: "kbit/s", Mbps: "Mbit/s", lm: "lm", cd: "cd", nm: "nm",
};
/** A qualifier after the unit (`idle_current_A_max`): it goes after the name ("Idle current, max"). */
const QUALIFIERS = new Set(["min", "max", "typ", "nom", "nominal", "avg", "peak", "rms"]);
/** Words a label writes its own way. */
const WORDS: Record<string, string> = {
  soc: "SoC", io: "I/O", kv: "KV", i2c: "I2C", i3c: "I3C", spi: "SPI", usb: "USB", led: "LED", pcb: "PCB", gpio: "GPIO", wifi: "Wi-Fi", cad: "CAD", mcu: "MCU",
  uart: "UART", pwm: "PWM", adc: "ADC", dac: "DAC", id: "ID", rtc: "RTC", ble: "BLE", cpu: "CPU", gpu: "GPU", ram: "RAM", esc: "ESC", imu: "IMU", fov: "FoV", dc: "DC", ac: "AC",
};
/** Keys that say where a figure came from or remark on it: not a specification. */
const SKIPPED = /^(sources?|notes?|cad|description|comment|comments|references?|url|urls|datasheet)$/;
const NOTE = /(^|_)note$/;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `sensor_average_current_mA` → { label: "Sensor average current", unit: "mA" }; `idle_current_A_max` → "Idle current, max", "A". */
export function keyLabel(key: string): { label: string; unit?: string } {
  const tokens = key.split("_").filter(Boolean);
  let qualifier: string | undefined;
  if (tokens.length > 1 && QUALIFIERS.has(tokens[tokens.length - 1])) qualifier = tokens.pop();
  let unit: string | undefined;
  if (tokens.length > 1 && UNITS[tokens[tokens.length - 1]]) unit = UNITS[tokens.pop()!];
  // a qualifier before the unit too: `diameter_tolerance_mm` keeps its words, `current_max_A` moves "max" after the name
  if (!qualifier && tokens.length > 1 && QUALIFIERS.has(tokens[tokens.length - 1])) qualifier = tokens.pop();
  const words = tokens.map((t) => WORDS[t.toLowerCase()] ?? t);
  const label = cap(words.join(" ")) + (qualifier ? `, ${qualifier}` : "");
  return { label, ...(unit ? { unit } : {}) };
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** A value as a fact's words: a number with its unit, a two-number range, a short text, yes or no. Anything else has no short form. */
function valueText(v: unknown, unit: string | undefined): string | undefined {
  const u = unit ? (unit === "°" || unit === "%" ? unit : ` ${unit}`) : "";
  if (typeof v === "number" && Number.isFinite(v)) return `${num(v)}${u}`;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v.trim() && v.length <= 72 && !/^https?:\/\//.test(v) ? `${v.trim()}${u}` : undefined;
  if (Array.isArray(v) && v.length >= 2 && v.length <= 3 && v.every((x) => typeof x === "number")) {
    // two numbers are a range; a key ending in a length with three is a size
    return v.length === 2 ? (v[0] === v[1] ? `${num(v[0])}${u}` : `${num(v[0])} to ${num(v[1])}${u}`) : `${v.map(num).join(" × ")}${u}`;
  }
  return undefined;
}

/**
 * The facts a domain's `metadata` states, in the order it states them: one
 * per value with a short form; a map of numbers gives one per entry
 * ("Sensor average current, continuous"). Remarks (`*_note`) go to `notes`.
 */
export function metadataFacts(metadata: unknown, notes: string[] = []): PartFact[] {
  const out: PartFact[] = [];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return out;
  for (const [key, v] of Object.entries(metadata as Record<string, unknown>)) {
    if (NOTE.test(key)) {
      if (typeof v === "string" && v.trim()) notes.push(v.trim());
      continue;
    }
    if (SKIPPED.test(key) || v === null || v === undefined) continue;
    const { label, unit } = keyLabel(key);
    const text = valueText(v, unit);
    if (text !== undefined) {
      out.push({ label, value: text });
      continue;
    }
    if (typeof v === "object" && !Array.isArray(v)) {
      for (const [sub, x] of Object.entries(v as Record<string, unknown>)) {
        const t = valueText(x, unit);
        if (t !== undefined) out.push({ label: `${label}, ${keyLabel(sub).label.toLowerCase()}`, value: t });
      }
    }
  }
  return out;
}

const domainsOf = (def: Def): Def[] => (Array.isArray(def.domains) ? def.domains.filter((d: unknown) => d && typeof d === "object") : []);
const range = (v: unknown, unit: string) => valueText(v, unit);

/** The specifications a definition states: its supply, power domains and operating range first, then every domain's own figures but the mechanical ones (those are the dimensions). */
export function specFacts(def: Def): { facts: PartFact[]; notes: string[] } {
  const facts: PartFact[] = [];
  const notes: string[] = [];
  const add = (f: PartFact | undefined) => {
    if (f && !facts.some((x) => x.label.toLowerCase() === f.label.toLowerCase())) facts.push(f);
  };
  const domains = domainsOf(def);
  const elec = domains.find((d) => d.domain === "electrical");
  const therm = domains.find((d) => d.domain === "thermal");
  const supply = range(elec?.metadata?.supply_voltage_V ?? elec?.supply_voltage_V, "V");
  if (supply) add({ label: "Supply", value: supply });
  for (const pd of Array.isArray(elec?.power_domains) ? elec.power_domains.slice(0, 4) : []) {
    const v = range(pd?.voltage_range_V, "V") ?? range(pd?.nominal_voltage_V, "V");
    if (v && typeof pd.name === "string") add({ label: pd.name.replace(/\s*\([^)]*\)\s*$/, ""), value: v, icon: "zap" });
  }
  const temp = range(therm?.operating_temperature_C, "°C");
  if (temp) add({ label: "Operating temperature", value: temp });
  for (const d of domains) {
    if (d.domain === "mechanical") continue;
    for (const f of metadataFacts(d.metadata, notes)) {
      // the supply was read above; a mounting or package key of a non-mechanical domain is still a specification
      if (/^supply voltage$/i.test(f.label)) continue;
      add(f);
    }
    // a domain's own top-level figures (`thermal.max_junction_C`), other than its structure
    const { domain: _d, metadata: _m, power_domains: _p, operating_temperature_C: _o, supply_voltage_V: _s, ...rest } = d;
    for (const f of metadataFacts(rest, notes)) add(f);
  }
  return { facts, notes };
}

/** The part's outline and the mechanical figures the definition states. */
export function dimensionFacts(def: Def): { outline?: PartOutline; rows: PartFact[] } | undefined {
  const mech = domainsOf(def).find((d) => d.domain === "mechanical");
  if (!mech) return undefined;
  const rows: PartFact[] = [];
  const add = (f: PartFact) => {
    if (!rows.some((x) => x.label.toLowerCase() === f.label.toLowerCase())) rows.push(f);
  };
  const dims = mech.dimensions_mm && typeof mech.dimensions_mm === "object" ? (mech.dimensions_mm as Record<string, unknown>) : {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
  const diameter = n(dims.diameter) ?? n(mech.metadata?.diameter_mm);
  const outline: PartOutline = {
    ...(n(dims.length) !== undefined ? { length: n(dims.length)! } : {}),
    ...(n(dims.width) !== undefined ? { width: n(dims.width)! } : {}),
    ...(n(dims.height) !== undefined ? { height: n(dims.height)! } : {}),
    ...(diameter !== undefined ? { diameter } : {}),
  };
  const size = [outline.length, outline.width, outline.height].filter((x): x is number => x !== undefined);
  if (size.length) add({ label: "Size", value: `${size.map(num).join(" × ")} mm`, icon: "ruler" });
  const mass = n(mech.weight_g) ?? n(mech.mass_g) ?? n(mech.metadata?.mass_g) ?? n(mech.metadata?.weight_g) ?? n(def.mass_g);
  if (mass !== undefined) add({ label: "Mass", value: `${num(mass)} g`, icon: "weight" });
  for (const f of metadataFacts(mech.metadata)) if (!/^(mass|weight)$/i.test(f.label)) add(f);
  const { domain: _d, metadata: _m, dimensions_mm: _x, weight_g: _w, mass_g: _g, ...rest } = mech;
  for (const f of metadataFacts(rest)) add(f);
  if (!rows.length) return undefined;
  return { ...(Object.keys(outline).length ? { outline } : {}), rows };
}

// ---------------------------------------------------------------- interfaces

const BUS_LABEL: Record<string, string> = { i2c: "I2C", i3c: "I3C", spi: "SPI", qspi: "QSPI", uart: "UART", usb: "USB", can: "CAN", canfd: "CAN FD", i2s: "I2S", pwm: "PWM", crsf: "CRSF", dshot: "DShot", ethernet: "Ethernet", gpio: "GPIO", adc: "ADC", hdmi: "HDMI", pcie: "PCIe", sdio: "SDIO", swd: "SWD", jtag: "JTAG" };
const busLabel = (p: string) => BUS_LABEL[p.toLowerCase()] ?? cap(p.replace(/_/g, " "));
const plainName = (s: string) => s.replace(/\s*\([^)]*\)/g, "").trim();

/**
 * The part's interfaces as chips, the ones that tell parts apart first:
 * buses and links by their protocol, connectors and mechanical interfaces by
 * name, power pins by name, then plain signal pins folded into one chip.
 * The same chip twice is written once with its count ("STEMMA QT socket ×2").
 */
export function interfaceChips(def: Def): { chips: string[]; count: number } {
  const list: Def[] = Array.isArray(def.interfaces) ? def.interfaces.filter((i: unknown) => i && typeof i === "object") : [];
  const ranked: { rank: number; label: string }[] = [];
  for (const i of list) {
    const type = String((Array.isArray(i.protocols) ? i.protocols[0]?.type : undefined) ?? "").toLowerCase();
    const name = plainName(String(i.name ?? i.id ?? ""));
    if (!name && !type) continue;
    if (type === "power" || type === "ground") ranked.push({ rank: 2, label: name || "Power" });
    else if (type === "digital" || type === "analog" || type === "signal") ranked.push({ rank: 4, label: type === "analog" ? "Analog pins" : "Signal pins" });
    else if (type === "connector" || i.domain === "mechanical" || !type) ranked.push({ rank: i.domain === "mechanical" ? 3 : 1, label: name || busLabel(type) });
    else ranked.push({ rank: 0, label: busLabel(type) });
  }
  const counts = new Map<string, { rank: number; n: number; at: number }>();
  ranked.forEach((r, at) => {
    const c = counts.get(r.label);
    if (c) c.n++;
    else counts.set(r.label, { rank: r.rank, n: 1, at });
  });
  const chips = [...counts]
    .sort((a, b) => a[1].rank - b[1].rank || a[1].at - b[1].at)
    .map(([label, c]) => (c.n > 1 ? `${label} ×${c.n}` : label));
  return { chips, count: list.length };
}

// ---------------------------------------------------------------- files: pictures, CAD, artifacts

const fileName = (path: string) => path.split("/").pop() ?? path;
const extOf = (path: string) => (/\.([a-z0-9]+)$/i.exec(path.split(/[?#]/)[0])?.[1] ?? "").toLowerCase();

/** "0.85 MB", "13.3 MB", "995 B". */
export function fileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e5) return `${Math.round(bytes / 100) / 10} kB`;
  const mb = bytes / 1e6;
  return `${mb < 10 ? Math.round(mb * 100) / 100 : Math.round(mb * 10) / 10} MB`;
}

/** A licence as a card writes it: its SPDX id, or "library terms" for the library's own. */
export const licenseLabel = (license: string | undefined) => (!license ? undefined : /^LicenseRef-/i.test(license) ? "library terms" : license);

const isImage = (a: EnvFile) => a.mediaType.startsWith("image/");
const isGlb = (a: EnvFile) => a.mediaType === "model/gltf-binary" || extOf(a.path) === "glb";
const isStep = (a: EnvFile) => a.mediaType === "model/step" || /^(step|stp)$/.test(extOf(a.path));

/** The revision's pictures, the catalog picture first: the files a host fetches before it builds the pages. */
export function pageImages(env: Pick<Envelope, "artifacts">): { sha256: string; size: number; mediaType: string; label: string }[] {
  const images = env.artifacts.filter(isImage);
  const first = images.filter((a) => a.role === "thumbnail");
  const rest = images.filter((a) => a.role !== "thumbnail");
  const label = (a: EnvFile) => (a.role === "thumbnail" ? "Catalog picture" : cap(fileName(a.path).replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ")));
  const seen = new Set<string>();
  return [...first, ...rest].filter((a) => !seen.has(a.sha256) && !!seen.add(a.sha256)).map((a) => ({ sha256: a.sha256, size: a.size, mediaType: a.mediaType, label: label(a) }));
}

/** The CAD a revision carries, in a line or two: its STEP, where it came from, its named mate features, and whether there is a mesh to orbit. */
export function cadInfo(env: Pick<Envelope, "artifacts" | "definition">, preview?: string): PartCadInfo | undefined {
  const defArts: Def[] = Array.isArray((env.definition as Def).artifacts) ? (env.definition as Def).artifacts : [];
  const roleOf = (a: EnvFile) => a.role ?? defArts.find((d) => d.id === a.artifactId)?.role;
  const glbs = env.artifacts.filter(isGlb);
  const body = glbs.find((a) => roleOf(a) === "body") ?? glbs.find((a) => roleOf(a) !== "interface");
  const steps = env.artifacts.filter(isStep);
  const step = steps.find((a) => a.role === "body") ?? steps[0];
  const features = glbs.filter((a) => roleOf(a) === "interface").length;
  const main = step ?? body;
  if (!main) return undefined;
  const vendor = /vendor/i.test(`${main.artifactId ?? ""} ${main.path}`);
  const kcl = env.artifacts.some((a) => extOf(a.path) === "kcl");
  const tool = defArts.find((d) => d.id === main.artifactId)?.provenance?.tool;
  const second = vendor ? licenseLabel(main.terms?.license) : kcl ? "KCL" : typeof tool === "string" ? tool.split(/[\s(]/)[0] : licenseLabel(main.terms?.license);
  return {
    ...(preview ? { preview } : {}),
    file: `${step ? "STEP" : "GLB"} · ${fileSize(main.size)}`,
    origin: [vendor ? "Vendor CAD" : "Generated", second].filter(Boolean).join(" · "),
    features,
    ...(body ? { mesh: body.size } : {}),
  };
}

const LINK_KINDS: Record<string, { label: string; icon: string }> = {
  datasheet: { label: "Datasheets", icon: "file-text" },
  documentation: { label: "Documentation", icon: "book-open" },
  schematic: { label: "Schematics", icon: "circuit-board" },
  pcb: { label: "PCB", icon: "circuit-board" },
  firmware: { label: "Firmware", icon: "binary" },
  simulation: { label: "Simulation", icon: "chart-line" },
  cad: { label: "Drawings", icon: "pencil-ruler" },
  "3d_model": { label: "3D models", icon: "box" },
};

const linkNote = (url: string) => {
  const e = extOf(url);
  return e === "pdf" ? "PDF" : /^(png|jpe?g|webp|gif|svg)$/.test(e) ? "image" : /^(zip|gz|7z)$/.test(e) ? "archive" : "web";
};

/** The kind a carried file is listed under. */
function fileKind(a: EnvFile): { kind: string; label: string; icon: string } {
  const e = extOf(a.path);
  if (a.role === "license") return { kind: "license", label: "Licences", icon: "scale" };
  if (isImage(a)) return { kind: "image", label: "Pictures", icon: "image" };
  if (isGlb(a)) return a.role === "interface" ? { kind: "interface-geometry", label: "Interface geometry", icon: "magnet" } : { kind: "mesh", label: "Viewer mesh", icon: "box" };
  if (isStep(a) || /^(stl|3mf|f3d|iges|igs|sldprt|fcstd)$/.test(e) || a.mediaType === "model/stl" || a.mediaType === "model/3mf") return { kind: "cad-model", label: "CAD models", icon: "box" };
  if (/^(py|kcl|scad|ts)$/.test(e) || a.mediaType === "text/x-python") return { kind: "cad-source", label: "CAD source", icon: "file-code" };
  if (a.mediaType === "application/json" && /manifest/i.test(a.path)) return { kind: "manifest", label: "Feature manifests", icon: "list-tree" };
  if (a.mediaType === "application/pdf") return { kind: "document", label: "Documents", icon: "file-text" };
  if (a.mediaType === "application/zip") return { kind: "archive", label: "Archives", icon: "file-archive" };
  return { kind: "file", label: "Other files", icon: "file" };
}

const KIND_ORDER = ["datasheet", "documentation", "schematic", "pcb", "cad", "cad-model", "3d_model", "mesh", "cad-source", "interface-geometry", "manifest", "firmware", "simulation", "document", "image", "archive", "file", "license", "evidence"];

/** The part's artifacts by kind, with counts: the definition's links (datasheets, documentation, schematics), the files the revision carries (CAD models, sources, meshes, licences) and its evidence. */
export function artifactGroups(env: Envelope): PartArtifactGroup[] {
  const groups = new Map<string, { label: string; icon: string; items: PartArtifactItem[]; formats: string[]; unit: string }>();
  const push = (k: { kind: string; label: string; icon: string }, item: PartArtifactItem, format: string, unit: string) => {
    const g = groups.get(k.kind) ?? { label: k.label, icon: k.icon, items: [], formats: [], unit };
    g.items.push(item);
    if (format && !g.formats.includes(format)) g.formats.push(format);
    groups.set(k.kind, g);
  };
  const defArts: Def[] = Array.isArray((env.definition as Def).artifacts) ? (env.definition as Def).artifacts : [];
  for (const a of defArts) {
    if (typeof a?.url !== "string" || !/^https?:\/\//.test(a.url)) continue;
    const type = String(a.type ?? "documentation");
    const k = LINK_KINDS[type] ?? { label: cap(type.replace(/_/g, " ")), icon: "link" };
    push({ kind: type, ...k }, { name: String(a.name ?? a.id ?? a.url), note: linkNote(a.url), url: a.url }, "", "links");
  }
  for (const a of env.artifacts) {
    if (a.role === "thumbnail") continue;
    const k = fileKind(a);
    const license = licenseLabel(a.terms?.license);
    push(k, { name: fileName(a.path), note: fileSize(a.size), ...(license ? { license } : {}) }, extOf(a.path).toUpperCase(), "files");
  }
  for (const e of env.evidence ?? []) push({ kind: "evidence", label: "Evidence", icon: "shield-check" }, { name: e.title ?? cap(e.kind), note: e.kind, ...(e.url ? { url: e.url } : {}) }, "", "records");
  const rank = (kind: string) => (KIND_ORDER.indexOf(kind) + 1 || KIND_ORDER.length) - 1;
  return [...groups]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([kind, g]) => {
      const one = g.items.length === 1 ? g.items[0] : undefined;
      const formats = g.formats.length > 0 && g.formats.length <= 3 ? g.formats.join(" · ") : "";
      return {
        kind,
        label: g.label,
        icon: g.icon,
        items: g.items,
        summary: one ? one.name : formats ? `${g.label} · ${formats}` : g.label,
        note: one ? (one.note ?? "") : `${g.items.length} ${g.unit}`,
      };
    });
}

// ---------------------------------------------------------------- the pages

/**
 * A revision's pages. `urls` are the pictures the host fetched, by blob
 * address (`pageImages` lists them); a picture without a URL is left out.
 */
export function partPages(env: Envelope, o: { urls?: Record<string, string> } = {}): PartPages {
  const def = env.definition as Def;
  const images: PartImage[] = pageImages(env)
    .filter((i) => o.urls?.[i.sha256])
    .map((i) => ({ url: o.urls![i.sha256], label: i.label }));
  const { facts, notes } = specFacts(def);
  const dimensions = dimensionFacts(def);
  const cad = cadInfo(env, images[0]?.url);
  return {
    revision: env.revision,
    images,
    specs: facts,
    specNotes: notes,
    ...(dimensions ? { dimensions } : {}),
    interfaces: interfaceChips(def),
    ...(cad ? { cad } : {}),
    artifacts: artifactGroups(env),
  };
}

/** The pages a part has data for, in order; the overview always is. Before the pages are known, every page is offered. */
export function availablePages(pages: PartPages | undefined): CardPageId[] {
  if (!pages) return [...CARD_PAGES];
  return CARD_PAGES.filter((p) => {
    switch (p) {
      case "overview":
        return true;
      case "specs":
        return pages.specs.length > 0;
      case "dimensions":
        return !!pages.dimensions;
      case "interfaces":
        return pages.interfaces.chips.length > 0;
      case "cad":
        return !!pages.cad;
      case "artifacts":
        return pages.artifacts.length > 0;
    }
  });
}

export const PAGE_LABEL: Record<CardPageId, string> = { overview: "Overview", specs: "Specs", dimensions: "Dimensions", interfaces: "Interfaces", cad: "CAD", artifacts: "Artifacts" };
export const PAGE_ICON: Record<CardPageId, string> = { overview: "info", specs: "gauge", dimensions: "ruler", interfaces: "plug", cad: "box", artifacts: "paperclip" };
