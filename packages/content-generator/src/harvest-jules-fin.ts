/**
 * Financial-explainer Jules deep-dive lane (harvest side, epic #65). After a
 * Jules session has opened its auto-PR adding jules-research/<SYMBOL>-explainer.
 * prose.json and that PR is merged, this turns the prose into a ContentPackage
 * using the SAME deterministic path as generate-financial-content.ts:
 * code-derived assets + numbers, validate + §2 gate. Jules supplied only prose
 * (title + beats); every load-bearing number and every visual stays code-owned
 * (AGENTS.md §3). Output is identical in shape to generate:fin, so the existing
 * tts/render pipeline consumes it unchanged.
 *
 * Run from repo root: `npm run harvest:jules:fin -- NVDA`
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ContentPackage, FinancialStatements } from "@ics/shared";
import {
  type Beat,
  assembleExplainer,
  buildExplainerAssets,
  buildExplainerPlan,
} from "./generate-financial-content";
import { complianceGate, validateContentPackage } from "./gate";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const IN_DIR = resolve(ROOT, "outputs/financials");
const PROSE_DIR = resolve(ROOT, "jules-research");
const OUT_DIR = resolve(ROOT, "outputs/content");

export interface Prose {
  title: string;
  beats: Beat[];
}

/**
 * Pure prose -> gated ContentPackage. Numbers/assets are code-derived from the
 * statements; Jules's prose only fills title/narration/caption. Throws on a beat
 * count/order mismatch, a missing title, schema failure, or a §2 violation — so
 * non-compliant Jules prose can never reach publish. Exported for verify-jules-fin.
 */
export function harvestExplainerProse(fs: FinancialStatements, prose: Prose): ContentPackage {
  const assets = buildExplainerAssets(fs);
  const plan = buildExplainerPlan(assets, fs);
  if (!Array.isArray(prose.beats) || prose.beats.length !== plan.length) {
    throw new Error(
      `Jules prose beats=${prose.beats?.length} but plan expects ${plan.length} — re-run the Jules request (count/order must match)`,
    );
  }
  if (!prose.title?.trim()) throw new Error("Jules prose has no title");

  const pkg = assembleExplainer(fs, assets, plan, { title: prose.title, beats: prose.beats });
  const v = validateContentPackage(pkg);
  if (!v.ok) throw new Error(`validate fail: ${v.errors.join("; ")}`);
  const c = complianceGate(pkg);
  if (!c.ok) throw new Error(`compliance fail (§2 — publish blocked): ${c.errors.join("; ")}`);
  return pkg;
}

async function harvest(symbol: string): Promise<void> {
  const fs = JSON.parse(
    await readFile(resolve(IN_DIR, `${symbol}.json`), "utf8"),
  ) as FinancialStatements;
  const prose = JSON.parse(
    await readFile(resolve(PROSE_DIR, `${symbol}-explainer.prose.json`), "utf8"),
  ) as Prose;
  const pkg = harvestExplainerProse(fs, prose);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(resolve(OUT_DIR, `${symbol}-explainer.json`), JSON.stringify(pkg, null, 2));
  console.log(
    `  ${symbol} ${fs.companyName}: ${pkg.scenes.length} scenes, ${pkg.assets.length} assets, "${pkg.meta.title}" -> outputs/content/${symbol}-explainer.json (via Jules)`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) throw new Error("usage: npm run harvest:jules:fin -- <SYMBOL> [SYMBOL...]");
  for (const symbol of argv) {
    try {
      await harvest(symbol);
    } catch (err) {
      console.error(`  ${symbol}: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
}

// Only run as a CLI; importing for harvestExplainerProse (verify) must not exec.
const isEntry = process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false;
if (isEntry) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
