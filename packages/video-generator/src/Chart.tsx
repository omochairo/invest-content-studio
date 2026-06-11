import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ChartSpec } from "@ics/shared";
import { countUp } from "./useCountUp";

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

        // Ensure fill percentage strictly <= 100%
        const fill = Math.min(1, (Math.abs(bar.value) / max) * grow);

        // Keep color and positive sign based on original true value to prevent flickering
        const positive = bar.value >= 0;
        const color = !signed ? NEUTRAL : positive ? POS : NEG;

        // Animated countUp value (duration 18 frames)
        const displayValue = countUp(bar.value, frame - i * 5, 0, 18);

        // Entry easing
        const enterOpacity = grow;
        const enterTranslateX = (1 - grow) * -30;

        // First bar visual highlight
        const isLead = i === 0;
        const labelSize = isLead ? 44 : 40;
        const labelWeight = isLead ? 800 : 700;

        return (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 16,
              alignItems: "stretch",
              opacity: enterOpacity,
              transform: `translateX(${enterTranslateX}px)`,
            }}
          >
            {/* Visual indicator bar on the left for lead highlighting, keeps column alignment */}
            <div
              style={{
                width: 8,
                background: isLead ? color : "transparent",
                borderRadius: 4,
                flexShrink: 0,
              }}
            />

            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: labelSize,
                  fontWeight: labelWeight,
                  marginBottom: 12,
                  color: "#cdd9e5",
                }}
              >
                <span>{bar.label}</span>
                <span style={{ color, fontVariantNumeric: "tabular-nums" }}>
                  {signed && positive ? "+" : ""}
                  {displayValue.toFixed(1)}
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
          </div>
        );
      })}
    </div>
  );
};

