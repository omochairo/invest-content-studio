// Wrap a bare ContentPackage JSON into the { pkg, manifest } shape that the
// Remotion compositions (MarketRecap / LongFormExplainer) take as props.
//
// WHY: `remotion render --props=<file>` shallow-merges the file over the
// composition's defaultProps. The compositions expect `{ pkg, manifest }`, so a
// bare ContentPackage (top-level meta/narration/scenes/assets, no `pkg` key)
// leaves defaultProps.pkg = the built-in sample untouched — the video silently
// renders the SAMPLE regardless of the symbol (audio still varies because TTS
// reads the real file). This was the real cause of "audio changes but the
// picture never does". Wrapping the package under `pkg` fixes it.
//
// manifest is loaded inside each composition's calculateMetadata from
// staticFile("audio/manifest.json"), so null here is correct and intentional.
//
// Usage: node scripts/render-props.mjs <content.json> <out-props.json>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("usage: node scripts/render-props.mjs <content.json> <out.json>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(input, "utf8"));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ pkg, manifest: null }));
console.log(`render-props: wrote ${output} (pkg.meta.title="${pkg?.meta?.title ?? "?"}")`);
