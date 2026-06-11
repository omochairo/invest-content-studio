/**
 * Scene timing — the single source of truth for where each scene sits in the
 * final video, in both frames and milliseconds.
 *
 * The renderer (video-generator) and any metadata step (e.g. YouTube chapters)
 * MUST agree on these positions, so the arithmetic lives here once and both
 * sides import it. Timing is domain-agnostic (it reads only the manifest's
 * measured clip durations + a fixed layout config), so it stays in @ics/shared.
 *
 * Layout mirrors the compositions exactly: a silent intro bumper of
 * `bumperFrames`, then each scene runs its narration clip length (or `estMs`
 * before TTS) + `padMs`, rounded up to whole frames.
 */
import type { AudioManifest } from "./audioManifest";
import type { ContentPackage } from "./contentPackage";

export interface SceneTimingConfig {
  /** Frames per second of the composition. */
  fps: number;
  /** Silent intro bumper length prepended before scene 0. */
  bumperFrames: number;
  /** Breathing room appended after each spoken line. */
  padMs: number;
  /** Fallback per-scene length when no audio manifest exists yet. */
  estMs: number;
}

/**
 * Canonical layout constants. video-generator (theme.ts / Root.tsx) imports
 * these so there is exactly one definition; the visual-regression suite guards
 * against accidental drift.
 */
export const DEFAULT_SCENE_TIMING: SceneTimingConfig = {
  fps: 30,
  bumperFrames: 45,
  padMs: 350,
  estMs: 3000,
};

/** Absolute position of one scene in the final video. */
export interface SceneTime {
  /** Index into ContentPackage.narration (and into ContentPackage.scenes). */
  narrationIndex: number;
  /** Whole frames of narration audio (0 before TTS). */
  narrationFrames: number;
  /** Scene length in frames (narration + padding, >= 1). */
  totalFrames: number;
  /** Absolute start frame, including the bumper offset. */
  startFrame: number;
  /** Absolute start time in ms. */
  startMs: number;
  /** Scene length in ms. */
  durationMs: number;
}

/** Frames a scene of the given spoken length occupies (narration + padding). */
function sceneFrames(durationMs: number, cfg: SceneTimingConfig): number {
  return Math.max(1, Math.ceil(((durationMs + cfg.padMs) / 1000) * cfg.fps));
}

/**
 * Per-scene absolute layout, parallel to `pkg.scenes` (same order/length).
 * A scene's length comes from its narration clip (matched by narrationIndex),
 * falling back to `estMs` when the manifest has no clip for it yet.
 */
export function sceneTimings(
  pkg: ContentPackage,
  manifest: AudioManifest | null,
  cfg: SceneTimingConfig = DEFAULT_SCENE_TIMING,
): SceneTime[] {
  const clipFor = (narrationIndex: number) =>
    manifest?.clips.find((c) => c.index === narrationIndex);
  const msPerFrame = 1000 / cfg.fps;

  const out: SceneTime[] = [];
  let cursor = cfg.bumperFrames;
  for (const scene of pkg.scenes) {
    const clip = clipFor(scene.narrationIndex);
    const narrationFrames = clip
      ? Math.max(1, Math.ceil((clip.durationMs / 1000) * cfg.fps))
      : 0;
    const totalFrames = sceneFrames(clip?.durationMs ?? cfg.estMs, cfg);
    out.push({
      narrationIndex: scene.narrationIndex,
      narrationFrames,
      totalFrames,
      startFrame: cursor,
      startMs: Math.round(cursor * msPerFrame),
      durationMs: Math.round(totalFrames * msPerFrame),
    });
    cursor += totalFrames;
  }
  return out;
}
