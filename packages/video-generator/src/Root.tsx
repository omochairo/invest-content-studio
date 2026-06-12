import { Composition, staticFile } from "remotion";
import type { AudioManifest, ContentPackage } from "@ics/shared";
import { DEFAULT_SCENE_TIMING } from "@ics/shared";
import sample from "@ics/shared/samples/market-recap.json";
import longFormSample from "@ics/shared/samples/long-form-explainer.json";
import financialSample from "@ics/shared/samples/financial-explainer.json";
import showcaseSample from "@ics/shared/samples/visual-showcase.json";
import { MarketRecap } from "./MarketRecap";
import { LongFormExplainer } from "./LongFormExplainer";
import { Thumbnail } from "./Thumbnail";
import { VisualShowcase, SHOWCASE_SCENE_FRAMES } from "./VisualShowcase";
import { BUMPER_FRAMES, ENDCARD_FRAMES } from "./theme";

/** Intro bumper + outro end card are silent, fixed-length sequences prepended/
 *  appended to every video (#35). They add a constant to the audio-derived
 *  scene total; the per-scene narration timing is unchanged. Kept here so the
 *  duration math and the compositions share the same constants (theme.ts). */
const BRAND_FRAMES = BUMPER_FRAMES + ENDCARD_FRAMES;

// Layout constants come from the canonical config in @ics/shared so the
// renderer and the chapter-timestamp math (#38) share one definition.
const FPS = DEFAULT_SCENE_TIMING.fps;
/** Breathing room appended after each spoken line (kept in sync with MarketRecap). */
export const PAD_MS = DEFAULT_SCENE_TIMING.padMs;
/** Fallback per-scene length when no audio manifest exists yet (studio preview). */
export const EST_MS = DEFAULT_SCENE_TIMING.estMs;

export type MarketRecapProps = {
  pkg: ContentPackage;
  manifest: AudioManifest | null;
};

const sceneFrames = (durationMs: number) =>
  Math.max(1, Math.ceil(((durationMs + PAD_MS) / 1000) * FPS));

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="MarketRecap"
        component={MarketRecap}
        width={1080}
        height={1920}
        fps={FPS}
        durationInFrames={300}
        defaultProps={{ pkg: sample as ContentPackage, manifest: null }}
        calculateMetadata={async ({ props }) => {
          // Derive total length from the synthesized audio so video stays in
          // sync with narration. Falls back to an estimate before TTS has run.
          let manifest: AudioManifest | null = null;
          try {
            const res = await fetch(staticFile("audio/manifest.json"));
            if (res.ok) manifest = (await res.json()) as AudioManifest;
          } catch {
            manifest = null;
          }
          const sceneTotal = manifest
            ? manifest.clips.reduce((sum, c) => sum + sceneFrames(c.durationMs), 0)
            : props.pkg.scenes.length * sceneFrames(EST_MS);
          return {
            durationInFrames: Math.max(BRAND_FRAMES + sceneTotal, 1),
            props: { ...props, manifest },
          };
        }}
      />
      {/* Long-form (16:9) explainer — Phase 2 (#5). Audio-duration-driven, same
          as MarketRecap: TTS writes audio/manifest.json, and total length is the
          sum of each scene's clip (matched by narrationIndex) + padding. Falls
          back to an estimate in the studio before TTS has run. */}
      <Composition
        id="LongFormExplainer"
        component={LongFormExplainer}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={300}
        defaultProps={{ pkg: longFormSample as ContentPackage, manifest: null }}
        calculateMetadata={async ({ props }) => {
          let manifest: AudioManifest | null = null;
          try {
            const res = await fetch(staticFile("audio/manifest.json"));
            if (res.ok) manifest = (await res.json()) as AudioManifest;
          } catch {
            manifest = null;
          }
          // Mirror the composition's scene<->clip binding so the timeline length
          // matches what LongFormExplainer actually lays out (Series.Sequence).
          const clipFor = (narrationIndex: number) =>
            manifest?.clips.find((c) => c.index === narrationIndex);
          const sceneTotal = props.pkg.scenes.reduce(
            (sum, s) => sum + sceneFrames(clipFor(s.narrationIndex)?.durationMs ?? EST_MS),
            0,
          );
          return {
            durationInFrames: Math.max(BRAND_FRAMES + sceneTotal, 1),
            props: { ...props, manifest },
          };
        }}
      />
      {/* FinancialExplainer (epic #65, E = 読み解き層): the financial-statement
          deep-dive. Reuses the LongFormExplainer component unchanged — it is
          domain-agnostic, so the proportional BS box, the PL waterfall and the
          ratio stat grids render from the ContentPackage alone. Same audio-
          duration-driven metadata as LongFormExplainer (falls back to an
          estimate in the studio before TTS has run). */}
      <Composition
        id="FinancialExplainer"
        component={LongFormExplainer}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={300}
        defaultProps={{ pkg: financialSample as ContentPackage, manifest: null }}
        calculateMetadata={async ({ props }) => {
          let manifest: AudioManifest | null = null;
          try {
            const res = await fetch(staticFile("audio/manifest.json"));
            if (res.ok) manifest = (await res.json()) as AudioManifest;
          } catch {
            manifest = null;
          }
          const clipFor = (narrationIndex: number) =>
            manifest?.clips.find((c) => c.index === narrationIndex);
          const sceneTotal = props.pkg.scenes.reduce(
            (sum, s) => sum + sceneFrames(clipFor(s.narrationIndex)?.durationMs ?? EST_MS),
            0,
          );
          return {
            durationInFrames: Math.max(BRAND_FRAMES + sceneTotal, 1),
            props: { ...props, manifest },
          };
        }}
      />
      {/* VisualShowcase: deterministic, audio-independent stage exercising each
          AssetSpec kind (donut/waterfall/gauge). Dev/QA + visual-regression
          only — not part of the published pipeline. Fixed-length scenes. */}
      <Composition
        id="VisualShowcase"
        component={VisualShowcase}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={Math.max(showcaseSample.scenes.length * SHOWCASE_SCENE_FRAMES, 1)}
        defaultProps={{ pkg: showcaseSample as ContentPackage }}
      />
      <Composition
        id="Thumbnail"
        component={Thumbnail}
        width={1280}
        height={720}
        fps={FPS}
        durationInFrames={1}
        defaultProps={{ pkg: sample as ContentPackage }}
      />
    </>
  );
};
