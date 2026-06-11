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
import { bgGradient, formatBarValue, headlineBar, type Tone, toneForAsset } from "./theme";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "800"],
  subsets: ["latin", "japanese"],
});
const BG = "#0b1220";

export const MarketRecap = ({ pkg, manifest }: MarketRecapProps) => {
  const { fps } = useVideoConfig();
  const clipFor = (narrationIndex: number) =>
    manifest?.clips.find((c) => c.index === narrationIndex);

  return (
    <AbsoluteFill style={{ backgroundColor: BG, fontFamily }}>
      <Series>
        {pkg.scenes.map((scene, i) => {
          const clip = clipFor(scene.narrationIndex);
          const durMs = (clip?.durationMs ?? EST_MS) + PAD_MS;
          const frames = Math.max(1, Math.ceil((durMs / 1000) * fps));
          const asset = findAsset(pkg, scene.visualRef);
          return (
            <Series.Sequence durationInFrames={frames} key={i}>
              <SceneView title={pkg.meta.title} caption={scene.caption} asset={asset} />
              {clip ? <Audio src={staticFile(clip.file)} /> : null}
            </Series.Sequence>
          );
        })}
      </Series>
      <Disclaimer text={pkg.meta.disclaimer} />
    </AbsoluteFill>
  );
};

const SceneView = ({
  title,
  caption,
  asset,
}: {
  title: string;
  caption: string;
  asset: Asset | undefined;
}) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const tone = toneForAsset(asset);
  // Motion direction reads the tone: positive rises up, negative settles down,
  // neutral simply fades — a small data-linked cue, not domain logic.
  const dir = tone.key === "positive" ? 1 : tone.key === "negative" ? -1 : 0;
  const shift = (1 - enter) * 30 * dir;
  const head = headlineBar(asset?.spec);

  return (
    <AbsoluteFill style={{ background: bgGradient(tone), padding: 72 }}>
      {/* Title band — accent recolored by tone */}
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 12, height: 48, background: tone.accent, borderRadius: 6 }} />
        <div style={{ fontSize: 46, fontWeight: 700, color: "#9fb3c8" }}>{title}</div>
      </div>

      {asset ? (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            gap: 48,
            opacity: enter,
            transform: `translateY(${shift}px)`,
          }}
        >
          {/* Hero: the headline number is the protagonist, tone-colored */}
          {head && asset.spec.kind === "bar" ? (
            <Hero label={head.label} value={head.value} spec={asset.spec} tone={tone} />
          ) : null}
          <Visual asset={asset} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            opacity: enter,
            transform: `translateY(${(1 - enter) * 30}px)`,
          }}
        >
          <div
            style={{
              fontSize: 88,
              fontWeight: 800,
              color: "#fff",
              textAlign: "center",
              lineHeight: 1.3,
              padding: "0 40px",
            }}
          >
            {caption}
          </div>
        </AbsoluteFill>
      )}

      {/* Telop near bottom (only when a visual occupies the stage) */}
      {asset ? (
        <div
          style={{
            position: "absolute",
            left: 56,
            right: 56,
            bottom: 200,
            textAlign: "center",
            fontSize: 60,
            fontWeight: 800,
            color: "#fff",
            background: "rgba(0,0,0,0.45)",
            borderRadius: 20,
            padding: "20px 28px",
            opacity: enter,
          }}
        >
          {caption}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const Hero = ({
  label,
  value,
  spec,
  tone,
}: {
  label: string;
  value: number;
  spec: import("@ics/shared").ChartSpec;
  tone: Tone;
}) => (
  <div style={{ textAlign: "center" }}>
    <div style={{ fontSize: 40, fontWeight: 700, color: "#9fb3c8", marginBottom: 8 }}>
      {label}
    </div>
    <div
      style={{
        fontSize: 180,
        fontWeight: 800,
        lineHeight: 1,
        color: tone.accent,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {formatBarValue(value, spec.unit, spec.signed ?? true)}
    </div>
  </div>
);

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
