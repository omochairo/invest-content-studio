import { AbsoluteFill, Series, interpolate, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/NotoSansJP";
import { type ContentPackage, findAsset } from "@ics/shared";
import { Visual } from "./Visual";
import { Telop } from "./Caption";
import { TONES, bgGradient } from "./theme";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "800"],
  subsets: ["latin", "japanese"],
});
const BG = "#0b1220";

/** Fixed per-scene length. Deterministic (no audio manifest), so the visual-
 *  regression harness can pin a settled frame per scene without TTS. */
export const SHOWCASE_SCENE_FRAMES = 90;

/** A lightweight, audio-independent stage that renders each asset on the
 *  standard background — a permanent regression/QA home for AssetSpec kinds
 *  (donut/waterfall/gauge) decoupled from the production compositions' frame
 *  math. Not part of the published pipeline. */
export const VisualShowcase = ({ pkg }: { pkg: ContentPackage }) => {
  const tone = TONES.neutral;
  return (
    <AbsoluteFill style={{ backgroundColor: BG, fontFamily }}>
      <Series>
        {pkg.scenes.map((scene, i) => {
          const asset = findAsset(pkg, scene.visualRef);
          return (
            <Series.Sequence durationInFrames={SHOWCASE_SCENE_FRAMES} key={i}>
              <ShowcaseScene title={pkg.meta.title} caption={scene.caption} assetId={scene.visualRef} pkg={pkg} />
            </Series.Sequence>
          );
        })}
      </Series>
      <Disclaimer text={pkg.meta.disclaimer} />
    </AbsoluteFill>
  );

  function ShowcaseScene({
    title,
    caption,
    assetId,
    pkg,
  }: {
    title: string;
    caption: string;
    assetId: string | null | undefined;
    pkg: ContentPackage;
  }) {
    const frame = useCurrentFrame();
    const enter = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
    const asset = findAsset(pkg, assetId);
    return (
      <AbsoluteFill style={{ background: bgGradient(tone), padding: 72 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 12, height: 48, background: tone.accent, borderRadius: 6 }} />
          <div style={{ fontSize: 46, fontWeight: 700, color: "#9fb3c8" }}>{title}</div>
        </div>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: enter }}>
          {asset ? <Visual asset={asset} /> : null}
        </AbsoluteFill>
        <Telop text={caption} tone={tone} format="wide" enter={enter} />
      </AbsoluteFill>
    );
  }
};

const Disclaimer = ({ text }: { text: string }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      padding: "24px 48px",
      background: "rgba(0,0,0,0.5)",
      color: "#8aa0b2",
      fontSize: 24,
      lineHeight: 1.5,
      textAlign: "center",
    }}
  >
    {text}
  </div>
);
