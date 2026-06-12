/**
 * T1 (US data layer, epic #65): Financial Modeling Prep -> FinancialStatements.
 *
 * Fetches the three core statements (`/income-statement`,
 * `/balance-sheet-statement`, `/cash-flow-statement`) for each symbol, over
 * multiple fiscal years (newest first), and normalizes them into the
 * `FinancialStatements` shape from @ics/shared. This is the LLM-free spine the
 * financial-explainer videos draw from: every box/waterfall/trend number is a
 * reported figure, never hallucinated. Interpretation stays §2-safe downstream.
 *
 * Writes one JSON per symbol to outputs/financials/<symbol>.json.
 *
 * Env: FMP_API_KEY (from repo-root .env, gitignored; same key as phase-1).
 * Run from repo root:
 *   `npm run fetch:fin`            # watchlist
 *   `npm run fetch:fin -- NVDA`    # one symbol (MVP / PoC)
 *   `npm run fetch:fin -- NVDA --years 6`
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import {
  type BalanceSheet,
  type CashFlowStatement,
  type FinancialPeriod,
  type FinancialStatements,
  type IncomeStatement,
} from "@ics/shared";

try {
  process.loadEnvFile(); // Node 22+: load .env from cwd if present
} catch {
  /* no .env file; rely on real env */
}

const HERE = dirname(fileURLToPath(import.meta.url));
// FMP "stable" API (same base as fetch-earnings). Legacy /api/v3 returns 403
// for keys issued after 2025-08-31; stable endpoints take ?symbol= as a query.
const API = "https://financialmodelingprep.com/stable";
const KEY = process.env.FMP_API_KEY;
const OUT_DIR = resolve(HERE, "../../../outputs/financials");
const DEFAULT_YEARS = 5;

async function fmp<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API}${path}${sep}apikey=${KEY}`);
  if (!res.ok) throw new Error(`FMP ${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** FMP statement rows are wide, partly source-dependent maps of numbers. */
type FmpRow = Record<string, unknown> & { date?: string; fiscalYear?: number };

/** First defined, finite numeric value among the given keys; else null. */
function pick(row: FmpRow, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Null-safe sum: null only when EVERY addend is null (a present 0 counts). */
function sumNullable(...vals: (number | null)[]): number | null {
  const present = vals.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

function toIncome(r: FmpRow): IncomeStatement {
  return {
    revenue: pick(r, "revenue"),
    costOfRevenue: pick(r, "costOfRevenue"),
    grossProfit: pick(r, "grossProfit"),
    researchAndDevelopment: pick(r, "researchAndDevelopmentExpenses"),
    sellingGeneralAndAdmin: pick(
      r,
      "sellingGeneralAndAdministrativeExpenses",
      "generalAndAdministrativeExpenses",
    ),
    otherOperatingExpenses: pick(r, "otherExpenses"),
    operatingIncome: pick(r, "operatingIncome"),
    nonOperatingNet: pick(r, "totalOtherIncomeExpensesNet"),
    incomeBeforeTax: pick(r, "incomeBeforeTax"),
    incomeTax: pick(r, "incomeTaxExpense"),
    netIncome: pick(r, "netIncome"),
  };
}

function toBalance(r: FmpRow): BalanceSheet {
  const totalEquity = pick(r, "totalStockholdersEquity", "totalEquity");
  // contributed capital = 資本金 + 資本剰余金 (common stock + paid-in capital).
  const commonStock = sumNullable(
    pick(r, "commonStock"),
    pick(r, "additionalPaidInCapital"),
  );
  const retainedEarnings = pick(r, "retainedEarnings");
  // その他 (treasury stock, AOCI, minority …): residual so the three equity
  // boxes always sum back to totalEquity for the proportional render.
  const otherEquity =
    totalEquity != null && commonStock != null && retainedEarnings != null
      ? totalEquity - commonStock - retainedEarnings
      : pick(r, "otherTotalStockholdersEquity");
  return {
    cashAndEquivalents: pick(r, "cashAndCashEquivalents"),
    shortTermInvestments: pick(r, "shortTermInvestments"),
    netReceivables: pick(r, "netReceivables", "accountsReceivables"),
    inventory: pick(r, "inventory"),
    otherCurrentAssets: pick(r, "otherCurrentAssets"),
    totalCurrentAssets: pick(r, "totalCurrentAssets"),
    propertyPlantEquipmentNet: pick(r, "propertyPlantEquipmentNet"),
    goodwill: pick(r, "goodwill"),
    intangibleAssets: pick(r, "intangibleAssets"),
    longTermInvestments: pick(r, "longTermInvestments"),
    otherNonCurrentAssets: pick(r, "otherNonCurrentAssets"),
    totalNonCurrentAssets: pick(r, "totalNonCurrentAssets"),
    totalAssets: pick(r, "totalAssets"),
    accountsPayable: pick(r, "accountPayables", "accountsPayable"),
    shortTermDebt: pick(r, "shortTermDebt"),
    deferredRevenue: pick(r, "deferredRevenue"),
    otherCurrentLiabilities: pick(r, "otherCurrentLiabilities"),
    totalCurrentLiabilities: pick(r, "totalCurrentLiabilities"),
    longTermDebt: pick(r, "longTermDebt"),
    otherNonCurrentLiabilities: pick(r, "otherNonCurrentLiabilities"),
    totalNonCurrentLiabilities: pick(r, "totalNonCurrentLiabilities"),
    totalLiabilities: pick(r, "totalLiabilities"),
    commonStock,
    retainedEarnings,
    otherEquity,
    totalEquity,
  };
}

function toCashFlow(r: FmpRow | undefined): CashFlowStatement | null {
  if (!r) return null;
  const capexRaw = pick(r, "capitalExpenditure");
  return {
    operating: pick(r, "netCashProvidedByOperatingActivities"),
    investing: pick(r, "netCashProvidedByInvestingActivities"),
    financing: pick(r, "netCashProvidedByFinancingActivities"),
    capex: capexRaw != null ? Math.abs(capexRaw) : null, // normalize to >=0
    freeCashFlow: pick(r, "freeCashFlow"),
  };
}

/** FMP gives newest-first already; key by period-end date to align statements. */
async function buildStatements(
  symbol: string,
  years: number,
): Promise<FinancialStatements | null> {
  const q = `?symbol=${symbol}&period=annual&limit=${years}`;
  const [income, balance, cash, profile] = await Promise.all([
    fmp<FmpRow[]>(`/income-statement${q}`),
    fmp<FmpRow[]>(`/balance-sheet-statement${q}`),
    fmp<FmpRow[]>(`/cash-flow-statement${q}`),
    fmp<{ companyName?: string; currency?: string }[]>(`/profile?symbol=${symbol}`),
  ]);
  if (!income.length) return null;

  const balByDate = new Map(balance.map((r) => [r.date ?? "", r]));
  const cashByDate = new Map(cash.map((r) => [r.date ?? "", r]));

  const periods: FinancialPeriod[] = income.map((inc) => {
    const date = inc.date ?? "";
    const fy = inc.fiscalYear ?? (date ? Number(date.slice(0, 4)) : null);
    const bal = balByDate.get(date) ?? {};
    return {
      period: fy ? `FY${fy}` : date,
      periodEnd: date,
      periodType: "annual" as const,
      balanceSheet: toBalance(bal),
      incomeStatement: toIncome(inc),
      cashFlow: toCashFlow(cashByDate.get(date)),
    };
  });

  return {
    symbol,
    companyName: profile[0]?.companyName ?? symbol,
    market: "US",
    // US issuers report in USD; the JP path lands via the EDINET fetcher (JPY).
    currency: "USD",
    accountingStandard: "US-GAAP",
    asOf: new Date().toISOString().slice(0, 10),
    periods,
    source: {
      provider: "FMP",
      url: `https://site.financialmodelingprep.com/financial-statements/${symbol}`,
    },
  };
}

async function main(): Promise<void> {
  if (!KEY) throw new Error("FMP_API_KEY is not set (add it to .env)");
  const argv = process.argv.slice(2);
  const yi = argv.indexOf("--years");
  const years = yi >= 0 ? Number(argv[yi + 1]) || DEFAULT_YEARS : DEFAULT_YEARS;
  const list = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--years");
  const symbols = list.length
    ? list
    : (JSON.parse(await readFile(resolve(HERE, "watchlist.json"), "utf8")) as {
        symbols: string[];
      }).symbols;

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`FMP financials: ${symbols.length} symbol(s), ${years}y annual`);
  let wrote = 0;
  for (const symbol of symbols) {
    try {
      const fs = await buildStatements(symbol, years);
      if (!fs || !fs.periods.length) {
        console.log(`  ${symbol}: no statements found`);
        continue;
      }
      await writeFile(resolve(OUT_DIR, `${symbol}.json`), JSON.stringify(fs, null, 2));
      wrote++;
      const p0 = fs.periods[0]!;
      const rev = p0.incomeStatement.revenue;
      const ta = p0.balanceSheet.totalAssets;
      const b = (n: number | null) => (n == null ? "n/a" : (n / 1e9).toFixed(1) + "B");
      console.log(
        `  ${symbol} (${fs.companyName}) ${fs.periods.length}p, latest ${p0.period}:` +
          ` rev ${b(rev)} / assets ${b(ta)}`,
      );
    } catch (err) {
      console.log(`  ${symbol}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`-> ${OUT_DIR} (${wrote}/${symbols.length} written)`);
  if (wrote === 0) throw new Error("no FinancialStatements written (all symbols failed)");
}

// Pure mappers are exported for unit tests; only run the fetch when executed
// directly (so importing this module in a test has no side effects).
export { toIncome, toBalance, toCashFlow, pick, sumNullable };

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
