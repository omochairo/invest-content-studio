/**
 * Financial-explainer cron selector (epic #65, financials-explainer-cron.yml).
 *
 * Picks the daily batch of single-company explainers to (re)generate. The
 * watchlist (explainer-watchlist.json) is rotated by "least-recently-generated
 * first": symbols never generated come first (date "0000-00-00"), then oldest
 * ledger date, tie-broken by watchlist order. We take the first N, where N is
 * EXPLAINER_BATCH_SIZE clamped to the 10-20 daily band (default 12) so the cron
 * never floods the renderer or (indirectly, via Gemini) the budget.
 *
 * Evergreen 解説 has no daily-speed pressure, so this lane uses the Gemini
 * fallback path (gen_source=gemini, no shared Jules quota); Jules deep-dives
 * stay a manual premium lane (financials-explainer-jules.yml).
 *
 * Emits to $GITHUB_OUTPUT a `batch` JSON array of { symbol, market } the render
 * matrix fans out over, plus a human-readable `summary`. Empty watchlist -> a
 * `[]` batch so the cron is a graceful no-op.
 *
 * Env: EXPLAINER_BATCH_SIZE (default 12, clamped [1,20]).
 * Run from repo root: `npm run select:explainer` (optionally `-- --size 8`).
 */
import { appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const WATCHLIST = resolve(HERE, "explainer-watchlist.json");
const LEDGER = resolve(ROOT, "state/explainer-published.json");

const DAILY_MIN = 10;
const DAILY_MAX = 20;

type WatchItem = { symbol: string; market: "us" | "jp" };

function resolveSize(): number {
  const argIdx = process.argv.indexOf("--size");
  const raw =
    (argIdx > -1 ? Number(process.argv[argIdx + 1]) : NaN) ||
    Number(process.env.EXPLAINER_BATCH_SIZE) ||
    12;
  // Clamp into the daily band so a stray var can't flood or stall the cron.
  return Math.min(DAILY_MAX, Math.max(DAILY_MIN, Math.floor(raw)));
}

async function loadWatchlist(): Promise<WatchItem[]> {
  const raw = JSON.parse(await readFile(WATCHLIST, "utf8")) as { symbols: WatchItem[] };
  return (raw.symbols ?? []).filter((w) => w && w.symbol && w.market);
}

/** symbol -> last generated date "YYYY-MM-DD" (most recent cron render). */
async function loadLedger(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(LEDGER, "utf8"));
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const size = resolveSize();
  const watchlist = await loadWatchlist();
  const ledger = await loadLedger();

  // Stable "least-recently-generated first": carry the original index so ties
  // (same/never date) keep watchlist order deterministically.
  const ranked = watchlist
    .map((w, idx) => ({ ...w, idx, last: ledger[w.symbol] ?? "0000-00-00" }))
    .sort((a, b) => (a.last !== b.last ? a.last.localeCompare(b.last) : a.idx - b.idx));

  const batch = ranked.slice(0, size).map(({ symbol, market }) => ({ symbol, market }));
  const summary = batch.map((b) => `${b.symbol}(${b.market})`).join(" ");
  console.error(
    `select:explainer size=${size} watchlist=${watchlist.length} -> ${batch.length}: ${summary || "<none>"}`,
  );

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `batch=${JSON.stringify(batch)}\nsummary=${summary}\ncount=${batch.length}\n`,
    );
  } else {
    console.log(JSON.stringify(batch));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
