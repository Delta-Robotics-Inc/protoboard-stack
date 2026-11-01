/**
 * The `.uhdpkg` manifest (PB-1195): `uhdpkg.json`, the first entry of the
 * zip. It wraps the part revision envelope (`protoboard.part-revision/v1` or
 * `uhd.part-revision/v1`, packages/cloud/src/envelope.ts) exactly as the CLI
 * builds it for `parts publish` and reads it for `parts add`. The envelope
 * already lists every carried file (path, sha256, size, media type, role,
 * licence terms), so the manifest adds no UHD field: the envelope IS the
 * file list. Nothing here changes UHD's structure.
 *
 * Build outputs (part and project digests, vendor-frame sidecars) are never
 * in the envelope: they may ride along as optional entries under `derived/`,
 * keyed by the sha256 of the CAD file they describe, listed in the
 * manifest's own `derived` member.
 */
import { createRequire } from "node:module";
import type { PartRevisionDraft, PartRevisionEnvelope } from "@protoboardai/cloud/client";

/** The manifest's schema id. v0: the format may change before 1.0. DEFAULT. */
export const UHDPKG_SCHEMA = "protoboard.uhdpkg/v0";
/** The manifest's entry name: always the first entry. */
export const MANIFEST_NAME = "uhdpkg.json";
/** The folder of derived (build-output) entries. */
export const DERIVED_DIR = "derived";
/** The file extension. */
export const UHDPKG_EXT = ".uhdpkg";

/**
 * The names a manifest's `required` may list, all of which this reader
 * understands. A name it does not know is an error (like an unknown glTF
 * required extension), never a warning.
 * - `envelope`: the files are the envelope's, checked by sha256 and size.
 * - `derived`: the `derived/` entries matter to the package's use (a reader
 *   that ignores them would mislead); this one checks them.
 */
export const KNOWN_REQUIRED = ["envelope", "derived"] as const;

/** Top-level manifest members this reader knows; others are ignored with a warning. */
export const KNOWN_MEMBERS = ["schema", "envelope", "required", "createdBy", "createdAt", "derived", "provenance"] as const;

/** A build output carried beside the envelope's files: never part of UHD. */
export interface DerivedEntry {
  /** `derived/<key>/<name>`. */
  path: string;
  /** sha256 (64 hex) of the envelope file this describes: the sidecar key. */
  key: string;
  sha256: string;
  size: number;
  mediaType?: string;
}

/**
 * Where the envelope came from when it is not one the service sealed (a
 * catalog part rebuilt from what a project vendored). Informational.
 */
export interface PackageProvenance {
  kind: "local-part" | "catalog-vendored" | "folder";
  /** The envelope digest the project pinned, when it differs from this envelope's. */
  pinnedEnvelopeDigest?: string;
  note?: string;
}

export interface UhdpkgManifest {
  schema: typeof UHDPKG_SCHEMA;
  envelope: PartRevisionDraft | PartRevisionEnvelope;
  required: string[];
  createdBy: string;
  createdAt: string;
  derived?: DerivedEntry[];
  provenance?: PackageProvenance;
}

/** Size and count caps for reading (and, so a writer never makes a package no reader opens, writing). */
export interface UhdpkgCaps {
  /** DEFAULT 256 MiB: the whole archive. */
  maxArchiveBytes: number;
  /** DEFAULT 128 MiB: one entry, uncompressed. */
  maxEntryBytes: number;
  /** DEFAULT 512 MiB: every entry, uncompressed. */
  maxTotalBytes: number;
  /** DEFAULT 10,000 entries. */
  maxEntries: number;
  /** DEFAULT 200: uncompressed / compressed, for entries of at least `ratioMinBytes` (zip bombs). */
  maxRatio: number;
  /** DEFAULT 1 MiB: small entries compress far without being a threat. */
  ratioMinBytes: number;
  /** DEFAULT 4 MiB: `uhdpkg.json`. */
  maxManifestBytes: number;
}

const MiB = 1024 * 1024;
export const DEFAULT_CAPS: UhdpkgCaps = {
  maxArchiveBytes: 256 * MiB,
  maxEntryBytes: 128 * MiB,
  maxTotalBytes: 512 * MiB,
  maxEntries: 10_000,
  maxRatio: 200,
  ratioMinBytes: 1 * MiB,
  maxManifestBytes: 4 * MiB,
};

export const capsWith = (over: Partial<UhdpkgCaps> = {}): UhdpkgCaps => ({ ...DEFAULT_CAPS, ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)) });

/** `createdBy`: this stack's core package and version. */
export function createdBy(): string {
  try {
    const pkg = createRequire(import.meta.url)("../../package.json") as { name?: string; version?: string };
    return `${pkg.name ?? "@protoboardai/core"} ${pkg.version ?? "?"}`;
  } catch {
    return "@protoboardai/core";
  }
}

/**
 * DEFAULT: the timestamp a package gets when none is given and the envelope
 * has no publish time: fixed, so two writes of the same input are
 * byte-identical. Pass `createdAt` to stamp a real time.
 */
export const FIXED_CREATED_AT = "1980-01-01T00:00:00.000Z";
