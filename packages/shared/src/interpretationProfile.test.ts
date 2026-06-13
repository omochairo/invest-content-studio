import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveInterpretationProfile } from "./interpretationProfile";
import type { BusinessSegment, FinancialStatements } from "./financialStatements";

/** Minimal FinancialStatements carrying only the fields the profiler reads. */
function make(opts: {
  revenue?: number | null;
  operatingIncome?: number | null;
  grossProfit?: number | null;
  netIncome?: number | null;
  totalAssets?: number | null;
  totalEquity?: number | null;
  segments?: BusinessSegment[];
}): FinancialStatements {
  return {
    symbol: "TEST",
    companyName: "Test Co",
    market: "JP",
    currency: "JPY",
    accountingStandard: "IFRS",
    asOf: "2026-06-13",
    segments: opts.segments,
    periods: [
      {
        period: "FY2025",
        periodEnd: "2025-03-31",
        periodType: "annual",
        incomeStatement: {
          revenue: opts.revenue ?? null,
          costOfRevenue: null,
          grossProfit: opts.grossProfit ?? null,
          researchAndDevelopment: null,
          sellingGeneralAndAdmin: null,
          otherOperatingExpenses: null,
          operatingIncome: opts.operatingIncome ?? null,
          nonOperatingNet: null,
          incomeBeforeTax: null,
          incomeTax: null,
          netIncome: opts.netIncome ?? null,
        },
        balanceSheet: {
          cashAndEquivalents: null, shortTermInvestments: null, netReceivables: null,
          inventory: null, otherCurrentAssets: null, totalCurrentAssets: null,
          propertyPlantEquipmentNet: null, goodwill: null, intangibleAssets: null,
          longTermInvestments: null, otherNonCurrentAssets: null, totalNonCurrentAssets: null,
          totalAssets: opts.totalAssets ?? null, accountsPayable: null, shortTermDebt: null,
          deferredRevenue: null, otherCurrentLiabilities: null, totalCurrentLiabilities: null,
          longTermDebt: null, otherNonCurrentLiabilities: null, totalNonCurrentLiabilities: null,
          totalLiabilities: null, commonStock: null, retainedEarnings: null,
          otherEquity: null, totalEquity: opts.totalEquity ?? null,
        },
        cashFlow: null,
      },
    ],
    source: { provider: "RADIKABUNAVI", url: null },
  };
}

const T = 1e12;

test("bank (MUFG shape) → financial-institution, suppresses waterfall+gross", () => {
  // assets dwarf revenue (turnover 0.033), no gross, thin equity (5.3%).
  const p = deriveInterpretationProfile(
    make({ revenue: 13.63 * T, operatingIncome: 1.29 * T, netIncome: 1.86 * T, totalAssets: 413 * T, totalEquity: 21.7 * T }),
  );
  assert.equal(p.archetype, "financial-institution");
  assert.equal(p.suppress.plWaterfall, true);
  assert.equal(p.suppress.grossMargin, true);
  assert.ok(p.assetTurnover! < 0.2);
  assert.ok(p.bsFocus && p.marginFocus);
});

test("investment holding (SBG shape, op n/a) → investment-holding, suppresses op margin", () => {
  const p = deriveInterpretationProfile(
    make({ revenue: 7.24 * T, operatingIncome: null, netIncome: 1.15 * T, totalAssets: 45 * T, totalEquity: 13.95 * T }),
  );
  assert.equal(p.archetype, "investment-holding");
  assert.equal(p.suppress.plWaterfall, true);
  assert.equal(p.suppress.operatingMargin, true);
});

test("financialized industrial (Toyota: segment assets) → financialized-industrial", () => {
  const segs: BusinessSegment[] = [
    { name: "自動車", nameRaw: "Auto", sales: 41 * T, operatingIncome: 4.6 * T, assets: 29 * T },
    { name: "金融", nameRaw: "Fin", sales: 3.4 * T, operatingIncome: 0.57 * T, assets: 43 * T },
  ];
  const p = deriveInterpretationProfile(
    make({ revenue: 48 * T, operatingIncome: 4.8 * T, netIncome: 4.77 * T, totalAssets: 93.6 * T, totalEquity: 36.9 * T, segments: segs }),
  );
  assert.equal(p.archetype, "financialized-industrial");
  assert.equal(p.suppress.plWaterfall, false);
});

test("trading company (Mitsubishi 8058 shape: op n/a, big trading revenue, many segments) → trading-company", () => {
  // op==null like a holding, but turnover ~0.78 (large trading revenue) over 9 segments
  // — must NOT be misrouted to financialized-industrial (Toyota) nor investment-holding (SBG).
  const segs: BusinessSegment[] = [
    { name: "天然ガス", nameRaw: "Gas", sales: 2 * T, operatingIncome: null, assets: 2 * T },
    { name: "金属資源", nameRaw: "Metals", sales: 3 * T, operatingIncome: null, assets: 3 * T },
  ];
  const p = deriveInterpretationProfile(
    make({ revenue: 18.9 * T, operatingIncome: null, netIncome: 0.95 * T, totalAssets: 24.2 * T, totalEquity: 10.3 * T, segments: segs }),
  );
  assert.equal(p.archetype, "trading-company");
  assert.equal(p.suppress.operatingMargin, true);
  assert.equal(p.suppress.plWaterfall, true);
  assert.ok(p.assetTurnover! >= 0.6);
  assert.ok(p.bsFocus && p.marginFocus);
});

test("a low-turnover holding with segments stays investment-holding (not trading-company)", () => {
  // op==null + segments but tiny turnover (pure investment holding) → step 2 wins.
  const segs: BusinessSegment[] = [
    { name: "投資", nameRaw: "Invest", sales: 1 * T, operatingIncome: null, assets: 20 * T },
    { name: "通信", nameRaw: "Telecom", sales: 2 * T, operatingIncome: null, assets: 15 * T },
  ];
  const p = deriveInterpretationProfile(
    make({ revenue: 7 * T, operatingIncome: null, netIncome: 1.1 * T, totalAssets: 45 * T, totalEquity: 14 * T, segments: segs }),
  );
  assert.equal(p.archetype, "investment-holding");
});

test("US tech (NVDA shape, full PL) → standard, nothing suppressed", () => {
  const p = deriveInterpretationProfile(
    make({ revenue: 0.22 * T, operatingIncome: 0.13 * T, grossProfit: 0.15 * T, netIncome: 0.12 * T, totalAssets: 0.21 * T, totalEquity: 0.16 * T }),
  );
  assert.equal(p.archetype, "standard");
  assert.equal(p.suppress.plWaterfall, false);
  assert.equal(p.suppress.grossMargin, false);
});

test("JP industrial without segment assets (Sony shape) → standard, gross suppressed (IFRS no COGS)", () => {
  const p = deriveInterpretationProfile(
    make({ revenue: 12 * T, operatingIncome: 1.41 * T, netIncome: 1.14 * T, totalAssets: 35.3 * T, totalEquity: 8.5 * T }),
  );
  assert.equal(p.archetype, "standard");
  assert.equal(p.suppress.grossMargin, true); // no gross profit line
});

test("a bank with op income is NOT misrouted to investment-holding", () => {
  // financial-institution must win even though both could plausibly match.
  const p = deriveInterpretationProfile(
    make({ revenue: 5 * T, operatingIncome: 0.5 * T, netIncome: 0.4 * T, totalAssets: 200 * T, totalEquity: 10 * T }),
  );
  assert.equal(p.archetype, "financial-institution");
});
