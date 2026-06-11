import { Composition, staticFile } from "remotion";
import type { AudioManifest, ContentPackage } from "@ics/shared";
import sample from "@ics/shared/samples/market-recap.json";
import longFormSample from "@ics/shared/samples/long-form-explainer.json";
import { MarketRecap } from "./MarketRecap";
import { LongFormExplainer } from "./LongFormExplainer";
import { Thumbnail } from "./Thumbnail";

const FPS = 30;
/** Breathing room appended after each spoken line (kept in sync with MarketRecap). */
export const PAD_MS = 350;
/** Fallback per-scene length when no audio manifest exists yet (studio preview). */
export const EST_MS = 3000;

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
          const durationInFrames = manifest
            ? manifest.clips.reduce((sum, c) => sum + sceneFrames(c.durationMs), 0)
            : props.pkg.scenes.length * sceneFrames(EST_MS);
          return {
            durationInFrames: Math.max(durationInFrames, 1),
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
          const durationInFrames = props.pkg.scenes.reduce(
            (sum, s) => sum + sceneFrames(clipFor(s.narrationIndex)?.durationMs ?? EST_MS),
            0,
          );
          return {
            durationInFrames: Math.max(durationInFrames, 1),
            props: { ...props, manifest },
          };
        }}
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
