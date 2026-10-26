/**
 * Stand-in test data for a system, generated from its model by the doc
 * spec's recipe (`testData.standins`, a module in lib/standins/). Writes
 * `docs/test-data/<test-id>.json` with status "standin". A file whose status
 * is "measured" is never touched; existing stand-ins are refreshed (they are
 * derived data, so regenerating them from the current model is always safe).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { BuiltContext } from "./context.ts";
import type { TestData } from "./testdata.ts";

export async function writeStandins(ctx: BuiltContext): Promise<{ written: string[]; kept: string[] }> {
  const recipe = ctx.sys.config.testData?.standins;
  if (!recipe) return { written: [], kept: [] };
  if (!/^[\w-]+$/.test(recipe)) throw new Error(`testData.standins "${recipe}" is not a recipe name (lib/standins/<name>.ts)`);
  const mod = await import(new URL(`./standins/${recipe}.ts`, import.meta.url).href);
  const sets: TestData[] = mod.standins(ctx);
  const dir = join(ctx.sys.absDocs, "test-data");
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const kept: string[] = [];
  for (const t of sets) {
    const file = join(dir, `${t.id}.json`);
    if (existsSync(file)) {
      const cur = JSON.parse(readFileSync(file, "utf8"));
      if (cur.status === "measured") {
        kept.push(t.id);
        continue;
      }
    }
    writeFileSync(file, JSON.stringify(t, null, 2) + "\n");
    written.push(t.id);
  }
  return { written, kept };
}
