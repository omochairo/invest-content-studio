import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toIncomeJP,
  toBalanceJP,
  toCashFlowJP,
  buildStatementsJP,
} from "./fetch-financials-jp";

// A "messy" IFRS filer with a finance arm (トヨタ7203 FY2025 real shape): the
// current/non-current splits and the raw totalLiabilities field are mis-tagged,
// and grossProfit/COGS contradict each other.
const TOYOTA_FY2025 = {
  fiscalYearEnd: "2025-03-31",
  accountingStandard: "IFRS",
  edinetFilingUrl: "https://disclosure2.edinet-fsa.go.jp/x",
  netSales: 48_036_704_000_000,
  costOfGoodsSold: 35_510_157_000_000,
  grossProfit: 4_787_596_000_000, // ≠ netSales − COGS (12.5兆) → mis-tagged
  sellingGeneralAndAdministrative: 4_782_452_000_000,
  operatingIncome: 4_795_586_000_000,
  incomeBeforeIncomeTaxes: 6_414_590_000_000,
  incomeTaxes: 1_624_835_000_000,
  netIncome: 4_765_086_000_000,
  totalAssets: 93_601_350_000_000,
  netAssets: 36_878_913_000_000,
  equity: 35_924_826_000_000,
  retainedEarnings: 35_841_218_000_000,
  capitalSurplus: 492_368_000_000,
  currentAssets: 15_707_095_000_000, // + noncurrent ≠ totalAssets → unreliable split
  noncurrentAssets: 13_339_604_000_000,
  currentLiabilities: 29_434_220_000_000,
  noncurrentLiabilities: 1_567_301_000_000,
  totalLiabilities: 7_541_895_000_000, // mis-tagged subset, must NOT be trusted
  cashFlowFromOperations: 3_696_934_000_000,
  cashFlowFromInvesting: -4_189_736_000_000,
  cashFlowFromFinancing: 197_236_000_000,
  capitalExpenditure: 2_134_890_000_000,
  fcf: -492_802_000_000,
};

test("toIncomeJP: trusts the reliable spine; gates the unreliable COGS/粗利/販管費", () => {
  const is = toIncomeJP(TOYOTA_FY2025);
  assert.equal(is.revenue, 48_036_704_000_000);
  assert.equal(is.operatingIncome, 4_795_586_000_000);
  assert.equal(is.incomeBeforeTax, 6_414_590_000_000);
  assert.equal(is.netIncome, 4_765_086_000_000);
  // 営業外損益 = 税引前 − 営業利益 (residual between two trusted subtotals).
  assert.equal(is.nonOperatingNet, 6_414_590_000_000 - 4_795_586_000_000);
  // granular lines don't reconcile → nulled so the waterfall shows the spine.
  assert.equal(is.costOfRevenue, null);
  assert.equal(is.grossProfit, null);
  assert.equal(is.sellingGeneralAndAdmin, null);
});

test("toBalanceJP: 純資産 = netAssets, 負債 = residual, unreliable splits nulled", () => {
  const bs = toBalanceJP(TOYOTA_FY2025);
  assert.equal(bs.totalAssets, 93_601_350_000_000);
  assert.equal(bs.totalEquity, 36_878_913_000_000); // netAssets, not equity
  // 負債 = 総資産 − 純資産 (identity-exact), NOT the mis-tagged 7.5兆 field.
  assert.equal(bs.totalLiabilities, 93_601_350_000_000 - 36_878_913_000_000);
  // current/non-current splits don't reconcile → nulled (single-box downstream).
  assert.equal(bs.totalCurrentAssets, null);
  assert.equal(bs.totalNonCurrentAssets, null);
  assert.equal(bs.totalCurrentLiabilities, null);
  assert.equal(bs.totalNonCurrentLiabilities, null);
  // equity decomposition closes back to netAssets.
  assert.equal(bs.commonStock, 492_368_000_000);
  assert.equal(bs.retainedEarnings, 35_841_218_000_000);
  const sum = (bs.commonStock ?? 0) + (bs.retainedEarnings ?? 0) + (bs.otherEquity ?? 0);
  assert.equal(sum, bs.totalEquity);
});

test("toBalanceJP: identity 資産 = 負債 + 純資産 holds exactly", () => {
  const bs = toBalanceJP(TOYOTA_FY2025);
  assert.equal(bs.totalAssets, (bs.totalLiabilities ?? 0) + (bs.totalEquity ?? 0));
});

// A "clean" filer whose splits reconcile: the granular lines must be EXPOSED.
const CLEAN_FY = {
  fiscalYearEnd: "2025-12-31",
  accountingStandard: "JP-GAAP",
  netSales: 1000,
  costOfGoodsSold: 600,
  grossProfit: 400, // 1000 − 600 = 400 ✓
  sellingGeneralAndAdministrative: 250,
  operatingIncome: 150, // 400 − 250 = 150 ✓
  incomeBeforeIncomeTaxes: 140,
  incomeTaxes: 40,
  netIncome: 100,
  totalAssets: 2000,
  netAssets: 1200,
  retainedEarnings: 900,
  capitalSurplus: 200,
  currentAssets: 1200,
  noncurrentAssets: 800, // 1200 + 800 = 2000 ✓
  currentLiabilities: 500,
  noncurrentLiabilities: 300, // 500 + 300 = 800 = (2000 − 1200) ✓
};

test("clean filer: reconciling splits and PL granularity are exposed", () => {
  const is = toIncomeJP(CLEAN_FY);
  assert.equal(is.costOfRevenue, 600);
  assert.equal(is.grossProfit, 400);
  assert.equal(is.sellingGeneralAndAdmin, 250);
  const bs = toBalanceJP(CLEAN_FY);
  assert.equal(bs.totalCurrentAssets, 1200);
  assert.equal(bs.totalNonCurrentAssets, 800);
  assert.equal(bs.totalCurrentLiabilities, 500);
  assert.equal(bs.totalNonCurrentLiabilities, 300);
  assert.equal(bs.totalLiabilities, 800);
});

test("toCashFlowJP: maps CF trichotomy; capex normalized to ≥0", () => {
  const cf = toCashFlowJP(TOYOTA_FY2025);
  assert.equal(cf.operating, 3_696_934_000_000);
  assert.equal(cf.investing, -4_189_736_000_000);
  assert.equal(cf.capex, 2_134_890_000_000); // already positive, abs no-op
  assert.equal(cf.freeCashFlow, -492_802_000_000);
});

test("buildStatementsJP: newest-first, drops revenue-less (USGAAP) rows", () => {
  const res = {
    companyName: "テスト株式会社",
    metadata: { latestFiscalYear: "2025-03-31" },
    fiscalYears: {
      "2025-03-31": TOYOTA_FY2025,
      "2024-03-31": { ...TOYOTA_FY2025, fiscalYearEnd: "2024-03-31" },
      // USGAAP-era row with no netSales → must be dropped (no trend gap).
      "2020-03-31": { fiscalYearEnd: "2020-03-31", operatingIncome: 1, totalAssets: 1 },
    },
  };
  const fs = buildStatementsJP(res, "7203", 5);
  assert.ok(fs);
  assert.equal(fs.market, "JP");
  assert.equal(fs.currency, "JPY");
  assert.equal(fs.accountingStandard, "IFRS");
  assert.equal(fs.source.provider, "radiokabu-edinet");
  assert.deepEqual(fs.periods.map((p) => p.period), ["FY2025", "FY2024"]);
  assert.equal(buildStatementsJP({ fiscalYears: {} }, "0000", 5), null);
});
