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
const API = "https://financialmodelingprep.com/api/v3";
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
  eps: number | null;
  epsEstimated: number | null;
  revenue: number | null;
  revenueEstimated: number | null;
};
type Filing = { fillingDate: string; finalLink: string };

async function buildEvent(symbol: string): Promise<EarningsEvent | null> {
  const [history, profile, quote] = await Promise.all([
    fmp<EarnRow[]>(`/historical/earning_calendar/${symbol}`),
    fmp<{ companyName: string }[]>(`/profile/${symbol}`),
    fmp<{ changesPercentage: number; price: number }[]>(`/quote/${symbol}`),
  ]);

  const latest = history.find((r) => r.eps != null);
  if (!latest) return null;

  const epsSurprise = surprisePct(latest.eps, latest.epsEstimated);
  const revSurprise = surprisePct(latest.revenue, latest.revenueEstimated);

  // Nearest 8-K filing on/after the report date is the primary source.
  let secFilingUrl: string | null = null;
  try {
    const filings = await fmp<Filing[]>(`/sec_filings/${symbol}?type=8-K&page=0`);
    secFilingUrl =
      filings.find((f) => f.fillingDate >= latest.date)?.finalLink ??
      filings[0]?.finalLink ??
      null;
  } catch {
    secFilingUrl = null;
  }

  const q = quote[0];
  return {
    symbol,
    companyName: profile[0]?.companyName ?? symbol,
    fiscalPeriod: `${latest.date.slice(0, 7)} 決算`,
    reportDate: latest.date,
    epsVerdict: epsVerdict(epsSurprise),
    eps: { actual: latest.eps, estimate: latest.epsEstimated, surprisePct: epsSurprise },
    revenue: {
      actual: latest.revenue,
      estimate: latest.revenueEstimated,
      surprisePct: revSurprise,
    },
    priceReaction: {
      close: q?.price ?? null,
      changePct: q?.changesPercentage ?? null,
      asOf: new Date().toISOString().slice(0, 10),
    },
    source: { provider: "FMP", secFilingUrl },
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
  for (const symbol of list) {
    try {
      const ev = await buildEvent(symbol);
      if (!ev) {
        console.log(`  ${symbol}: no reported earnings found`);
        continue;
      }
      await writeFile(resolve(OUT_DIR, `${symbol}.json`), JSON.stringify(ev, null, 2));
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
  console.log(`-> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
