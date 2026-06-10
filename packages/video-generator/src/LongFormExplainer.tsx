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
import { Chart } from "./Chart";
import { LineChart } from "./LineChart";
import { StatGrid } from "./StatGrid";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "800"],
  subsets: ["latin", "japanese"],
});
const BG = "#0b1220";
const ACCENT = "#3fb950";

/** Resolve any data-driven asset to its visual component by discriminant. */
const Visual = ({ asset }: { asset: Asset }) => {
  switch (asset.spec.kind) {
    case "bar":
      return <Chart spec={asset.spec} />;
    case "line":
      return <LineChart spec={asset.spec} />;
    case "stats":
      return <StatGrid spec={asset.spec} />;
    default:
      return null;
  }
};

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
        {pkg.scenes.map((scene, i) => {
          const clip = clipFor(scene.narrationIndex);
          const durMs = (clip?.durationMs ?? EST_MS) + PAD_MS;
          const frames = Math.max(1, Math.ceil((durMs / 1000) * fps));
          const asset = findAsset(pkg, scene.visualRef);
          return (
            <Series.Sequence durationInFrames={frames} key={i}>
              <SceneView
                title={pkg.meta.title}
                section={scene.section ?? null}
                caption={scene.caption}
                asset={asset}
              />
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

  return (
    <AbsoluteFill style={{ padding: "64px 96px" }}>
      {/* Header: accent bar + section chip + program title */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ width: 14, height: 52, background: ACCENT, borderRadius: 7 }} />
        {section ? (
          <div
            style={{
              fontSize: 34,
              fontWeight: 800,
              color: "#06210f",
              background: ACCENT,
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
          opacity: enter,
          transform: `translateY(${(1 - enter) * 28}px)`,
        }}
      >
        {asset ? (
          <Visual asset={asset} />
        ) : (
          <div
            style={{
              fontSize: 96,
              fontWeight: 800,
              color: "#fff",
              textAlign: "center",
              lineHeight: 1.3,
              padding: "0 80px",
            }}
          >
            {caption}
          </div>
        )}
      </AbsoluteFill>

      {/* Telop band at the bottom when a visual occupies the stage */}
      {asset ? (
        <div
          style={{
            position: "absolute",
            left: 96,
            right: 96,
            bottom: 150,
            textAlign: "center",
            fontSize: 56,
            fontWeight: 800,
            color: "#fff",
            background: "rgba(0,0,0,0.45)",
            borderRadius: 20,
            padding: "18px 28px",
            opacity: enter,
          }}
        >
          {caption}
        </div>
      ) : null}
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
