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
import { type FinancialStatements, deriveInterpretationProfile } from "@ics/shared";
import { buildExplainerAssets, buildExplainerPlan, buildPrompt } from "./generate-financial-content";

/** Human-readable archetype label for the Jules research steer. */
const ARCHETYPE_LABEL: Record<string, string> = {
  "financial-institution": "金融機関（銀行・保険）型＝BSそのものが事業",
  "investment-holding": "投資持株型＝純利益が投資成果で変動",
  "financialized-industrial": "金融子会社を抱える製造業型＝売上と資産構成のズレ",
  standard: "標準的な事業会社型＝費用構造と利益の蓄積",
};
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
  const profile = deriveInterpretationProfile(fs);
  const plan = buildExplainerPlan(buildExplainerAssets(fs), fs, profile);
  const base = buildPrompt(fs, plan, "", profile);
  return `あなたは財務諸表を中立的に読み解く、単独のリサーチャー兼ナレーターです。
時間をかけてよい前提で、公開情報（10-K・有価証券報告書・IR・一次情報）を深く調査し、
企業のビジネスモデル・事業構造の一般的背景を文脈として厚くした、財務諸表の読み解き解説台本（prose）を作成してください。
浅い数字の読み上げではなく、数字が財務構造について何を意味するかを一段深く説明するのが狙いです。

# この企業の構造型（調査の最優先軸）
財務諸表の形から、この企業は「${ARCHETYPE_LABEL[profile.archetype] ?? profile.archetype}」と判定されています。
本文中ほどの『この企業の読み解き軸』を最優先の調査対象とし、その軸に沿って一次情報を深掘りしてください
（汎用的な利益率・自己資本比率の一般論に流さず、この構造型ならではの読み解きを主役にする）。

# 深い調査の成果をどこに反映するか（最重要・これが他社との差別化）
あなたが調査した「その企業固有の事業構造」を、次の3点で必ず台本に効かせてください。テンプレ的な汎用文（どの企業にも当てはまる言い回し）は不可です:
- 冒頭で、その会社が何を事業の柱とし、どのセグメントから収益を得ているかを、公開事実として簡潔に提示する。
- 利益率の読み解きで、その水準が事業モデル（何を売り、どこに費用がかかる構造か）からなぜそうなるのかを説明する。
- 貸借対照表の読み解きで、自己資本比率や資産・負債の大きさが、その企業の事業の成り立ち（例：金融子会社の有無、設備の重さ、資本調達の経緯）からどう説明できるかを添える。
ただし数値の創作は禁止（下記「確定データ」のみ）、§2 コンプラ（売買推奨・将来予測の禁止）は厳守する。

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
