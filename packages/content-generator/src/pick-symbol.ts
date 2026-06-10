/**
 * 1f selector: choose the symbol-of-the-day for the daily cron.
 *
 * Scans the watchlist with one cheap FMP call per symbol (the earnings endpoint
 * only) and picks the freshest *recently-reported, not-yet-published* event:
 *   1. keep events reported within the freshness window (PICK_WINDOW_DAYS, 14d),
 *   2. drop any whose reportDate is already in the published ledger,
 *   3. pick the most recent; tie-break on the largest |EPS surprise| (most
 *      newsworthy).
 *
 * If nothing qualifies it writes an empty result and exits 0 — the daily cron is
 * then a graceful no-op (no stale re-uploads, no failed run). The chosen symbol
 * is written to outputs/chosen-symbol.txt and, in CI, to $GITHUB_OUTPUT.
 *
 * Env: FMP_API_KEY, PICK_WINDOW_DAYS (default 14)
 * Run from repo root: `npm run pick` (optionally `-- --window 30`)
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { surprisePct } from "@ics/shared";

try {
  process.loadEnvFile();
} catch {
  /* rely on real env */
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const API = "https://financialmodelingprep.com/stable";
const KEY = process.env.FMP_API_KEY;

const windowArgIdx = process.argv.indexOf("--window");
const WINDOW_DAYS =
  (windowArgIdx > -1 ? Number(process.argv[windowArgIdx + 1]) : NaN) ||
  Number(process.env.PICK_WINDOW_DAYS) ||
  14;

type EarnRow = {
  date: string;
  epsActual: number | null;
  epsEstimated: number | null;
};

type Candidate = { symbol: string; reportDate: string; epsSurprise: number | null };

async function latestReported(symbol: string): Promise<Candidate | null> {
  const res = await fetch(`${API}/earnings?symbol=${symbol}&apikey=${KEY}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()) as EarnRow[];
  const reported = rows
    .filter((r) => r.epsActual != null)
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = reported[0];
  if (!latest) return null;
  return {
    symbol,
    reportDate: latest.date,
    epsSurprise: surprisePct(latest.epsActual, latest.epsEstimated),
  };
}

/** symbol -> reportDate of the most recent already-published video. */
async function loadLedger(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(resolve(ROOT, "state/published.json"), "utf8"));
  } catch {
    return {};
  }
}

async function emit(symbol: string, reportDate: string): Promise<void> {
  await mkdir(resolve(ROOT, "outputs"), { recursive: true });
  await writeFile(resolve(ROOT, "outputs/chosen-symbol.txt"), symbol, "utf8");
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `symbol=${symbol}\nreport_date=${reportDate}\n`,
    );
  }
}

async function main(): Promise<void> {
  if (!KEY) throw new Error("FMP_API_KEY is not set (add it to .env)");
  const watchlist = (
    JSON.parse(await readFile(resolve(HERE, "watchlist.json"), "utf8")) as {
      symbols: string[];
    }
  ).symbols;
  const ledger = await loadLedger();
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  console.error(`pick: scanning ${watchlist.length} symbols, window=${WINDOW_DAYS}d (>=${cutoff})`);
  const candidates: Candidate[] = [];
  for (const symbol of watchlist) {
    try {
      const c = await latestReported(symbol);
      if (!c) continue;
      if (c.reportDate < cutoff) continue; // stale
      if (ledger[symbol] === c.reportDate) continue; // already published this event
      candidates.push(c);
      const s = c.epsSurprise?.toFixed(1) ?? "n/a";
      console.error(`  candidate ${symbol} ${c.reportDate} (EPS surp ${s}%)`);
    } catch (err) {
      console.error(`  ${symbol}: ${err instanceof Error ? err.message : err}`);
    }
  }

  candidates.sort((a, b) => {
    if (a.reportDate !== b.reportDate) return b.reportDate.localeCompare(a.reportDate);
    return Math.abs(b.epsSurprise ?? 0) - Math.abs(a.epsSurprise ?? 0);
  });
  const chosen = candidates[0];
  if (!chosen) {
    console.error("pick: no fresh, unpublished earnings in window -> no-op");
    await emit("", "");
    return;
  }
  console.error(`pick: chose ${chosen.symbol} (${chosen.reportDate})`);
  console.log(chosen.symbol);
  await emit(chosen.symbol, chosen.reportDate);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
