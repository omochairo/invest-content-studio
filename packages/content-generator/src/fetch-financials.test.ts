import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pick,
  sumNullable,
  toIncome,
  toBalance,
  toCashFlow,
} from "./fetch-financials";

test("pick: first finite numeric among aliases, else null", () => {
  assert.equal(pick({ a: 5 } as never, "a"), 5);
  assert.equal(pick({ a: undefined, b: 7 } as never, "a", "b"), 7);
  assert.equal(pick({ a: "x" } as never, "a"), null); // non-numeric ignored
  assert.equal(pick({ a: NaN } as never, "a"), null); // non-finite ignored
  assert.equal(pick({ a: 0 } as never, "a"), 0); // present 0 is a real value
  assert.equal(pick({} as never, "missing"), null);
});

test("sumNullable: null only when every addend is null; 0 counts", () => {
  assert.equal(sumNullable(null, null), null);
  assert.equal(sumNullable(null, 3), 3);
  assert.equal(sumNullable(0, null), 0);
  assert.equal(sumNullable(2, 3, null), 5);
});

test("toIncome maps FMP income fields", () => {
  const inc = toIncome({
    revenue: 1000,
    costOfRevenue: 400,
    grossProfit: 600,
    researchAndDevelopmentExpenses: 100,
    sellingGeneralAndAdministrativeExpenses: 80,
    otherExpenses: 20,
    operatingIncome: 400,
    totalOtherIncomeExpensesNet: -10,
    incomeBeforeTax: 390,
    incomeTaxExpense: 60,
    netIncome: 330,
  } as never);
  assert.equal(inc.revenue, 1000);
  assert.equal(inc.researchAndDevelopment, 100);
  assert.equal(inc.sellingGeneralAndAdmin, 80);
  assert.equal(inc.nonOperatingNet, -10);
  assert.equal(inc.netIncome, 330);
});

test("toBalance: contributed capital sums and equity residual closes", () => {
  const bs = toBalance({
    totalAssets: 1000,
    totalLiabilities: 600,
    totalStockholdersEquity: 400,
    commonStock: 50,
    additionalPaidInCapital: 150, // contributed = 200
    retainedEarnings: 250,
    accountPayables: 90,
  } as never);
  assert.equal(bs.commonStock, 200);
  assert.equal(bs.accountsPayable, 90);
  // otherEquity is the residual: 400 - 200 - 250 = -50 (e.g. treasury stock).
  assert.equal(bs.otherEquity, -50);
  // The three equity boxes must sum back to totalEquity for proportional render.
  assert.equal(bs.commonStock! + bs.retainedEarnings! + bs.otherEquity!, bs.totalEquity);
});

test("toBalance: residual falls back when a component is missing", () => {
  const bs = toBalance({
    totalStockholdersEquity: 400,
    retainedEarnings: 250,
    otherTotalStockholdersEquity: 30,
    // no commonStock / additionalPaidInCapital -> commonStock null -> fallback
  } as never);
  assert.equal(bs.commonStock, null);
  assert.equal(bs.otherEquity, 30);
});

test("toCashFlow: capex normalized to >=0; null row -> null", () => {
  const cf = toCashFlow({
    netCashProvidedByOperatingActivities: 500,
    netCashProvidedByInvestingActivities: -200,
    netCashProvidedByFinancingActivities: -100,
    capitalExpenditure: -150,
    freeCashFlow: 350,
  } as never);
  assert.equal(cf?.operating, 500);
  assert.equal(cf?.capex, 150); // abs of -150
  assert.equal(cf?.freeCashFlow, 350);
  assert.equal(toCashFlow(undefined), null);
});
