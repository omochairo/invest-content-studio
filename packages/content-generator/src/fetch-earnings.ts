/**
 * Phase 1 data layer: Financial Modeling Prep -> EarningsEvent (LLM-free).
 *
 * For each watchlist symbol, fetches the latest reported earnings (actual vs
 * estimate), company name, post-earnings price reaction, and the SEC 8-K
 * filing link (cited as the primary source). Writes one EarningsEvent JSON
 * per symbol to outputs/earnings/.
 *
 * Env: FMP_API_KEY (from .env, gitignored)
 * Run from repo root: `npm run fetch` or `npm run fetch -- AAPL NVDA`
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  type EarningsEvent,
  epsVerdict,
  surprisePct,
} from "@ics/shared";

try {
  process.loadEnvFile(); // Node 22+: load .env from cwd if present
} catch {
  /* no .env file; rely on real env */
}

const HERE = dirname(fileURLToPath(import.meta.url));
// FMP "stable" API. Legacy /api/v3 returns 403 for keys issued after
// 2025-08-31; the stable endpoints take ?symbol= as a query param.
const API = "https://financialmodelingprep.com/stable";
const KEY = process.env.FMP_API_KEY;
const OUT_DIR = resolve(HERE, "../../../outputs/earnings");

async function fmp<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API}${path}${sep}apikey=${KEY}`);
  if (!res.ok) throw new Error(`FMP ${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

type EarnRow = {
  date: string;
  epsActual: number | null;
  epsEstimated: number | null;
  revenueActual: number | null;
  revenueEstimated: number | null;
};

/** SEC EDGAR 8-K filings page for a company (primary source, no key needed). */
function edgarUrl(cik: string | null | undefined): string | null {
  if (!cik) return null;
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padded}&type=8-K&dateb=&owner=include&count=10`;
}

async function buildEvent(symbol: string): Promise<EarningsEvent | null> {
  const [earnings, profile, quote] = await Promise.all([
    fmp<EarnRow[]>(`/earnings?symbol=${symbol}`),
    fmp<{ companyName: string; cik: string }[]>(`/profile?symbol=${symbol}`),
    fmp<{ changePercentage: number; price: number }[]>(`/quote?symbol=${symbol}`),
  ]);

  // The endpoint mixes upcoming (null actuals) and reported rows; the most
  // recent reported result is the one with a non-null actual EPS.
  const reported = earnings
    .filter((r) => r.epsActual != null)
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = reported[0];
  if (!latest) return null;

  const epsSurprise = surprisePct(latest.epsActual, latest.epsEstimated);
  const revSurprise = surprisePct(latest.revenueActual, latest.revenueEstimated);
  const q = quote[0];

  return {
    symbol,
    companyName: profile[0]?.companyName ?? symbol,
    fiscalPeriod: `${latest.date.slice(0, 7)} 決算`,
    reportDate: latest.date,
    epsVerdict: epsVerdict(epsSurprise),
    eps: { actual: latest.epsActual, estimate: latest.epsEstimated, surprisePct: epsSurprise },
    revenue: {
      actual: latest.revenueActual,
      estimate: latest.revenueEstimated,
      surprisePct: revSurprise,
    },
    // NOTE: FMP free plan lacks historical EOD around the report date, so this
    // is the latest daily move (a context proxy), not the report-day reaction.
    // True post-earnings reaction is a follow-up (needs historical EOD / EDGAR).
    priceReaction: {
      close: q?.price ?? null,
      changePct: q?.changePercentage ?? null,
      asOf: new Date().toISOString().slice(0, 10),
    },
    source: { provider: "FMP", secFilingUrl: edgarUrl(profile[0]?.cik) },
  };
}

async function main(): Promise<void> {
  if (!KEY) throw new Error("FMP_API_KEY is not set (add it to .env)");
  const argv = process.argv.slice(2);
  const list = argv.length
    ? argv
    : (JSON.parse(await readFile(resolve(HERE, "watchlist.json"), "utf8")) as {
        symbols: string[];
      }).symbols;

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`FMP earnings: ${list.length} symbol(s)`);
  let wrote = 0;
  for (const symbol of list) {
    try {
      const ev = await buildEvent(symbol);
      if (!ev) {
        console.log(`  ${symbol}: no reported earnings found`);
        continue;
      }
      await writeFile(resolve(OUT_DIR, `${symbol}.json`), JSON.stringify(ev, null, 2));
      wrote++;
      const e = ev.eps.surprisePct?.toFixed(1) ?? "n/a";
      const r = ev.revenue.surprisePct?.toFixed(1) ?? "n/a";
      const p = ev.priceReaction.changePct?.toFixed(1) ?? "n/a";
      console.log(
        `  ${symbol} [${ev.epsVerdict}] EPS surp ${e}% / Rev surp ${r}% / px ${p}% (${ev.reportDate})`,
      );
    } catch (err) {
      console.log(`  ${symbol}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`-> ${OUT_DIR} (${wrote}/${list.length} written)`);
  // Fail loudly so CI stops here instead of at a downstream ENOENT.
  if (wrote === 0) throw new Error("no EarningsEvent written (all symbols failed)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
