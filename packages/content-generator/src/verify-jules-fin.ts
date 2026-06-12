/**
 * Self-contained verification of the financial-explainer Jules harvest path (no
 * Gemini, no Jules quota, no network). Runs three checks against
 * harvestExplainerProse():
 *   1) happy path  — valid prose -> gated ContentPackage (full asset set:
 *                    waterfall / pl-ratios / rev-trend / proportion / bs-ratios).
 *   2) beat count  — a wrong number of beats is rejected.
 *   3) §2 safety   — a prohibited phrase in Jules prose is BLOCKED by the gate
 *                    (Jules can never bypass compliance; numbers stay code-side).
 * Exits non-zero on any failure. Run: `npm run verify:jules:fin`.
 */
import type { BalanceSheet, FinancialStatements, IncomeStatement } from "@ics/shared";
import { type Beat, buildExplainerAssets, buildExplainerPlan } from "./generate-financial-content";
import { harvestExplainerProse } from "./harvest-jules-fin";

// One synthetic period's statements (USD, 億 scale). Subtotals + totals present
// so every code-side asset builds: PL waterfall, PL/BS ratio grids, BS proportion.
const incomeStatement = (revenue: number, net: number): IncomeStatement => ({
  revenue,
  costOfRevenue: -Math.round(revenue * 0.3),
  grossProfit: Math.round(revenue * 0.7),
  researchAndDevelopment: -Math.round(revenue * 0.08),
  sellingGeneralAndAdmin: -Math.round(revenue * 0.05),
  otherOperatingExpenses: null,
  operatingIncome: Math.round(revenue * 0.57),
  nonOperatingNet: Math.round(revenue * 0.02),
  incomeBeforeTax: Math.round(revenue * 0.59),
  incomeTax: -Math.round(revenue * 0.09),
  netIncome: net,
});

const balanceSheet = (): BalanceSheet => ({
  cashAndEquivalents: null,
  shortTermInvestments: null,
  netReceivables: null,
  inventory: null,
  otherCurrentAssets: null,
  totalCurrentAssets: 1_200_000_000_000,
  propertyPlantEquipmentNet: null,
  goodwill: null,
  intangibleAssets: null,
  longTermInvestments: null,
  otherNonCurrentAssets: null,
  totalNonCurrentAssets: 800_000_000_000,
  totalAssets: 2_000_000_000_000,
  accountsPayable: null,
  shortTermDebt: null,
  deferredRevenue: null,
  otherCurrentLiabilities: null,
  totalCurrentLiabilities: 300_000_000_000,
  longTermDebt: null,
  otherNonCurrentLiabilities: null,
  totalNonCurrentLiabilities: 200_000_000_000,
  totalLiabilities: 500_000_000_000,
  commonStock: 100_000_000_000,
  retainedEarnings: 1_400_000_000_000,
  otherEquity: 0,
  totalEquity: 1_500_000_000_000,
});

const STATEMENTS: FinancialStatements = {
  symbol: "TEST",
  companyName: "テスト半導体",
  market: "US",
  currency: "USD",
  accountingStandard: "US-GAAP",
  asOf: "2026-06-12",
  source: { provider: "FMP", url: "https://example.com/TEST" },
  periods: [
    {
      period: "FY2026",
      periodEnd: "2026-01-26",
      periodType: "annual",
      cashFlow: null,
      balanceSheet: balanceSheet(),
      incomeStatement: incomeStatement(2_000_000_000_000, 1_100_000_000_000),
    },
    {
      period: "FY2025",
      periodEnd: "2025-01-26",
      periodType: "annual",
      cashFlow: null,
      balanceSheet: balanceSheet(),
      incomeStatement: incomeStatement(1_300_000_000_000, 700_000_000_000),
    },
  ],
};

const N = buildExplainerPlan(buildExplainerAssets(STATEMENTS), STATEMENTS).length;
const neutralBeats = (n: number): Beat[] =>
  Array.from({ length: n }, (_, i) => ({
    narration: `確定データに基づき、財務構造の意味を中立的に読み解きます（${i + 1}）。`,
    caption: `ポイント${i + 1}`,
  }));

let failures = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL  ${name}: ${e instanceof Error ? e.message : e}`);
  }
};
const expectThrow = (fn: () => void, mustInclude: string) => {
  try {
    fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes(mustInclude)) throw new Error(`threw but message lacked "${mustInclude}": ${msg}`);
    return;
  }
  throw new Error("expected a throw, but none happened");
};

check(`happy path -> ${N} scenes, gated package (full assets)`, () => {
  const pkg = harvestExplainerProse(STATEMENTS, { title: "テスト半導体 財務の読み解き", beats: neutralBeats(N) });
  if (pkg.narration.length !== N) throw new Error(`scenes=${pkg.narration.length} != ${N}`);
  if (pkg.assets.length !== 5) throw new Error(`assets=${pkg.assets.length} != 5 (waterfall/pl-ratios/trend/proportion/bs-ratios)`);
  if (!pkg.meta.disclaimer?.trim()) throw new Error("disclaimer missing");
});

check("wrong beat count rejected", () => {
  expectThrow(() => harvestExplainerProse(STATEMENTS, { title: "x", beats: neutralBeats(3) }), "plan expects");
});

check("§2 prohibited phrase in Jules prose blocked", () => {
  const beats = neutralBeats(N);
  beats[1] = { narration: "この銘柄は今が買い時です。", caption: "注目" };
  expectThrow(() => harvestExplainerProse(STATEMENTS, { title: "x", beats }), "compliance fail");
});

if (failures > 0) {
  console.error(`verify:jules:fin FAILED (${failures})`);
  process.exit(1);
}
console.log("verify:jules:fin OK (3/3)");
