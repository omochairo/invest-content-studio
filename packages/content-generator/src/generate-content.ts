/**
 * Phase 1 generation layer (1b): EarningsEvent -> ContentPackage via Gemini Flash.
 *
 * The model writes ONLY prose (title, narration lines, captions) as a single
 * neutral news-reader. EVERY load-bearing NUMBER and every chart/stat/line asset
 * is computed HERE from the EarningsEvent, never from the model (AGENTS.md §3:
 * numbers in the video are never hallucinated). The scene<->asset binding is a
 * fixed, code-owned BEAT PLAN (mirroring generate-jp-content.ts), so the model
 * cannot point a scene at a wrong/absent visual. The mandatory disclaimer and
 * primary sources are injected deterministically so the compliance gate (§2.2)
 * always has its required elements. On a §2.1 prohibited-phrase hit we retry once
 * with the violation fed back, then fail hard (AGENTS.md §5/§6: never publish).
 *
 * Assets emitted (each builder returns null when its data is absent):
 *   reaction  (bar/signed) — EPS・売上の予想比 + 株価本日比 (tone の主役)
 *   headline  (stats)      — EPS実績 / 売上実績 / 株価終値 (予想・本日比は note)
 *   rev-trend (line)       — 直近四半期の売上推移 (EarningsEvent.history, 2点以上)
 * EPS 実績 vs 予想 is intentionally NOT a bar: the bar renderer formats values
 * with toFixed(1) + a suffix unit, which would corrupt small USD EPS values
 * (0.85 -> "0.9"). The comparison is shown losslessly in the headline StatGrid.
 *
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-2.5-flash).
 * Run from repo root: `npm run generate -- NVDA`  (reads outputs/earnings/NVDA.json)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type {
  Asset,
  ContentPackage,
  EarningsEvent,
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
const IN_DIR = resolve(ROOT, "outputs/earnings");
const OUT_DIR = resolve(ROOT, "outputs/content");
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

const DISCLAIMER =
  "本コンテンツは情報提供を目的としたもので、特定の金融商品の売買を推奨・勧誘するものではありません。投資判断はご自身の責任で行ってください。";

// ── deterministic formatting (every load-bearing number comes from here) ──
/** Signed % for surprises / price move ("+1.2%" / "-2.0%" / "不明"). */
const pct = (n: number | null) => (n == null ? "不明" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
/** USD with auto B/M scaling; small values keep 2 decimals (EPS-safe). */
const usd = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(2)}`;
};
const verdictJa = (v: EarningsEvent["epsVerdict"]) =>
  v === "beat" ? "予想を上回る" : v === "miss" ? "予想を下回る" : "ほぼ予想どおり";

// ── code-side asset builders (return null when the data is absent) ────────
/** Reaction bar: EPS・売上 予想比 + 株価本日比 (signed deltas → tone colors). */
function buildReactionChart(ev: EarningsEvent): Asset | null {
  const bars = [
    { label: "EPS 予想比", value: ev.eps.surprisePct },
    { label: "売上 予想比", value: ev.revenue.surprisePct },
    { label: "株価 本日比", value: ev.priceReaction.changePct },
  ].filter((b): b is { label: string; value: number } => b.value != null);
  if (bars.length === 0) return null;
  return { id: "reaction", type: "chart", spec: { kind: "bar", unit: "%", bars } };
}

/** Headline stats: EPS実績 / 売上実績 / 株価終値 (pre-formatted, lossless). */
function buildHeadlineStats(ev: EarningsEvent): Asset | null {
  const items: { label: string; value: string; note?: string | null }[] = [];
  if (ev.eps.actual != null)
    items.push({
      label: "EPS（実績）",
      value: usd(ev.eps.actual),
      note: ev.eps.estimate != null ? `予想 ${usd(ev.eps.estimate)}` : null,
    });
  if (ev.revenue.actual != null)
    items.push({
      label: "売上（実績）",
      value: usd(ev.revenue.actual),
      note: ev.revenue.estimate != null ? `予想 ${usd(ev.revenue.estimate)}` : null,
    });
  if (ev.priceReaction.close != null)
    items.push({
      label: "株価（終値）",
      value: usd(ev.priceReaction.close),
      note: ev.priceReaction.changePct != null ? `本日比 ${pct(ev.priceReaction.changePct)}` : null,
    });
  if (items.length === 0) return null;
  return { id: "headline", type: "stats", spec: { kind: "stats", items } };
}

/** Quarterly revenue trend from EarningsEvent.history (oldest→newest). */
function buildRevTrend(ev: EarningsEvent): Asset | null {
  const points = [...(ev.history ?? [])]
    .filter((h) => h.revenueActual != null)
    .reverse() // history is newest-first; a trend reads left(old)→right(new)
    .map((h) => ({
      label: h.period.slice(2).replace("-", "/"), // "2026-03" → "26/03"
      value: Math.round(((h.revenueActual as number) / 1e9) * 10) / 10, // 十億ドル, 1 decimal
    }));
  if (points.length < 2) return null;
  return { id: "rev-trend", type: "line", spec: { kind: "line", unit: "B$", points } };
}

function buildSources(ev: EarningsEvent): Source[] {
  const sources: Source[] = [];
  if (ev.source.secFilingUrl)
    sources.push({ label: "SEC EDGAR 8-K（一次情報）", url: ev.source.secFilingUrl });
  sources.push({ label: "Financial Modeling Prep", url: "https://financialmodelingprep.com/" });
  return sources;
}

// ── beat plan: a fixed, code-owned scene<->asset binding ─────────────────
interface BeatPlan {
  visualRef: string | null;
  /** What this beat should talk about (guides the model's prose, no numbers). */
  focus: string;
}

/** Ordered beat plan; a visual beat is included only if its asset exists. */
function buildPlan(assets: Asset[]): BeatPlan[] {
  const has = (id: string) => assets.some((a) => a.id === id);
  const plan: BeatPlan[] = [
    { visualRef: null, focus: "つかみ。どの企業の何の決算速報か（社名・対象期間）をひと言で。" },
  ];
  if (has("headline"))
    plan.push({ visualRef: "headline", focus: "主要な実績（EPS・売上の実績、株価終値）を一望。中立に事実として提示。" });
  if (has("reaction"))
    plan.push({ visualRef: "reaction", focus: "EPS・売上の予想比（beat/miss）と足元の株価変動に言及。データ上の結果として述べる。" });
  if (has("rev-trend"))
    plan.push({ visualRef: "rev-trend", focus: "直近数四半期の売上の推移。伸び・変化の方向を中立に。断定的な将来予測はしない。" });
  plan.push({
    visualRef: null,
    focus: "締め。『数値の詳細と出典は概要欄をご確認ください。投資判断はご自身で。』相当で結ぶ。",
  });
  return plan;
}

/** Formatted fact sheet — the ONLY numbers the model may put into prose. */
function factSheet(ev: EarningsEvent): string {
  const lines = [
    `企業名: ${ev.companyName} (${ev.symbol})`,
    `対象期間: ${ev.fiscalPeriod} / 開示日: ${ev.reportDate}`,
    `EPS判定: ${verdictJa(ev.epsVerdict)}`,
    `EPS: 実績 ${ev.eps.actual != null ? usd(ev.eps.actual) : "不明"} / 予想 ${ev.eps.estimate != null ? usd(ev.eps.estimate) : "不明"}（予想比 ${pct(ev.eps.surprisePct)}）`,
    `売上: 実績 ${ev.revenue.actual != null ? usd(ev.revenue.actual) : "不明"} / 予想 ${ev.revenue.estimate != null ? usd(ev.revenue.estimate) : "不明"}（予想比 ${pct(ev.revenue.surprisePct)}）`,
    `株価: 終値 ${ev.priceReaction.close != null ? usd(ev.priceReaction.close) : "不明"}（本日比 ${pct(ev.priceReaction.changePct)}, ${ev.priceReaction.asOf ?? ""}）`,
  ];
  const hist = (ev.history ?? []).filter((h) => h.revenueActual != null);
  if (hist.length >= 2)
    lines.push(
      `売上推移（四半期）: ${[...hist].reverse().map((h) => `${h.period} ${usd(h.revenueActual as number)}`).join(" → ")}`,
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

function buildPrompt(ev: EarningsEvent, plan: BeatPlan[], retryNote = ""): string {
  const beats = plan
    .map((b, i) => `  ${i}) ${b.visualRef ? "（画面にデータ表示あり）" : ""}${b.focus}`)
    .join("\n");
  return `あなたは日本語の経済ニュースを読み上げる、中立的な単独ナレーターです。
米国株の決算速報を、縦型ショート動画（約30〜40秒）の台本にします。

# 厳守ルール（金融商品取引法コンプラ・違反は不可）
- 事実報道に徹する。売買の推奨・指示は一切しない（「買うべき」「買い時」「売り時」「狙い目」等は禁止）。
- 断定的な将来予測をしない（「必ず上がる」「確実に」「絶対」等は禁止）。
- 利回り・元本の保証をしない（「儲かる」「損しない」「元本保証」「リスクなし」等は禁止）。
- 数値は下記「確定データ」の値だけを使う。新しい数値を創作しない。
- 主語を事実・出典に置く（「市場ではこう開示された」「データはこうなっている」）。

# 確定データ（この数値以外を本文に出さない）
${factSheet(ev)}

# 構成（各ビートに narration と caption を1つずつ。順番・個数は厳守＝${plan.length}個）
${beats}

# 出力仕様（JSON）
- title: 動画タイトル（社名と「決算速報」を含む簡潔な日本語、誇張なし）。
- beats: 上の構成と完全に同じ個数・同じ順番（${plan.length}個）。各 beat は narration（話す1文・自然な口語）/ caption（画面テロップ・短く）。
${retryNote}`;
}

async function callGemini(prompt: string): Promise<{ title: string; beats: Beat[] }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
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
  if (!res.ok) throw new Error(`Gemini -> HTTP ${res.status}: ${(await res.text()).slice(0, 1500)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: empty response");
  return JSON.parse(text) as { title: string; beats: Beat[] };
}

function assemble(
  ev: EarningsEvent,
  assets: Asset[],
  plan: BeatPlan[],
  gen: { title: string; beats: Beat[] },
): ContentPackage {
  const narration: NarrationLine[] = [];
  const scenes: Scene[] = [];
  plan.forEach((b, i) => {
    const beat = gen.beats[i] as Beat; // length checked in generate() before assemble
    narration.push({ text: beat.narration });
    scenes.push({ narrationIndex: i, caption: beat.caption, visualRef: b.visualRef });
  });
  return {
    meta: {
      title: gen.title?.trim() || `${ev.companyName} 決算速報`,
      lang: "ja",
      format: "short",
      disclaimer: DISCLAIMER,
      sources: buildSources(ev),
    },
    narration,
    scenes,
    assets,
  };
}

async function generate(ev: EarningsEvent): Promise<ContentPackage> {
  const assets = [buildHeadlineStats(ev), buildReactionChart(ev), buildRevTrend(ev)].filter(
    (a): a is Asset => a !== null,
  );
  const plan = buildPlan(assets);
  let note = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const gen = await callGemini(buildPrompt(ev, plan, note));
    if (!Array.isArray(gen.beats) || gen.beats.length !== plan.length) {
      note = `\n# 前回は beats の個数が違いました。必ず ${plan.length} 個、構成と同じ順番で出力してください。`;
      continue;
    }
    const pkg = assemble(ev, assets, plan, gen);
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
  if (argv.length === 0) throw new Error("usage: npm run generate -- <SYMBOL> [SYMBOL...]");
  await mkdir(OUT_DIR, { recursive: true });

  for (const symbol of argv) {
    try {
      const ev = JSON.parse(
        await readFile(resolve(IN_DIR, `${symbol}.json`), "utf8"),
      ) as EarningsEvent;
      const pkg = await generate(ev);
      await writeFile(resolve(OUT_DIR, `${symbol}.json`), JSON.stringify(pkg, null, 2));
      console.log(
        `  ${symbol}: ${pkg.scenes.length} scenes, ${pkg.assets.length} assets, "${pkg.meta.title}" -> outputs/content/${symbol}.json`,
      );
    } catch (err) {
      console.error(`  ${symbol}: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
