import { AbsoluteFill } from "remotion";
import { loadFont } from "@remotion/google-fonts/NotoSansJP";
import type { ContentPackage, ChartSpec, StatGridSpec } from "@ics/shared";
import { bgGradient, formatBarValue, headlineBar, toneForAsset } from "./theme";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "800"],
  subsets: ["latin", "japanese"],
});

export const Thumbnail = ({ pkg }: { pkg: ContentPackage }) => {
  // Find main asset to determine tone and hero number
  const barAsset = pkg.assets.find(
    (a) => a.type === "chart" && a.spec.kind === "bar"
  );
  const statsAsset = pkg.assets.find((a) => a.type === "stats");

  let heroValStr = "";
  let heroLabel = "";
  const assetForTone = barAsset || statsAsset;

  if (barAsset) {
    const spec = barAsset.spec as ChartSpec;
    const head = headlineBar(spec);
    if (head) {
      heroValStr = formatBarValue(
        head.value,
        spec.unit,
        spec.signed ?? true
      );
      heroLabel = head.label;
    }
  } else if (
    statsAsset &&
    statsAsset.spec.kind === "stats" &&
    statsAsset.spec.items.length > 0
  ) {
    const firstItem = statsAsset.spec.items[0];
    if (firstItem) {
      heroValStr = firstItem.value;
      heroLabel = firstItem.label;
    }
  } else {
    heroValStr = pkg.scenes[0]?.caption ?? "";
  }

  const tone = toneForAsset(assetForTone);
  const kicker = pkg.scenes[0]?.caption ?? "";

  return (
    <AbsoluteFill
      style={{
        background: bgGradient(tone),
        padding: 80,
        fontFamily,
        color: "#cdd9e5",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      {/* Title band */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            width: 14,
            height: 60,
            background: tone.accent,
            borderRadius: 6,
          }}
        />
        <div style={{ fontSize: 56, fontWeight: 800, color: "#fff" }}>
          {pkg.meta.title}
        </div>
      </div>

      {/* Central Hero Block */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: 20,
        }}
      >
        {heroLabel ? (
          <div style={{ fontSize: 48, fontWeight: 700, color: "#9fb3c8" }}>
            {heroLabel}
          </div>
        ) : null}

        <div
          style={{
            fontSize: 220,
            fontWeight: 800,
            lineHeight: 1,
            color: tone.accent,
            fontVariantNumeric: "tabular-nums",
            textAlign: "center",
          }}
        >
          {heroValStr}
        </div>

        {kicker && kicker !== heroValStr ? (
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              color: "#cdd9e5",
              marginTop: 10,
            }}
          >
            {kicker}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
