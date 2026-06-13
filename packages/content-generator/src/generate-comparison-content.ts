/**
 * Comparison generation layer (T2, issue #64): N companies' normalized
 * FinancialStatements -> ONE long-form ContentPackage that maps them against
 * each other — a 収益性 × 財務健全性 scatter plus profitability / soundness
 * ranking bars. The "まとめ動画" lane, distinct from the single-company
 * explainer (#65): here the value is the cross-company *map*, not one firm's
 * deep read.
 *
 * §3 invariant: EVERY load-bearing number and every visual is computed HERE
 * from deriveExplainerMetrics — the narration is deterministic, code-authored
 * prose (no model), so this lane has zero LLM/quota dependency. §2-safe by
 * construction: positions are described as reported facts (収益性が高い側 等),
 * never 割安/割高 or buy/sell, and complianceGate is run before writing.
 *
 * Cross-currency safe: only dimensionless % metrics (margins, equity ratio)
 * are compared — never absolute amounts (億ドル vs 億円 are not comparable).
 *
 * Run from repo root: `npm run generate:comparison -- NVDA AAPL MSFT 7203 6758 9984`
 * (reads outputs/financials/<SYMBOL>.json; writes outputs/content/COMPARE.json).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  type Asset,
  type ContentPackage,
  type FinancialStatements,
  type NarrationLine,
  type Scene,
  type ScatterPoint,
  type Source,
  deriveExplainerMetrics,
} from "@ics/shared";
import { complianceGate, validateContentPackage } from "./gate";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const IN_DIR = resolve(ROOT, "outputs/financials");
const OUT_DIR = resolve(ROOT, "outputs/content");
const OUT_SLUG = process.env.COMPARE_SLUG ?? "COMPARE";

const DISCLAIMER =
  "本コンテンツは情報提供を目的としたもので、特定の金融商品の売買を推奨・勧誘するものではありません。投資判断はご自身の責任で行ってください。";

/** One company's comparison row — all metrics are currency-neutral %. */
export interface CompanyRow {
  symbol: string;
  /** Short, recognizable company name for chart labels (NVIDIA, トヨタ自動車). */
  name: string;
  /** Full company name for prose. */
  fullName: string;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  equityRatioPct: number | null;
  /** 増収率 = 売上の前年比 (null when there is no prior period). */
  revenueYoYPct: number | null;
  /** 利益剰余金 / 純資産 — how much of equity is self-earned (can be negative
   *  when buybacks/dividends have exceeded cumulative profit, e.g. Apple). */
  retainedToEquityPct: number | null;
  period: string;
}

/**
 * Chart-label name: strip corporate-form tokens from the full company name so
 * scatter points and bar labels read as a recognizable brand (NVIDIA Corporation
 * -> NVIDIA, ソフトバンクグループ株式会社 -> ソフトバンクG) instead of a ticker or a
 * 4-digit TSE code (9984), which tells a general viewer nothing. グループ /
 * ホールディングス are abbreviated (G / HD) rather than dropped, because they
 * distinguish a holding company from its operating subsidiary (ソフトバンクG vs
 * ソフトバンク). Falls back to the symbol if stripping leaves nothing.
 */
export function shortName(fullName: string, symbol: string): string {
  let s = (fullName ?? "").trim();
  s = s.replace(/グループ/g, "G").replace(/ホールディングス/g, "HD");
  s = s.replace(/株式会社/g, "");
  s = s.replace(
    /[,\s]*\b(?:Incorporated|Corporation|Holdings|Company|Limited|Group|Inc|Corp|Co|Ltd|PLC|LLC)\b\.?/gi,
    "",
  );
  s = s.replace(/[\s,.]+$/g, "").trim();
  return s.length > 0 ? s : symbol.trim();
}

export function toRow(fs: FinancialStatements): CompanyRow {
  const m = deriveExplainerMetrics(fs, 0);
  return {
    symbol: fs.symbol,
    name: shortName(fs.companyName, fs.symbol),
    fullName: fs.companyName,
    operatingMarginPct: m.operatingMarginPct,
    netMarginPct: m.netMarginPct,
    equityRatioPct: m.equityRatioPct,
    revenueYoYPct: m.revenueYoYPct,
    retainedToEquityPct: m.retainedToEquityPct,
    period: fs.periods[0]?.period ?? "",
  };
}

const ratio = (n: number | null) => (n == null ? "不明" : `${n.toFixed(1)}%`);
/** Like `ratio`, but with an explicit +/- so growth/decline reads at a glance. */
const signedRatio = (n: number | null) =>
  n == null ? "不明" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

// ── code-side asset builders (every number on screen comes from here) ──────
/** 収益性(営業利益率) × 財務健全性(自己資本比率) scatter with quadrant medians. */
export function buildScatter(rows: CompanyRow[]): Asset | null {
  const r1 = (n: number) => Number(n.toFixed(1));
  const pts: ScatterPoint[] = rows
    .filter((r) => r.operatingMarginPct != null && r.equityRatioPct != null)
    .map((r) => ({ label: r.name, x: r1(r.operatingMarginPct as number), y: r1(r.equityRatioPct as number) }));
  if (pts.length < 2) return null;
  return {
    id: "scatter-prof-equity",
    type: "scatter",
    spec: {
      kind: "scatter",
      xLabel: "営業利益率（収益性）",
      yLabel: "自己資本比率（財務の自己資本の厚み）",
      xUnit: "%",
      yUnit: "%",
      xMid: median(pts.map((p) => p.x)),
      yMid: median(pts.map((p) => p.y)),
      points: pts,
    },
  };
}

/**
 * Ranking bar for one currency-neutral % metric (desc). `signed` controls the
 * renderer's sign prefix + sign coloring: false for a level (営業利益率, 自己資本
 * 比率 — no +/- prefix, neutral color); true for a change or a value whose sign
 * carries meaning (増収率, or 利益剰余金比率 where negative = returned more to
 * shareholders than cumulative profit).
 */
export function buildRankBar(
  rows: CompanyRow[],
  id: string,
  pick: (r: CompanyRow) => number | null,
  signed = false,
): Asset | null {
  const bars = rows
    .filter((r) => pick(r) != null)
    .map((r) => ({ label: r.name, value: Number((pick(r) as number).toFixed(1)) }))
    .sort((a, b) => b.value - a.value);
  if (bars.length < 2) return null;
  return { id, type: "chart", spec: { kind: "bar", unit: "%", signed, bars } };
}

export function buildComparisonAssets(rows: CompanyRow[]): Asset[] {
  return [
    buildScatter(rows),
    buildRankBar(rows, "rank-op-margin", (r) => r.operatingMarginPct),
    buildRankBar(rows, "rank-growth", (r) => r.revenueYoYPct, true),
    buildRankBar(rows, "rank-equity", (r) => r.equityRatioPct),
    buildRankBar(rows, "rank-retained", (r) => r.retainedToEquityPct, true),
  ].filter((a): a is Asset => a != null);
}

function buildSources(all: FinancialStatements[]): Source[] {
  const sources: Source[] = [];
  const hasJp = all.some((fs) => fs.market === "JP");
  const hasUs = all.some((fs) => fs.market !== "JP");
  if (hasUs) sources.push({ label: "Financial Modeling Prep（米国企業の財務諸表）", url: "https://financialmodelingprep.com/" });
  if (hasJp) sources.push({ label: "EDINET（日本企業の有価証券報告書）", url: "https://disclosure2.edinet-fsa.go.jp/" });
  return sources;
}

// ── deterministic, §2-safe narration (code-authored; no model) ────────────
const argMax = (rows: CompanyRow[], pick: (r: CompanyRow) => number | null) =>
  rows.filter((r) => pick(r) != null).sort((a, b) => (pick(b) as number) - (pick(a) as number));

interface Beat {
  narration: string;
  caption: string;
  visualRef: string | null;
  section: string | null;
}

export function buildComparisonBeats(rows: CompanyRow[], assets: Asset[]): Beat[] {
  const has = (id: string) => assets.some((a) => a.id === id);
  const n = rows.length;
  const names = rows.map((r) => r.fullName);
  const lead = names.slice(0, 2).join("・") + (n > 2 ? "など" : "");
  const opSorted = argMax(rows, (r) => r.operatingMarginPct);
  const eqSorted = argMax(rows, (r) => r.equityRatioPct);
  const grSorted = argMax(rows, (r) => r.revenueYoYPct);
  const reSorted = argMax(rows, (r) => r.retainedToEquityPct);
  const topOp = opSorted[0];
  const botOp = opSorted[opSorted.length - 1];
  const topEq = eqSorted[0];
  const topGr = grSorted[0];
  const botGr = grSorted[grSorted.length - 1];
  const topRe = reSorted[0];
  const botRe = reSorted[reSorted.length - 1];
  // Companies dropped from the profitability views (e.g. SBG, which does not
  // report a standalone operating income) — stated honestly so a viewer is not
  // left wondering why a named company is absent from the scatter / op-margin bar.
  const noOp = rows.filter((r) => r.operatingMarginPct == null);
  const noOpNote =
    noOp.length > 0
      ? `なお、${noOp.map((r) => r.fullName).join("・")}は本業の営業利益が単独で開示されていないため、この散布図と営業利益率のランキングには含めていません。`
      : "";

  const beats: Beat[] = [
    {
      section: "イントロ",
      visualRef: null,
      caption: `大型株${n}社 財務体質くらべ`,
      narration: `今回は、${lead}あわせて${n}社の最新の本決算をもとに、本業の収益性・売上の成長性・財務の自己資本の厚み・利益の蓄積という四つの視点で、各社の財務体質を見比べます。画面に出る数値は、すべて報告済みの財務諸表から計算したもので、為替の影響を受けない比率だけを使うので、ドル建ての会社と円建ての会社も同じ土俵で比べられます。`,
    },
  ];
  if (has("scatter-prof-equity") && topOp && topEq)
    beats.push({
      section: "全体マップ",
      visualRef: "scatter-prof-equity",
      caption: "収益性 × 自己資本の厚み",
      narration: `まずは全体像です。この散布図は、横軸が営業利益率、つまり売上に対してどれだけ営業利益を残せているかという収益性、縦軸が自己資本比率、つまり総資産のうち返済義務のない自己資本が占める割合という財務の厚みです。点線は各社の中央値で、右に行くほど収益性が高く、上に行くほど自己資本が厚いことを表します。この中で営業利益率が最も高いのは${topOp.fullName}の${ratio(topOp.operatingMarginPct)}、自己資本比率が最も高いのは${topEq.fullName}の${ratio(topEq.equityRatioPct)}でした。${noOpNote}`,
    });
  if (has("rank-op-margin") && topOp && botOp)
    beats.push({
      section: "収益性",
      visualRef: "rank-op-margin",
      caption: "営業利益率ランキング",
      narration: `ここからは指標ごとに見ていきます。まず収益性、営業利益率を高い順に並べると、首位は${topOp.fullName}で${ratio(topOp.operatingMarginPct)}、最も低いのは${botOp.fullName}で${ratio(botOp.operatingMarginPct)}でした。この差は、各社が何を売り、原価や研究開発、販管費のどこに費用の重心があるかという事業モデルの違いを反映した、報告済みの事実です。`,
    });
  if (has("rank-growth") && topGr && botGr)
    beats.push({
      section: "成長性",
      visualRef: "rank-growth",
      caption: "増収率（前年比）ランキング",
      narration: `次は成長性です。売上が前の期からどれだけ増えたかという増収率を見ると、最も伸びたのは${topGr.fullName}で${signedRatio(topGr.revenueYoYPct)}、最も伸びが小さかったのは${botGr.fullName}で${signedRatio(botGr.revenueYoYPct)}でした。${
        topGr.symbol === topOp?.symbol
          ? `収益性で首位だった${topGr.fullName}が成長率でも首位に立っており、高い利益率と高い成長を同時に実現しているのは、成熟した大型株のなかでは際立った特徴です。`
          : `収益性が高いことと売上が伸びていることは別の話で、利益率の高い会社が必ずしも大きく伸びているとは限らないのが見て取れます。`
      }`,
    });
  if (has("rank-equity") && topEq)
    beats.push({
      section: "財務",
      visualRef: "rank-equity",
      caption: "自己資本比率ランキング",
      narration: `続いて財務の厚みです。自己資本比率を高い順に並べると、首位は${topEq.fullName}で${ratio(topEq.equityRatioPct)}でした。自己資本比率は、銀行やリース、販売金融といった事業を抱える会社では、資産と負債がともに大きく計上されるぶん、構造的に低めに出る傾向があります。水準の高低そのものが、ただちに良し悪しを意味するわけではありません。`,
    });
  if (has("rank-retained") && topRe && botRe)
    beats.push({
      section: "利益の蓄積",
      visualRef: "rank-retained",
      caption: "利益剰余金が純資産に占める割合",
      narration: `最後に、いまの自己資本が何でできているかを見ます。純資産のうち、過去から積み上げた利益、いわゆる利益剰余金が占める割合です。割合が高いほど、外部からの出資より自前で稼いだ利益で資本を厚くしてきたことを表し、最も高いのは${topRe.fullName}で${ratio(topRe.retainedToEquityPct)}でした。${
        botRe.retainedToEquityPct != null && botRe.retainedToEquityPct < 0
          ? `一方で目を引くのが${botRe.fullName}で、${signedRatio(botRe.retainedToEquityPct)}とマイナスです。これは赤字という意味ではなく、長年積み上げた利益を上回る規模で、自社株買いや配当として株主に利益を還元してきた結果、会計上の利益剰余金がマイナスになっているためです。先ほど${botRe.fullName}の自己資本比率が低めだったのも、この積極的な株主還元の裏返しと読めます。`
          : `最も低いのは${botRe.fullName}で${ratio(botRe.retainedToEquityPct)}でした。`
      }`,
    });
  beats.push({
    section: "まとめ",
    visualRef: null,
    caption: "数値・出典は概要欄へ",
    narration: `以上、${n}社の財務体質を、収益性・成長性・自己資本の厚み・利益の蓄積という四つの視点で見比べました。同じ大型株でも、何で稼ぎ、どれだけ伸び、稼いだ利益をどう使うかは大きく異なります。個別の数値や出典は概要欄をご確認ください。投資判断はご自身の責任でお願いします。`,
  });
  return beats;
}

export function assembleComparison(rows: CompanyRow[], assets: Asset[], all: FinancialStatements[]): ContentPackage {
  const beats = buildComparisonBeats(rows, assets);
  const narration: NarrationLine[] = [];
  const scenes: Scene[] = [];
  beats.forEach((b, i) => {
    narration.push({ text: b.narration });
    scenes.push({ narrationIndex: i, caption: b.caption, visualRef: b.visualRef, section: b.section });
  });
  return {
    meta: {
      title: `大型株${rows.length}社の財務体質くらべ｜収益性×自己資本の厚み`,
      lang: "ja",
      format: "wide",
      disclaimer: DISCLAIMER,
      sources: buildSources(all),
    },
    narration,
    scenes,
    assets,
  };
}

async function main(): Promise<void> {
  const symbols = process.argv.slice(2);
  if (symbols.length < 2) throw new Error("usage: npm run generate:comparison -- <SYMBOL> <SYMBOL> [SYMBOL...]");
  await mkdir(OUT_DIR, { recursive: true });

  const all: FinancialStatements[] = [];
  for (const s of symbols) {
    all.push(JSON.parse(await readFile(resolve(IN_DIR, `${s}.json`), "utf8")) as FinancialStatements);
  }
  const rows = all.map(toRow);
  const assets = buildComparisonAssets(rows);
  const pkg = assembleComparison(rows, assets, all);

  const v = validateContentPackage(pkg);
  if (!v.ok) throw new Error(`validate fail: ${v.errors.join("; ")}`);
  const c = complianceGate(pkg);
  if (!c.ok) throw new Error(`compliance fail (§2): ${c.errors.join("; ")}`);

  await writeFile(resolve(OUT_DIR, `${OUT_SLUG}.json`), JSON.stringify(pkg, null, 2));
  console.log(
    `  ${OUT_SLUG}: ${rows.length} companies, ${pkg.scenes.length} scenes, ${pkg.assets.length} assets, "${pkg.meta.title}" -> outputs/content/${OUT_SLUG}.json`,
  );
}

// Entry-guard: only run main() when invoked directly, so the pure builders
// above can be imported by unit tests without filesystem access.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
