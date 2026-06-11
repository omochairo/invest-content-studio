/**
 * CompanyProfile — the structured, LLM-free output of the Phase 2 data-fetch
 * layer (Japanese equity long-form explainer). Built from primary/aggregated
 * data: J-Quants v2 (TSE-official listing + price) and the ラジ株ナビ MCP
 * (EDINET 有報-based consolidated financials + TDnet 短信 forecast).
 *
 * Like EarningsEvent, this is prose-free: every number the video shows comes
 * from here, so the generation layer can never hallucinate a figure. The
 * generation layer turns this into a ContentPackage; valuation is expressed
 * as quantitative facts (PER/PBR/yield) — no buy/sell verdict (AGENTS §2).
 */

/** Headline figures for one fiscal year (consolidated). */
export interface FiscalYearFinancials {
  /** Fiscal year-end, e.g. "2025-03-31". */
  fiscalYearEnd: string;
  /** 営業収益 (net sales / operating revenue), in JPY. */
  netSales: number | null;
  /** 営業利益 (operating income), in JPY. */
  operatingIncome: number | null;
}

/** One reportable business segment (depth: structure visualization). */
export interface SegmentBreakdown {
  name: string;
  sales: number | null;
  operatingIncome: number | null;
}

/** Latest TDnet 短信 result + YoY change (newer than the audited 有報). */
export interface LatestReport {
  fiscalYearEnd: string;
  disclosedDate: string | null;
  netSales: number | null;
  /** YoY % change in net sales. */
  changeNetSales: number | null;
  operatingIncome: number | null;
  changeOperatingIncome: number | null;
  netIncome: number | null;
  changeNetIncome: number | null;
}

/** One metric in the same-industry comparison (depth lever 2: peer/market). */
export interface PeerMetric {
  /** Display label, e.g. "営業利益率". */
  label: string;
  /** Unit suffix shown on values, e.g. "%" or "倍". */
  unit: string;
  /** This company's value. */
  company: number | null;
  /** Industry average for the same metric (edinetdb 業種平均). */
  industryAverage: number | null;
}

/**
 * Same-industry comparison sourced from edinetdb.jp (supplementary; null when
 * the sector can't be matched or the free 100/day budget is exhausted). The
 * comparison is shown as facts only — company value vs industry average — which
 * is §2-safe (no buy/sell verdict, no naming of rival tickers).
 */
export interface PeerComparison {
  /** edinetdb industry name (日本語, e.g. "輸送用機器"). */
  industry: string;
  /** edinetdb industry slug used for the lookup, e.g. "transportation-equipment". */
  industrySlug: string;
  /** Number of companies in the industry sample (context for the average). */
  sampleSize: number | null;
  metrics: PeerMetric[];
  source: { label: string; url: string };
}

/** One metric's rank within the company's own 33-sector (depth lever: ranking). */
export interface RankMetric {
  /** Display label, e.g. "営業利益率". */
  label: string;
  /** Unit suffix shown on values, e.g. "%" or "円". */
  unit: string;
  /** This company's value (from ラジ株ナビ, for in-video consistency). */
  company: number | null;
  /** 1-based rank within the sector (1 = highest), null when not rankable. */
  rank: number | null;
  /** Number of companies ranked for this metric (the denominator). */
  outOf: number | null;
}

/**
 * The company's position within its own 33-sector, sourced from edinetdb.jp's
 * per-industry member list (`/v1/industries/{slug}`). Shown as a plain fact —
 * "業種83社中 1位" with source — which is §2-safe (a factual rank, no buy/sell
 * verdict and no rival tickers named). Null when the sector/company can't be
 * matched or the free 100/day budget is exhausted (supplementary source).
 */
export interface SectorRanking {
  /** edinetdb industry name (日本語, e.g. "輸送用機器"). */
  industry: string;
  /** edinetdb industry slug used for the lookup. */
  industrySlug: string;
  /** Total companies in the sector member list (context for the rank). */
  universeSize: number | null;
  metrics: RankMetric[];
  source: { label: string; url: string };
}

export interface CompanyProfile {
  /** 4-digit TSE code, e.g. "7203". */
  code: string;
  companyName: string;
  /** 33-sector name, e.g. "輸送用機器". */
  sector: string | null;
  /** Market segment, e.g. "プライム". */
  market: string | null;
  /** Scale category, e.g. "TOPIX Core30". */
  scaleCategory: string | null;
  /** ISO date this profile was built. */
  asOf: string;
  /** Latest audited fiscal year-end (有報). */
  latestFiscalYear: string;
  accountingStandard: string | null;

  /** Headline financials for the latest audited year (consolidated). */
  financials: {
    fiscalYearEnd: string;
    netSales: number | null;
    operatingIncome: number | null;
    /** % (operating income / net sales * 100). */
    operatingMargin: number | null;
    netIncome: number | null;
    roe: number | null;
    /** 自己資本比率 %. */
    equityRatio: number | null;
    /** 配当利回り %. */
    dividendYield: number | null;
    dividendPerShare: number | null;
    /** 配当性向 %. */
    payoutRatio: number | null;
    eps: number | null;
  };

  /** Valuation as quantitative facts only (§2: no buy/sell verdict). */
  valuation: {
    per: number | null;
    pbr: number | null;
  };

  /** Multi-year revenue trend (IFRS years only — USGAAP lacks netSales). */
  revenueTrend: FiscalYearFinancials[];

  /** Reportable segments for the latest year. */
  segments: SegmentBreakdown[];

  /** Latest TDnet 短信 figures (may be a more recent year than 有報). */
  latestReport: LatestReport | null;

  /** Same-industry comparison (edinetdb.jp; null when unavailable). */
  peerComparison: PeerComparison | null;

  /** Rank within the company's own sector (edinetdb.jp; null when unavailable). */
  sectorRanking: SectorRanking | null;

  /** TSE-official market price (J-Quants free is ~12 weeks delayed). */
  price: {
    close: number | null;
    /** ISO date of the close (within the delayed window). */
    date: string | null;
  } | null;

  sources: { label: string; url: string }[];
}

/** Null-safe operating margin (%). */
export function operatingMargin(
  operatingIncome: number | null,
  netSales: number | null,
): number | null {
  if (operatingIncome == null || netSales == null || netSales === 0) return null;
  return (operatingIncome / netSales) * 100;
}
