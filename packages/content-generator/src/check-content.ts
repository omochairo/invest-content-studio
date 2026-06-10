/**
 * Quality-gate CLI (1c): run validate + compliance on a ContentPackage file.
 *
 * Exits non-zero on any failure so CI stops before rendering/publishing.
 * A §2 compliance failure must never be carried past this point (AGENTS.md §6).
 *
 * Run: `npm run check -- outputs/content/NVDA.json`
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ContentPackage } from "@ics/shared";
import { complianceGate, validateContentPackage } from "./gate";

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error("usage: npm run check -- <package.json> [...]");

  let failed = false;
  for (const file of files) {
    const pkg = JSON.parse(await readFile(resolve(file), "utf8")) as ContentPackage;
    const v = validateContentPackage(pkg);
    const c = complianceGate(pkg);
    const label = pkg?.meta?.title ?? file;
    if (v.ok && c.ok) {
      console.log(`PASS  ${file}  (${label})`);
    } else {
      failed = true;
      console.error(`FAIL  ${file}  (${label})`);
      v.errors.forEach((e) => console.error(`  [validate] ${e}`));
      c.errors.forEach((e) => console.error(`  [compliance] ${e}`));
    }
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
