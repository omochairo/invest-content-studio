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
  const { fps, width } = useVideoConfig();

  const vertical = width < 1300;
  const containerWidth = vertical ? width - 144 : 1240;
  const gridColumns = vertical ? "repeat(2, 1fr)" : "repeat(3, 1fr)";
  const gap = vertical ? 20 : 28;
  const padding = vertical ? "20px 24px" : "28px 32px";

  const labelSize = vertical ? 26 : 32;
  const valueSize = vertical ? 52 : 64;
  const noteSize = vertical ? 22 : 26;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: gridColumns,
        gap: gap,
        width: containerWidth,
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
              padding: padding,
              opacity: enter,
              transform: `translateY(${(1 - enter) * 24}px)`,
            }}
          >
            <div style={{ fontSize: labelSize, color: LABEL, marginBottom: 12 }}>{it.label}</div>
            <div style={{ fontSize: valueSize, fontWeight: 800, color: VALUE, fontVariantNumeric: "tabular-nums" }}>
              {it.value}
            </div>
            {it.note ? <div style={{ fontSize: noteSize, color: NOTE, marginTop: 8 }}>{it.note}</div> : null}
          </div>
        );
      })}
    </div>
  );
};
