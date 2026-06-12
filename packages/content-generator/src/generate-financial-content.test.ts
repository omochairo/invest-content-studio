import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  BalanceSheet,
  FinancialStatements,
  IncomeStatement,
} from "@ics/shared";
import {
  assembleExplainer,
  buildExplainerAssets,
  buildExplainerPlan,
  explainerFactSheet,
} from "./generate-financial-content";
import { complianceGate, validateContentPackage } from "./gate";

// Inline NVDA fixture (outputs/financials/NVDA.json is gitignored, so the test
// can't read it in CI). Real FY2026 numbers; FY2025/FY2024 carry just enough for
// YoY + the revenue trend.
const ZERO_BS: BalanceSheet = Object.fromEntries(
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

const FY26_IS: IncomeStatement = {
  revenue: 215_938_000_000, costOfRevenue: 62_475_000_000, grossProfit: 153_463_000_000,
  researchAndDevelopment: 18_497_000_000, sellingGeneralAndAdmin: 4_579_000_000,
  otherOperatingExpenses: 0, operatingIncome: 130_387_000_000, nonOperatingNet: 11_063_000_000,
  incomeBeforeTax: 141_450_000_000, incomeTax: 21_383_000_000, netIncome: 120_067_000_000,
};
const FY26_BS: BalanceSheet = {
  ...ZERO_BS,
  totalAssets: 206_803_000_000, totalCurrentAssets: 125_605_000_000,
  totalCurrentLiabilities: 32_163_000_000, retainedEarnings: 146_973_000_000,
  totalEquity: 157_293_000_000,
};

function nvda(): FinancialStatements {
  const period = (label: string, end: string, is: IncomeStatement, bs: BalanceSheet) => ({
    period: label, periodEnd: end, periodType: "annual" as const,
    balanceSheet: bs, incomeStatement: is, cashFlow: null,
  });
  return {
    symbol: "NVDA", companyName: "NVIDIA Corporation", market: "US", currency: "USD",
    accountingStandard: "US-GAAP", asOf: "2026-06-12",
    periods: [
      period("FY2026", "2026-01-25", FY26_IS, FY26_BS),
      period("FY2025", "2025-01-26", { ...ZERO_IS, revenue: 130_497_000_000, operatingIncome: 81_453_000_000, netIncome: 72_880_000_000 }, ZERO_BS),
      period("FY2024", "2024-01-28", { ...ZERO_IS, revenue: 60_922_000_000 }, ZERO_BS),
    ],
    source: { provider: "FMP", url: "https://site.financialmodelingprep.com/financial-statements/NVDA" },
  };
}

test("buildExplainerAssets - 5 assets in display order, all code-derived", () => {
  const assets = buildExplainerAssets(nvda());
  assert.deepEqual(
    assets.map((a) => a.id),
    ["pl-waterfall", "pl-ratios", "rev-trend", "bs-proportion", "bs-ratios"],
  );
  assert.equal(assets.find((a) => a.id === "pl-waterfall")!.type, "waterfall");
  assert.equal(assets.find((a) => a.id === "bs-proportion")!.type, "proportion");
  const trend = assets.find((a) => a.id === "rev-trend")!;
  // oldest -> newest, 億ドル
  assert.deepEqual(
    (trend.spec as { points: { label: string }[] }).points.map((p) => p.label),
    ["FY2024", "FY2025", "FY2026"],
  );
});

test("explainerFactSheet - load-bearing numbers match the scaled figures", () => {
  const sheet = explainerFactSheet(nvda());
  assert.match(sheet, /売上高 2159\.4億ドル/);
  assert.match(sheet, /粗利率 71\.1%/);
  assert.match(sheet, /自己資本比率 76\.1%/);
  assert.match(sheet, /売上 \+65\.5%/); // YoY vs FY2025
  assert.match(sheet, /売上推移: FY2024 .* → FY2025 .* → FY2026/);
});

test("buildExplainerPlan - chaptered, every visual beat resolves to an asset", () => {
  const fs = nvda();
  const assets = buildExplainerAssets(fs);
  const plan = buildExplainerPlan(assets, fs);
  assert.equal(plan.length, 7); // intro + 5 visual beats + outro
  assert.deepEqual(plan.map((b) => b.section), ["イントロ", "損益", "損益", "成長", "財務", "財務", "まとめ"]);
  for (const b of plan)
    if (b.visualRef) assert.ok(assets.some((a) => a.id === b.visualRef), `dangling ${b.visualRef}`);
});

test("assembleExplainer - passes validate + §2 compliance, wide format, sections kept", () => {
  const fs = nvda();
  const assets = buildExplainerAssets(fs);
  const plan = buildExplainerPlan(assets, fs);
  const gen = {
    title: "NVIDIA 財務諸表の読み解き",
    beats: plan.map((b, i) => ({ narration: `${b.section}の解説${i}。報告された数字を事実として説明します。`, caption: `テロップ${i}` })),
  };
  const pkg = assembleExplainer(fs, assets, plan, gen);
  assert.equal(pkg.meta.format, "wide");
  assert.equal(pkg.narration.length, plan.length);
  assert.equal(pkg.scenes.length, plan.length);
  assert.equal(pkg.scenes[1]!.section, "損益");
  assert.equal(pkg.scenes[1]!.visualRef, "pl-waterfall");
  assert.ok(validateContentPackage(pkg).ok, validateContentPackage(pkg).errors.join("; "));
  assert.ok(complianceGate(pkg).ok, complianceGate(pkg).errors.join("; "));
});

test("buildExplainerAssets - omits trend when only one period has revenue", () => {
  const fs = nvda();
  fs.periods = [fs.periods[0]!];
  const ids = buildExplainerAssets(fs).map((a) => a.id);
  assert.ok(!ids.includes("rev-trend"));
  assert.ok(ids.includes("pl-waterfall") && ids.includes("bs-proportion"));
});
