/**
 * Financial-explainer cron ledger writer (epic #65). Records that a symbol's
 * explainer was generated today, so tomorrow's selector (select-explainer-batch
 * .ts) rotates to the next least-recently-generated symbols instead of redoing
 * the same ones.
 *
 * Takes the symbols that actually produced a ContentPackage (the cron's record
 * job derives them from the rendered artifacts, so a failed shard is NOT marked
 * and keeps getting retried / staying visible). Upserts state/explainer-
 * published.json: { "<symbol>": "<YYYY-MM-DD UTC>" }. The scheduled workflow
 * commits this file back so the rotation survives runs.
 *
 * Run from repo root: `npm run mark:explainer -- NVDA AAPL 7203`
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const LEDGER = resolve(ROOT, "state/explainer-published.json");

async function main(): Promise<void> {
  const symbols = process.argv.slice(2).filter(Boolean);
  if (symbols.length === 0) throw new Error("usage: npm run mark:explainer -- <SYMBOL> [SYMBOL...]");

  const today = new Date().toISOString().slice(0, 10);
  let ledger: Record<string, string> = {};
  try {
    ledger = JSON.parse(await readFile(LEDGER, "utf8"));
  } catch {
    /* first write */
  }

  for (const symbol of symbols) ledger[symbol] = today;
  const sorted = Object.fromEntries(Object.entries(ledger).sort());
  await mkdir(dirname(LEDGER), { recursive: true });
  await writeFile(LEDGER, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  console.log(`marked ${symbols.length} explainer(s) @ ${today}: ${symbols.join(" ")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
