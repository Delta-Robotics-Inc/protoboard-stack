/**
 * A part's status (PB-932): the one mapping from what a library records
 * today to local, unverified, verified and official, and what it reads from
 * a project's vendored evidence.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { BLANK_BLOCK_TEXT, PART_TRUST_STATES, PART_TRUST_TEXT, isBlankBlock, parseVerificationRecord, partTrust, partTrustTooltip, vendoredTrust } from "../src/index.js";

const TMP = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp-part-trust");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("partTrust", () => {
  it("a part that is not from a library is local, whatever else is known", () => {
    expect(partTrust({ inLibrary: false })).toEqual({ trust: "local", basis: "not in a library" });
    expect(partTrust({ inLibrary: false, reported: "official", verification: { audit: { independent: true } } }).trust).toBe("local");
  });

  it("a library part is verified only by an independent audit with no wrong fact left unrepaired", () => {
    expect(partTrust({ inLibrary: true, verification: { audit: { independent: true, wrong: 0 } } })).toEqual({ trust: "verified", basis: "independent audit recorded" });
    // a wrong fact with its repair recorded is resolved (as ext-hardware's evidence check reads it)
    expect(partTrust({ inLibrary: true, verification: { audit: { independent: true, wrong: 2 }, repairs: "pinout corrected" } }).trust).toBe("verified");
    expect(partTrust({ inLibrary: true, verification: { audit: { independent: true, wrong: 2 } } })).toEqual({ trust: "unverified", basis: "its audit found wrong facts with no recorded repair" });
    expect(partTrust({ inLibrary: true, verification: { audit: { independent: false, wrong: 0 } } })).toEqual({ trust: "unverified", basis: "self-audit only: an independent audit is still owed" });
    expect(partTrust({ inLibrary: true, verification: { audit: {} } }).trust).toBe("unverified");
    expect(partTrust({ inLibrary: true, verification: {} })).toEqual({ trust: "unverified", basis: "its verification record has no audit" });
  });

  it("no record, or one that could not be read, is unverified: never guessed", () => {
    expect(partTrust({ inLibrary: true })).toEqual({ trust: "unverified", basis: "no verification record" });
    expect(partTrust({ inLibrary: true, verification: null })).toEqual({ trust: "unverified", basis: "its verification record could not be read" });
  });

  it("official comes only from what the library reports; nothing else today says who maintains a part", () => {
    expect(partTrust({ inLibrary: true, reported: "official" })).toEqual({ trust: "official", basis: "reported by the library" });
    // the library's report wins over the record
    expect(partTrust({ inLibrary: true, reported: "unverified", verification: { audit: { independent: true } } }).trust).toBe("unverified");
    // an unknown word from a library is not a status
    expect(partTrust({ inLibrary: true, reported: "trusted", verification: { audit: { independent: true } } }).trust).toBe("verified");
    // no input makes a part official without that report
    for (const verification of [undefined, null, { audit: { independent: true, wrong: 0 } }]) expect(partTrust({ inLibrary: true, ...(verification !== undefined ? { verification } : {}) }).trust).not.toBe("official");
  });

  it("reads a verification.json, tolerating what is not one", () => {
    expect(parseVerificationRecord(JSON.stringify({ partId: "x", audit: { method: "m", independent: true, checked: 20, wrong: 1 }, repairs: "fixed" }))).toEqual({ audit: { independent: true, wrong: 1 }, repairs: "fixed" });
    expect(parseVerificationRecord(JSON.stringify({ partId: "x" }))).toEqual({});
    expect(parseVerificationRecord("not json")).toBeNull();
    expect(parseVerificationRecord("[1]")).toBeNull();
    // a string where a boolean belongs is not an independent audit
    expect(partTrust({ inLibrary: true, verification: parseVerificationRecord(JSON.stringify({ audit: { independent: "yes" } })) }).trust).toBe("unverified");
  });

  it("names the four states and says what each means", () => {
    expect(PART_TRUST_STATES).toEqual(["local", "unverified", "verified", "official"]);
    for (const t of PART_TRUST_STATES) expect(PART_TRUST_TEXT[t].meaning.length).toBeGreaterThan(20);
    expect(partTrustTooltip("official")).toBe("Official. An official part, maintained by the Protoboard team.");
    expect(partTrustTooltip("unverified", "no verification record")).toMatch(/^Unverified\. In a library, but not verified.*\(No verification record\.\)$/);
    expect(partTrustTooltip("local", "not in a library")).toBe("Local. Only in this project: researched or designed here, not in a library.");
  });
});

describe("vendoredTrust", () => {
  const write = (rel: string, body: unknown) => {
    mkdirSync(join(TMP, rel, ".."), { recursive: true });
    writeFileSync(join(TMP, rel), typeof body === "string" ? body : JSON.stringify(body));
  };
  it("reads the verification record vendored with a library revision (offline)", () => {
    write("parts/catalog/a/library/parts/a/verification.json", { audit: { independent: true, wrong: 0 } });
    write("parts/catalog/b/library/parts/b/verification.json", { audit: { independent: false, wrong: 0 } });
    write("parts/catalog/c/library/parts/c/verification.json", "{ broken");
    const at = (id: string) => ({ evidence: [{ kind: "sources", file: `parts/catalog/${id}/library/parts/${id}/sources.json` }, { kind: "verification", file: `parts/catalog/${id}/library/parts/${id}/verification.json` }] });
    expect(vendoredTrust(TMP, at("a"))).toEqual({ trust: "verified", trustBasis: "independent audit recorded" });
    expect(vendoredTrust(TMP, at("b")).trust).toBe("unverified");
    expect(vendoredTrust(TMP, at("c"))).toEqual({ trust: "unverified", trustBasis: "its verification record could not be read" });
    // the record is named but its file is gone
    expect(vendoredTrust(TMP, at("missing")).trustBasis).toBe("its verification record could not be read");
    // a revision vendored with sources only, or without evidence
    expect(vendoredTrust(TMP, { evidence: [{ kind: "sources", file: "x" }] })).toEqual({ trust: "unverified", trustBasis: "no verification record" });
    expect(vendoredTrust(TMP, undefined).trust).toBe("unverified");
  });
});

describe("a blank block (a module with no part chosen)", () => {
  const blank = { inLibrary: false, children: 0, artifacts: 0, details: 0 };

  it("is a module of the project with a name and interfaces only", () => {
    expect(isBlankBlock(blank)).toBe(true);
    expect(isBlankBlock({ ...blank, kind: "module" })).toBe(true);
    expect(isBlankBlock({ ...blank, manufacturer: "  ", partNumber: "" })).toBe(true);
  });

  it("is not a part that names its part, carries a file or engineering data, holds modules, or comes from a library", () => {
    expect(isBlankBlock({ ...blank, partNumber: "USB4105-GF-A" })).toBe(false);
    expect(isBlankBlock({ ...blank, manufacturer: "GCT" })).toBe(false);
    expect(isBlankBlock({ ...blank, artifacts: 1 })).toBe(false);
    // a board's pads and an assembly's materials: described by their package or their specification
    expect(isBlankBlock({ ...blank, details: 1 })).toBe(false);
    expect(isBlankBlock({ ...blank, children: 3 })).toBe(false);
    expect(isBlankBlock({ ...blank, inLibrary: true })).toBe(false);
    expect(isBlankBlock({ ...blank, kind: "harness" })).toBe(false);
    expect(isBlankBlock({ ...blank, kind: "group" })).toBe(false);
  });

  it("says so in place of the status, in every view's tooltip", () => {
    expect(partTrustTooltip("local", "no part chosen", true)).toBe(`${BLANK_BLOCK_TEXT.label}. ${BLANK_BLOCK_TEXT.meaning}`);
    expect(partTrustTooltip("local", "not in a library")).toBe(`${PART_TRUST_TEXT.local.label}. ${PART_TRUST_TEXT.local.meaning}`);
    expect(BLANK_BLOCK_TEXT.label).toBe("Blank block");
  });
});
