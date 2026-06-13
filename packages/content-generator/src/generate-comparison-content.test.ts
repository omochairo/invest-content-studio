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
  shortName,
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
  // C has no operating income -> excluded; A and B remain. Labels are the
  // chart-friendly short names, not the ticker/symbol.
  assert.deepEqual(spec.points.map((p) => p.label).sort(), ["Alpha", "Beta"]);
  const a = spec.points.find((p) => p.label === "Alpha");
  assert.equal(a?.x, 60); // rounded to 1dp
  assert.equal(a?.y, 76);
  assert.ok(spec.xMid != null && spec.yMid != null);
});

test("buildRankBar sorts desc, signed flag passes through, and skips null metric", () => {
  const op = buildRankBar(rows, "rank-op", (r) => r.operatingMarginPct);
  const spec = op?.spec as ChartSpec;
  assert.equal(spec.signed, false); // a level -> no sign prefix by default
  assert.deepEqual(spec.bars.map((b) => b.label), ["Alpha", "Beta"]); // C(null) dropped
  assert.equal(spec.bars[0]?.value, 60);
  const eq = buildRankBar(rows, "rank-eq", (r) => r.equityRatioPct);
  // equity is present for all three -> C included
  assert.equal((eq?.spec as ChartSpec).bars.length, 3);
  // signed:true is forwarded (used for growth / retained-earnings bars).
  const signedBar = buildRankBar(rows, "rank-eq2", (r) => r.equityRatioPct, true);
  assert.equal((signedBar?.spec as ChartSpec).signed, true);
});

test("shortName strips corporate-form tokens and abbreviates group/holdings", () => {
  assert.equal(shortName("NVIDIA Corporation", "NVDA"), "NVIDIA");
  assert.equal(shortName("Apple Inc.", "AAPL"), "Apple");
  assert.equal(shortName("Microsoft Corporation", "MSFT"), "Microsoft");
  assert.equal(shortName("Nintendo Co., Ltd.", "7974"), "Nintendo");
  assert.equal(shortName("トヨタ自動車株式会社", "7203"), "トヨタ自動車");
  assert.equal(shortName("ソニーグループ株式会社", "6758"), "ソニーG");
  assert.equal(shortName("ソフトバンクグループ株式会社", "9984"), "ソフトバンクG");
  // empty / unparseable name falls back to the symbol so a label is never blank.
  assert.equal(shortName("株式会社", "1234"), "1234");
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

// Two-period companies (so 増収率 is defined) with retained earnings, including
// one negative (buyback) case, to exercise the growth + 利益の蓄積 dimensions.
function co2(
  symbol: string, name: string, market: "US" | "JP",
  rev: number, prevRev: number, opInc: number, netInc: number,
  equity: number, assets: number, retained: number,
): FinancialStatements {
  return {
    symbol, companyName: name, market, currency: market === "JP" ? "JPY" : "USD",
    accountingStandard: market === "JP" ? "IFRS" : "US-GAAP", asOf: "2026-06-13",
    source: { provider: "FMP", url: "" },
    periods: [
      {
        period: "FY2025", periodEnd: "2025-03-31", periodType: "annual",
        incomeStatement: { ...ZERO_IS, revenue: rev, operatingIncome: opInc, netIncome: netInc },
        balanceSheet: { ...ZERO_BS, totalAssets: assets, totalEquity: equity, retainedEarnings: retained },
        cashFlow: null,
      },
      {
        period: "FY2024", periodEnd: "2024-03-31", periodType: "annual",
        incomeStatement: { ...ZERO_IS, revenue: prevRev },
        balanceSheet: { ...ZERO_BS }, cashFlow: null,
      },
    ],
  } as FinancialStatements;
}

// P: top op-margin AND top growth (NVDA-like). Q: negative retained (Apple-like
// buyback). R: middling.
const P = co2("P", "Peak Inc.", "US", 1650, 1000, 990, 900, 760, 1000, 700); // +65% growth, retained 92.1%
const Q = co2("Q", "Quay Corp.", "US", 1060, 1000, 320, 270, 200, 1000, -40); // +6% growth, retained -20%
const R = co2("R", "Ridge Holdings", "JP", 1070, 1000, 110, 100, 300, 1000, 240); // +7% growth, retained 80%
const rows2 = [P, Q, R].map(toRow);

test("growth + retained-earnings bars are signed and reflect the metrics", () => {
  const assets = buildComparisonAssets(rows2);
  const growth = assets.find((a) => a.id === "rank-growth")?.spec as ChartSpec;
  assert.ok(growth);
  assert.equal(growth.signed, true);
  assert.equal(growth.bars[0]?.label, "Peak"); // fastest grower first
  assert.equal(growth.bars[0]?.value, 65);
  const retained = assets.find((a) => a.id === "rank-retained")?.spec as ChartSpec;
  assert.ok(retained);
  assert.equal(retained.signed, true);
  assert.equal(retained.bars.at(-1)?.value, -20); // negative (buyback) sits last
});

test("comparison beats add growth + 利益の蓄積 acts, stay §2-safe, and explain the negative case", () => {
  const assets = buildComparisonAssets(rows2);
  const beats = buildComparisonBeats(rows2, assets);
  const sections = beats.map((b) => b.section);
  assert.ok(sections.includes("成長性"));
  assert.ok(sections.includes("利益の蓄積"));
  const joined = beats.map((b) => b.narration).join("\n");
  assert.match(joined, /Peak Inc\.で\+65\.0%/); // signed growth, full name in prose
  assert.match(joined, /成長率でも首位/); // top-op == top-growth insight fired
  assert.match(joined, /-20\.0%とマイナス/); // negative retained surfaced
  assert.match(joined, /株主に利益を還元/); // buyback reframing, not a buy/sell rec
  // §2 compliance must still hold for the deepened narration.
  const pkg = assembleComparison(rows2, assets, [P, Q, R]);
  assert.ok(complianceGate(pkg).ok, complianceGate(pkg).errors.join("; "));
  assert.ok(validateContentPackage(pkg).ok);
});
