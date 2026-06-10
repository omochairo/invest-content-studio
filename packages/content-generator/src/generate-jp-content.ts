/**
 * Phase 2 (2c) generation layer: CompanyProfile -> long-form ContentPackage
 * via Gemini Flash (Japanese-equity explainer, 16:9 "wide").
 *
 * Same contract as 1b (generate-content.ts): the model writes ONLY prose
 * (title, narration, captions). EVERY load-bearing number and every
 * chart/line/stat asset is computed HERE from the CompanyProfile, never from
 * the model (AGENTS.md §3: numbers in the video are never hallucinated). The
 * scene<->asset binding is also fixed in code (a static BEAT PLAN), so the
 * model cannot point a scene at a wrong/absent visual. The disclaimer + primary
 * sources are injected deterministically so the compliance gate (§2.2) always
 * has its required elements. Valuation is shown as quantitative facts only —
 * no buy/sell verdict (§2.1).
 *
 * Depth (anti-thinness) levers baked into the prompt (all §2-safe):
 *   (1) 因果の物語化  — tie the trend / 増収減益 to plausible general drivers.
 *   (2) 時系列比較    — multi-year self time-series (peer/market: 今後 edinetdb).
 *   (3) 構造の可視化  — reportable-segment breakdown (the project's weapon).
 *   (4) 投資家の視点  — general-knowledge education frame (e.g. PBR<1の一般的意味).
 *
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-2.5-flash).
 * Run from repo root: `npm run generate:jp -- 7203`  (reads outputs/equities/7203.json)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type {
  Asset,
  CompanyProfile,
  ContentPackage,
  NarrationLine,
  Scene,
  Source,
} from "@ics/shared";
import { complianceGate, validateContentPackage } from "./gate";

try {
  process.loadEnvFile();
} catch {
  /* rely on real env */
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const IN_DIR = resolve(ROOT, "outputs/equities");
const OUT_DIR = resolve(ROOT, "outputs/content");
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

const DISCLAIMER =
  "本コンテンツは情報提供を目的としたもので、特定の金融商品の売買を推奨・勧誘するものではありません。" +
  "数値は公表データ（有価証券報告書・適時開示等）に基づきます。投資判断はご自身の責任で行ってください。";

// ── deterministic formatting (every load-bearing number comes from here) ──
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
/** Yen -> 兆円 display string, 1 decimal (48036704000000 -> "48.0兆円"). */
const choYen = (yen: number) => `${f1(yen / 1e12)}兆円`;
/** Yen -> 兆 as a number, 1 decimal (for chart/line values). */
const choNum = (yen: number) => Math.round((yen / 1e12) * 10) / 10;
const pct1 = (n: number) => `${f1(n)}%`;
const signedPct1 = (n: number) => `${n >= 0 ? "+" : ""}${f1(n)}%`;
/** "2025-03-31" -> "FY25". */
const fyLabel = (end: string) => `FY${end.slice(2, 4)}`;

// ── segment 日本語化: English XBRL reportable-segment tag -> JP label ──────
const SEGMENT_JA: Record<string, string> = {
  AutomotiveReportableSegment: "自動車",
  FinancialServicesReportableSegment: "金融",
  OtherReportableSegments: "その他",
  OtherReportableSegment: "その他",
};
const SEGMENT_WORDS: [RegExp, string][] = [
  [/Automotive/i, "自動車"],
  [/FinancialServices|Financial/i, "金融"],
  [/Electronics?/i, "エレクトロニクス"],
  [/Machinery/i, "機械"],
  [/Chemicals?/i, "化学"],
  [/Healthcare/i, "ヘルスケア"],
  [/Pharmaceutical/i, "医薬品"],
  [/Energy/i, "エネルギー"],
  [/Other/i, "その他"],
];
function segmentJa(tag: string): string {
  if (SEGMENT_JA[tag]) return SEGMENT_JA[tag];
  for (const [re, ja] of SEGMENT_WORDS) if (re.test(tag)) return ja;
  return tag.replace(/ReportableSegments?$/i, "").replace(/Segment$/i, "") || tag;
}

// ── code-side asset builders (return null when the data is absent) ────────
/** Multi-year revenue line; appends the latest 短信 actual if it is newer. */
function buildRevTrend(p: CompanyProfile): Asset | null {
  const points = p.revenueTrend
    .filter((y) => y.netSales != null)
    .map((y) => ({ label: fyLabel(y.fiscalYearEnd), value: choNum(y.netSales as number) }));
  const lr = p.latestReport;
  if (lr?.netSales != null && lr.fiscalYearEnd) {
    const lbl = fyLabel(lr.fiscalYearEnd);
    if (!points.some((pt) => pt.label === lbl)) points.push({ label: lbl, value: choNum(lr.netSales) });
  }
  if (points.length < 2) return null;
  return { id: "rev-trend", type: "line", spec: { kind: "line", unit: "兆円", points } };
}

/** Reportable-segment sales breakdown (structure visualization — lever 3). */
function buildSegments(p: CompanyProfile): Asset | null {
  const bars = p.segments
    .filter((s) => s.sales != null)
    .map((s) => ({ label: segmentJa(s.name), value: choNum(s.sales as number) }));
  if (bars.length === 0) return null;
  return { id: "segments", type: "chart", spec: { kind: "bar", unit: "兆円", signed: false, bars } };
}

/** Headline financial stats (pre-formatted strings; renderer never reformats). */
function buildFinStats(p: CompanyProfile): Asset | null {
  const f = p.financials;
  const fy = f.fiscalYearEnd ? `${f.fiscalYearEnd.slice(0, 4)}/3期` : null;
  const items: { label: string; value: string; note?: string | null }[] = [];
  const add = (label: string, value: string | null) => {
    if (value != null) items.push({ label, value, note: fy });
  };
  add("売上（営業収益）", f.netSales != null ? choYen(f.netSales) : null);
  add("営業利益", f.operatingIncome != null ? choYen(f.operatingIncome) : null);
  add("営業利益率", f.operatingMargin != null ? pct1(f.operatingMargin) : null);
  add("ROE", f.roe != null ? pct1(f.roe) : null);
  add("自己資本比率", f.equityRatio != null ? pct1(f.equityRatio) : null);
  add("配当利回り", f.dividendYield != null ? pct1(f.dividendYield) : null);
  if (items.length === 0) return null;
  return { id: "fin-stats", type: "stats", spec: { kind: "stats", items } };
}

/** Valuation as facts only — no verdict (§2). Absolute magnitudes (signed:false). */
function buildValuation(p: CompanyProfile): Asset | null {
  const bars = [
    { label: "PER（株価収益率）", value: p.valuation.per },
    { label: "PBR（株価純資産倍率）", value: p.valuation.pbr },
  ].filter((b): b is { label: string; value: number } => b.value != null);
  if (bars.length === 0) return null;
  return { id: "valuation", type: "chart", spec: { kind: "bar", unit: "倍", signed: false, bars } };
}

/** Latest 短信 YoY change (causal-story material — lever 1). Signed deltas. */
function buildLatestYoy(p: CompanyProfile): Asset | null {
  const lr = p.latestReport;
  if (!lr) return null;
  const bars = [
    { label: "売上", value: lr.changeNetSales },
    { label: "営業利益", value: lr.changeOperatingIncome },
    { label: "純利益", value: lr.changeNetIncome },
  ].filter((b): b is { label: string; value: number } => b.value != null);
  if (bars.length === 0) return null;
  return { id: "latest-yoy", type: "chart", spec: { kind: "bar", unit: "%", signed: true, bars } };
}

// ── beat plan: a fixed, code-owned scene<->asset binding ─────────────────
interface BeatPlan {
  section: string;
  visualRef: string | null;
  /** What this beat should talk about (guides the model's prose, no numbers). */
  focus: string;
}

/** Build the ordered beat plan, including a visual only if its asset exists. */
function buildPlan(assets: Asset[]): BeatPlan[] {
  const has = (id: string) => assets.some((a) => a.id === id);
  const plan: BeatPlan[] = [
    { section: "イントロ", visualRef: null, focus: "誰の・何の解説かをひと言で。社名・業種・市場区分にふれてつかむ。" },
    { section: "事業", visualRef: null, focus: "この会社が何をしている会社かを一般的な言葉で。事業の全体像。" },
  ];
  if (has("segments"))
    plan.push({ section: "事業", visualRef: "segments", focus: "売上を事業セグメント別に分解し、収益の柱がどこにあるかを構造として可視化する（レバー3）。" });
  if (has("rev-trend"))
    plan.push({ section: "財務", visualRef: "rev-trend", focus: "売上の数年の推移。伸び・変化の方向を述べ、背景にある一般的要因（為替・需要等）に『データ上は』と添えて因果を物語化する（レバー1・2）。" });
  if (has("fin-stats"))
    plan.push({ section: "財務", visualRef: "fin-stats", focus: "利益率・ROE・自己資本比率・配当利回りなど主要指標を整理。収益性と財務の健全性を中立に説明。" });
  if (has("latest-yoy"))
    plan.push({ section: "ハイライト", visualRef: "latest-yoy", focus: "最新の決算短信の前年比。増収か減益かの方向性を述べ、その差が生じた一般的背景に触れて因果を物語化する（レバー1）。断定予測はしない。" });
  if (has("valuation"))
    plan.push({ section: "評価", visualRef: "valuation", focus: "PER・PBRを『市場ではこう評価されている』と事実として提示。PBR1倍割れ等は資本効率の改善が期待される水準といった一般論の教育枠で意味づけ（レバー4）。割安/割高の断定や売買の示唆はしない。" });
  plan.push({ section: "リスク", visualRef: null, focus: "注意して見るべき一般的論点（為替変動・投資負担・競争環境など）。特定銘柄への売買判断は示さない。" });
  plan.push({ section: "まとめ", visualRef: null, focus: "ここまでをデータ上の人物像として中立に要約。" });
  plan.push({ section: "まとめ", visualRef: null, focus: "『数値の詳細と出典は概要欄をご確認ください。投資判断はご自身で行ってください。』に相当する締め。" });
  return plan;
}

/** Formatted fact sheet — the ONLY numbers the model may put into prose. */
function factSheet(p: CompanyProfile): string {
  const f = p.financials;
  const lines = [
    `企業名: ${p.companyName}（証券コード ${p.code}）`,
    `業種: ${p.sector ?? "不明"} / 市場: ${p.market ?? "不明"} / 規模: ${p.scaleCategory ?? "不明"} / 会計基準: ${p.accountingStandard ?? "不明"}`,
    `対象決算期(有報): ${f.fiscalYearEnd}`,
  ];
  if (f.netSales != null) lines.push(`売上(営業収益): ${choYen(f.netSales)}`);
  if (f.operatingIncome != null)
    lines.push(`営業利益: ${choYen(f.operatingIncome)}（営業利益率 ${f.operatingMargin != null ? pct1(f.operatingMargin) : "不明"}）`);
  if (f.roe != null) lines.push(`ROE: ${pct1(f.roe)}`);
  if (f.equityRatio != null) lines.push(`自己資本比率: ${pct1(f.equityRatio)}`);
  if (f.dividendYield != null) lines.push(`配当利回り: ${pct1(f.dividendYield)}`);
  if (p.valuation.per != null) lines.push(`PER: ${p.valuation.per}倍`);
  if (p.valuation.pbr != null) lines.push(`PBR: ${p.valuation.pbr}倍`);
  const segs = p.segments.filter((s) => s.sales != null);
  if (segs.length) lines.push(`セグメント別売上: ${segs.map((s) => `${segmentJa(s.name)} ${choYen(s.sales as number)}`).join(" / ")}`);
  const tr = p.revenueTrend.filter((y) => y.netSales != null);
  if (tr.length) lines.push(`売上推移: ${tr.map((y) => `${fyLabel(y.fiscalYearEnd)} ${choYen(y.netSales as number)}`).join(" → ")}`);
  const lr = p.latestReport;
  if (lr)
    lines.push(
      `最新短信(${lr.fiscalYearEnd}, 開示 ${lr.disclosedDate ?? "不明"}, 前年比): 売上 ${lr.changeNetSales != null ? signedPct1(lr.changeNetSales) : "不明"} / 営業利益 ${lr.changeOperatingIncome != null ? signedPct1(lr.changeOperatingIncome) : "不明"} / 純利益 ${lr.changeNetIncome != null ? signedPct1(lr.changeNetIncome) : "不明"}`,
    );
  return lines.join("\n");
}

type Beat = { narration: string; caption: string };

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

function buildPrompt(p: CompanyProfile, plan: BeatPlan[], retryNote = ""): string {
  const beats = plan
    .map((b, i) => `  ${i}) [章:${b.section}]${b.visualRef ? "（画面にデータ表示あり）" : ""} ${b.focus}`)
    .join("\n");
  return `あなたは日本語の企業・経済解説を読み上げる、中立的な単独ナレーターです。
日本株1銘柄を、データに基づいて落ち着いて解説する長尺（約2〜3分・横型）動画の台本を書きます。

# 厳守ルール（金融商品取引法コンプラ・違反は不可）
- 教育・情報提供・事実報道に徹する。売買の推奨・指示は一切しない（「買うべき」「買い時」「売り時」「狙い目」「仕込め」等は禁止）。
- 断定的な将来予測をしない（「必ず上がる/下がる」「確実に」「間違いなく」「絶対」「〜は確定」等は禁止）。
- 利回り・元本の保証をしない（「儲かる」「損しない」「元本保証」「リスクなし」等は禁止）。
- 割安/割高に触れるときも、当チャンネルの断定や行動指示にしない。主語を事実・データ・市場に置く（「市場ではこう評価されている」「データ上はこうなっている」）。
- 数値は下記「確定データ」の値だけを使う。新しい数値を創作しない。「およそ」等の言い換えは可だが桁・方向は変えない。

# 深掘り（薄さ対策・すべて上記コンプラの範囲内で）
1. 因果の物語化: 数字の増減を、一般に知られた要因（為替・需要・投資負担など）と結びつけ「データ上は」「一般に」と添えて語る。断定はしない。
2. 時系列比較: 売上推移など自社の時間変化で語る（他社比較は今回は扱わない）。
3. 構造の可視化: 事業セグメントなど、数字の内訳・構造を言葉で見せる。
4. 投資家の視点(教育枠): 指標の一般的な意味を教える（例: PBR1倍割れは資本効率の改善が市場から期待される水準、など一般論）。

# 確定データ（この数値以外を本文に出さない）
${factSheet(p)}

# 構成（各ビートに1つずつ narration と caption を書く。順番・個数は厳守）
${beats}

# 出力仕様（JSON）
- title: 動画タイトル（社名と「解説」等を含む簡潔な日本語、誇張なし）。
- beats: 上の構成と完全に同じ個数・同じ順番（${plan.length}個）。各 beat は narration（読み上げる自然な口語。長尺なので各ビート1〜2文、内容が重複しないように）/ caption（画面テロップ。短く要点だけ）。
${retryNote}`;
}

async function callGemini(prompt: string): Promise<{ title: string; beats: Beat[] }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0.6 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini -> HTTP ${res.status}: ${(await res.text()).slice(0, 1500)}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: empty response");
  return JSON.parse(text) as { title: string; beats: Beat[] };
}

function buildSources(p: CompanyProfile): Source[] {
  const s = (p.sources ?? []).filter((x) => /^https?:\/\//.test(x.url ?? ""));
  return s.length ? s : [{ label: "EDINET（金融庁）", url: "https://disclosure2.edinet-fsa.go.jp/" }];
}

function assemble(p: CompanyProfile, assets: Asset[], plan: BeatPlan[], gen: { title: string; beats: Beat[] }): ContentPackage {
  const narration: NarrationLine[] = [];
  const scenes: Scene[] = [];
  plan.forEach((b, i) => {
    const beat = gen.beats[i] as Beat; // length checked in generate() before assemble
    narration.push({ text: beat.narration });
    scenes.push({ section: b.section, narrationIndex: i, caption: beat.caption, visualRef: b.visualRef });
  });
  return {
    meta: {
      title: gen.title?.trim() || `${p.companyName} 解説`,
      lang: "ja",
      format: "wide",
      disclaimer: DISCLAIMER,
      sources: buildSources(p),
    },
    narration,
    scenes,
    assets,
  };
}

async function generate(p: CompanyProfile): Promise<ContentPackage> {
  const assets = [buildSegments(p), buildRevTrend(p), buildFinStats(p), buildValuation(p), buildLatestYoy(p)].filter(
    (a): a is Asset => a !== null,
  );
  const plan = buildPlan(assets);
  let note = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const gen = await callGemini(buildPrompt(p, plan, note));
    if (!Array.isArray(gen.beats) || gen.beats.length !== plan.length) {
      note = `\n# 前回は beats の個数が違いました。必ず ${plan.length} 個、構成と同じ順番で出力してください。`;
      continue;
    }
    const pkg = assemble(p, assets, plan, gen);
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
  if (argv.length === 0) throw new Error("usage: npm run generate:jp -- <CODE> [CODE...]");
  await mkdir(OUT_DIR, { recursive: true });

  for (const code of argv) {
    try {
      const p = JSON.parse(await readFile(resolve(IN_DIR, `${code}.json`), "utf8")) as CompanyProfile;
      const pkg = await generate(p);
      await writeFile(resolve(OUT_DIR, `${code}.json`), JSON.stringify(pkg, null, 2));
      console.log(
        `  ${code} ${p.companyName}: ${pkg.narration.length} scenes, ${pkg.assets.length} assets, "${pkg.meta.title}" -> outputs/content/${code}.json`,
      );
    } catch (err) {
      console.error(`  ${code}: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

