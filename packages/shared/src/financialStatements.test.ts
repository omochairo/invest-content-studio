import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balanceSheetToProportionSpec,
  deriveExplainerMetrics,
  incomeStatementToWaterfallSpec,
  marginPct,
} from "./financialStatements";
import type {
  BalanceSheet,
  FinancialStatements,
  IncomeStatement,
} from "./financialStatements";

const ZERO_BS: BalanceSheet = {
  cashAndEquivalents: null,
  shortTermInvestments: null,
  netReceivables: null,
  inventory: null,
  otherCurrentAssets: null,
  totalCurrentAssets: null,
  propertyPlantEquipmentNet: null,
  goodwill: null,
  intangibleAssets: null,
  longTermInvestments: null,
  otherNonCurrentAssets: null,
  totalNonCurrentAssets: null,
  totalAssets: null,
  accountsPayable: null,
  shortTermDebt: null,
  deferredRevenue: null,
  otherCurrentLiabilities: null,
  totalCurrentLiabilities: null,
  longTermDebt: null,
  otherNonCurrentLiabilities: null,
  totalNonCurrentLiabilities: null,
  totalLiabilities: null,
  commonStock: null,
  retainedEarnings: null,
  otherEquity: null,
  totalEquity: null,
};

function fs(bs: BalanceSheet, currency: "USD" | "JPY" = "USD"): FinancialStatements {
  return {
    symbol: "TEST",
    companyName: "Test Co",
    market: currency === "JPY" ? "JP" : "US",
    currency,
    accountingStandard: null,
    asOf: "2026-06-12",
    periods: [
      {
        period: "FY2026",
        periodEnd: "2026-01-25",
        periodType: "annual",
        balanceSheet: bs,
        incomeStatement: {
          revenue: null,
          costOfRevenue: null,
          grossProfit: null,
          researchAndDevelopment: null,
          sellingGeneralAndAdmin: null,
          otherOperatingExpenses: null,
          operatingIncome: null,
          nonOperatingNet: null,
          incomeBeforeTax: null,
          incomeTax: null,
          netIncome: null,
        },
        cashFlow: null,
      },
    ],
    source: { provider: "FMP", url: null },
  };
}

test("balanceSheetToProportionSpec - two balanced columns scaled to 億", () => {
  // Real NVDA FY2026 shape: assets = liabilities + equity (identity holds).
  const bs: BalanceSheet = {
    ...ZERO_BS,
    totalCurrentAssets: 125_605_000_000,
    totalNonCurrentAssets: 81_198_000_000,
    totalAssets: 206_803_000_000,
    totalCurrentLiabilities: 32_163_000_000,
    totalNonCurrentLiabilities: 17_347_000_000,
    totalLiabilities: 49_510_000_000,
    totalEquity: 157_293_000_000,
  };
  const spec = balanceSheetToProportionSpec(fs(bs));
  assert.equal(spec.kind, "proportion");
  assert.equal(spec.unit, "億ドル");
  assert.equal(spec.columns.length, 2);

  const [assets, liabEq] = spec.columns;
  assert.equal(assets.label, "資産");
  assert.deepEqual(
    assets.segments.map((s) => [s.label, s.value]),
    [
      ["流動資産", 1256.1],
      ["固定資産", 812],
    ],
  );
  assert.equal(liabEq.label, "負債・純資産");
  assert.deepEqual(
    liabEq.segments.map((s) => [s.label, s.value]),
    [
      ["流動負債", 321.6],
      ["固定負債", 173.5],
      ["純資産", 1572.9],
    ],
  );

  // The two columns balance (the visual's whole point): equal totals -> equal height.
  const sum = (c: (typeof spec.columns)[number]) => c.segments.reduce((a, s) => a + s.value, 0);
  assert.ok(Math.abs(sum(assets) - sum(liabEq)) < 0.2, "columns must balance");
});

test("balanceSheetToProportionSpec - subtotal null falls back to summing line items", () => {
  const bs: BalanceSheet = {
    ...ZERO_BS,
    cashAndEquivalents: 10_000_000_000,
    netReceivables: 5_000_000_000,
    // totalCurrentAssets intentionally null -> must sum to 150億
    totalEquity: 20_000_000_000,
  };
  const spec = balanceSheetToProportionSpec(fs(bs));
  const assets = spec.columns.find((c) => c.label === "資産");
  assert.ok(assets, "assets column present from summed line items");
  assert.deepEqual(
    assets!.segments.map((s) => [s.label, s.value]),
    [["流動資産", 150]],
  );
});

test("balanceSheetToProportionSpec - empty BS yields no columns, currency-aware unit", () => {
  const spec = balanceSheetToProportionSpec(fs(ZERO_BS, "JPY"));
  assert.equal(spec.unit, "億円");
  assert.deepEqual(spec.columns, []);
});

test("balanceSheetToProportionSpec - missing period returns empty spec, not a throw", () => {
  const empty = fs(ZERO_BS);
  empty.periods = [];
  const spec = balanceSheetToProportionSpec(empty);
  assert.deepEqual(spec.columns, []);
});

test("marginPct - null-safe", () => {
  assert.equal(marginPct(50, 200), 25);
  assert.equal(marginPct(null, 200), null);
  assert.equal(marginPct(50, 0), null);
});

const ZERO_IS: IncomeStatement = {
  revenue: null,
  costOfRevenue: null,
  grossProfit: null,
  researchAndDevelopment: null,
  sellingGeneralAndAdmin: null,
  otherOperatingExpenses: null,
  operatingIncome: null,
  nonOperatingNet: null,
  incomeBeforeTax: null,
  incomeTax: null,
  netIncome: null,
};

function isFs(is: IncomeStatement, currency: "USD" | "JPY" = "USD"): FinancialStatements {
  const base = fs(ZERO_BS, currency);
  base.periods[0].incomeStatement = is;
  return base;
}

test("incomeStatementToWaterfallSpec - real NVDA FY2026 PL bridge, scaled to 億ドル", () => {
  // Numbers from outputs/financials/NVDA.json FY2026 (raw USD).
  const is: IncomeStatement = {
    revenue: 215_938_000_000,
    costOfRevenue: 62_475_000_000,
    grossProfit: 153_463_000_000,
    researchAndDevelopment: 18_497_000_000,
    sellingGeneralAndAdmin: 4_579_000_000,
    otherOperatingExpenses: 0, // omitted (zero delta)
    operatingIncome: 130_387_000_000,
    nonOperatingNet: 11_063_000_000, // signed gain -> positive delta
    incomeBeforeTax: 141_450_000_000,
    incomeTax: 21_383_000_000,
    netIncome: 120_067_000_000,
  };
  const spec = incomeStatementToWaterfallSpec(isFs(is));
  assert.equal(spec.kind, "waterfall");
  assert.equal(spec.unit, "億ドル");
  assert.deepEqual(
    spec.steps.map((s) => [s.label, s.value, s.isTotal ?? false]),
    [
      ["売上高", 2159.4, true],
      ["売上原価", -624.8, false],
      ["売上総利益", 1534.6, true],
      ["研究開発費", -185, false],
      ["販管費", -45.8, false],
      // その他営業費用 (0) omitted
      ["営業利益", 1303.9, true],
      ["営業外損益", 110.6, false],
      ["税引前利益", 1414.5, true],
      ["法人税等", -213.8, false],
      ["純利益", 1200.7, true],
    ],
  );

  // The bridge is self-consistent: running the deltas off each subtotal lands on
  // the next subtotal (within 1dp rounding) -- the renderer relies on this.
  const grossProfit = spec.steps.find((s) => s.label === "売上総利益")!.value;
  const cogs = spec.steps.find((s) => s.label === "売上原価")!.value;
  const revenue = spec.steps.find((s) => s.label === "売上高")!.value;
  assert.ok(Math.abs(revenue + cogs - grossProfit) < 0.2, "revenue - cogs ~= gross profit");
});

test("incomeStatementToWaterfallSpec - null lines omitted (USGAAP gaps), zero delta dropped", () => {
  const is: IncomeStatement = {
    ...ZERO_IS,
    revenue: 100_000_000_000,
    costOfRevenue: 40_000_000_000,
    grossProfit: 60_000_000_000,
    otherOperatingExpenses: 0, // dropped
    operatingIncome: 60_000_000_000,
    netIncome: 60_000_000_000,
    // R&D / SG&A / nonOperating / tax all null -> omitted
  };
  const spec = incomeStatementToWaterfallSpec(isFs(is));
  assert.deepEqual(
    spec.steps.map((s) => s.label),
    ["売上高", "売上原価", "売上総利益", "営業利益", "純利益"],
  );
});

test("incomeStatementToWaterfallSpec - negative non-operating passes through signed", () => {
  const is: IncomeStatement = {
    ...ZERO_IS,
    operatingIncome: 50_000_000_000,
    nonOperatingNet: -8_000_000_000, // a net loss -> negative delta
    incomeBeforeTax: 42_000_000_000,
  };
  const spec = incomeStatementToWaterfallSpec(isFs(is));
  const nonOp = spec.steps.find((s) => s.label === "営業外損益");
  assert.ok(nonOp);
  assert.equal(nonOp!.value, -80);
  assert.equal(nonOp!.isTotal, undefined);
});

test("incomeStatementToWaterfallSpec - JPY unit, missing period yields empty steps", () => {
  assert.equal(incomeStatementToWaterfallSpec(isFs(ZERO_IS, "JPY")).unit, "億円");
  const empty = isFs(ZERO_IS);
  empty.periods = [];
  assert.deepEqual(incomeStatementToWaterfallSpec(empty).steps, []);
});

// ── deriveExplainerMetrics (epic #65 E = 読み解き層) ──────────────────────
/** Within 0.01 percentage point — ratios are facts, not rounded display. */
const near = (a: number | null, b: number) => {
  assert.ok(a != null, `expected ${b}, got null`);
  assert.ok(Math.abs(a! - b) < 0.01, `expected ~${b}, got ${a}`);
};

/** NVDA FY2026 (newest) + FY2025 (prior) from outputs/financials/NVDA.json. */
const NVDA_FY26_BS: BalanceSheet = {
  ...ZERO_BS,
  totalAssets: 206_803_000_000,
  totalCurrentAssets: 125_605_000_000,
  totalCurrentLiabilities: 32_163_000_000,
  retainedEarnings: 146_973_000_000,
  totalEquity: 157_293_000_000,
};
const NVDA_FY26_IS: IncomeStatement = {
  revenue: 215_938_000_000,
  costOfRevenue: 62_475_000_000,
  grossProfit: 153_463_000_000,
  researchAndDevelopment: 18_497_000_000,
  sellingGeneralAndAdmin: 4_579_000_000,
  otherOperatingExpenses: 0,
  operatingIncome: 130_387_000_000,
  nonOperatingNet: 11_063_000_000,
  incomeBeforeTax: 141_450_000_000,
  incomeTax: 21_383_000_000,
  netIncome: 120_067_000_000,
};
const NVDA_FY25_IS: IncomeStatement = {
  ...ZERO_IS,
  revenue: 130_497_000_000,
  operatingIncome: 81_453_000_000,
  netIncome: 72_880_000_000,
};

/** Two-period (newest-first) statements for the YoY path. */
function twoPeriodFs(
  newIs: IncomeStatement,
  newBs: BalanceSheet,
  prevIs: IncomeStatement | null,
): FinancialStatements {
  const base = fs(newBs);
  base.periods[0].incomeStatement = newIs;
  if (prevIs)
    base.periods.push({
      period: "FY2025",
      periodEnd: "2025-01-26",
      periodType: "annual",
      balanceSheet: ZERO_BS,
      incomeStatement: prevIs,
      cashFlow: null,
    });
  return base;
}

test("deriveExplainerMetrics - real NVDA FY2026 PL/BS ratios", () => {
  const m = deriveExplainerMetrics(twoPeriodFs(NVDA_FY26_IS, NVDA_FY26_BS, NVDA_FY25_IS));
  near(m.grossMarginPct, 71.0682);
  near(m.operatingMarginPct, 60.3817);
  near(m.netMarginPct, 55.6029);
  near(m.cogsRatioPct, 28.9318);
  near(m.rndRatioPct, 8.5658);
  near(m.sgaRatioPct, 2.1205);
  near(m.effectiveTaxRatePct, 15.1171);
  near(m.equityRatioPct, 76.0598);
  near(m.currentRatioPct, 390.5295);
  near(m.retainedToEquityPct, 93.4393);
  // 粗利率 + 売上原価率 = 100 (grossProfit + cogs = revenue, by construction).
  near(m.grossMarginPct! + m.cogsRatioPct!, 100);
});

test("deriveExplainerMetrics - YoY uses the prior period (newest-first)", () => {
  const m = deriveExplainerMetrics(twoPeriodFs(NVDA_FY26_IS, NVDA_FY26_BS, NVDA_FY25_IS));
  near(m.revenueYoYPct, 65.4734); // (215938-130497)/130497
  near(m.operatingIncomeYoYPct, 60.0763);
  near(m.netIncomeYoYPct, 64.7464);
});

test("deriveExplainerMetrics - no prior period yields null YoY (never 0)", () => {
  const m = deriveExplainerMetrics(twoPeriodFs(NVDA_FY26_IS, NVDA_FY26_BS, null));
  assert.equal(m.revenueYoYPct, null);
  assert.equal(m.operatingIncomeYoYPct, null);
  assert.equal(m.netIncomeYoYPct, null);
  near(m.grossMarginPct, 71.0682); // single-period ratios still resolve
});

test("deriveExplainerMetrics - all-null statements and empty periods stay null", () => {
  const allNull = deriveExplainerMetrics(twoPeriodFs(ZERO_IS, ZERO_BS, null));
  assert.equal(allNull.grossMarginPct, null);
  assert.equal(allNull.equityRatioPct, null);
  assert.equal(allNull.effectiveTaxRatePct, null);
  const empty = fs(ZERO_BS);
  empty.periods = [];
  assert.equal(deriveExplainerMetrics(empty).netMarginPct, null);
});
