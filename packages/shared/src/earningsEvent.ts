/**
 * EarningsEvent — the structured, LLM-free output of the data-fetch layer
 * (Phase 1, US stock earnings). Built from primary/aggregated financial data
 * (Financial Modeling Prep + the SEC 8-K filing link). This is the factual
 * input the generation layer turns into a ContentPackage; keeping it free of
 * prose means the numbers in the video are never hallucinated.
 */

/** Actual vs consensus estimate, with a computed surprise percentage. */
export interface ActualVsEstimate {
  actual: number | null;
  estimate: number | null;
  /** (actual - estimate) / |estimate| * 100, or null if not computable. */
  surprisePct: number | null;
}

/** Post-earnings price move (the market's reaction). */
export interface PriceReaction {
  close: number | null;
  /** Daily % change around/after the report. */
  changePct: number | null;
  /** ISO date the reaction was measured. */
  asOf: string | null;
}

export interface EarningsEvent {
  symbol: string;
  companyName: string;
  /** Fiscal period label, e.g. "FY2026 Q1". */
  fiscalPeriod: string;
  /** ISO date the results were reported. */
  reportDate: string;
  /** "beat" | "miss" | "inline" on EPS, the headline framing. */
  epsVerdict: "beat" | "miss" | "inline";
  eps: ActualVsEstimate;
  revenue: ActualVsEstimate;
  priceReaction: PriceReaction;
  source: {
    provider: "FMP";
    /** SEC EDGAR 8-K filing URL — the primary source cited in the video. */
    secFilingUrl: string | null;
  };
}

/** Compute a surprise % from actual vs estimate (null-safe). */
export function surprisePct(actual: number | null, estimate: number | null): number | null {
  if (actual == null || estimate == null || estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

/** Headline verdict from an EPS surprise, with a small inline band. */
export function epsVerdict(surprise: number | null): "beat" | "miss" | "inline" {
  if (surprise == null) return "inline";
  if (surprise > 1) return "beat";
  if (surprise < -1) return "miss";
  return "inline";
}
