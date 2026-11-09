/**
 * The source model: an EasyEDA Pro project read from its export into documents of keyed records, the same shape
 * for both storage formats.
 *
 * - Format 3 (`.epro2`, documented in "lceda-pro-file-format-v3"): the archive holds one log file (`*.epru`).
 *   Each line is two JSON values joined by `||`: an outer `{ type, id, ticket }` and the inner key-value record.
 *   A `DOCHEAD` line starts a document (`docType`, `uuid`, `client`); records after it belong to that document.
 *   For a type and id the highest `ticket` wins; on a tie the smaller `client` wins. An inner value of `""` deletes
 *   the record; `DELETE_DOC` with `isDelete` deletes the document.
 * - Format 2 (`.epro`, documented in "lceda-pro-file-format-v2.2"): `project.json` plus one file per document
 *   (`PCB/`, `FOOTPRINT/`, `POUR/`), each line a JSON array whose positions are fixed per record type. A file may
 *   hold several documents, each starting with `["DOCTYPE", type, version]`; a `HEAD` line may name the
 *   document's uuid. Records are turned into the keyed form of format 3 here (`v2.ts`), so the converter reads one
 *   shape.
 */
import { v2RecordToKeyed } from "./v2.js";
import { ZipReader } from "./zip.js";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Obj = { [k: string]: Json };

export interface SourceRecord {
  type: string;
  /** The outer id as written (format 3 may write a JSON array as a string: `["LAYER",1]`). */
  id: string;
  ticket: number;
  /** Order of first appearance in its document. */
  seq: number;
  data: Obj;
}

export interface SourceDoc {
  docType: string;
  uuid: string;
  /** META title or name, or the format 2 HEAD title. */
  title?: string;
  meta?: Obj;
  deleted: boolean;
  /** type -> id -> record (live records only). */
  records: Map<string, Map<string, SourceRecord>>;
  /** Deleted records by type (counted, not converted). */
  deletedCount: number;
}

export interface SourceBoard {
  uuid: string;
  title: string;
  sort?: number;
  pcb?: string;
}

export interface SourceProject {
  format: 3 | 2;
  title?: string;
  docs: Map<string, SourceDoc>;
  boards: SourceBoard[];
  /** Device attributes by device uuid (format 2 keeps them in project.json). */
  devices: Map<string, Obj>;
  /** Footprint titles by uuid (format 2 keeps them in project.json). */
  footprintTitles: Map<string, string>;
  /** Format notes for the report: lines that could not be read. */
  warnings: string[];
}

export function records(doc: SourceDoc | undefined, type: string): SourceRecord[] {
  const m = doc?.records.get(type);
  return m ? [...m.values()].sort((a, b) => a.seq - b.seq) : [];
}

/** Parse a record id that format 3 writes as a JSON array string; anything else comes back as one string. */
export function idParts(id: string): Json[] {
  if (id.startsWith("[")) {
    try {
      const v = JSON.parse(id) as Json;
      if (Array.isArray(v)) return v;
    } catch {
      /* fall through */
    }
  }
  return [id];
}

// ---------------------------------------------------------------- format 3

/** The end index (exclusive) of the JSON object or array that starts at `start`, honoring strings. */
function jsonEnd(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (inStr) {
      if (c === 92) i++;
      else if (c === 34) inStr = false;
      continue;
    }
    if (c === 34) inStr = true;
    else if (c === 123 || c === 91) depth++;
    else if (c === 125 || c === 93) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

interface Candidate {
  ticket: number;
  client: string;
  seq: number;
  data: Obj | undefined;
}

/** Read a format 3 project log into documents (eventual-consistency rules applied). */
export function parseLog(text: string, warnings: string[] = []): Map<string, SourceDoc> {
  const docs = new Map<string, { doc: SourceDoc; cand: Map<string, Candidate>; deleteTicket: number; deleteState: boolean; metaTicket: number }>();
  let cur: ReturnType<typeof docs.get>;
  let client = "";
  let seq = 0;
  const lines = text.split("\n");
  for (let ln = 0; ln < lines.length; ln++) {
    let line = lines[ln];
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.trim()) continue;
    const end = line.startsWith("{") ? jsonEnd(line, 0) : -1;
    if (end < 0 || line.slice(end, end + 2) !== "||") {
      warnings.push(`log line ${ln + 1} is not "outer||inner"`);
      continue;
    }
    let outer: Obj;
    try {
      outer = JSON.parse(line.slice(0, end)) as Obj;
    } catch {
      warnings.push(`log line ${ln + 1}: the outer object is not JSON`);
      continue;
    }
    let innerText = line.slice(end + 2);
    // each line ends with a single "|" terminator in the exports seen; the documentation does not show it
    if (innerText.endsWith("|")) innerText = innerText.slice(0, -1);
    let inner: Json | undefined;
    if (innerText === "" || innerText === '""') inner = "";
    else
      try {
        inner = JSON.parse(innerText) as Json;
      } catch {
        warnings.push(`log line ${ln + 1}: the inner record is not JSON`);
        continue;
      }
    const type = String(outer.type ?? "");
    if (type === "DOCHEAD") {
      const h = (inner && typeof inner === "object" && !Array.isArray(inner) ? inner : {}) as Obj;
      const uuid = String(h.uuid ?? "");
      client = String(h.client ?? "");
      let d = docs.get(uuid);
      if (!d) {
        d = {
          doc: { docType: String(h.docType ?? ""), uuid, deleted: false, records: new Map(), deletedCount: 0 },
          cand: new Map(),
          deleteTicket: -1,
          deleteState: false,
          metaTicket: -1,
        };
        docs.set(uuid, d);
      }
      cur = d;
      continue;
    }
    if (!cur) {
      warnings.push(`log line ${ln + 1}: a record before any DOCHEAD`);
      continue;
    }
    const ticket = typeof outer.ticket === "number" ? outer.ticket : 0;
    if (type === "DELETE_DOC") {
      if (ticket >= cur.deleteTicket) {
        cur.deleteTicket = ticket;
        cur.deleteState = !!(inner && typeof inner === "object" && !Array.isArray(inner) && (inner as Obj).isDelete);
      }
      continue;
    }
    const id = outer.id === undefined || outer.id === null ? type : typeof outer.id === "string" ? outer.id : JSON.stringify(outer.id);
    const key = `${type}\u0000${id}`;
    const data = inner && typeof inner === "object" && !Array.isArray(inner) ? (inner as Obj) : undefined;
    const prev = cur.cand.get(key);
    if (prev && (prev.ticket > ticket || (prev.ticket === ticket && prev.client <= client))) continue;
    cur.cand.set(key, { ticket, client, seq: prev?.seq ?? seq++, data });
  }
  const out = new Map<string, SourceDoc>();
  for (const { doc, cand, deleteState } of docs.values()) {
    doc.deleted = deleteState;
    for (const [key, c] of cand) {
      const i = key.indexOf("\u0000");
      const type = key.slice(0, i);
      const id = key.slice(i + 1);
      if (!c.data) {
        doc.deletedCount++;
        continue;
      }
      let m = doc.records.get(type);
      if (!m) doc.records.set(type, (m = new Map()));
      m.set(id, { type, id, ticket: c.ticket, seq: c.seq, data: c.data });
    }
    const meta = doc.records.get("META")?.values().next().value?.data;
    if (meta) {
      doc.meta = meta;
      const t = meta.title ?? meta.name;
      if (typeof t === "string" && t) doc.title = t;
    }
    out.set(doc.uuid, doc);
  }
  return out;
}

function readFormat3(zip: ZipReader): SourceProject {
  const warnings: string[] = [];
  const log = zip.names().find((n) => /\.epru$/i.test(n));
  if (!log) throw new Error("this EasyEDA Pro export has no project log (*.epru)");
  const docs = parseLog(zip.text(log), warnings);
  let title: string | undefined;
  if (zip.has("project2.json"))
    try {
      const pj = JSON.parse(zip.text("project2.json")) as Obj;
      if (typeof pj.title === "string") title = pj.title;
    } catch {
      warnings.push("project2.json is not JSON");
    }
  const boards: SourceBoard[] = [];
  for (const d of docs.values()) {
    if (d.docType !== "BOARD" || d.deleted) continue;
    boards.push({ uuid: d.uuid, title: d.title ?? d.uuid, ...(typeof d.meta?.sort === "number" ? { sort: d.meta.sort } : {}) });
  }
  for (const d of docs.values()) {
    if (d.docType !== "PCB" || d.deleted) continue;
    const b = boards.find((x) => x.uuid === d.meta?.board);
    if (b && !b.pcb) b.pcb = d.uuid;
  }
  const devices = new Map<string, Obj>();
  for (const d of docs.values()) {
    if (d.docType !== "DEVICE") continue;
    const a = d.meta?.attributes;
    if (a && typeof a === "object" && !Array.isArray(a)) devices.set(d.uuid, a as Obj);
  }
  const footprintTitles = new Map<string, string>();
  for (const d of docs.values()) if (d.docType === "FOOTPRINT" && d.title) footprintTitles.set(d.uuid, d.title);
  return { format: 3, ...(title ? { title } : {}), docs, boards, devices, footprintTitles, warnings };
}

// ---------------------------------------------------------------- format 2

function readFormat2(zip: ZipReader): SourceProject {
  const warnings: string[] = [];
  const pj = JSON.parse(zip.text("project.json")) as Obj;
  const docs = new Map<string, SourceDoc>();
  for (const name of zip.names()) {
    const m = /^(PCB|FOOTPRINT|POUR)\/([^/]+?)(\.\w+)?$/.exec(name);
    if (!m) continue;
    const fileUuid = m[2];
    let cur: SourceDoc | undefined;
    let seq = 0;
    // the file's own document (a PCB in PCB/, a footprint in FOOTPRINT/) is named by the file; other documents
    // embedded in it (the footprints a PCB file carries) by their HEAD line
    const ownType = m[1] === "POUR" ? "POURED" : m[1];
    let first = true;
    const lines = zip.text(name).split("\n");
    for (let ln = 0; ln < lines.length; ln++) {
      const line = lines[ln].trim();
      if (!line) continue;
      let arr: Json;
      try {
        arr = JSON.parse(line) as Json;
      } catch {
        warnings.push(`${name}:${ln + 1} is not JSON`);
        continue;
      }
      if (Array.isArray(arr) && arr.length === 0) continue; // empty lines of the form []
      if (!Array.isArray(arr) || typeof arr[0] !== "string") {
        warnings.push(`${name}:${ln + 1} is not a record array`);
        continue;
      }
      const type = arr[0];
      if (type === "DOCTYPE") {
        const docType = m[1] === "POUR" ? "POURED" : String(arr[1] ?? "");
        const own = first && docType === ownType;
        if (own) first = false;
        cur = { docType, uuid: own ? fileUuid : `${fileUuid}#${ln + 1}`, deleted: false, records: new Map(), deletedCount: 0 };
        docs.set(cur.uuid, cur);
        continue;
      }
      if (!cur) {
        cur = { docType: m[1], uuid: fileUuid, deleted: false, records: new Map(), deletedCount: 0 };
        first = false;
        docs.set(cur.uuid, cur);
      }
      if (type === "HEAD") {
        const h = (arr[1] && typeof arr[1] === "object" && !Array.isArray(arr[1]) ? arr[1] : {}) as Obj;
        if (typeof h.uuid === "string" && h.uuid && h.uuid !== cur.uuid && cur.uuid !== fileUuid) {
          docs.delete(cur.uuid);
          cur.uuid = h.uuid;
          docs.set(cur.uuid, cur);
        }
        if (typeof h.title === "string") cur.title = h.title;
        cur.meta = h;
        continue;
      }
      const keyed = v2RecordToKeyed(arr);
      if (!keyed) continue;
      let mm = cur.records.get(keyed.type);
      if (!mm) cur.records.set(keyed.type, (mm = new Map()));
      let id = keyed.id;
      if (mm.has(id)) id = `${id}#${ln + 1}`;
      mm.set(id, { type: keyed.type, id, ticket: 0, seq: seq++, data: keyed.data });
    }
  }
  const asObj = (v: Json | undefined): Obj => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const boards: SourceBoard[] = [];
  for (const [name, b] of Object.entries(asObj(pj.boards))) {
    const pcb = asObj(b).pcb;
    boards.push({ uuid: name, title: name, ...(typeof pcb === "string" && pcb ? { pcb } : {}) });
  }
  for (const [uuid, title] of Object.entries(asObj(pj.pcbs))) {
    const d = docs.get(uuid);
    if (d && typeof title === "string") d.title = title;
  }
  const devices = new Map<string, Obj>();
  for (const [uuid, dv] of Object.entries(asObj(pj.devices))) devices.set(uuid, asObj(asObj(dv).attributes));
  const footprintTitles = new Map<string, string>();
  for (const [uuid, f] of Object.entries(asObj(pj.footprints))) {
    const t = asObj(f).title;
    if (typeof t === "string") footprintTitles.set(uuid, t);
  }
  const cfg = asObj(pj.config);
  return { format: 2, ...(typeof cfg.title === "string" ? { title: cfg.title } : {}), docs, boards, devices, footprintTitles, warnings };
}

/** Read an EasyEDA Pro export (format 3 `.epro2` or format 2 `.epro`). */
export function readProject(bytes: Uint8Array): SourceProject {
  const zip = new ZipReader(bytes);
  if (zip.names().some((n) => /\.epru$/i.test(n))) return readFormat3(zip);
  if (zip.has("project.json")) return readFormat2(zip);
  throw new Error("not an EasyEDA Pro export: neither a project log (*.epru) nor project.json was found");
}

/** The PCB documents of a project, in board order then title. */
export function listPcbs(p: SourceProject): { uuid: string; title: string; board?: string; records: number }[] {
  const out: { uuid: string; title: string; board?: string; records: number; order: number }[] = [];
  const boardOrder = [...p.boards].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  for (const d of p.docs.values()) {
    if (d.docType !== "PCB" || d.deleted) continue;
    const bi = boardOrder.findIndex((b) => b.pcb === d.uuid);
    let n = 0;
    for (const m of d.records.values()) n += m.size;
    out.push({ uuid: d.uuid, title: d.title ?? d.uuid, ...(bi >= 0 ? { board: boardOrder[bi].title } : {}), records: n, order: bi < 0 ? 1e9 : bi });
  }
  return out.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)).map(({ order: _o, ...r }) => r);
}
