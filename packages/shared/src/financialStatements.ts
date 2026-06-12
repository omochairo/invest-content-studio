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
import type {
  ProportionColumn,
  ProportionSegment,
  ProportionSpec,
  WaterfallSpec,
  WaterfallStep,
} from "./contentPackage";

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

/**
 * Build the PL waterfall (損益計算書の分解) from one period's income statement, as
 * the domain-agnostic `waterfall` AssetSpec the renderer consumes. The bridge
 * reads top to bottom: 売上高 → −売上原価 → 売上総利益 → −販管費/R&D → 営業利益 →
 * ±営業外損益 → 税引前利益 → −法人税等 → 純利益. Subtotals (粗利・営業利益・税引前・
 * 純利益) are `isTotal` columns that sit on the baseline and re-anchor the running
 * cumulative, so a rounding drift in the deltas can never accumulate — each
 * subtotal is the source figure, not a re-sum. This is the only place that knows
 * which IncomeStatement field is a step; the renderer stays generic.
 *
 * Cost lines (原価・R&D・販管費・税) are stored as positive magnitudes in the
 * source, so they are negated here into downward deltas; 営業外損益 is already
 * signed and passes through. Amounts are divided by `scale` (default 1e8 = 億単位)
 * and rounded to 1 dp — the same scale the proportional BS box uses, so the two
 * visuals are directly comparable. A null line is omitted; a zero delta is
 * omitted too (no movement to draw), but a subtotal is kept whenever reported.
 */
export function incomeStatementToWaterfallSpec(
  fs: FinancialStatements,
  periodIndex = 0,
  opts: { scale?: number; unit?: string } = {},
): WaterfallSpec {
  const unit = opts.unit ?? (fs.currency === "JPY" ? "億円" : "億ドル");
  const period = fs.periods[periodIndex];
  if (!period) return { kind: "waterfall", unit, steps: [] };

  const is = period.incomeStatement;
  const scale = opts.scale ?? 1e8;
  // Round on magnitude then reapply sign, so a downward delta rounds the same way
  // as the equivalent positive figure (Math.round breaks .5 toward +Infinity, so
  // -624.75 would otherwise become -624.7 while +624.75 becomes 624.8).
  const sc = (raw: number | null): number | null =>
    raw == null ? null : (Math.sign(raw) * Math.round((Math.abs(raw) / scale) * 10)) / 10;

  const steps: WaterfallStep[] = [];
  const total = (label: string, raw: number | null): void => {
    const v = sc(raw);
    if (v != null) steps.push({ label, value: v, isTotal: true });
  };
  // `raw` is the already-signed contribution to the running cumulative (cost
  // lines are negated by the caller; 営業外損益 is passed signed). A null or a
  // value that rounds to 0 draws no bar.
  const delta = (label: string, raw: number | null): void => {
    const v = sc(raw);
    if (v != null && v !== 0) steps.push({ label, value: v });
  };
  const neg = (raw: number | null): number | null => (raw == null ? null : -raw);

  total("売上高", is.revenue);
  delta("売上原価", neg(is.costOfRevenue));
  total("売上総利益", is.grossProfit);
  delta("研究開発費", neg(is.researchAndDevelopment));
  delta("販管費", neg(is.sellingGeneralAndAdmin));
  delta("その他営業費用", neg(is.otherOperatingExpenses));
  total("営業利益", is.operatingIncome);
  delta("営業外損益", is.nonOperatingNet);
  total("税引前利益", is.incomeBeforeTax);
  delta("法人税等", neg(is.incomeTax));
  total("純利益", is.netIncome);

  return { kind: "waterfall", unit, steps };
}

/**
 * The interpretation layer's prose-free fact base (epic #65 E = 読み解き層). From
 * one period (and its predecessor for YoY), derive the ratios/structure numbers a
 * "読み解き" narration rests on — gross/operating/net margin, cost structure as a
 * share of revenue, the balance-sheet structure (自己資本比率/流動比率/利益剰余金の
 * 厚み), and year-over-year growth. Every figure is a fact computed from the
 * statements, so the generation layer can frame what a number MEANS while NEVER
 * inventing one (AGENTS.md §3) and staying §2-safe (no buy/sell, just structure).
 *
 * This is the single place that knows which ratio is which — like the proportion/
 * waterfall mappers above. It carries NO thresholds, "notable" judgement, or
 * wording: selecting which structure to talk about and the §2-safe framing is the
 * generator's (editorial) job; this stays pure computation. Every field is
 * `number | null` (a null numerator/denominator, or a missing prior period for
 * YoY, yields null — never 0). All values are percentages.
 */
export interface ExplainerMetrics {
  // --- PL structure (share of revenue) ---
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  cogsRatioPct: number | null;
  rndRatioPct: number | null;
  sgaRatioPct: number | null;
  /** 実効税率 = 法人税等 / 税引前利益. */
  effectiveTaxRatePct: number | null;
  // --- BS structure ---
  /** 自己資本比率 = 純資産 / 総資産. */
  equityRatioPct: number | null;
  /** 流動比率 = 流動資産 / 流動負債. */
  currentRatioPct: number | null;
  /** 利益剰余金の厚み = 利益剰余金 / 純資産. */
  retainedToEquityPct: number | null;
  // --- Growth vs the prior period (null when there is no predecessor) ---
  revenueYoYPct: number | null;
  operatingIncomeYoYPct: number | null;
  netIncomeYoYPct: number | null;
}

export function deriveExplainerMetrics(
  fs: FinancialStatements,
  periodIndex = 0,
): ExplainerMetrics {
  const empty: ExplainerMetrics = {
    grossMarginPct: null,
    operatingMarginPct: null,
    netMarginPct: null,
    cogsRatioPct: null,
    rndRatioPct: null,
    sgaRatioPct: null,
    effectiveTaxRatePct: null,
    equityRatioPct: null,
    currentRatioPct: null,
    retainedToEquityPct: null,
    revenueYoYPct: null,
    operatingIncomeYoYPct: null,
    netIncomeYoYPct: null,
  };
  const period = fs.periods[periodIndex];
  if (!period) return empty;

  const is = period.incomeStatement;
  const bs = period.balanceSheet;
  // `periods` is newest-first, so the prior fiscal period is the next index.
  const prevIs = fs.periods[periodIndex + 1]?.incomeStatement ?? null;
  const yoy = (cur: number | null, prev: number | null): number | null =>
    marginPct(cur != null && prev != null ? cur - prev : null, prev);

  return {
    grossMarginPct: marginPct(is.grossProfit, is.revenue),
    operatingMarginPct: marginPct(is.operatingIncome, is.revenue),
    netMarginPct: marginPct(is.netIncome, is.revenue),
    cogsRatioPct: marginPct(is.costOfRevenue, is.revenue),
    rndRatioPct: marginPct(is.researchAndDevelopment, is.revenue),
    sgaRatioPct: marginPct(is.sellingGeneralAndAdmin, is.revenue),
    effectiveTaxRatePct: marginPct(is.incomeTax, is.incomeBeforeTax),
    equityRatioPct: marginPct(bs.totalEquity, bs.totalAssets),
    currentRatioPct: marginPct(bs.totalCurrentAssets, bs.totalCurrentLiabilities),
    retainedToEquityPct: marginPct(bs.retainedEarnings, bs.totalEquity),
    revenueYoYPct: yoy(is.revenue, prevIs?.revenue ?? null),
    operatingIncomeYoYPct: yoy(is.operatingIncome, prevIs?.operatingIncome ?? null),
    netIncomeYoYPct: yoy(is.netIncome, prevIs?.netIncome ?? null),
  };
}
