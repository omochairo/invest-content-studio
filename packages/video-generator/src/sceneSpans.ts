import type { AudioManifest, ContentPackage } from "@ics/shared";
import { findAsset } from "@ics/shared";
import { EST_MS, PAD_MS } from "./Root";
import { BUMPER_FRAMES } from "./theme";
import type { SceneSpan } from "./audioMix";

/** Count-up settle offset within a scene (useCountUp(...,0,20)); the reveal SE
 *  lands here for scenes that animate a headline number (bar charts). */
const REVEAL_OFFSET = 20;

/**
 * Build the absolute per-scene frame layout shared by the scene <Series> and the
 * audio bed (#34). Single source of truth: the compositions size each scene from
 * spans[i].totalFrames, and AudioBed ducks/triggers from the same spans, so the
 * picture, narration and BGM/SE can never disagree.
 *
 * The math mirrors the composition timing exactly: scenes follow the silent
 * BUMPER_FRAMES intro, and each scene runs its narration clip length (or EST_MS
 * before TTS) + PAD_MS, rounded to whole frames.
 */
export function buildSceneSpans(
  pkg: ContentPackage,
  manifest: AudioManifest | null,
  fps: number,
): SceneSpan[] {
  const clipFor = (narrationIndex: number) =>
    manifest?.clips.find((c) => c.index === narrationIndex);

  const spans: SceneSpan[] = [];
  let cursor = BUMPER_FRAMES;
  for (const scene of pkg.scenes) {
    const clip = clipFor(scene.narrationIndex);
    const narrationFrames = clip
      ? Math.max(1, Math.ceil((clip.durationMs / 1000) * fps))
      : 0;
    const totalFrames = Math.max(
      1,
      Math.ceil((((clip?.durationMs ?? EST_MS) + PAD_MS) / 1000) * fps),
    );
    const asset = findAsset(pkg, scene.visualRef);
    const hasReveal = asset?.spec.kind === "bar";
    spans.push({
      startFrame: cursor,
      narrationFrames,
      totalFrames,
      revealFrame: hasReveal ? cursor + REVEAL_OFFSET : null,
    });
    cursor += totalFrames;
  }
  return spans;
}
