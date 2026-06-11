import type { AudioManifest, ContentPackage } from "@ics/shared";
import { DEFAULT_SCENE_TIMING, findAsset, sceneTimings } from "@ics/shared";
import type { SceneSpan } from "./audioMix";

/** Count-up settle offset within a scene (useCountUp(...,0,20)); the reveal SE
 *  lands here for scenes that animate a headline number (bar charts). */
const REVEAL_OFFSET = 20;

/**
 * Build the absolute per-scene frame layout shared by the scene <Series> and the
 * audio bed (#34). Single source of truth: the frame math lives in @ics/shared's
 * `sceneTimings` (also used by the YouTube chapter timestamps, #38), so the
 * picture, narration, BGM/SE and chapter markers can never disagree. Here we
 * only add the renderer-specific reveal-SE offset on top of that layout.
 */
export function buildSceneSpans(
  pkg: ContentPackage,
  manifest: AudioManifest | null,
  fps: number,
): SceneSpan[] {
  const times = sceneTimings(pkg, manifest, { ...DEFAULT_SCENE_TIMING, fps });
  return times.map((t, i) => {
    const asset = findAsset(pkg, pkg.scenes[i]?.visualRef);
    const hasReveal = asset?.spec.kind === "bar";
    return {
      startFrame: t.startFrame,
      narrationFrames: t.narrationFrames,
      totalFrames: t.totalFrames,
      revealFrame: hasReveal ? t.startFrame + REVEAL_OFFSET : null,
    };
  });
}
