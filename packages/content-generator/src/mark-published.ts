/**
 * 1f ledger: record that a symbol's current earnings event was published, so the
 * daily selector (pick-symbol.ts) won't re-upload the same event tomorrow.
 *
 * Reads the reportDate from outputs/earnings/<symbol>.json (written by the fetch
 * step) and upserts outputs/published.json: { "<symbol>": "<reportDate>" }.
 * The scheduled workflow commits this file back so dedup state survives runs.
 *
 * Run from repo root: `npm run mark:published -- NVDA`
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { EarningsEvent } from "@ics/shared";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const LEDGER = resolve(ROOT, "state/published.json");

async function main(): Promise<void> {
  const symbol = process.argv[2];
  if (!symbol) throw new Error("usage: npm run mark:published -- <SYMBOL>");

  const ev = JSON.parse(
    await readFile(resolve(ROOT, `outputs/earnings/${symbol}.json`), "utf8"),
  ) as EarningsEvent;

  let ledger: Record<string, string> = {};
  try {
    ledger = JSON.parse(await readFile(LEDGER, "utf8"));
  } catch {
    /* first write */
  }

  ledger[symbol] = ev.reportDate;
  const sorted = Object.fromEntries(Object.entries(ledger).sort());
  await mkdir(dirname(LEDGER), { recursive: true });
  await writeFile(LEDGER, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  console.log(`marked ${symbol} published @ ${ev.reportDate} -> ${LEDGER}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
