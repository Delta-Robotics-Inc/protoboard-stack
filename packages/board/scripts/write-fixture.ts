/**
 * Writes the Airnode C3 fixture's board files to packages/board/test/fixtures/airnode-c3/ (the tests compare them
 * byte for byte with what the builder makes).
 *
 *   npx tsx packages/board/scripts/write-fixture.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { airnodeC3, AIRNODE_C3_NETLIST } from "../src/fixtures/airnode-c3.js";
import { fileName, serializeDocument, serializeNetlist, NETLIST_FILE } from "../src/format.js";
import { BOARD_FILES } from "../src/schema.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "airnode-c3");
mkdirSync(out, { recursive: true });
const texts = serializeDocument(airnodeC3());
for (const f of BOARD_FILES) writeFileSync(join(out, fileName(f)), texts[f]);
writeFileSync(join(out, NETLIST_FILE), serializeNetlist(AIRNODE_C3_NETLIST));
console.log(`wrote ${BOARD_FILES.length + 1} files to ${out}`);
