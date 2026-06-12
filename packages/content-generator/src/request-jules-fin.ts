/**
 * Financial-explainer Jules deep-dive lane (request side, epic #65). For a
 * SELECTED symbol, ask Jules — the slower-but-deeper async agent (Gemini 3.1
 * Pro, unbounded I/O) — to research the company and write the explainer prose
 * (title + beats) to a committed file via an auto-PR. The numbers/visuals are
 * NOT Jules's job: they stay code-derived in the harvest step (same
 * non-hallucination contract as the Gemini path), so Jules only writes prose,
 * exactly the role Gemini plays in generate:fin.
 *
 * This is the PRIMARY explainer lane (evergreen 解説 has no daily-speed pressure,
 * so we lead with the deepest path; Gemini generate:fin is the fast fallback).
 * The Jules quota is SHARED with omochairo, so we gate on recent creations
 * before dispatching, and manual dispatch only (no schedule).
 *
 * Run from repo root: `npm run request:jules:fin -- NVDA`
 * Env: JULES_API_KEY (required), JULES_DAILY_CAP (default 80).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { FinancialStatements } from "@ics/shared";
import { buildExplainerAssets, buildExplainerPlan, buildPrompt } from "./generate-financial-content";
import { createSession, recentCreationCount, resolveSource } from "./jules-client";

try {
  process.loadEnvFile();
} catch {
  /* rely on real env */
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const IN_DIR = resolve(ROOT, "outputs/financials");
const OWNER = "omochairo";
const REPO = "invest-content-studio";
const CAP = Number(process.env.JULES_DAILY_CAP ?? "80");

/** The committed path Jules must write (outputs/ is gitignored, so a PR there
 *  would have an empty diff — the prose has to land on a tracked path). */
const proseFile = (symbol: string) => `jules-research/${symbol}-explainer.prose.json`;

/** Wrap the shared base prompt with Jules-specific research + delivery. */
function julesPrompt(fs: FinancialStatements, symbol: string): string {
  const plan = buildExplainerPlan(buildExplainerAssets(fs), fs);
  const base = buildPrompt(fs, plan);
  return `あなたは財務諸表を中立的に読み解く、単独のリサーチャー兼ナレーターです。
時間をかけてよい前提で、公開情報（10-K・有価証券報告書・IR・一次情報）を深く調査し、
企業のビジネスモデル・事業構造の一般的背景を文脈として厚くした、財務諸表の読み解き解説台本（prose）を作成してください。
浅い数字の読み上げではなく、数字が財務構造について何を意味するかを一段深く説明するのが狙いです。

# 成果物（リポジトリへの書き込み + PR）
- ファイル \`${proseFile(symbol)}\` を新規作成（既存なら全置換）し、PR を作成する。
- 中身は厳密に次の JSON 1 個だけ: {"title": string, "beats": [{"narration": string, "caption": string}, ...]}。
- **このファイル以外は絶対に変更しない**（scripts/.github/packages/outputs/ 等に触れない）。作業用の一時ファイルは最終コミット前に必ず削除し、最終 PR の差分を ${proseFile(symbol)} の 1 ファイルのみにする。
- 数値は下記「確定データ」の値だけを使う（深く調査するのは文脈・背景であって、新しい数値の創作は禁止）。コンプラ規則も厳守。

=== 以下、台本の本体仕様（この内容を ${proseFile(symbol)} に JSON として書く） ===
${base}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) throw new Error("usage: npm run request:jules:fin -- <SYMBOL> [SYMBOL...]");

  // Shared-quota gate: never starve omochairo's article generation.
  const recent = await recentCreationCount(24);
  const budget = Math.max(0, CAP - recent);
  console.log(`Jules quota: ${recent} created in last 24h, cap ${CAP} -> budget ${budget}`);
  if (budget <= 0) {
    console.log("Jules budget exhausted (shared with omochairo) — skipping dispatch (no-op).");
    return;
  }

  const source = await resolveSource(OWNER, REPO);
  console.log(`Jules source: ${source}`);

  let dispatched = 0;
  for (const symbol of argv) {
    if (dispatched >= budget) {
      console.log(`  ${symbol}: budget reached (${budget}) — skipping remaining`);
      break;
    }
    try {
      const fs = JSON.parse(
        await readFile(resolve(IN_DIR, `${symbol}.json`), "utf8"),
      ) as FinancialStatements;
      const session = await createSession({
        prompt: julesPrompt(fs, symbol),
        source,
        title: `[fin-explainer-jules] ${fs.companyName}（${symbol}）explainer prose`,
      });
      dispatched++;
      console.log(
        `  ${symbol} ${fs.companyName}: session ${session.id} (${session.status}) -> PR will add ${proseFile(symbol)}`,
      );
    } catch (err) {
      console.error(`  ${symbol}: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
  console.log(`-> dispatched ${dispatched}/${argv.length} Jules session(s)`);
}

// Only run as a CLI (defensive: keep import side-effect-free like the others).
const isEntry = process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false;
if (isEntry) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
