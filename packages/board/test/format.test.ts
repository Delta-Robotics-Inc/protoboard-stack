/** The on-disk format (contract section 7): canonical lines, sorted records, byte-identical round trips. */
import { cpSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { airnodeC3, AIRNODE_C3_NETLIST } from "../src/fixtures/airnode-c3.js";
import { BOARD_FILES, BoardFormatError, diffIds, fileName, loadBoardDir, NETLIST_FILE, parseFile, serializeDocument, serializeNetlist, withChanges, writeBoardDir } from "../src/index.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/airnode-c3/", import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), "pb-board-format-"));

describe("board files", () => {
  it("the committed fixture is what the builder makes (regenerate with scripts/write-fixture.ts)", () => {
    const texts = serializeDocument(airnodeC3());
    for (const f of BOARD_FILES) expect(readFileSync(join(FIXTURE, fileName(f)), "utf8"), f).toBe(texts[f]);
    expect(readFileSync(join(FIXTURE, NETLIST_FILE), "utf8")).toBe(serializeNetlist(AIRNODE_C3_NETLIST));
  });

  it("loads and saves byte-identical", () => {
    const dir = tmp();
    cpSync(FIXTURE, dir, { recursive: true });
    const before = Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f))]));
    const loaded = loadBoardDir(dir);
    const out = tmp();
    const r = writeBoardDir(out, loaded.doc);
    expect(r.written.sort()).toEqual([...BOARD_FILES].sort());
    for (const f of BOARD_FILES) expect(readFileSync(join(out, fileName(f))).equals(before[fileName(f)]), f).toBe(true);
    // saving again over the same folder writes nothing
    const again = writeBoardDir(dir, loaded.doc);
    expect(again.written).toEqual([]);
    expect(again.unchanged.length).toBe(BOARD_FILES.length);
    expect(diffIds(loaded.doc, airnodeC3())).toEqual([]);
  });

  it("writes canonical lines: kind and id first, keys sorted, header first, records sorted", () => {
    const text = serializeDocument(airnodeC3()).copper;
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe('{"file":"copper","schema":"protoboard.board/v1","units":{"angle":"mdeg","length":"nm"}}');
    expect(lines[1].startsWith('{"kind":"track","id":"trk:')).toBe(true);
    const ids = lines.slice(1).map((l) => JSON.parse(l).id as string);
    expect(ids).toEqual([...ids].sort());
    expect(text.endsWith("\n")).toBe(true);
    expect(text).not.toMatch(/:-?\d+\.\d/); // no fractional numbers in copper: integer nanometers
  });

  it("refuses unsorted, misfiled, or malformed lines with a line number", () => {
    const text = serializeDocument(airnodeC3()).copper.trimEnd().split("\n");
    const swapped = [text[0], text[2], text[1], ...text.slice(3)].join("\n") + "\n";
    expect(() => parseFile("copper", swapped)).toThrow(/sorted/);
    expect(() => parseFile("placement", serializeDocument(airnodeC3()).copper)).toThrow(BoardFormatError);
    const bad = [text[0], text[1].replace('"width":', '"widht":')].join("\n") + "\n";
    expect(() => parseFile("copper", bad)).toThrow(/copper.jsonl:2/);
    expect(() => parseFile("copper", text.join("\r\n"))).toThrow(/line ends/);
  });

  it("refuses to overwrite a file changed by someone else", () => {
    const dir = tmp();
    cpSync(FIXTURE, dir, { recursive: true });
    const loaded = loadBoardDir(dir);
    // unchanged text: nothing to write, so nothing to refuse
    expect(writeBoardDir(dir, loaded.doc, { copper: "something else" }).refused).toEqual([]);
    const changed = withChanges(loaded.doc, [], ["trk:f.spare.1"]);
    const r = writeBoardDir(dir, changed, { copper: "what the writer last read" });
    expect(r.refused).toEqual(["copper"]);
    expect(readFileSync(join(dir, "copper.jsonl"), "utf8")).toBe(loaded.texts.copper);
    expect(writeBoardDir(dir, changed, { copper: loaded.texts.copper ?? null }).written).toEqual(["copper"]);
  });
});
