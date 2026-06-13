/**
 * T2 (JP data layer, epic #65): ラジ株ナビ MCP `get_edinet_financial_data`
 * (EDINET 連結 159-field) -> the SAME `FinancialStatements` shape the US/FMP
 * fetcher lands in (fetch-financials.ts). Writing to outputs/financials/<code>.json
 * means the entire downstream financial-explainer pipeline (proportional BS box,
 * PL waterfall, deriveExplainerMetrics, generate:fin, render) runs UNCHANGED for
 * Japanese issuers — only the data source differs.
 *
 * WHY this is not a straight port of the US `pick()` mapper: the EDINET XBRL
 * extraction is unreliable at the line-item level for complex IFRS filers (a
 * finance subsidiary, etc.). For トヨタ(7203) FY2025 the extracted
 * currentAssets+noncurrentAssets (29兆) do NOT sum to totalAssets (93.6兆), and
 * the `totalLiabilities` field (7.5兆) is a mis-tagged subset of the real 負債
 * (= totalAssets − netAssets = 56.7兆); likewise grossProfit/COGS contradict each
 * other. So this mapper trusts only the bedrock figures (totalAssets, netAssets,
 * retainedEarnings, operatingIncome, incomeBeforeIncomeTaxes, netIncome, CF) and:
 *   - derives 負債 as the residual totalAssets − netAssets (identity-exact), and
 *   - EXPOSES the current/non-current split and the COGS/粗利/販管費 granularity
 *     ONLY when they reconcile within tolerance; otherwise nulls them so the
 *     proportion box collapses to a single 資産 | 負債+純資産 and the waterfall
 *     shows the reliable 売上→営業利益→税引前→純利益 spine. The §2-safe / numbers-
 *     are-facts invariants (AGENTS §3) thus hold even on dirty source rows.
 *
 * Env (.env, gitignored): RADIKABUNAVI_API_KEY (Bearer). Run from repo root:
 *   `npm run fetch:fin:jp -- 7203`        # one TSE code
 *   `npm run fetch:fin:jp -- 7203 --years 6`
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import {
  type BalanceSheet,
  type BusinessSegment,
  type CashFlowStatement,
  type FinancialPeriod,
  type FinancialStatements,
  type HumanCapital,
  type IncomeStatement,
} from "@ics/shared";

try {
  process.loadEnvFile();
} catch {
  /* rely on real env */
}

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_URL = "https://radikabunavi.com/mcp";
const MCP_KEY = process.env.RADIKABUNAVI_API_KEY;
const OUT_DIR = resolve(HERE, "../../../outputs/financials");
const DEFAULT_YEARS = 5;
/** Relative tolerance for "does this detail reconcile to its subtotal?". */
const RECONCILE_TOL = 0.05;

const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** A flat EDINET fiscal-year row (subset of the 159 fields; rest ignored). */
type EdinetFy = Record<string, unknown>;

/** First finite numeric value among the candidate keys; else null. */
function fnum(fy: EdinetFy, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = n(fy[k]);
    if (v != null) return v;
  }
  return null;
}

/** True when `actual` is within RECONCILE_TOL of the reference subtotal `ref`. */
function reconciles(actual: number | null, ref: number | null): boolean {
  if (actual == null || ref == null || ref === 0) return false;
  return Math.abs(actual - ref) / Math.abs(ref) <= RECONCILE_TOL;
}

// ── ラジ株ナビ MCP (JSON-RPC over HTTP, SSE replies) — same client as fetch-jp ──
let sessionId: string | undefined;
let rpcId = 1;
async function mcpRaw(
  method: string,
  params: Record<string, unknown>,
  notify = false,
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${MCP_KEY ?? ""}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const body: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (!notify) body.id = rpcId++;
  const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  if (!res.ok) throw new Error(`ラジ株ナビ MCP HTTP ${res.status}`);
  if (notify) return null;
  const text = await res.text();
  const last = [...text.matchAll(/^data:\s*(.+)$/gm)].at(-1);
  const parsed = JSON.parse(last?.[1] ?? text) as { result?: unknown; error?: { message: string } };
  if (parsed.error) throw new Error(parsed.error.message);
  return parsed.result;
}

let mcpReady = false;
async function mcpCall<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!mcpReady) {
    await mcpRaw("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ics", version: "0.0.0" },
    });
    await mcpRaw("notifications/initialized", {}, true);
    mcpReady = true;
  }
  const r = (await mcpRaw("tools/call", { name, arguments: args })) as {
    content?: { type: string; text?: string }[];
  };
  const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  return JSON.parse(text) as T;
}

/**
 * Map one EDINET fiscal-year row to the income statement. Trusts the reliable
 * subtotals (売上高/営業利益/税引前/純利益) always; exposes the COGS/粗利/販管費
 * granularity only when 売上−原価≈粗利 AND 粗利−販管費≈営業利益 (else null —
 * the waterfall then shows the reliable spine). 営業外損益 is the residual between
 * two trusted subtotals (税引前 − 営業利益).
 */
export function toIncomeJP(fy: EdinetFy): IncomeStatement {
  const revenue = fnum(fy, "netSales");
  const cogs = fnum(fy, "costOfGoodsSold");
  const grossProfit = fnum(fy, "grossProfit");
  const sga = fnum(fy, "sellingGeneralAndAdministrative");
  const operatingIncome = fnum(fy, "operatingIncome");
  const incomeBeforeTax = fnum(fy, "incomeBeforeIncomeTaxes", "ordinaryIncome");
  const grossOk =
    revenue != null && cogs != null && reconciles(revenue - cogs, grossProfit);
  const plDetailOk =
    grossOk && sga != null && reconciles((grossProfit ?? 0) - sga, operatingIncome);
  const nonOperatingNet =
    incomeBeforeTax != null && operatingIncome != null
      ? incomeBeforeTax - operatingIncome
      : null;
  return {
    revenue,
    costOfRevenue: plDetailOk ? cogs : null,
    grossProfit: plDetailOk ? grossProfit : null,
    researchAndDevelopment: null,
    sellingGeneralAndAdmin: plDetailOk ? sga : null,
    otherOperatingExpenses: null,
    operatingIncome,
    nonOperatingNet,
    incomeBeforeTax,
    incomeTax: fnum(fy, "incomeTaxes"),
    netIncome: fnum(fy, "netIncome"),
  };
}

/**
 * Map one EDINET fiscal-year row to the balance sheet. 純資産 = netAssets (純資産
 * 合計, incl. 非支配持分) so the column balances; 負債 = totalAssets − netAssets is
 * the identity-exact residual (the raw totalLiabilities field is mis-tagged). The
 * current/non-current split is exposed only when it reconciles to its total; the
 * equity decomposition (資本剰余金 / 利益剰余金 / その他=residual) sums to netAssets.
 */
export function toBalanceJP(fy: EdinetFy): BalanceSheet {
  const totalAssets = fnum(fy, "totalAssets");
  const netAssets = fnum(fy, "netAssets", "equity");
  const cA = fnum(fy, "currentAssets");
  const ncA = fnum(fy, "noncurrentAssets");
  const assetsSplitOk = totalAssets != null && reconciles(
    (cA ?? NaN) + (ncA ?? NaN),
    totalAssets,
  );
  const totalLiabilities =
    totalAssets != null && netAssets != null ? totalAssets - netAssets : fnum(fy, "totalLiabilities");
  const cL = fnum(fy, "currentLiabilities");
  const ncL = fnum(fy, "noncurrentLiabilities");
  const liabSplitOk = reconciles((cL ?? NaN) + (ncL ?? NaN), totalLiabilities);
  const capitalSurplus = fnum(fy, "capitalSurplus");
  const retainedEarnings = fnum(fy, "retainedEarnings");
  const otherEquity =
    netAssets != null && capitalSurplus != null && retainedEarnings != null
      ? netAssets - capitalSurplus - retainedEarnings
      : null;
  return {
    cashAndEquivalents: null,
    shortTermInvestments: null,
    netReceivables: null,
    inventory: null,
    otherCurrentAssets: null,
    totalCurrentAssets: assetsSplitOk ? cA : null,
    propertyPlantEquipmentNet: null,
    goodwill: null,
    intangibleAssets: null,
    longTermInvestments: null,
    otherNonCurrentAssets: null,
    totalNonCurrentAssets: assetsSplitOk ? ncA : null,
    totalAssets,
    accountsPayable: null,
    shortTermDebt: null,
    deferredRevenue: null,
    otherCurrentLiabilities: null,
    totalCurrentLiabilities: liabSplitOk ? cL : null,
    longTermDebt: null,
    otherNonCurrentLiabilities: null,
    totalNonCurrentLiabilities: liabSplitOk ? ncL : null,
    totalLiabilities,
    commonStock: capitalSurplus,
    retainedEarnings,
    otherEquity,
    totalEquity: netAssets,
  };
}

export function toCashFlowJP(fy: EdinetFy): CashFlowStatement {
  const capex = fnum(fy, "capitalExpenditure");
  return {
    operating: fnum(fy, "cashFlowFromOperations"),
    investing: fnum(fy, "cashFlowFromInvesting"),
    financing: fnum(fy, "cashFlowFromFinancing"),
    capex: capex != null ? Math.abs(capex) : null,
    freeCashFlow: fnum(fy, "fcf"),
  };
}

/**
 * XBRL segment token (after stripping the "ReportableSegment(s)"/"Business"
 * suffix) -> Japanese display name. Unknown tokens fall back to a de-camelCased
 * form; a bare aggregate row ("ReportableSegments") is dropped (it double-counts).
 */
const SEGMENT_NAMES: Record<string, string> = {
  Automotive: "自動車",
  FinancialServices: "金融",
  GameAndNetworkServices: "ゲーム＆ネットワーク",
  Music: "音楽",
  Pictures: "映画",
  EntertainmentTechnologyAndServices: "ET＆S",
  ImagingAndSensingSolutions: "イメージング＆センシング",
  SoftBank: "ソフトバンク",
  Arm: "アーム",
  HoldingCompanyInvestment: "持株会社投資事業",
  SoftBankVisionFunds: "ビジョン・ファンド",
  Other: "その他",
  AllOther: "その他",
};

/** Map a raw segment token to a JP name, or null to DROP it (aggregate subtotal). */
function mapSegmentName(raw: string): string | null {
  // The "...NotIncludedInReportableSegments..." reconciliation bucket is just その他.
  if (/NotIncludedInReportable|OtherRevenueGenerating/i.test(raw)) return "その他";
  const core = raw
    .replace(/ReportableSegments?$/i, "")
    .replace(/Business$/i, "")
    .replace(/Segments?$/i, "");
  if (core === "") return null; // was exactly "ReportableSegments" — a subtotal row.
  return SEGMENT_NAMES[core] ?? core.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** One raw EDINET segment row (subset of fields used). */
type EdinetSegment = { segmentName?: string; sales?: unknown; operatingIncome?: unknown; assets?: unknown };

/**
 * Extract the latest period's reportable segments (JP-only). Aggregate subtotal
 * rows are dropped; a segment with neither sales nor operating income is skipped
 * (no structural signal). Returns undefined when there is no usable multi-segment
 * breakdown, so the downstream segment visual/beat is omitted gracefully.
 */
export function extractSegments(fy: EdinetFy): BusinessSegment[] | undefined {
  const raw = fy.segments;
  if (!Array.isArray(raw)) return undefined;
  const out: BusinessSegment[] = [];
  for (const s of raw as EdinetSegment[]) {
    const token = String(s.segmentName ?? "");
    const name = mapSegmentName(token);
    if (name == null) continue; // aggregate/subtotal row
    const sales = n(s.sales);
    const operatingIncome = n(s.operatingIncome);
    const assets = n(s.assets);
    if (sales == null && operatingIncome == null) continue;
    out.push({ name, nameRaw: token, sales, operatingIncome, assets });
  }
  return out.length >= 2 ? out : undefined;
}

/** Extract the 有報 human-capital block (JP-only); undefined when nothing present. */
export function extractHumanCapital(fy: EdinetFy): HumanCapital | undefined {
  const hc: HumanCapital = {
    employees: fnum(fy, "numberOfEmployees"),
    avgAnnualSalary: fnum(fy, "avgAnnualSalary"),
    avgAgeYears: fnum(fy, "avgAgeYears"),
    avgTenureYears: fnum(fy, "avgTenureYears"),
    salesPerEmployee: fnum(fy, "salesPerEmployee"),
    operatingIncomePerEmployee: fnum(fy, "operatingIncomePerEmployee"),
  };
  return Object.values(hc).some((v) => v != null) ? hc : undefined;
}

interface EdinetResponse {
  companyName?: string;
  metadata?: { latestFiscalYear?: string };
  fiscalYears?: Record<string, EdinetFy>;
}

/** Period-end ISO date → "FY{endYear}" (Toyota 2025-03-31 → FY2025). */
const fyLabel = (periodEnd: string): string =>
  /^\d{4}/.test(periodEnd) ? `FY${periodEnd.slice(0, 4)}` : periodEnd;

/**
 * Build the normalized FinancialStatements from an EDINET response. Periods are
 * newest-first; the USGAAP-era rows that lack 売上 (netSales undefined, see memory
 * reference-invest-jp-data-apis) are dropped so the trend/animation never has a
 * gap, then the newest `years` are kept.
 */
export function buildStatementsJP(
  res: EdinetResponse,
  code: string,
  years: number,
): FinancialStatements | null {
  const rows = Object.values(res.fiscalYears ?? {});
  const periods: FinancialPeriod[] = rows
    .map((fy) => {
      const periodEnd = String(fy.fiscalYearEnd ?? "");
      return {
        period: fyLabel(periodEnd),
        periodEnd,
        periodType: "annual" as const,
        balanceSheet: toBalanceJP(fy),
        incomeStatement: toIncomeJP(fy),
        cashFlow: toCashFlowJP(fy),
      };
    })
    .filter((p) => p.incomeStatement.revenue != null && p.periodEnd)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
    .slice(0, years);
  if (!periods.length) return null;

  const latestKey = res.metadata?.latestFiscalYear ?? "";
  const latest = res.fiscalYears?.[latestKey] ?? {};
  // JP-only structural data is taken from the latest filing (the segment note and
  // 有報 human-capital block); both are optional and omitted when absent.
  const segments = extractSegments(latest);
  const humanCapital = extractHumanCapital(latest);
  return {
    symbol: code,
    companyName: res.companyName ?? code,
    market: "JP",
    currency: "JPY",
    accountingStandard: (latest.accountingStandard as string) ?? null,
    asOf: new Date().toISOString().slice(0, 10),
    periods,
    ...(segments ? { segments } : {}),
    ...(humanCapital ? { humanCapital } : {}),
    source: {
      provider: "radiokabu-edinet",
      url: (latest.edinetFilingUrl as string) ?? "https://radikabunavi.com/",
    },
  };
}

async function main(): Promise<void> {
  if (!MCP_KEY) throw new Error("RADIKABUNAVI_API_KEY is not set (add it to .env)");
  const argv = process.argv.slice(2);
  const yi = argv.indexOf("--years");
  const years = yi >= 0 ? Number(argv[yi + 1]) || DEFAULT_YEARS : DEFAULT_YEARS;
  const codes = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--years");
  if (!codes.length) codes.push("7203");

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`EDINET financials: ${codes.length} code(s), ${years}y annual`);
  let wrote = 0;
  for (const code of codes) {
    try {
      const res = await mcpCall<EdinetResponse>("get_edinet_financial_data", { code });
      const fs = buildStatementsJP(res, code, years);
      if (!fs) {
        console.log(`  ${code}: no statements found`);
        continue;
      }
      await writeFile(resolve(OUT_DIR, `${code}.json`), JSON.stringify(fs, null, 2));
      wrote++;
      const p0 = fs.periods[0]!;
      const b = (v: number | null) => (v == null ? "n/a" : (v / 1e12).toFixed(1) + "兆");
      const bs = p0.balanceSheet;
      console.log(
        `  ${code} (${fs.companyName}) ${fs.periods.length}p [${fs.accountingStandard}], latest ${p0.period}:` +
          ` 売上${b(p0.incomeStatement.revenue)} 営利${b(p0.incomeStatement.operatingIncome)}` +
          ` 総資産${b(bs.totalAssets)} 負債${b(bs.totalLiabilities)} 純資産${b(bs.totalEquity)}`,
      );
    } catch (err) {
      console.log(`  ${code}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`-> ${OUT_DIR} (${wrote}/${codes.length} written)`);
  if (wrote === 0) throw new Error("no FinancialStatements written (all codes failed)");
}

// Pure mappers are exported for unit tests; the fetch runs only when executed
// directly (importing this module in a test has no side effects).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
