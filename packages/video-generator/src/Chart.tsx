import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ChartSpec } from "@ics/shared";

const POS = "#3fb950";
const NEG = "#f85149";
const NEUTRAL = "#4a8fe0";

/** Data-driven horizontal bar chart; bars grow in with a staggered spring. */
export const Chart = ({ spec }: { spec: ChartSpec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const signed = spec.signed ?? true;
  const max = Math.max(...spec.bars.map((b) => Math.abs(b.value)), 1);

  return (
    <div style={{ width: 900, display: "flex", flexDirection: "column", gap: 44 }}>
      {spec.bars.map((bar, i) => {
        const grow = spring({
          frame: frame - i * 5,
          fps,
          config: { damping: 200 },
        });
        const fill = (Math.abs(bar.value) / max) * grow;
        const positive = bar.value >= 0;
        const color = !signed ? NEUTRAL : positive ? POS : NEG;
        return (
          <div key={i}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 40,
                marginBottom: 12,
                color: "#cdd9e5",
              }}
            >
              <span>{bar.label}</span>
              <span style={{ color, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                {signed && positive ? "+" : ""}
                {bar.value.toFixed(1)}
                {spec.unit ?? ""}
              </span>
            </div>
            <div style={{ height: 48, background: "#1b2838", borderRadius: 10 }}>
              <div
                style={{
                  width: `${fill * 100}%`,
                  height: "100%",
                  background: color,
                  borderRadius: 10,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
