import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  BalanceSheet,
  FinancialStatements,
  IncomeStatement,
  ScatterSpec,
  ChartSpec,
} from "@ics/shared";
import {
  buildScatter,
  buildRankBar,
  buildComparisonAssets,
  buildComparisonBeats,
  assembleComparison,
  toRow,
} from "./generate-comparison-content";
import { complianceGate, validateContentPackage } from "./gate";

const ZERO_BS = Object.fromEntries(
  [
    "cashAndEquivalents", "shortTermInvestments", "netReceivables", "inventory",
    "otherCurrentAssets", "totalCurrentAssets", "propertyPlantEquipmentNet",
    "goodwill", "intangibleAssets", "longTermInvestments", "otherNonCurrentAssets",
    "totalNonCurrentAssets", "totalAssets", "accountsPayable", "shortTermDebt",
    "deferredRevenue", "otherCurrentLiabilities", "totalCurrentLiabilities",
    "longTermDebt", "otherNonCurrentLiabilities", "totalNonCurrentLiabilities",
    "totalLiabilities", "commonStock", "retainedEarnings", "otherEquity", "totalEquity",
  ].map((k) => [k, null]),
) as unknown as BalanceSheet;
const ZERO_IS: IncomeStatement = {
  revenue: null, costOfRevenue: null, grossProfit: null, researchAndDevelopment: null,
  sellingGeneralAndAdmin: null, otherOperatingExpenses: null, operatingIncome: null,
  nonOperatingNet: null, incomeBeforeTax: null, incomeTax: null, netIncome: null,
};

/** Minimal company: only the fields the comparison metrics read. opInc=null
 *  models a firm whose operating income is not reported (e.g. SBG). */
function co(
  symbol: string, name: string, market: "US" | "JP",
  rev: number, opInc: number | null, netInc: number, equity: number, assets: number,
): FinancialStatements {
  return {
    symbol, companyName: name, market, currency: market === "JP" ? "JPY" : "USD",
    accountingStandard: market === "JP" ? "IFRS" : "US-GAAP", asOf: "2026-06-13",
    source: { provider: "FMP", url: "" },
    periods: [
      {
        period: "FY2025", periodEnd: "2025-03-31", periodType: "annual",
        incomeStatement: { ...ZERO_IS, revenue: rev, operatingIncome: opInc, netIncome: netInc },
        balanceSheet: { ...ZERO_BS, totalAssets: assets, totalEquity: equity },
        cashFlow: null,
      },
    ],
  } as FinancialStatements;
}

// Two high (A,B) + one with no operating income (C).
const A = co("A", "Alpha Inc.", "US", 1000, 600, 480, 760, 1000); // op 60% eq 76%
const B = co("B", "Beta Corp.", "US", 1000, 300, 240, 200, 1000); // op 30% eq 20%
const C = co("C", "Gamma Holdings", "JP", 1000, null, 120, 300, 1000); // op n/a eq 30%
const rows = [A, B, C].map(toRow);

test("buildScatter drops companies missing either metric and sets quadrant medians", () => {
  const asset = buildScatter(rows);
  assert.ok(asset);
  const spec = asset.spec as ScatterSpec;
  assert.equal(spec.kind, "scatter");
  // C has no operating income -> excluded; A and B remain.
  assert.deepEqual(spec.points.map((p) => p.label).sort(), ["A", "B"]);
  const a = spec.points.find((p) => p.label === "A");
  assert.equal(a?.x, 60); // rounded to 1dp
  assert.equal(a?.y, 76);
  assert.ok(spec.xMid != null && spec.yMid != null);
});

test("buildRankBar sorts desc, signed:false, and skips null metric", () => {
  const op = buildRankBar(rows, "rank-op", (r) => r.operatingMarginPct);
  const spec = op?.spec as ChartSpec;
  assert.equal(spec.signed, false);
  assert.deepEqual(spec.bars.map((b) => b.label), ["A", "B"]); // C(null) dropped
  assert.equal(spec.bars[0]?.value, 60);
  const eq = buildRankBar(rows, "rank-eq", (r) => r.equityRatioPct);
  // equity is present for all three -> C included
  assert.equal((eq?.spec as ChartSpec).bars.length, 3);
});

test("assembleComparison passes validate + §2 compliance and binds scenes to assets", () => {
  const assets = buildComparisonAssets(rows);
  const pkg = assembleComparison(rows, assets, [A, B, C]);
  assert.ok(validateContentPackage(pkg).ok);
  const c = complianceGate(pkg);
  assert.ok(c.ok, c.errors.join("; "));
  // every visualRef resolves to an existing asset
  for (const s of pkg.scenes) {
    if (s.visualRef) assert.ok(assets.some((a) => a.id === s.visualRef), s.visualRef);
  }
  assert.equal(pkg.meta.format, "wide");
});

test("buildComparisonBeats states the leaders with the same rounded numbers the bars show", () => {
  const assets = buildComparisonAssets(rows);
  const beats = buildComparisonBeats(rows, assets);
  const joined = beats.map((b) => b.narration).join("\n");
  assert.match(joined, /Alpha Inc\.の60\.0%/); // top operating margin
  assert.match(joined, /76\.0%/); // top equity ratio
});
