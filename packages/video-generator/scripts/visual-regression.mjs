// Visual regression harness (#42): render a fixed set of Remotion stills and
// pixel-diff them against committed baselines so any unintended rendering change
// surfaces as a CI failure (and any intended one as a reviewable diff).
//
// DETERMINISM CONTRACT (load-bearing — read before changing):
//   1. Stills use the compositions' built-in defaultProps (the @ics/shared
//      samples). No --props, no fetched data → identical input every run.
//   2. calculateMetadata fetches staticFile("audio/manifest.json"); with no
//      public/audio/manifest.json present it falls back to manifest=null, so
//      scene lengths are the EST_MS estimate — stable and audio-independent.
//   3. Frames are pinned to land on SETTLED scenes (past the 10f enter ease and
//      the 20f count-up), so a 1-frame timing wobble never flips the test.
//   4. Font anti-aliasing differs across OS/Chromium builds. BASELINES MUST BE
//      GENERATED IN THE SAME ENVIRONMENT AS CI (ubuntu-22.04, the
//      visual-regression workflow's `update` run). Running --update on Windows/
//      macOS produces baselines that will false-positive in CI; treat local
//      --update output as a preview only and never commit it.
//
// Usage:
//   node scripts/visual-regression.mjs           # compare, exit 1 on regression
//   node scripts/visual-regression.mjs --update   # (re)write baselines
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, ".."); // packages/video-generator
const ENTRY = "src/index.ts";
const BASELINE_DIR = join(ROOT, "__baselines__");
const ACTUAL_DIR = join(ROOT, "out", "visual", "actual");
const DIFF_DIR = join(ROOT, "out", "visual", "diff");

// Fixed still set. Frames chosen to sit inside a settled scene that exercises a
// specific visual kind (see MarketRecap/LongFormExplainer scene order). Keep
// names stable — they are the baseline filenames.
//
// #35 added a silent BUMPER_FRAMES(=45) intro bumper before scene 0, so every
// scene still's absolute frame is its old value + 45 (it lands at the identical
// scene-local position; the SceneTransition wrapper is opacity 1 there, so the
// scene baselines are unchanged). Bumper/end-card stills are new: bumper frames
// sit mid-intro (past the 8f fade-in); end-card frames sit mid-outro, whose
// absolute start = 45 + sceneTotal (MarketRecap 5 scenes -> 550, LongForm 9 -> 954).
const STILLS = [
  { comp: "MarketRecap", frame: 22, name: "market-recap-bumper" },
  { comp: "MarketRecap", frame: 105, name: "market-recap-caption" },
  { comp: "MarketRecap", frame: 206, name: "market-recap-stats" },
  { comp: "MarketRecap", frame: 307, name: "market-recap-bar" },
  { comp: "MarketRecap", frame: 408, name: "market-recap-line" },
  { comp: "MarketRecap", frame: 587, name: "market-recap-endcard" },
  { comp: "LongFormExplainer", frame: 22, name: "long-form-bumper" },
  { comp: "LongFormExplainer", frame: 105, name: "long-form-intro" },
  { comp: "LongFormExplainer", frame: 395, name: "long-form-line" },
  { comp: "LongFormExplainer", frame: 495, name: "long-form-stats" },
  { comp: "LongFormExplainer", frame: 595, name: "long-form-bar" },
  { comp: "LongFormExplainer", frame: 991, name: "long-form-endcard" },
  // VisualShowcase (#36): deterministic, audio-independent. Each scene is
  // SHOWCASE_SCENE_FRAMES(=90) long; frames sit at scene-local 60 (past the 10f
  // enter ease, the 40f sweep spring, and the count-up that ends at 6+30=36), so
  // the still captures the settled visual with its exact (load-bearing) values.
  { comp: "VisualShowcase", frame: 60, name: "showcase-donut" },
  { comp: "VisualShowcase", frame: 150, name: "showcase-waterfall" },
  { comp: "VisualShowcase", frame: 240, name: "showcase-gauge" },
  // YouTube thumbnail (#37): static still, so the only frame is 0.
  { comp: "Thumbnail", frame: 0, name: "thumbnail" },
];

// Fail when more than this fraction of pixels differ. ~0 in a matched env; the
// small margin absorbs sub-visible encoder noise without hiding real changes.
const FAIL_RATIO = 0.001;
// Per-pixel sensitivity passed to pixelmatch (0 = strict, 1 = lax).
const PIXEL_THRESHOLD = 0.1;

const update = process.argv.includes("--update");

function renderStill(comp, frame, outPath) {
  execFileSync(
    "npx",
    ["remotion", "still", ENTRY, comp, outPath, `--frame=${frame}`, "--log=error"],
    { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" },
  );
}

function loadPng(p) {
  return PNG.sync.read(readFileSync(p));
}

mkdirSync(BASELINE_DIR, { recursive: true });
mkdirSync(ACTUAL_DIR, { recursive: true });
mkdirSync(DIFF_DIR, { recursive: true });

const failures = [];
for (const { comp, frame, name } of STILLS) {
  const target = update ? join(BASELINE_DIR, `${name}.png`) : join(ACTUAL_DIR, `${name}.png`);
  console.log(`render ${comp} @${frame} -> ${name}.png`);
  renderStill(comp, frame, target);
  if (update) continue;

  const baselinePath = join(BASELINE_DIR, `${name}.png`);
  if (!existsSync(baselinePath)) {
    failures.push(`${name}: no baseline (run test:visual:update in CI first)`);
    continue;
  }
  const actual = loadPng(target);
  const baseline = loadPng(baselinePath);
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    failures.push(
      `${name}: size ${actual.width}x${actual.height} != baseline ${baseline.width}x${baseline.height}`,
    );
    continue;
  }
  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  const changed = pixelmatch(baseline.data, actual.data, diff.data, width, height, {
    threshold: PIXEL_THRESHOLD,
  });
  const ratio = changed / (width * height);
  if (ratio > FAIL_RATIO) {
    writeFileSync(join(DIFF_DIR, `${name}.png`), PNG.sync.write(diff));
    failures.push(`${name}: ${changed} px changed (${(ratio * 100).toFixed(3)}% > ${(FAIL_RATIO * 100).toFixed(3)}%)`);
  } else {
    console.log(`  ok (${changed} px, ${(ratio * 100).toFixed(3)}%)`);
  }
}

if (update) {
  console.log(`\nBaselines written to ${BASELINE_DIR}`);
  process.exit(0);
}

if (failures.length) {
  console.error(`\nVisual regression: ${failures.length}/${STILLS.length} still(s) changed:`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`\nDiff images in ${DIFF_DIR} (uploaded as a CI artifact).`);
  console.error("If the change is intended, re-run the workflow with update=true to refresh baselines.");
  process.exit(1);
}

rmSync(ACTUAL_DIR, { recursive: true, force: true });
console.log(`\nVisual regression: all ${STILLS.length} stills match baselines.`);
