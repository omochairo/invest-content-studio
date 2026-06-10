/**
 * Phase 2 (2a) data layer: J-Quants v2 + ラジ株ナビ MCP -> CompanyProfile
 * (LLM-free). For each TSE code, fetches the listing master + delayed official
 * price (J-Quants) and the consolidated EDINET financials + TDnet 短信 forecast
 * (ラジ株ナビ), and writes one CompanyProfile JSON per code to outputs/equities/.
 *
 * Env (.env, gitignored): JQUANTS_API_KEY (x-api-key), RADIKABUNAVI_API_KEY (Bearer).
 * Run from repo root: `npm run fetch:jp` or `npm run fetch:jp -- 7203 6758`.
 * Field map confirmed via probe-jp (see memory reference-invest-jp-data-apis).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { type CompanyProfile, operatingMargin } from "@ics/shared";

try {
  process.loadEnvFile();
} catch {
  /* rely on real env */
}

const HERE = dirname(fileURLToPath(import.meta.url));
const JQ_BASE = "https://api.jquants.com/v2";
const JQ_KEY = process.env.JQUANTS_API_KEY;
const MCP_URL = "https://radikabunavi.com/mcp";
const MCP_KEY = process.env.RADIKABUNAVI_API_KEY;
const OUT_DIR = resolve(HERE, "../../../outputs/equities");

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const code5 = (code: string): string => (/^\d{4}$/.test(code) ? `${code}0` : code);

async function jq<T>(path: string): Promise<{ ok: boolean; status: number; body: string; json?: T }> {
  const res = await fetch(`${JQ_BASE}/${path}`, { headers: { "x-api-key": JQ_KEY ?? "" } });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body, json: res.ok ? (JSON.parse(body) as T) : undefined };
}

/** Latest official close. Free plan is ~12wk delayed, so on a 400 we read the
 *  covered window from the error and re-request its tail. */
async function jqLatestClose(code: string): Promise<{ close: number | null; date: string | null } | null> {
  type Bar = { Date: string; C: number; AdjC?: number };
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  let r = await jq<{ data: Bar[] }>(`equities/bars/daily?code=${code5(code)}&from=${from}&to=${to}`);
  if (!r.ok && r.status === 400) {
    const end = r.body.match(/~\s*(\d{4}-\d{2}-\d{2})/)?.[1]; // "...covers ... ~ 2026-03-18"
    if (end) {
      const start = new Date(new Date(end).getTime() - 14 * 864e5).toISOString().slice(0, 10);
      r = await jq<{ data: Bar[] }>(`equities/bars/daily?code=${code5(code)}&from=${start}&to=${end}`);
    }
  }
  const bars = r.json?.data ?? [];
  const last = bars.at(-1);
  return last ? { close: last.AdjC ?? last.C, date: last.Date } : null;
}

// ── ラジ株ナビ MCP (JSON-RPC over HTTP, SSE replies) ───────────────────
let sessionId: string | undefined;
let rpcId = 1;
async function mcpRaw(method: string, params: Record<string, unknown>, notify = false): Promise<unknown> {
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
    await mcpRaw("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ics", version: "0.0.0" } });
    await mcpRaw("notifications/initialized", {}, true);
    mcpReady = true;
  }
  const r = (await mcpRaw("tools/call", { name, arguments: args })) as { content?: { type: string; text?: string }[] };
  const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  return JSON.parse(text) as T;
}

type FyRow = Record<string, unknown> & { netSales?: number; operatingIncome?: number };

async function buildProfile(code: string): Promise<CompanyProfile> {
  const master = await jq<{ data: Record<string, string>[] }>(`equities/master?code=${code5(code)}`);
  const m = master.json?.data?.[0] ?? {};

  const fin = await mcpCall<{
    companyName?: string;
    metadata?: { latestFiscalYear?: string };
    fiscalYears?: Record<string, FyRow>;
  }>("get_edinet_financial_data", { code });
  const latestKey = fin.metadata?.latestFiscalYear ?? "";
  const fy = fin.fiscalYears?.[latestKey] ?? {};
  const seg = (fy.segments as { segmentName?: string; sales?: number; operatingIncome?: number }[] | undefined) ?? [];

  const forecast = await mcpCall<{ actual?: Record<string, unknown>; fiscalYearEnd?: string; disclosedDate?: string }>(
    "get_earnings_forecast",
    { code },
  ).catch(() => null);
  const a = forecast?.actual ?? null;

  const trend = Object.values(fin.fiscalYears ?? {})
    .filter((y) => num(y.netSales) != null)
    .sort((x, y) => String(x.fiscalYearEnd).localeCompare(String(y.fiscalYearEnd)))
    .map((y) => ({ fiscalYearEnd: String(y.fiscalYearEnd), netSales: num(y.netSales), operatingIncome: num(y.operatingIncome) }));

  const price = JQ_KEY ? await jqLatestClose(code) : null;

  return {
    code,
    companyName: fin.companyName ?? m.CoName ?? code,
    sector: m.S33Nm ?? null,
    market: m.MktNm ?? null,
    scaleCategory: m.ScaleCat ?? null,
    asOf: new Date().toISOString().slice(0, 10),
    latestFiscalYear: latestKey,
    accountingStandard: (fy.accountingStandard as string) ?? null,
    financials: {
      fiscalYearEnd: latestKey,
      netSales: num(fy.netSales),
      operatingIncome: num(fy.operatingIncome),
      operatingMargin: num(fy.operatingMargin) ?? operatingMargin(num(fy.operatingIncome), num(fy.netSales)),
      netIncome: num(fy.netIncome),
      roe: num(fy.roe),
      equityRatio: num(fy.equityRatio),
      dividendYield: num(fy.dividendYield),
      dividendPerShare: num(fy.dividendPerShare),
      payoutRatio: num(fy.payoutRatio),
      eps: num(fy.eps),
    },
    valuation: { per: num(fy.per) ?? num(fy.priceEarningsRatio), pbr: num(fy.pbr) },
    revenueTrend: trend,
    segments: seg.map((s) => ({ name: s.segmentName ?? "", sales: num(s.sales), operatingIncome: num(s.operatingIncome) })),
    latestReport: a
      ? {
          fiscalYearEnd: forecast?.fiscalYearEnd ?? "",
          disclosedDate: forecast?.disclosedDate ?? null,
          netSales: num(a.netSales),
          changeNetSales: num(a.changeNetSales),
          operatingIncome: num(a.operatingIncome),
          changeOperatingIncome: num(a.changeOperatingIncome),
          netIncome: num(a.netIncome),
          changeNetIncome: num(a.changeNetIncome),
        }
      : null,
    price,
    sources: [
      { label: "J-Quants（東証 上場・株価データ）", url: "https://jpx-jquants.com/" },
      { label: "ラジ株ナビ（EDINET 有報・TDnet 短信ベース財務）", url: "https://radikabunavi.com/" },
      ...(fy.edinetFilingUrl ? [{ label: "EDINET 有価証券報告書", url: String(fy.edinetFilingUrl) }] : []),
    ],
  };
}

async function main(): Promise<void> {
  if (!MCP_KEY) throw new Error("RADIKABUNAVI_API_KEY is not set (add it to .env)");
  const argv = process.argv.slice(2);
  const list = argv.length ? argv : ["7203"];
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`JP equity profiles: ${list.length} code(s)`);
  let wrote = 0;
  for (const code of list) {
    try {
      const p = await buildProfile(code);
      await writeFile(resolve(OUT_DIR, `${code}.json`), JSON.stringify(p, null, 2));
      wrote++;
      const f = p.financials;
      console.log(
        `  ${code} ${p.companyName} [${p.sector}] 売上${f.netSales}/営利${f.operatingIncome} (率${f.operatingMargin?.toFixed(1)}%) PER${p.valuation.per}/PBR${p.valuation.pbr} 推移${p.revenueTrend.length}期 seg${p.segments.length} 株価${p.price?.close ?? "n/a"}`,
      );
    } catch (err) {
      console.log(`  ${code}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`-> ${OUT_DIR} (${wrote}/${list.length} written)`);
  if (wrote === 0) throw new Error("no CompanyProfile written (all codes failed)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
