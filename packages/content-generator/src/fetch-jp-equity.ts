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
import {
  type CompanyProfile,
  operatingMargin,
  type PeerComparison,
  type PeerMetric,
  type RankMetric,
  type SectorRanking,
} from "@ics/shared";

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
const EDB_BASE = "https://edinetdb.jp/v1";
const EDB_KEY = process.env.EDINETDB_API_KEY;
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

// ── edinetdb.jp (REST; supplementary same-industry averages) ─────────────
// Supplies ONLY the industry average for each metric; the company's own values
// are reused from the ラジ株ナビ profile so the video stays internally
// consistent. Null on any failure (free 100/day budget; supplementary source).
async function edb<T>(path: string): Promise<T | null> {
  if (!EDB_KEY) return null;
  try {
    const res = await fetch(`${EDB_BASE}/${path}`, { headers: { "X-API-Key": EDB_KEY } });
    if (!res.ok) {
      console.log(`    edinetdb /${path} -> HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.log(`    edinetdb /${path} -> ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

const norm = (s: string): string => s.normalize("NFKC").replace(/\s+/g, "").trim();
const lk = (k: string): string => k.toLowerCase().replace(/[-_\s]/g, "");

/** First finite number under any candidate key (normalized) of a flat object. */
function readNum(bag: Record<string, unknown> | null, keys: string[]): number | null {
  if (!bag) return null;
  const want = new Set(keys.map(lk));
  for (const [k, v] of Object.entries(bag)) {
    if (want.has(lk(k)) && typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** First array found at top level or under any envelope key (data/items/results/…). */
function firstArray(x: unknown): Record<string, unknown>[] {
  if (Array.isArray(x)) return x as Record<string, unknown>[];
  if (x && typeof x === "object") {
    for (const v of Object.values(x as Record<string, unknown>)) if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}
const rowName = (r: Record<string, unknown>): string =>
  String(r.name_ja ?? r.name ?? r.label ?? r.industry ?? r.japanese_name ?? r.industry_name ?? "");
const rowSlug = (r: Record<string, unknown>): string => {
  const s = r.slug ?? r.code ?? r.id ?? r.key;
  return s != null ? String(s) : "";
};

/**
 * Same-industry comparison via edinetdb. The `/v1/industries` LIST rows already
 * carry the aggregates we need (avg_operating_margin / avg_roe / avg_revenue /
 * company_count), so ONE request covers it — the per-industry detail endpoint
 * returns member companies (not averages) and is not used. Resolves the sector
 * (J-Quants 33業種 日本語名) to its row by name, then pairs each industry
 * average with the company's own value (from ラジ株ナビ, so both sides agree).
 * §2-safe: facts only, no rival tickers named. Returns null if unavailable.
 */
async function fetchPeerComparison(
  sector: string | null,
  own: { operatingMargin: number | null; roe: number | null; netSales: number | null },
): Promise<PeerComparison | null> {
  if (!EDB_KEY || !sector) return null;
  const rows = firstArray(await edb<unknown>("industries"));
  if (!rows.length) {
    console.log("    edinetdb: /industries returned no rows — skipping peer comparison");
    return null;
  }
  const want = norm(sector);
  const hit =
    rows.find((r) => rowName(r) && norm(rowName(r)) === want) ??
    rows.find((r) => rowName(r) && norm(rowName(r)).includes(want));
  if (!hit) {
    console.log(`    edinetdb: no industry match for sector "${sector}" (${rows.length} industries)`);
    return null;
  }
  const sample = readNum(hit, ["company_count", "companies_count", "count", "total", "n"]);
  const metrics = (
    [
      { label: "営業利益率", unit: "%", company: own.operatingMargin, industryAverage: readNum(hit, ["avg_operating_margin", "operating_margin"]) },
      { label: "ROE", unit: "%", company: own.roe, industryAverage: readNum(hit, ["avg_roe", "roe"]) },
      { label: "売上規模", unit: "円", company: own.netSales, industryAverage: readNum(hit, ["avg_revenue", "avg_net_sales", "revenue"]) },
    ] satisfies PeerMetric[]
  ).filter((m) => m.industryAverage != null);
  if (metrics.length === 0) {
    console.log(`    edinetdb: industry "${rowName(hit)}" had no usable average fields — skipping`);
    return null;
  }
  const slug = rowSlug(hit);
  console.log(`    edinetdb: ${sector} -> ${rowName(hit)} (n=${sample}); ${metrics.map((m) => `${m.label}平均${m.industryAverage}`).join(" ")}`);
  return {
    industry: rowName(hit) || sector,
    industrySlug: slug,
    sampleSize: sample,
    metrics,
    source: { label: "edinetdb.jp（業種平均・EDINET 集計）", url: slug ? `https://edinetdb.jp/industries/${slug}` : "https://edinetdb.jp/" },
  };
}

const rowSecCode = (r: Record<string, unknown>): string => {
  const v = r.sec_code ?? r.securities_code ?? r.code ?? r.ticker ?? r.securityCode;
  return v != null ? String(v).replace(/\D/g, "").slice(0, 4) : "";
};

/**
 * The company's rank within its OWN sector via edinetdb's per-industry member
 * list (`/v1/industries/{slug}`), for the same three metrics as the peer
 * average. Rank is computed from the homogeneous edinetdb list (so positions
 * are comparable across members), while the displayed value reuses the own
 * ラジ株ナビ value for in-video consistency. Higher is better for all three
 * (operating margin / ROE / revenue size), so rank = (# strictly greater) + 1.
 * Reuses the slug already resolved by fetchPeerComparison (no extra /industries
 * match). §2-safe: a factual rank with source, no rival tickers named. Returns
 * null on any failure or when the company isn't in the member list.
 */
async function fetchSectorRanking(
  slug: string,
  industryName: string,
  code: string,
  own: { operatingMargin: number | null; roe: number | null; netSales: number | null },
): Promise<SectorRanking | null> {
  if (!EDB_KEY || !slug) return null;
  const rows = firstArray(await edb<unknown>(`industries/${encodeURIComponent(slug)}`));
  if (!rows.length) {
    console.log(`    edinetdb: /industries/${slug} returned no member rows — skipping ranking`);
    return null;
  }
  const me = code.replace(/\D/g, "").slice(0, 4);
  const meRow = rows.find((r) => rowSecCode(r) === me);
  if (!meRow) {
    console.log(`    edinetdb: code ${code} not in industry "${slug}" member list (${rows.length}) — skipping ranking`);
    return null;
  }
  const configs: { label: string; unit: string; keys: string[]; company: number | null }[] = [
    { label: "営業利益率", unit: "%", keys: ["operating_margin"], company: own.operatingMargin },
    { label: "ROE", unit: "%", keys: ["roe"], company: own.roe },
    { label: "売上規模", unit: "円", keys: ["revenue", "net_sales"], company: own.netSales },
  ];
  const metrics: RankMetric[] = [];
  for (const c of configs) {
    const mine = readNum(meRow, c.keys);
    if (mine == null) continue;
    const vals = rows.map((r) => readNum(r, c.keys)).filter((v): v is number => v != null);
    if (vals.length < 2) continue;
    const rank = vals.filter((v) => v > mine).length + 1;
    metrics.push({ label: c.label, unit: c.unit, company: c.company ?? mine, rank, outOf: vals.length });
  }
  if (metrics.length === 0) {
    console.log(`    edinetdb: industry "${slug}" member rows had no usable metrics — skipping ranking`);
    return null;
  }
  console.log(`    edinetdb: ${industryName} ranking (universe ${rows.length}); ${metrics.map((m) => `${m.label}${m.rank}/${m.outOf}位`).join(" ")}`);
  return {
    industry: industryName || slug,
    industrySlug: slug,
    universeSize: rows.length,
    metrics,
    source: { label: "edinetdb.jp（業種内ランキング・EDINET 集計）", url: `https://edinetdb.jp/industries/${slug}` },
  };
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

  const ownMargin = num(fy.operatingMargin) ?? operatingMargin(num(fy.operatingIncome), num(fy.netSales));
  const ownPer = num(fy.per) ?? num(fy.priceEarningsRatio);
  const own = { operatingMargin: ownMargin, roe: num(fy.roe), netSales: num(fy.netSales) };
  const peerComparison = await fetchPeerComparison(m.S33Nm ?? null, own);
  // Ranking reuses the slug already resolved by the peer lookup (one extra
  // /industries/{slug} call); skipped when the sector couldn't be matched.
  const sectorRanking = peerComparison?.industrySlug
    ? await fetchSectorRanking(peerComparison.industrySlug, peerComparison.industry, code, own)
    : null;

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
      operatingMargin: ownMargin,
      netIncome: num(fy.netIncome),
      roe: num(fy.roe),
      equityRatio: num(fy.equityRatio),
      dividendYield: num(fy.dividendYield),
      dividendPerShare: num(fy.dividendPerShare),
      payoutRatio: num(fy.payoutRatio),
      eps: num(fy.eps),
    },
    valuation: { per: ownPer, pbr: num(fy.pbr) },
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
    peerComparison,
    sectorRanking,
    price,
    sources: [
      { label: "J-Quants（東証 上場・株価データ）", url: "https://jpx-jquants.com/" },
      { label: "ラジ株ナビ（EDINET 有報・TDnet 短信ベース財務）", url: "https://radikabunavi.com/" },
      ...(fy.edinetFilingUrl ? [{ label: "EDINET 有価証券報告書", url: String(fy.edinetFilingUrl) }] : []),
      ...(peerComparison ? [peerComparison.source] : []),
      ...(sectorRanking ? [sectorRanking.source] : []),
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
        `  ${code} ${p.companyName} [${p.sector}] 売上${f.netSales}/営利${f.operatingIncome} (率${f.operatingMargin?.toFixed(1)}%) PER${p.valuation.per}/PBR${p.valuation.pbr} 推移${p.revenueTrend.length}期 seg${p.segments.length} 株価${p.price?.close ?? "n/a"} peer${p.peerComparison ? `(${p.peerComparison.metrics.filter((mt) => mt.industryAverage != null).length}/${p.peerComparison.metrics.length}指標)` : "なし"} rank${p.sectorRanking ? `(${p.sectorRanking.metrics.length}指標/${p.sectorRanking.universeSize}社)` : "なし"}`,
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
