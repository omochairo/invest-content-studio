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
  /** Short label for charts (ticker / TSE code). */
  name: string;
  /** Full company name for prose. */
  fullName: string;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  equityRatioPct: number | null;
  period: string;
}

export function toRow(fs: FinancialStatements): CompanyRow {
  const m = deriveExplainerMetrics(fs, 0);
  return {
    symbol: fs.symbol,
    name: fs.symbol,
    fullName: fs.companyName,
    operatingMarginPct: m.operatingMarginPct,
    netMarginPct: m.netMarginPct,
    equityRatioPct: m.equityRatioPct,
    period: fs.periods[0]?.period ?? "",
  };
}

const ratio = (n: number | null) => (n == null ? "不明" : `${n.toFixed(1)}%`);
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

/** Ranking bar for one currency-neutral % metric (desc), signed:false. */
export function buildRankBar(
  rows: CompanyRow[],
  id: string,
  pick: (r: CompanyRow) => number | null,
): Asset | null {
  const bars = rows
    .filter((r) => pick(r) != null)
    .map((r) => ({ label: r.name, value: Number((pick(r) as number).toFixed(1)) }))
    .sort((a, b) => b.value - a.value);
  if (bars.length < 2) return null;
  return { id, type: "chart", spec: { kind: "bar", unit: "%", signed: false, bars } };
}

export function buildComparisonAssets(rows: CompanyRow[]): Asset[] {
  return [
    buildScatter(rows),
    buildRankBar(rows, "rank-op-margin", (r) => r.operatingMarginPct),
    buildRankBar(rows, "rank-equity", (r) => r.equityRatioPct),
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
  const topOp = opSorted[0];
  const botOp = opSorted[opSorted.length - 1];
  const topEq = eqSorted[0];

  const beats: Beat[] = [
    {
      section: "イントロ",
      visualRef: null,
      caption: `大型株${n}社 財務体質くらべ`,
      narration: `今回は、${lead}あわせて${n}社の最新の本決算をもとに、収益性と財務の自己資本の厚みという二つの指標で、各社の財務体質を一枚の図で見比べます。画面に出る数値は、すべて報告済みの財務諸表から計算したものです。`,
    },
  ];
  if (has("scatter-prof-equity") && topOp && topEq)
    beats.push({
      section: "全体マップ",
      visualRef: "scatter-prof-equity",
      caption: "収益性 × 自己資本の厚み",
      narration: `この散布図は、横軸が営業利益率、つまり売上に対してどれだけ営業利益を残せているかという収益性、縦軸が自己資本比率、つまり総資産のうち返済義務のない自己資本が占める割合という財務の厚みです。点線は各社の中央値で、右に行くほど収益性が高く、上に行くほど自己資本が厚いことを表します。この中で営業利益率が最も高いのは${topOp.fullName}の${ratio(topOp.operatingMarginPct)}、自己資本比率が最も高いのは${topEq.fullName}の${ratio(topEq.equityRatioPct)}でした。`,
    });
  if (has("rank-op-margin") && topOp && botOp)
    beats.push({
      section: "収益性",
      visualRef: "rank-op-margin",
      caption: "営業利益率ランキング",
      narration: `営業利益率を高い順に並べると、首位は${topOp.fullName}で${ratio(topOp.operatingMarginPct)}、最も低いのは${botOp.fullName}で${ratio(botOp.operatingMarginPct)}でした。この差は、各社が何を売り、原価や研究開発、販管費のどこに費用の重心があるかという事業モデルの違いを反映した、報告済みの事実です。`,
    });
  if (has("rank-equity") && topEq)
    beats.push({
      section: "財務",
      visualRef: "rank-equity",
      caption: "自己資本比率ランキング",
      narration: `自己資本比率を高い順に並べると、首位は${topEq.fullName}で${ratio(topEq.equityRatioPct)}でした。自己資本比率は、銀行やリース、販売金融といった事業を抱える会社では、資産と負債がともに大きく計上されるぶん、構造的に低めに出る傾向があります。水準の高低そのものが、ただちに良し悪しを意味するわけではありません。`,
    });
  beats.push({
    section: "まとめ",
    visualRef: null,
    caption: "数値・出典は概要欄へ",
    narration: `以上、${n}社の財務体質を、収益性と自己資本の厚みという二つの軸で見比べました。個別の数値や出典は概要欄をご確認ください。投資判断はご自身の責任でお願いします。`,
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
