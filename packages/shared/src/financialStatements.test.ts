import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceSheetToProportionSpec, marginPct } from "./financialStatements";
import type { BalanceSheet, FinancialStatements } from "./financialStatements";

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
