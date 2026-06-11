import {
  AbsoluteFill,
  Audio,
  interpolate,
  Series,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/NotoSansJP";
import { type Asset, findAsset } from "@ics/shared";
import { EST_MS, type MarketRecapProps, PAD_MS } from "./Root";
import { Visual } from "./Visual";
import { HeroCaption, Telop } from "./Caption";
import { Bumper, EndCard, SceneTransition } from "./Brand";
import { BUMPER_FRAMES, bgGradient, ENDCARD_FRAMES, toneForAsset } from "./theme";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "800"],
  subsets: ["latin", "japanese"],
});
const BG = "#0b1220";

/** Long-form (16:9) explainer: a chaptered walk-through with a persistent
 *  title/section header. Reuses the domain-agnostic ContentPackage, so the
 *  same composition can later narrate an omochairo toy deep-dive. */
export const LongFormExplainer = ({ pkg, manifest }: MarketRecapProps) => {
  const { fps } = useVideoConfig();
  const clipFor = (narrationIndex: number) =>
    manifest?.clips.find((c) => c.index === narrationIndex);

  return (
    <AbsoluteFill style={{ backgroundColor: BG, fontFamily }}>
      <Series>
        {/* Intro bumper (#35): silent, fixed-length, faded by the component. */}
        <Series.Sequence durationInFrames={BUMPER_FRAMES}>
          <Bumper title={pkg.meta.title} durationInFrames={BUMPER_FRAMES} />
        </Series.Sequence>
        {pkg.scenes.map((scene, i) => {
          const clip = clipFor(scene.narrationIndex);
          const durMs = (clip?.durationMs ?? EST_MS) + PAD_MS;
          const frames = Math.max(1, Math.ceil((durMs / 1000) * fps));
          const asset = findAsset(pkg, scene.visualRef);
          return (
            <Series.Sequence durationInFrames={frames} key={i}>
              {/* Cross-dissolve the visuals only; Audio stays outside the fade
                  so narration is never attenuated (#35 invariant B). */}
              <SceneTransition durationInFrames={frames}>
                <SceneView
                  title={pkg.meta.title}
                  section={scene.section ?? null}
                  caption={scene.caption}
                  asset={asset}
                />
              </SceneTransition>
              {clip ? <Audio src={staticFile(clip.file)} /> : null}
            </Series.Sequence>
          );
        })}
        {/* Outro end card (#35): silent CTA, faded by the component. */}
        <Series.Sequence durationInFrames={ENDCARD_FRAMES}>
          <EndCard durationInFrames={ENDCARD_FRAMES} />
        </Series.Sequence>
      </Series>
      <Disclaimer text={pkg.meta.disclaimer} />
    </AbsoluteFill>
  );
};

const SceneView = ({
  title,
  section,
  caption,
  asset,
}: {
  title: string;
  section: string | null;
  caption: string;
  asset: Asset | undefined;
}) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const tone = toneForAsset(asset);

  return (
    <AbsoluteFill style={{ background: bgGradient(tone), padding: "64px 96px" }}>
      {/* Header: accent bar + section chip + program title */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ width: 14, height: 52, background: tone.accent, borderRadius: 7 }} />
        {section ? (
          <div
            style={{
              fontSize: 34,
              fontWeight: 800,
              color: "#06210f",
              background: tone.accent,
              borderRadius: 999,
              padding: "8px 28px",
            }}
          >
            {section}
          </div>
        ) : null}
        <div style={{ fontSize: 40, fontWeight: 700, color: "#9fb3c8" }}>{title}</div>
      </div>

      {/* Center stage: the visual, or a large caption when text-only */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: asset ? enter : 1,
          transform: `translateY(${(1 - enter) * 28}px)`,
        }}
      >
        {asset ? <Visual asset={asset} /> : <HeroCaption text={caption} tone={tone} format="wide" />}
      </AbsoluteFill>

      {/* Telop band at the bottom when a visual occupies the stage */}
      {asset ? <Telop text={caption} tone={tone} format="wide" enter={enter} /> : null}
    </AbsoluteFill>
  );
};

const Disclaimer = ({ text }: { text: string }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      padding: "18px 64px",
      background: "rgba(0,0,0,0.5)",
      color: "#8aa0b2",
      fontSize: 24,
      lineHeight: 1.4,
      textAlign: "center",
    }}
  >
    {text}
  </div>
);
