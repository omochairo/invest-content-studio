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
