/**
 * Phase 2 Jules deep-dive lane (request side). For a SELECTED high-value JP
 * stock, ask Jules — the slower-but-deeper async agent — to research the company
 * and write the long-form prose (title + beats) to a committed file via an
 * auto-PR. The numbers/visuals are NOT Jules's job: they stay code-derived in
 * the harvest step (same non-hallucination contract as the Gemini path), so
 * Jules only writes prose, exactly the role Gemini plays in generate:jp.
 *
 * This is the "selective weekly" half of the two-tier plan: daily/volume =
 * Gemini (generate:jp), ここぞの銘柄 = Jules (this). The Jules quota is SHARED
 * with omochairo, so we gate on recent creations before dispatching.
 *
 * Run from repo root: `npm run request:jules:jp -- 6758`
 * Env: JULES_API_KEY (required), JULES_DAILY_CAP (default 80).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CompanyProfile } from "@ics/shared";
import { buildAssets, buildPlan, buildPrompt } from "./generate-jp-content";
import { createSession, recentCreationCount, resolveSource } from "./jules-client";

try {
  process.loadEnvFile();
} catch {
  /* rely on real env */
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const IN_DIR = resolve(ROOT, "outputs/equities");
const OWNER = "omochairo";
const REPO = "invest-content-studio";
const CAP = Number(process.env.JULES_DAILY_CAP ?? "80");

/** The committed path Jules must write (outputs/ is gitignored, so a PR there
 *  would have an empty diff — the prose has to land on a tracked path). */
const proseFile = (code: string) => `jules-research/${code}.prose.json`;

/** Wrap the shared base prompt with Jules-specific delivery (write file + PR). */
function julesPrompt(p: CompanyProfile, code: string): string {
  const plan = buildPlan(buildAssets(p));
  const base = buildPrompt(p, plan);
  return `あなたは日本株の企業・経済解説を作る、中立的なリサーチャー兼ナレーターです。
時間をかけてよい前提で、公開情報（有価証券報告書・適時開示・一次情報）を深く調査し、
事実の背景・文脈を厚くした長尺解説動画の台本（prose）を作成してください。

# 成果物（リポジトリへの書き込み + PR）
- ファイル \`${proseFile(code)}\` を新規作成（既存なら全置換）し、PR を作成する。
- 中身は厳密に次の JSON 1 個だけ: {"title": string, "beats": [{"narration": string, "caption": string}, ...]}。
- **このファイル以外は絶対に変更しない**（scripts/.github/packages/outputs/ 等に触れない）。作業用の一時ファイルは最終コミット前に必ず削除し、最終 PR の差分を ${proseFile(code)} の 1 ファイルのみにする。
- 数値は下記「確定データ」の値だけを使う（深く調査するのは文脈・背景であって、新しい数値の創作は禁止）。コンプラ規則も厳守。

=== 以下、台本の本体仕様（この内容を ${proseFile(code)} に JSON として書く） ===
${base}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) throw new Error("usage: npm run request:jules:jp -- <CODE> [CODE...]");

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
  for (const code of argv) {
    if (dispatched >= budget) {
      console.log(`  ${code}: budget reached (${budget}) — skipping remaining`);
      break;
    }
    try {
      const p = JSON.parse(await readFile(resolve(IN_DIR, `${code}.json`), "utf8")) as CompanyProfile;
      const session = await createSession({
        prompt: julesPrompt(p, code),
        source,
        title: `[phase2-jp-jules] ${p.companyName}（${code}）prose`,
      });
      dispatched++;
      console.log(`  ${code} ${p.companyName}: session ${session.id} (${session.status}) -> PR will add ${proseFile(code)}`);
    } catch (err) {
      console.error(`  ${code}: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
  console.log(`-> dispatched ${dispatched}/${argv.length} Jules session(s)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
