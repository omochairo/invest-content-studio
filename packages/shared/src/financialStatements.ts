/**
 * FinancialStatements — the structured, LLM-free output of the financial-
 * explainer data-fetch layer (the 比例縮尺 / financial-statement visualization
 * pivot, epic #65). It is the single normalized shape that BOTH data sources
 * land in:
 *   - US: Financial Modeling Prep `/income-statement` + `/balance-sheet-statement`
 *         (+ `/cash-flow-statement`), the robust core endpoints.
 *   - JP: ラジ株ナビ MCP `get_edinet_financial_data` (EDINET 連結 159-field).
 *
 * Like EarningsEvent / CompanyProfile, this is prose-free: every number a video
 * draws (the proportional BS/PL boxes, the PL waterfall, the multi-year trend)
 * comes from here, so the generation layer can never hallucinate a figure.
 * Valuation/interpretation stays §2-safe downstream (facts, no buy/sell verdict).
 *
 * Amounts are in the statement's reporting currency raw unit (USD or JPY), not
 * pre-scaled — the renderer scales proportionally. `null` = not reported / not
 * mapped (the render layer must treat null as "omit this box", never as 0).
 */
import type { ProportionColumn, ProportionSegment, ProportionSpec } from "./contentPackage";

/**
 * Balance sheet, decomposed for the proportional two-column box (assets on the
 * left, liabilities + equity on the right). Group subtotals are kept explicit so
 * the renderer never has to re-sum; when a source only gives the subtotal the
 * line items are null (and vice-versa).
 */
export interface BalanceSheet {
  // --- Assets: current ---
  cashAndEquivalents: number | null;
  shortTermInvestments: number | null;
  netReceivables: number | null;
  inventory: number | null;
  otherCurrentAssets: number | null;
  totalCurrentAssets: number | null;
  // --- Assets: non-current ---
  propertyPlantEquipmentNet: number | null;
  goodwill: number | null;
  intangibleAssets: number | null;
  longTermInvestments: number | null;
  otherNonCurrentAssets: number | null;
  totalNonCurrentAssets: number | null;
  totalAssets: number | null;

  // --- Liabilities: current ---
  accountsPayable: number | null;
  shortTermDebt: number | null;
  deferredRevenue: number | null;
  otherCurrentLiabilities: number | null;
  totalCurrentLiabilities: number | null;
  // --- Liabilities: non-current ---
  longTermDebt: number | null;
  otherNonCurrentLiabilities: number | null;
  totalNonCurrentLiabilities: number | null;
  totalLiabilities: number | null;

  // --- Equity ---
  /** 資本金 + 資本剰余金 (contributed capital). */
  commonStock: number | null;
  /** 利益剰余金 (retained earnings) — the thickness tells the structure story. */
  retainedEarnings: number | null;
  /** その他 (treasury stock, AOCI, minority interest …). */
  otherEquity: number | null;
  totalEquity: number | null;
}

/**
 * Income statement as the PL waterfall steps: revenue → −COGS → gross profit →
 * −opex → operating income → … → net income. Reused by the existing `waterfall`
 * AssetSpec kind (T3) and the proportional PL box.
 */
export interface IncomeStatement {
  revenue: number | null;
  costOfRevenue: number | null;
  grossProfit: number | null;
  researchAndDevelopment: number | null;
  sellingGeneralAndAdmin: number | null;
  otherOperatingExpenses: number | null;
  operatingIncome: number | null;
  /** 営業外損益 + 特別損益 + 支払利息 など (net non-operating). */
  nonOperatingNet: number | null;
  incomeBeforeTax: number | null;
  incomeTax: number | null;
  netIncome: number | null;
}

/** Cash-flow trichotomy (operating / investing / financing) + capex for D/A3. */
export interface CashFlowStatement {
  operating: number | null;
  investing: number | null;
  financing: number | null;
  /** Capital expenditure (negative or positive per source; normalize to ≥0). */
  capex: number | null;
  freeCashFlow: number | null;
}

/** One fiscal period's full statements (consolidated, reporting currency). */
export interface FinancialPeriod {
  /** Fiscal period label, e.g. "FY2025" or "FY2025 Q1". */
  period: string;
  /** Fiscal period-end ISO date, e.g. "2025-01-26". */
  periodEnd: string;
  periodType: "annual" | "quarter";
  balanceSheet: BalanceSheet;
  incomeStatement: IncomeStatement;
  cashFlow: CashFlowStatement | null;
}

export interface FinancialStatements {
  /** Ticker (US, e.g. "NVDA") or 4-digit TSE code (JP, e.g. "7203"). */
  symbol: string;
  companyName: string;
  /** Drives narration framing + which data source / asymmetry applies. */
  market: "US" | "JP";
  /** Reporting currency for every amount in `periods`. */
  currency: "USD" | "JPY";
  /** e.g. "US-GAAP" | "IFRS" | "JP-GAAP" (USGAAP JP issuers lack some lines). */
  accountingStandard: string | null;
  /** ISO date this set was built. */
  asOf: string;
  /** Periods, newest first — the trend/animation charts iterate these. */
  periods: FinancialPeriod[];
  source: { provider: "FMP" | "radiokabu-edinet"; url: string | null };
}

/** Null-safe margin/ratio (%): numerator / denominator * 100. */
export function marginPct(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

/** Sum the non-null inputs; null when every input is null (so the caller can
 *  tell "all unreported" from a genuine 0). */
function sumOrNull(...vals: (number | null)[]): number | null {
  let acc = 0;
  let seen = false;
  for (const v of vals) {
    if (v != null) {
      acc += v;
      seen = true;
    }
  }
  return seen ? acc : null;
}

/**
 * Build the proportional balance-sheet box (資産 | 負債・純資産) from one period,
 * as the domain-agnostic `proportion` AssetSpec the renderer consumes. Both
 * columns balance by the accounting identity (資産 = 負債 + 純資産), so they render
 * at equal height — that equality IS the visual's point. This is the only place
 * that knows which BS field maps to which segment; the renderer stays generic.
 *
 * Amounts are divided by `scale` (default 1e8 = 億単位) and rounded to 1 dp so the
 * on-screen numbers stay legible while proportions are preserved. A subtotal that
 * is unreported falls back to summing its line items; a segment still null or 0
 * is omitted (never drawn as a zero-height box — see the null contract above).
 */
export function balanceSheetToProportionSpec(
  fs: FinancialStatements,
  periodIndex = 0,
  opts: { scale?: number; unit?: string } = {},
): ProportionSpec {
  const unit = opts.unit ?? (fs.currency === "JPY" ? "億円" : "億ドル");
  const period = fs.periods[periodIndex];
  if (!period) return { kind: "proportion", unit, columns: [] };

  const bs = period.balanceSheet;
  const scale = opts.scale ?? 1e8;

  const push = (
    into: ProportionSegment[],
    label: string,
    raw: number | null,
  ): void => {
    if (raw != null && raw !== 0) {
      into.push({ label, value: Math.round((raw / scale) * 10) / 10 });
    }
  };

  const assets: ProportionSegment[] = [];
  push(
    assets,
    "流動資産",
    bs.totalCurrentAssets ??
      sumOrNull(
        bs.cashAndEquivalents,
        bs.shortTermInvestments,
        bs.netReceivables,
        bs.inventory,
        bs.otherCurrentAssets,
      ),
  );
  push(
    assets,
    "固定資産",
    bs.totalNonCurrentAssets ??
      sumOrNull(
        bs.propertyPlantEquipmentNet,
        bs.goodwill,
        bs.intangibleAssets,
        bs.longTermInvestments,
        bs.otherNonCurrentAssets,
      ),
  );

  const liabEquity: ProportionSegment[] = [];
  push(
    liabEquity,
    "流動負債",
    bs.totalCurrentLiabilities ??
      sumOrNull(
        bs.accountsPayable,
        bs.shortTermDebt,
        bs.deferredRevenue,
        bs.otherCurrentLiabilities,
      ),
  );
  push(
    liabEquity,
    "固定負債",
    bs.totalNonCurrentLiabilities ?? sumOrNull(bs.longTermDebt, bs.otherNonCurrentLiabilities),
  );
  push(
    liabEquity,
    "純資産",
    bs.totalEquity ?? sumOrNull(bs.commonStock, bs.retainedEarnings, bs.otherEquity),
  );

  const columns: ProportionColumn[] = [];
  if (assets.length) columns.push({ label: "資産", segments: assets });
  if (liabEquity.length) columns.push({ label: "負債・純資産", segments: liabEquity });

  return { kind: "proportion", unit, columns };
}
