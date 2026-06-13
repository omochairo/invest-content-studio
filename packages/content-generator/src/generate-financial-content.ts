/**
 * Financial-explainer generation layer (epic #65, E = 読み解き層): a normalized
 * FinancialStatements -> a long-form ContentPackage that walks through the
 * proportional balance sheet (比例縮尺 BS) and the PL waterfall, then READS the
 * numbers — what the margins, the cost structure, the equity ratio and the
 * retained-earnings depth MEAN. That interpretation is the moat (eurekapu shows
 * the boxes but never explains them).
 *
 * The §3 invariant is unchanged from generate-content.ts: the model writes ONLY
 * prose. EVERY load-bearing number and every visual is computed HERE — the BS
 * proportion box and PL waterfall come from the isolated shared mappers, the
 * ratios from deriveExplainerMetrics. The model may only restate numbers that
 * appear in the fact sheet. The scene<->asset binding is a fixed, code-owned BEAT
 * PLAN with chapter sections (損益 / 成長 / 財務), so a scene can never point at a
 * wrong/absent visual. §2-safe by construction: the focus hints describe the
 * structure as reported fact (no buy/sell), and complianceGate blocks §2.1
 * phrases — on a hit we retry once with the violation fed back, then fail hard.
 *
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-2.5-flash).
 * Run from repo root: `npm run generate:fin -- NVDA` (reads outputs/financials/NVDA.json).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  type Asset,
  type ContentPackage,
  type ExplainerMetrics,
  type FinancialStatements,
  type InterpretationProfile,
  type NarrationLine,
  type Scene,
  type Source,
  balanceSheetToProportionSpec,
  deriveExplainerMetrics,
  deriveInterpretationProfile,
  deriveSegmentFacts,
  incomeStatementToWaterfallSpec,
  segmentsToProportionSpec,
} from "@ics/shared";
import { complianceGate, validateContentPackage } from "./gate";

try {
  process.loadEnvFile();
} catch {
  /* rely on real env */
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const IN_DIR = resolve(ROOT, "outputs/financials");
const OUT_DIR = resolve(ROOT, "outputs/content");
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

const DISCLAIMER =
  "本コンテンツは情報提供を目的としたもので、特定の金融商品の売買を推奨・勧誘するものではありません。投資判断はご自身の責任で行ってください。";

// ── deterministic formatting (every load-bearing number comes from here) ──
const unitOf = (fs: FinancialStatements) => (fs.currency === "JPY" ? "億円" : "億ドル");
/** Raw amount -> 億 unit, 1 dp, matching the proportion/waterfall scale (÷1e8). */
const oku = (raw: number | null, unit: string) =>
  raw == null ? "不明" : `${(raw / 1e8).toFixed(1)}${unit}`;
/** Unsigned ratio %, 1 dp ("71.1%" / "不明") — margins, equity ratio, etc. */
const ratio = (n: number | null) => (n == null ? "不明" : `${n.toFixed(1)}%`);
/** Signed % for growth ("+65.5%" / "-2.0%" / "不明"). */
const growth = (n: number | null) => (n == null ? "不明" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

// ── code-side asset builders (return null when the data is absent) ────────
/** PL waterfall + BS proportion straight from the isolated shared mappers. */
function buildStructureAssets(fs: FinancialStatements): Asset[] {
  const assets: Asset[] = [];
  const wf = incomeStatementToWaterfallSpec(fs, 0);
  if (wf.steps.length) assets.push({ id: "pl-waterfall", type: "waterfall", spec: wf });
  const bs = balanceSheetToProportionSpec(fs, 0);
  if (bs.columns.length) assets.push({ id: "bs-proportion", type: "proportion", spec: bs });
  return assets;
}

/** Two ratio stat grids (PL profitability, BS soundness) from the metrics. */
function buildRatioAssets(m: ExplainerMetrics): Asset[] {
  const assets: Asset[] = [];
  const pl = [
    { label: "粗利率", value: ratio(m.grossMarginPct), note: "売上総利益 ÷ 売上高" },
    { label: "営業利益率", value: ratio(m.operatingMarginPct), note: "営業利益 ÷ 売上高" },
    { label: "純利益率", value: ratio(m.netMarginPct), note: "純利益 ÷ 売上高" },
  ].filter((i) => i.value !== "不明");
  if (pl.length) assets.push({ id: "pl-ratios", type: "stats", spec: { kind: "stats", items: pl } });

  const bs = [
    { label: "自己資本比率", value: ratio(m.equityRatioPct), note: "純資産 ÷ 総資産" },
    { label: "流動比率", value: ratio(m.currentRatioPct), note: "流動資産 ÷ 流動負債" },
    { label: "利益剰余金の厚み", value: ratio(m.retainedToEquityPct), note: "純資産に占める割合" },
  ].filter((i) => i.value !== "不明");
  if (bs.length) assets.push({ id: "bs-ratios", type: "stats", spec: { kind: "stats", items: bs } });
  return assets;
}

/** 万円 with locale commas, for the people-side per-employee/salary figures. */
const man = (rawYen: number | null) =>
  rawYen == null ? "不明" : `${Math.round(rawYen / 1e4).toLocaleString("ja-JP")}万円`;
/** Big-yen amount in 兆円 (≥1兆) else 億円, 1 dp — for segment figures. */
const bigYen = (raw: number | null) =>
  raw == null
    ? "不明"
    : Math.abs(raw) >= 1e12
      ? `${(raw / 1e12).toFixed(1)}兆円`
      : `${(raw / 1e8).toFixed(1)}億円`;

/**
 * JP-only segment-structure proportion (売上構成 ｜ セグメント資産). Present only when
 * the EDINET filing disclosed ≥2 segments; absent for US (FMP) or single-segment
 * filers, so the beat is omitted gracefully. This is the moat visual + the
 * 金融子会社の BS 膨張 story (a finance segment's tiny revenue vs huge asset slab).
 */
function buildSegmentAsset(fs: FinancialStatements): Asset | null {
  const spec = segmentsToProportionSpec(fs);
  if (!spec.columns.length) return null;
  return { id: "seg-structure", type: "proportion", spec };
}

/** JP-only human-capital stat grid (有報 disclosure); null when absent (US). */
function buildHumanCapitalAsset(fs: FinancialStatements): Asset | null {
  const hc = fs.humanCapital;
  if (!hc) return null;
  const items = [
    hc.employees != null
      ? { label: "従業員数", value: `${hc.employees.toLocaleString("ja-JP")}名`, note: "連結" }
      : null,
    hc.avgAnnualSalary != null
      ? {
          label: "平均年間給与",
          value: man(hc.avgAnnualSalary),
          note: [
            hc.avgAgeYears != null ? `平均年齢${hc.avgAgeYears}歳` : null,
            hc.avgTenureYears != null ? `勤続${hc.avgTenureYears}年` : null,
          ]
            .filter(Boolean)
            .join("・") || "提出会社",
        }
      : null,
    hc.salesPerEmployee != null
      ? { label: "一人当たり売上高", value: man(hc.salesPerEmployee), note: "売上高÷従業員数" }
      : null,
    hc.operatingIncomePerEmployee != null
      ? { label: "一人当たり営業利益", value: man(hc.operatingIncomePerEmployee), note: "営業利益÷従業員数" }
      : null,
  ].filter((i): i is { label: string; value: string; note: string } => i != null);
  if (items.length < 2) return null;
  return { id: "human-capital", type: "stats", spec: { kind: "stats", items } };
}

/** Multi-year revenue trend (oldest->newest, 億 unit) from periods. */
function buildRevTrend(fs: FinancialStatements): Asset | null {
  const unit = unitOf(fs);
  const points = [...fs.periods]
    .filter((p) => p.incomeStatement.revenue != null)
    .reverse() // periods are newest-first; a trend reads left(old)->right(new)
    .map((p) => ({
      label: p.period,
      value: Math.round(((p.incomeStatement.revenue as number) / 1e8) * 10) / 10,
    }));
  if (points.length < 2) return null;
  return { id: "rev-trend", type: "line", spec: { kind: "line", unit, points } };
}

/** All code-owned assets, in display order. */
export function buildExplainerAssets(fs: FinancialStatements): Asset[] {
  const m = deriveExplainerMetrics(fs, 0);
  const assets = [...buildStructureAssets(fs)];
  const ratios = buildRatioAssets(m);
  const pl = ratios.find((a) => a.id === "pl-ratios");
  const bs = ratios.find((a) => a.id === "bs-ratios");
  const trend = buildRevTrend(fs);
  const seg = buildSegmentAsset(fs); // JP-only; null for US / single-segment
  const hc = buildHumanCapitalAsset(fs); // JP-only; null for US
  // Order: PL waterfall, PL ratios, revenue trend, segment structure, BS
  // proportion, BS ratios, human capital. The JP-only segment/human-capital
  // assets are simply absent for US, leaving that pipeline unchanged.
  const wf = assets.find((a) => a.id === "pl-waterfall");
  const prop = assets.find((a) => a.id === "bs-proportion");
  return [wf, pl, trend, seg, prop, bs, hc].filter((a): a is Asset => a != null);
}

function buildSources(fs: FinancialStatements): Source[] {
  const sources: Source[] = [];
  if (fs.source.url) sources.push({ label: "Financial Modeling Prep（財務諸表）", url: fs.source.url });
  sources.push({ label: "Financial Modeling Prep", url: "https://financialmodelingprep.com/" });
  return sources;
}

/** Formatted fact sheet — the ONLY numbers the model may put into prose. */
export function explainerFactSheet(fs: FinancialStatements): string {
  const u = unitOf(fs);
  const p = fs.periods[0];
  if (!p) return "（データなし）";
  const is = p.incomeStatement;
  const bs = p.balanceSheet;
  const m = deriveExplainerMetrics(fs, 0);
  const lines = [
    `企業名: ${fs.companyName} (${fs.symbol}) / 市場: ${fs.market} / 会計基準: ${fs.accountingStandard ?? "不明"}`,
    `対象期: ${p.period}（${p.periodEnd}） 通貨: ${fs.currency}・金額単位: ${u}`,
    "— 損益（PL）—",
    `売上高 ${oku(is.revenue, u)} / 売上総利益 ${oku(is.grossProfit, u)} / 営業利益 ${oku(is.operatingIncome, u)} / 純利益 ${oku(is.netIncome, u)}`,
    `売上原価 ${oku(is.costOfRevenue, u)} / 研究開発費 ${oku(is.researchAndDevelopment, u)} / 販管費 ${oku(is.sellingGeneralAndAdmin, u)}`,
    `粗利率 ${ratio(m.grossMarginPct)} / 営業利益率 ${ratio(m.operatingMarginPct)} / 純利益率 ${ratio(m.netMarginPct)} / 実効税率 ${ratio(m.effectiveTaxRatePct)}`,
    "— 財務（BS）—",
    `総資産 ${oku(bs.totalAssets, u)} / 純資産 ${oku(bs.totalEquity, u)} / 利益剰余金 ${oku(bs.retainedEarnings, u)}`,
    `自己資本比率 ${ratio(m.equityRatioPct)} / 流動比率 ${ratio(m.currentRatioPct)} / 利益剰余金の厚み ${ratio(m.retainedToEquityPct)}`,
    "— 成長（前期比）—",
    `売上 ${growth(m.revenueYoYPct)} / 営業利益 ${growth(m.operatingIncomeYoYPct)} / 純利益 ${growth(m.netIncomeYoYPct)}`,
  ];
  const hist = [...fs.periods].filter((q) => q.incomeStatement.revenue != null);
  if (hist.length >= 2)
    lines.push(
      `売上推移: ${[...hist].reverse().map((q) => `${q.period} ${oku(q.incomeStatement.revenue, u)}`).join(" → ")}`,
    );

  // JP-only: business segments (構造の可視化) — the revenue-vs-asset asymmetry that
  // drives 金融子会社の BS 膨張 is spelled out explicitly so prose can cite it.
  if (fs.segments?.length) {
    const sf = deriveSegmentFacts(fs);
    lines.push("— 事業セグメント（最新期）—");
    for (const s of sf.segments) {
      const parts = [
        `売上 ${bigYen(s.sales)}（構成${ratio(s.salesSharePct)}）`,
        `営業利益 ${bigYen(s.operatingIncome)}（利益率${ratio(s.operatingMarginPct)}）`,
      ];
      if (s.assets != null)
        parts.push(`セグメント資産 ${bigYen(s.assets)}（資産構成${ratio(s.assetSharePct)}）`);
      lines.push(`${s.name}: ${parts.join(" / ")}`);
    }
    if (sf.assetHeavy)
      lines.push(
        `※${sf.assetHeavy.name}セグメントは売上構成${ratio(sf.assetHeavy.salesSharePct)}に対しセグメント資産構成${ratio(sf.assetHeavy.assetSharePct)}（売上比で資産が突出＝連結BSが膨らむ構造）`,
      );
  }

  // JP-only: human-capital disclosure (有報).
  const hc = fs.humanCapital;
  if (hc) {
    lines.push("— 人的資本（提出会社/連結）—");
    lines.push(
      `従業員数 ${hc.employees != null ? hc.employees.toLocaleString("ja-JP") + "名" : "不明"} / 平均年間給与 ${man(hc.avgAnnualSalary)} / 平均年齢 ${hc.avgAgeYears != null ? hc.avgAgeYears + "歳" : "不明"} / 平均勤続 ${hc.avgTenureYears != null ? hc.avgTenureYears + "年" : "不明"}`,
    );
    lines.push(
      `一人当たり売上高 ${man(hc.salesPerEmployee)} / 一人当たり営業利益 ${man(hc.operatingIncomePerEmployee)}`,
    );
  }
  return lines.join("\n");
}

// ── beat plan: a fixed, code-owned scene<->asset binding with chapters ────
interface BeatPlan {
  visualRef: string | null;
  /** Chapter chip (損益 / 成長 / 財務 …) shown in the long-form header. */
  section: string | null;
  /** What this beat should talk about (guides the prose, §2-safe, no numbers). */
  focus: string;
}

/** Ordered beat plan; a visual beat is included only if its asset exists. The
 *  stage-1 interpretation profile (derived deterministically when not supplied so
 *  every caller — generate / Jules request / harvest — agrees on the same plan)
 *  suppresses beats whose default framing misleads for this archetype and reframes
 *  the margin / BS-ratio focus. */
export function buildExplainerPlan(
  assets: Asset[],
  fs: FinancialStatements,
  profile: InterpretationProfile = deriveInterpretationProfile(fs),
): BeatPlan[] {
  const has = (id: string) => assets.some((a) => a.id === id);
  const plan: BeatPlan[] = [
    {
      visualRef: null,
      section: "イントロ",
      focus: `つかみ。${fs.companyName} が何を事業の柱とし、どう収益を上げている会社かを、公開情報に基づく事実として1文で示す（テンプレ的な定型句で済ませない）。そのうえで ${fs.periods[0]?.period ?? ""} の財務諸表を、数字の意味まで読み解くと予告する。`,
    },
  ];
  // The PL waterfall lumps every expense into one coarse drop for filers without a
  // gross-profit line; for banks/holdings that lump is meaningless or misleading,
  // so the profile suppresses it.
  if (has("pl-waterfall") && !profile.suppress.plWaterfall)
    plan.push({
      visualRef: "pl-waterfall",
      section: "損益",
      focus: "売上高から売上原価・各費用を順に引いて利益が残るまでの流れを、図に沿って事実として説明する。",
    });
  if (has("pl-ratios"))
    plan.push({
      visualRef: "pl-ratios",
      section: "損益",
      focus:
        profile.marginFocus ??
        "粗利率・営業利益率・純利益率の水準を読み解く。定義の言い換えで終わらせず、この水準が『この企業の事業モデル』（何を売り、原価・販管費・研究開発のどこに費用の重心がある事業構造か）の観点から何を意味するかを、報告済みの事実として一段踏み込んで説明する。売買の含意や将来予測は出さない。",
    });
  if (has("rev-trend"))
    plan.push({
      visualRef: "rev-trend",
      section: "成長",
      focus:
        "複数期の売上推移の変化の大きさを具体的に言語化する（何倍になったか等。「増加傾向」で済ませない）。前期比の伸びも述べる。断定的な将来予測はしない。",
    });
  if (has("seg-structure"))
    plan.push({
      visualRef: "seg-structure",
      section: "事業構造",
      focus:
        "事業セグメント別の構成。左の売上構成でどの事業が稼ぎの柱かを示したうえで、セグメント資産の列が開示されていれば、売上構成と資産構成の『ズレ』を読み解く。とくに金融・リース事業は売上比は小さくても資産を大きく抱えるため、連結の貸借対照表が膨らみ自己資本比率が構造的に低めに出る——という、この企業ならではの構造の非対称を、報告済みの事実として説明する。良し悪しの評価や売買の含意は出さない。",
    });
  if (has("bs-proportion"))
    plan.push({
      visualRef: "bs-proportion",
      section: "財務",
      focus:
        "比例縮尺の貸借対照表。資産＝負債＋純資産の恒等式に触れたうえで、純資産ブロックの厚み（自己資本でどれだけ賄われているか）を読み解く。その水準が『この企業の事業モデル』からどう説明できるかを報告済みの事実として添える（例：金融・リース等の事業を抱えると資産・負債が大きく計上され自己資本比率が構造的に低めに出る／設備が軽い事業は資産が小さく出る）。",
    });
  if (has("bs-ratios"))
    plan.push({
      visualRef: "bs-ratios",
      section: "財務",
      focus:
        profile.bsFocus ??
        "自己資本比率・流動比率・利益剰余金の厚みを読み解き、稼いだ利益が利益剰余金として社内に蓄積し自己資本の厚みにつながっている、というPLとBSの事実の連関に触れる。良し悪しの評価はしない。",
    });
  if (has("human-capital"))
    plan.push({
      visualRef: "human-capital",
      section: "人的資本",
      focus:
        "人的資本。従業員数・平均給与・平均勤続年数といった有価証券報告書ならではの開示と、一人当たり売上高・営業利益という生産性指標を読み解く。その水準が事業モデル（労働集約か装置・資本集約か、付加価値の高い事業か等）の観点から何を示す事実かを、一段踏み込んで説明する。良し悪しの評価はしない。",
    });
  plan.push({
    visualRef: null,
    section: "まとめ",
    focus: "締め。『数値の詳細と出典は概要欄をご確認ください。投資判断はご自身で。』相当で結ぶ。",
  });
  return plan;
}

export type Beat = { narration: string; caption: string };

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    beats: {
      type: "array",
      items: {
        type: "object",
        properties: { narration: { type: "string" }, caption: { type: "string" } },
        required: ["narration", "caption"],
      },
    },
  },
  required: ["title", "beats"],
};

export function buildPrompt(
  fs: FinancialStatements,
  plan: BeatPlan[],
  retryNote = "",
  profile: InterpretationProfile = deriveInterpretationProfile(fs),
): string {
  const beats = plan
    .map(
      (b, i) =>
        `  ${i}) [${b.section ?? "—"}] ${b.visualRef ? "（画面にデータ表示あり）" : ""}${b.focus}`,
    )
    .join("\n");
  return `あなたは日本語で財務諸表をやさしく解説する、中立的な単独ナレーターです。
横型の財務解説動画の台本を書きます。決算「速報」ではなく、報告済みの財務諸表を読み解く解説です。

# 厳守ルール（金融商品取引法コンプラ・違反は不可）
- 報告済みの事実の説明に徹する。売買の推奨・指示は一切しない（「買うべき」「買い時」「売り時」「狙い目」「割安」「割高だから売り」等は禁止）。
- 断定的な将来予測をしない（「必ず上がる」「確実に」「絶対」等は禁止）。
- 利回り・元本の保証をしない（「儲かる」「損しない」「元本保証」「リスクなし」等は禁止）。
- 数値は下記「確定データ」の値だけを使う。新しい数値を創作しない。比率の四捨五入も確定データの表記に従う。

# この企業の読み解き軸（最優先・下の一般指針より優先）
${profile.axisNote}

# 読み解きの深さ（重要：数字の読み上げで終わらせない）
この台本の価値は、図表を読み上げることではなく、数字が財務構造について「何を意味するか」を一段踏み込んで説明することにある。上の『読み解き軸』を主役に据えたうえで、各ビートで次を満たす:
- 規模感を言語化する。複数期で大きく動いた数値は「増加傾向」で済ませず、何倍・どの程度の変化かを具体的に述べる。
- 比率は定義の言い換えで終わらせない。その水準が費用構造・資本構成について示す事実を説明する（例：原価率が小さい＝売上に対し直接費用の比重が小さい収益構造）。
- 損益（PL）と財務（BS）を事実として関連づける（例：高い利益率が利益剰余金として積み上がり、それが自己資本の厚みにつながっている、という報告値どうしの連関）。
- 数字を『この企業固有の事業モデル』に結びつける。何を売り、どこに費用の重心があり、どんな資産・資本構成の事業なのか——公開情報として確立した事業構造の背景を、該当する数値が「なぜそうなっているか」の説明として簡潔に添える（市場予測や未確認の個別事実の創作はしない）。
- 各社で同じ言い回しを使い回さない。テンプレートに数値を流し込むのではなく、その企業の事業構造に即した固有の読み解きにする。
- 確定データに「事業セグメント」がある場合は、構造の読み解きの主役にする。どの事業が稼ぎの柱かに加え、セグメント資産が開示されていれば売上構成と資産構成の『ズレ』（例：金融・リース事業は売上比は小さいのに資産を大きく抱える→連結BSが膨らみ自己資本比率が構造的に低めに出る）を、報告済みの事実として具体的な数値で示す。これはこの企業ならではの構造であり最大の読みどころ。
- 確定データに「人的資本」がある場合は、一人当たり売上・営業利益や平均給与・勤続年数を、労働集約か装置・資本集約かといった事業モデルの観点から事実として読み解く。
- ただし良し悪し・割安割高・売買適否・将来の評価はしない（§2厳守）。あくまで報告済みの構造が「どうなっているか」の説明に徹する。

# 確定データ（この数値以外を本文に出さない）
${explainerFactSheet(fs)}

# 構成（各ビートに narration と caption を1つずつ。順番・個数は厳守＝${plan.length}個）
${beats}

# 出力仕様（JSON）
- title: 動画タイトル（社名と「財務諸表の読み解き」相当を含む簡潔な日本語、誇張なし）。
- beats: 上の構成と完全に同じ個数・同じ順番（${plan.length}個）。各 beat は narration（話す1〜2文・自然な解説口調）/ caption（画面テロップ・短く）。
${retryNote}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds to wait from a 429/503 body's RetryInfo (`retryDelay: "53s"`), if any. */
function retryDelaySec(body: string): number | null {
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Number(m[1]) : null;
}

async function callGemini(prompt: string): Promise<{ title: string; beats: Beat[] }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  // The free tier caps generate_content at 5 RPM/model, so a batch lane (e.g. the
  // explainer cron fanning many symbols at once) routinely trips 429
  // RESOURCE_EXHAUSTED. Retry on 429/503, honoring the server's retryDelay when
  // present, so each shard self-heals into the rate window instead of failing.
  const MAX_ATTEMPTS = 6;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.6,
        },
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Gemini: empty response");
      return JSON.parse(text) as { title: string; beats: Beat[] };
    }
    const body = (await res.text()).slice(0, 1500);
    const retriable = res.status === 429 || res.status === 503;
    if (!retriable || attempt >= MAX_ATTEMPTS) {
      throw new Error(`Gemini -> HTTP ${res.status}: ${body}`);
    }
    // Honor server-advised delay; otherwise exponential backoff capped at 60s.
    const waitMs = (retryDelaySec(body) ?? Math.min(2 ** attempt, 60)) * 1000;
    console.error(`Gemini HTTP ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${waitMs / 1000}s`);
    await sleep(waitMs);
  }
}

export function assembleExplainer(
  fs: FinancialStatements,
  assets: Asset[],
  plan: BeatPlan[],
  gen: { title: string; beats: Beat[] },
): ContentPackage {
  const narration: NarrationLine[] = [];
  const scenes: Scene[] = [];
  plan.forEach((b, i) => {
    const beat = gen.beats[i] as Beat; // length checked in generate() before assemble
    narration.push({ text: beat.narration });
    scenes.push({ narrationIndex: i, caption: beat.caption, visualRef: b.visualRef, section: b.section });
  });
  return {
    meta: {
      title: gen.title?.trim() || `${fs.companyName} 財務諸表の読み解き`,
      lang: "ja",
      format: "wide",
      disclaimer: DISCLAIMER,
      sources: buildSources(fs),
    },
    narration,
    scenes,
    assets,
  };
}

async function generate(fs: FinancialStatements): Promise<ContentPackage> {
  const assets = buildExplainerAssets(fs);
  const plan = buildExplainerPlan(assets, fs);
  let note = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const gen = await callGemini(buildPrompt(fs, plan, note));
    if (!Array.isArray(gen.beats) || gen.beats.length !== plan.length) {
      note = `\n# 前回は beats の個数が違いました。必ず ${plan.length} 個、構成と同じ順番で出力してください。`;
      continue;
    }
    const pkg = assembleExplainer(fs, assets, plan, gen);
    const v = validateContentPackage(pkg);
    if (!v.ok) throw new Error(`validate fail: ${v.errors.join("; ")}`);
    const c = complianceGate(pkg);
    if (c.ok) return pkg;
    console.log(`  compliance fail (attempt ${attempt}): ${c.errors.join("; ")}`);
    note = `\n# 前回の出力はコンプラ違反でした。次の表現を必ず避けて書き直してください:\n${c.errors.join("\n")}`;
  }
  throw new Error("generation failed after retry (count/compliance) — publish blocked (AGENTS.md §2)");
}

async function main(): Promise<void> {
  if (!KEY) throw new Error("GEMINI_API_KEY is not set (add it to .env / CI secret)");
  const argv = process.argv.slice(2);
  if (argv.length === 0) throw new Error("usage: npm run generate:fin -- <SYMBOL> [SYMBOL...]");
  await mkdir(OUT_DIR, { recursive: true });

  for (const symbol of argv) {
    try {
      const fs = JSON.parse(
        await readFile(resolve(IN_DIR, `${symbol}.json`), "utf8"),
      ) as FinancialStatements;
      const pkg = await generate(fs);
      await writeFile(resolve(OUT_DIR, `${symbol}-explainer.json`), JSON.stringify(pkg, null, 2));
      console.log(
        `  ${symbol}: ${pkg.scenes.length} scenes, ${pkg.assets.length} assets, "${pkg.meta.title}" -> outputs/content/${symbol}-explainer.json`,
      );
    } catch (err) {
      console.error(`  ${symbol}: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
}

// Entry-guard: only run main() when invoked directly, so the pure builders above
// can be imported by unit tests without a network call or API key.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

