/**
 * Facts about a pin, a part or a net as the Inspect panel shows them, each with a status chip that says where it
 * comes from (concept decision 7): `authored` (stated in the UHD source), `inferred` (derived by the tool),
 * `confirmed` (verified by a check: the drawn netlist equals UHD, a voltage within the pin's limits), `conflict`
 * (a finding contradicts it), `stale` (the circuit changed since the sheet was laid out), `proposed` (a fix or a
 * cleanup on screen would change it). Pure; no DOM.
 */
import type { PageDerived, PageFinding, PageModel, PageNet, PagePart } from "./types.js";

export type Chip = "confirmed" | "authored" | "inferred" | "proposed" | "stale" | "conflict";
export const CHIPS: readonly Chip[] = ["confirmed", "authored", "inferred", "proposed", "stale", "conflict"];

export interface Fact {
  label: string;
  value: string;
  chip?: Chip;
  why?: string;
}

const volts = (v: number) => `${Math.round(v * 100) / 100} V`;
export function voltageText(v: { min?: number; max?: number; nominal?: number } | undefined): string | undefined {
  if (!v) return undefined;
  if (v.nominal !== undefined && v.min === undefined && v.max === undefined) return volts(v.nominal);
  const range = v.min !== undefined && v.max !== undefined ? `${volts(v.min)} to ${volts(v.max)}` : v.max !== undefined ? `up to ${volts(v.max)}` : v.min !== undefined ? `at least ${volts(v.min)}` : "";
  return v.nominal !== undefined ? `${volts(v.nominal)} (${range})` : range;
}

/** The findings that name a pin (by its key). */
export const findingsOfPin = (d: PageDerived | undefined, key: string): PageFinding[] => (d?.findings ?? []).filter((f) => f.objects.includes(`pin:${key}`));
export const findingsOfNet = (d: PageDerived | undefined, net: string): PageFinding[] => (d?.findings ?? []).filter((f) => f.objects.includes(`net:${net}`));

const gateOk = (d: PageDerived | undefined, id: string) => !!d && d.gateRules.some((g) => g.id === id && g.count === 0);

export function pinFacts(part: PagePart, pinId: string, ctx: { derived?: PageDerived; nets: readonly PageNet[]; stale?: boolean; proposed?: boolean }): Fact[] {
  const q = part.pins.find((p) => p.id === pinId);
  if (!q) return [];
  const key = `${part.path}:${pinId}`;
  const found = findingsOfPin(ctx.derived, key);
  const volt = found.find((f) => f.check === "voltage");
  const open = found.find((f) => f.check === "unconnected_pin");
  const net = q.net ? ctx.nets.find((n) => n.name === q.net) : undefined;
  const out: Fact[] = [
    { label: "Pin", value: `${q.number} · ${q.name}`, chip: "authored", why: "the part's UHD pin table" },
    { label: "Type", value: q.type.replace(/_/g, " "), chip: "inferred", why: "from the pin's UHD protocols" },
  ];
  if (q.net) out.push({ label: "Net", value: net?.shown && net.shown !== q.net ? `${net.shown} (${q.net})` : q.net, chip: gateOk(ctx.derived, "C01") ? "confirmed" : "authored", why: gateOk(ctx.derived, "C01") ? "UHD's net; the drawn netlist equals UHD (gate C01)" : "UHD's net" });
  else if (q.open) out.push({ label: "Net", value: "left open on purpose", chip: "authored", why: q.open });
  else out.push({ label: "Net", value: "none", ...(open ? { chip: "conflict" as const, why: open.message } : { chip: "authored" as const }) });
  const allowed = voltageText(q.voltage);
  if (allowed) out.push({ label: "Allowed", value: allowed, chip: "authored", why: "the pin's UHD voltage parameter" });
  if (net?.voltage) out.push({ label: "Net level", value: voltageText(net.voltage)!, chip: "authored", why: "the net's design voltage in UHD" });
  if (volt) out.push({ label: "Voltage check", value: volt.severity === "error" ? "fails" : "uncertain", chip: "conflict", why: volt.message });
  else if (q.voltage?.max !== undefined && q.net && ctx.derived) out.push({ label: "Voltage check", value: `within ${volts(q.voltage.max)}`, chip: "confirmed", why: "the highest level its net can reach stays within the pin's maximum" });
  if (q.functions) out.push({ label: "Functions", value: q.functions, chip: "authored", why: "pin_functions, cited in UHD" });
  if (q.capabilities?.length) out.push({ label: "Can be", value: q.capabilities.join(", "), chip: "authored" });
  if (ctx.stale) out.push({ label: "Placement", value: "laid out against an older circuit", chip: "stale", why: "the UHD circuit changed since this sheet was laid out; run the layout" });
  if (ctx.proposed) out.push({ label: "Placement", value: "a fix on screen moves it", chip: "proposed" });
  return out;
}

export function partFacts(part: PagePart, ctx: { stale?: boolean; proposed?: boolean; refFromBoard?: boolean }): Fact[] {
  const out: Fact[] = [
    { label: "Reference", value: part.ref, chip: ctx.refFromBoard ? "authored" : "inferred", why: ctx.refFromBoard ? "the designator the board uses" : "assigned once by the layout, then kept" },
    { label: "Part", value: part.name, chip: "authored", why: `UHD definition ${part.part}` },
  ];
  if (part.value) out.push({ label: "Value", value: part.value, chip: "authored" });
  if (part.mpn) out.push({ label: "MPN", value: part.mpn, chip: "authored", why: "the part's UHD part number" });
  else out.push({ label: "MPN", value: "not stated in UHD" });
  out.push({ label: "Class", value: part.class.replace(/_/g, " "), chip: "inferred", why: "from the UHD passive trait, categories and pin names" });
  if (part.categories?.length) out.push({ label: "Categories", value: part.categories.join(", "), chip: "authored" });
  out.push({ label: "Symbol", value: part.symbol.source === "pack" ? `pack ${part.symbol.id}${part.symbol.variant ? ` (${part.symbol.variant})` : ""}` : `generated: ${part.symbol.id}`, chip: part.symbol.source === "pack" ? "authored" : "inferred", why: part.symbol.source === "pack" ? "a drawn symbol of the Protoboard symbol pack" : "built from the part's pin data (supply on top, ground below, inputs left, outputs right)" });
  out.push({ label: "Sub-module", value: part.group || "the board's root", chip: "authored", why: "where the part sits in UHD (its card)" });
  if (ctx.stale) out.push({ label: "Placement", value: "laid out against an older circuit", chip: "stale" });
  if (ctx.proposed) out.push({ label: "Placement", value: "a fix on screen moves it", chip: "proposed" });
  return out;
}

export function netFacts(net: PageNet, ctx: { derived?: PageDerived; parts: readonly PagePart[]; cards: ReadonlyMap<string, string> }): Fact[] {
  const found = findingsOfNet(ctx.derived, net.name);
  const out: Fact[] = [
    { label: "Net", value: net.shown === net.name ? net.name : `${net.shown} (${net.name})`, chip: "authored", why: "UHD's net" },
    { label: "Kind", value: `${net.kind} · ${net.cls}`, chip: "inferred", why: "rails and ground by kind; I2C, USB and analog by the pins on it" },
    { label: "Pins", value: String(net.pins.length), chip: gateOk(ctx.derived, "C01") ? "confirmed" : "authored", why: gateOk(ctx.derived, "C01") ? "the drawn netlist equals UHD (gate C01)" : undefined as unknown as string },
  ];
  if (net.voltage) out.push({ label: "Design level", value: voltageText(net.voltage)!, chip: "authored" });
  if (net.cards.length) out.push({ label: "Cards", value: net.cards.map((c) => ctx.cards.get(c) ?? c).join(", ") });
  for (const f of found) out.push({ label: f.check.replace(/_/g, " "), value: f.severity, chip: "conflict", why: f.message });
  return out.map((f) => (f.why === undefined ? { label: f.label, value: f.value, ...(f.chip ? { chip: f.chip } : {}) } : f));
}

/** A pin key's words: "U1 pin 13 IO9". */
export function pinWords(model: Pick<PageModel, "parts">, key: string): string {
  const i = key.lastIndexOf(":");
  const part = model.parts.find((p) => p.path === key.slice(0, i));
  const q = part?.pins.find((p) => p.id === key.slice(i + 1));
  return part && q ? `${part.ref} pin ${q.number} ${q.name}` : key;
}
