import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { StatGridSpec } from "@ics/shared";

const CARD = "#111c2e";
const BORDER = "#23344d";
const LABEL = "#9fb3c8";
const VALUE = "#ffffff";
const NOTE = "#6f8298";

/** Grid of headline metrics (e.g. revenue, PER, equity ratio). Cards fade/
 *  rise in with a staggered spring. Values are pre-formatted strings so the
 *  renderer never reformats a load-bearing number. */
export const StatGrid = ({ spec }: { spec: StatGridSpec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 28,
        width: 1240,
      }}
    >
      {spec.items.map((it, i) => {
        const enter = spring({ frame: frame - i * 4, fps, config: { damping: 200 } });
        return (
          <div
            key={i}
            style={{
              background: CARD,
              border: `2px solid ${BORDER}`,
              borderRadius: 18,
              padding: "28px 32px",
              opacity: enter,
              transform: `translateY(${(1 - enter) * 24}px)`,
            }}
          >
            <div style={{ fontSize: 32, color: LABEL, marginBottom: 12 }}>{it.label}</div>
            <div style={{ fontSize: 64, fontWeight: 800, color: VALUE, fontVariantNumeric: "tabular-nums" }}>
              {it.value}
            </div>
            {it.note ? <div style={{ fontSize: 26, color: NOTE, marginTop: 8 }}>{it.note}</div> : null}
          </div>
        );
      })}
    </div>
  );
};
