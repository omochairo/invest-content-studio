/**
 * Phase 2 Jules deep-dive lane (harvest side). After a Jules session has opened
 * its auto-PR adding `jules-research/<code>.prose.json` and that PR is merged,
 * this turns the prose into a ContentPackage using the SAME deterministic path
 * as the Gemini generator: code-derived assets + numbers, validate + §2 gate.
 * Jules supplied only prose (title + beats); every load-bearing number stays
 * code-owned (AGENTS.md §3). Output is identical in shape to generate:jp, so
 * the existing tts/render pipeline consumes it unchanged.
 *
 * Run from repo root: `npm run harvest:jules:jp -- 6758`
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Beat } from "./generate-jp-content";
import type { CompanyProfile, ContentPackage } from "@ics/shared";
import { assemble, buildAssets, buildPlan } from "./generate-jp-content";
import { complianceGate, validateContentPackage } from "./gate";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const EQ_DIR = resolve(ROOT, "outputs/equities");
const PROSE_DIR = resolve(ROOT, "jules-research");
const OUT_DIR = resolve(ROOT, "outputs/content");

export interface Prose {
  title: string;
  beats: Beat[];
}

/**
 * Pure prose -> gated ContentPackage. Numbers/assets are code-derived from the
 * profile; Jules's prose only fills title/narration/caption. Throws on a beat
 * count/order mismatch, a missing title, schema failure, or a §2 violation —
 * so a non-compliant Jules prose can never reach publish. Exported for the
 * verification script (verify-jules-jp.ts).
 */
export function harvestProse(p: CompanyProfile, prose: Prose): ContentPackage {
  const assets = buildAssets(p);
  const plan = buildPlan(assets);
  if (!Array.isArray(prose.beats) || prose.beats.length !== plan.length) {
    throw new Error(
      `Jules prose beats=${prose.beats?.length} but plan expects ${plan.length} — re-run the Jules request (count/order must match)`,
    );
  }
  if (!prose.title?.trim()) throw new Error("Jules prose has no title");

  const pkg = assemble(p, assets, plan, { title: prose.title, beats: prose.beats });
  const v = validateContentPackage(pkg);
  if (!v.ok) throw new Error(`validate fail: ${v.errors.join("; ")}`);
  const c = complianceGate(pkg);
  if (!c.ok) throw new Error(`compliance fail (§2 — publish blocked): ${c.errors.join("; ")}`);
  return pkg;
}

async function harvest(code: string): Promise<void> {
  const p = JSON.parse(await readFile(resolve(EQ_DIR, `${code}.json`), "utf8")) as CompanyProfile;
  const prose = JSON.parse(await readFile(resolve(PROSE_DIR, `${code}.prose.json`), "utf8")) as Prose;
  const pkg = harvestProse(p, prose);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(resolve(OUT_DIR, `${code}.json`), JSON.stringify(pkg, null, 2));
  console.log(
    `  ${code} ${p.companyName}: ${pkg.narration.length} scenes, ${pkg.assets.length} assets, "${pkg.meta.title}" -> outputs/content/${code}.json (via Jules)`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) throw new Error("usage: npm run harvest:jules:jp -- <CODE> [CODE...]");
  for (const code of argv) {
    try {
      await harvest(code);
    } catch (err) {
      console.error(`  ${code}: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
}

// Only run as a CLI; importing for harvestProse (verify-jules-jp) must not exec.
const isEntry = process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false;
if (isEntry) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
