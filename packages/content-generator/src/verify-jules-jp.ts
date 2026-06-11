/**
 * Self-contained verification of the Jules harvest path (no Gemini, no Jules
 * quota, no network). Runs three checks against harvestProse():
 *   1) happy path  — valid prose -> gated ContentPackage (full asset set).
 *   2) beat count  — a wrong number of beats is rejected.
 *   3) §2 safety   — a prohibited phrase in Jules prose is BLOCKED by the gate
 *                    (Jules can never bypass compliance; numbers stay code-side).
 * Exits non-zero on any failure. Run: `npm run verify:jules`.
 */
import type { CompanyProfile } from "@ics/shared";
import { buildAssets, buildPlan, type Beat } from "./generate-jp-content";
import { harvestProse } from "./harvest-jules-jp";

// Synthetic profile exercising every code-side asset (segments / rev-trend /
// fin-stats / latest-yoy / valuation / peers / ranking) so the plan is full.
const PROFILE: CompanyProfile = {
  code: "TEST",
  companyName: "テスト電機",
  sector: "電気機器",
  market: "プライム",
  scaleCategory: "TOPIX Core30",
  asOf: "2026-06-11",
  latestFiscalYear: "2025-03-31",
  accountingStandard: "IFRS",
  financials: {
    fiscalYearEnd: "2025-03-31",
    netSales: 1_000_000_000_000,
    operatingIncome: 150_000_000_000,
    operatingMargin: 15.0,
    netIncome: 100_000_000_000,
    roe: 12.0,
    equityRatio: 50.0,
    dividendYield: 2.5,
    dividendPerShare: 50,
    payoutRatio: 30.0,
    eps: 200,
  },
  valuation: { per: 18.0, pbr: 2.0 },
  revenueTrend: [
    { fiscalYearEnd: "2023-03-31", netSales: 800_000_000_000, operatingIncome: 100_000_000_000 },
    { fiscalYearEnd: "2024-03-31", netSales: 900_000_000_000, operatingIncome: 120_000_000_000 },
    { fiscalYearEnd: "2025-03-31", netSales: 1_000_000_000_000, operatingIncome: 150_000_000_000 },
  ],
  segments: [
    { name: "Electronics", sales: 600_000_000_000, operatingIncome: 90_000_000_000 },
    { name: "Machinery", sales: 400_000_000_000, operatingIncome: 60_000_000_000 },
  ],
  latestReport: {
    fiscalYearEnd: "2025-03-31",
    disclosedDate: "2025-05-08",
    netSales: 1_050_000_000_000,
    changeNetSales: 5.0,
    operatingIncome: 160_000_000_000,
    changeOperatingIncome: 6.7,
    netIncome: 105_000_000_000,
    changeNetIncome: 5.0,
  },
  peerComparison: {
    industry: "電気機器",
    industrySlug: "electric",
    sampleSize: 100,
    metrics: [
      { label: "営業利益率", unit: "%", company: 15.0, industryAverage: 8.0 },
      { label: "ROE", unit: "%", company: 12.0, industryAverage: 7.0 },
      { label: "売上規模", unit: "円", company: 1_000_000_000_000, industryAverage: 500_000_000_000 },
    ],
    source: { label: "edinetdb.jp（業種平均）", url: "https://edinetdb.jp/" },
  },
  sectorRanking: {
    industry: "電気機器",
    industrySlug: "electric",
    universeSize: 200,
    metrics: [
      { label: "営業利益率", unit: "%", company: 15.0, rank: 5, outOf: 180 },
      { label: "ROE", unit: "%", company: 12.0, rank: 20, outOf: 180 },
      { label: "売上規模", unit: "円", company: 1_000_000_000_000, rank: 10, outOf: 190 },
    ],
    source: { label: "edinetdb.jp（業種内ランキング）", url: "https://edinetdb.jp/industries/electric" },
  },
  price: { close: 5000, date: "2026-03-18" },
  sources: [{ label: "J-Quants", url: "https://jpx-jquants.com/" }],
};

const N = buildPlan(buildAssets(PROFILE)).length;
const neutralBeats = (n: number): Beat[] =>
  Array.from({ length: n }, (_, i) => ({
    narration: `公開データに基づき、この銘柄について中立的に解説します（${i + 1}）。`,
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

check(`happy path -> ${N} scenes, gated package`, () => {
  const pkg = harvestProse(PROFILE, { title: "テスト電機 解説", beats: neutralBeats(N) });
  if (pkg.narration.length !== N) throw new Error(`scenes=${pkg.narration.length} != ${N}`);
  if (pkg.assets.length !== 7) throw new Error(`assets=${pkg.assets.length} != 7`);
  if (!pkg.meta.disclaimer?.trim()) throw new Error("disclaimer missing");
});

check("wrong beat count rejected", () => {
  expectThrow(() => harvestProse(PROFILE, { title: "x", beats: neutralBeats(3) }), "plan expects");
});

check("§2 prohibited phrase in Jules prose blocked", () => {
  const beats = neutralBeats(N);
  beats[1] = { narration: "この銘柄は今が買い時です。", caption: "注目" };
  expectThrow(() => harvestProse(PROFILE, { title: "x", beats }), "compliance fail");
});

if (failures > 0) {
  console.error(`verify:jules FAILED (${failures})`);
  process.exit(1);
}
console.log("verify:jules OK (3/3)");
