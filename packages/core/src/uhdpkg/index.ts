/**
 * `.uhdpkg` (PB-1195): a part revision envelope (`protoboard.part-revision/v1`
 * or `uhd.part-revision/v1`, unchanged) plus its files, zipped, with no
 * change to UHD. See docs/reference/uhdpkg.md.
 *
 * - `buildPackage` / `writePackage`: envelope + files → archive (deterministic).
 * - `inputFromFolder`: an unpacked package or an envelope.json folder → input.
 * - `inputFromProjectPart`: a project's part → input, offline, as publish builds it.
 * - `inspectPackage` / `verifyPackageFile`: every check, no file written.
 * - `readPackage`: every check, then the files into a new folder, atomically.
 */
export { DEFAULT_CAPS, DERIVED_DIR, FIXED_CREATED_AT, KNOWN_MEMBERS, KNOWN_REQUIRED, MANIFEST_NAME, UHDPKG_EXT, UHDPKG_SCHEMA, capsWith, type DerivedEntry, type PackageProvenance, type UhdpkgCaps, type UhdpkgManifest } from "./manifest.js";
export { MAX_NAME_BYTES, MAX_SEGMENT_BYTES, entryNameProblem, nameClashes, nameKey } from "./names.js";
export { ENVELOPE_WARNING_CODES, envelopeFiles, inspectPackage, type EntryKind, type EntryReport, type ExpectedFile, type InspectOptions, type PackageReport, type Problem } from "./verify.js";
export { ENVELOPE_FILE, UhdpkgError, buildPackage, inputFromFolder, outputNameProblem, writeFileAtomic, writePackage, type BuiltPackage, type DerivedInput, type FileSource, type PackageInput } from "./write.js";
export { readPackage, verifyPackageFile, type ReadResult } from "./read.js";
export { inputFromProjectPart, type ProjectPartOptions } from "./project-part.js";
export { ZipError, crc32, crc32Table, readEntry, readZipDirectory, writeZip, type ZipEntry, type ZipInput } from "./zip.js";
