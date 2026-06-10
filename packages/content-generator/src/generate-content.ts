/**
 * Phase 1 generation layer (1b): EarningsEvent -> ContentPackage via Gemini Flash.
 *
 * The model writes ONLY prose (title, narration lines, captions) as a single
 * neutral news-reader. Every load-bearing NUMBER and the chart are computed
 * here from the EarningsEvent, never from the model (AGENTS.md §3: numbers in
 * the video are never hallucinated). The mandatory disclaimer and primary
 * sources are injected deterministically so the compliance gate (§2.2) always
 * has its required elements. On a §2.1 prohibited-phrase hit we retry once with
 * the violation fed back, then fail hard (AGENTS.md §5/§6: never publish).
 *
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-2.0-flash)
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
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

const DISCLAIMER =
  "本コンテンツは情報提供を目的としたもので、特定の金融商品の売買を推奨・勧誘するものではありません。投資判断はご自身の責任で行ってください。";

const pct = (n: number | null) => (n == null ? "不明" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
const verdictJa = (v: EarningsEvent["epsVerdict"]) =>
  v === "beat" ? "予想を上回る" : v === "miss" ? "予想を下回る" : "ほぼ予想どおり";

/** Deterministic chart built straight from the event (no LLM numbers). */
function buildChart(ev: EarningsEvent): Asset {
  const bars = [
    { label: "EPS 予想比", value: ev.eps.surprisePct },
    { label: "売上 予想比", value: ev.revenue.surprisePct },
    { label: "株価反応", value: ev.priceReaction.changePct },
  ].filter((b): b is { label: string; value: number } => b.value != null);
  return { id: "reaction", type: "chart", spec: { kind: "bar", unit: "%", bars } };
}

function buildSources(ev: EarningsEvent): Source[] {
  const sources: Source[] = [];
  if (ev.source.secFilingUrl)
    sources.push({ label: "SEC EDGAR 8-K（一次情報）", url: ev.source.secFilingUrl });
  sources.push({ label: "Financial Modeling Prep", url: "https://financialmodelingprep.com/" });
  return sources;
}

type Beat = { narration: string; caption: string; showChart: boolean };

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    beats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          narration: { type: "string" },
          caption: { type: "string" },
          showChart: { type: "boolean" },
        },
        required: ["narration", "caption", "showChart"],
      },
    },
  },
  required: ["title", "beats"],
};

function buildPrompt(ev: EarningsEvent, retryNote = ""): string {
  const facts = [
    `企業名: ${ev.companyName} (${ev.symbol})`,
    `対象期間: ${ev.fiscalPeriod} / 開示日: ${ev.reportDate}`,
    `EPS判定: ${verdictJa(ev.epsVerdict)}`,
    `EPS 予想比サプライズ: ${pct(ev.eps.surprisePct)}（実績 ${ev.eps.actual ?? "不明"} / 予想 ${ev.eps.estimate ?? "不明"}）`,
    `売上 予想比サプライズ: ${pct(ev.revenue.surprisePct)}`,
    `開示後の株価反応: ${pct(ev.priceReaction.changePct)}（終値 ${ev.priceReaction.close ?? "不明"}, ${ev.priceReaction.asOf ?? ""}）`,
  ].join("\n");

  return `あなたは日本語の経済ニュースを読み上げる、中立的な単独ナレーターです。
米国株の決算速報を、縦型ショート動画（約30秒）の台本にします。

# 厳守ルール（金融商品取引法コンプラ・違反は不可）
- 事実報道に徹する。売買の推奨・指示は一切しない（「買うべき」「買い時」「売り時」「狙い目」等は禁止）。
- 断定的な将来予測をしない（「必ず上がる」「確実に」「絶対」等は禁止）。
- 利回り・元本の保証をしない（「儲かる」「損しない」「元本保証」「リスクなし」等は禁止）。
- 数値は下記「確定データ」の値だけを使う。新しい数値を創作しない。
- 主語を事実・出典に置く（「市場ではこう開示された」「データはこうなっている」）。

# 確定データ（この数値以外を本文に出さない）
${facts}

# 出力仕様（JSON）
- title: 動画タイトル（社名と「決算速報」を含む簡潔な日本語、誇張なし）。
- beats: 5〜6個。各 beat は narration（話す1文・自然な口語）/ caption（画面テロップ・短く）/ showChart（その beat でデータ棒グラフを見せるなら true）。
  - 1個目: つかみ（何の決算速報か）。
  - 中盤に showChart=true の beat をちょうど1つ置き、EPS・売上の予想比と株価反応に言及。
  - 最後の beat: 「数値の詳細と出典は概要欄をご確認ください。投資判断はご自身で。」相当で締める。
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
  if (!res.ok) throw new Error(`Gemini -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: empty response");
  return JSON.parse(text) as { title: string; beats: Beat[] };
}

function assemble(ev: EarningsEvent, gen: { title: string; beats: Beat[] }): ContentPackage {
  const chart = buildChart(ev);
  const hasChart = chart.spec.bars.length > 0;
  const narration: NarrationLine[] = [];
  const scenes: Scene[] = [];
  gen.beats.forEach((b, i) => {
    narration.push({ text: b.narration });
    scenes.push({
      narrationIndex: i,
      caption: b.caption,
      visualRef: b.showChart && hasChart ? chart.id : null,
    });
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
    assets: hasChart ? [chart] : [],
  };
}

async function generate(ev: EarningsEvent): Promise<ContentPackage> {
  let retryNote = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const gen = await callGemini(buildPrompt(ev, retryNote));
    const pkg = assemble(ev, gen);
    const v = validateContentPackage(pkg);
    if (!v.ok) throw new Error(`validate fail: ${v.errors.join("; ")}`);
    const c = complianceGate(pkg);
    if (c.ok) return pkg;
    console.log(`  compliance fail (attempt ${attempt}): ${c.errors.join("; ")}`);
    retryNote = `\n# 前回の出力はコンプラ違反でした。次の表現を必ず避けて書き直してください:\n${c.errors.join("\n")}`;
  }
  throw new Error("compliance gate failed after retry — publish blocked (AGENTS.md §2)");
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
      console.log(`  ${symbol}: ${pkg.narration.length} lines, "${pkg.meta.title}" -> outputs/content/${symbol}.json`);
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
