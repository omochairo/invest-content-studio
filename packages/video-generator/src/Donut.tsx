import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { DonutSpec } from "@ics/shared";
import { countUp } from "./useCountUp";

const TEXT = "#cdd9e5";
const LABEL = "#9fb3c8";
const TRACK = "#1b2838";
// Domain-neutral categorical palette (part-to-whole has no sentiment, so we do
// not reuse the green/red tone colors here).
const PALETTE = ["#4a8fe0", "#3fb950", "#d29922", "#a371f7", "#db61a2", "#56d4dd"];

/** Build an annular sector (donut slice) path from `a0`..`a1` radians. */
function arc(cx: number, cy: number, R: number, r: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + R * Math.cos(a0);
  const y0 = cy + R * Math.sin(a0);
  const x1 = cx + R * Math.cos(a1);
  const y1 = cy + R * Math.sin(a1);
  const xi1 = cx + r * Math.cos(a1);
  const yi1 = cy + r * Math.sin(a1);
  const xi0 = cx + r * Math.cos(a0);
  const yi0 = cy + r * Math.sin(a0);
  return [
    `M ${x0} ${y0}`,
    `A ${R} ${R} 0 ${large} 1 ${x1} ${y1}`,
    `L ${xi1} ${yi1}`,
    `A ${r} ${r} 0 ${large} 0 ${xi0} ${yi0}`,
    "Z",
  ].join(" ");
}

/** Composition (part-to-whole) donut. Arcs are derived from value / sum so the
 *  generator may emit absolute amounts or pre-computed shares (domain-agnostic).
 *  Slices sweep in clockwise; the share count-up matches the static reading. */
export const Donut = ({ spec }: { spec: DonutSpec }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const vertical = width < 1300;

  const segs = spec.segments;
  const total = segs.reduce((s, x) => s + x.value, 0) || 1;

  const size = vertical ? 420 : 480;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 8;
  const r = R * 0.58;

  const sweep = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 40 });
  const legendSize = vertical ? 28 : 32;
  const centerSize = vertical ? 44 : 56;

  // Precompute cumulative angles (start at 12 o'clock, sweep clockwise).
  let acc = -Math.PI / 2;
  const slices = segs.map((s, i) => {
    const frac = s.value / total;
    const a0 = acc;
    const a1 = acc + frac * Math.PI * 2 * sweep;
    acc += frac * Math.PI * 2; // full extent so later slices keep their position
    return { s, i, a0, a1, frac };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: vertical ? 28 : 36 }}>
      <svg width={size} height={size} style={{ overflow: "visible" }}>
        <circle cx={cx} cy={cy} r={(R + r) / 2} fill="none" stroke={TRACK} strokeWidth={R - r} />
        {slices.map(({ i, a0, a1 }) =>
          a1 > a0 ? <path key={i} d={arc(cx, cy, R, r, a0, a1)} fill={PALETTE[i % PALETTE.length]} /> : null,
        )}
        {spec.centerLabel ? (
          <text x={cx} y={cy} fill="#fff" fontSize={centerSize} fontWeight={800} textAnchor="middle" dominantBaseline="central">
            {spec.centerLabel}
          </text>
        ) : null}
      </svg>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: vertical ? "1fr 1fr" : "repeat(3, auto)",
          gap: vertical ? "12px 32px" : "14px 48px",
        }}
      >
        {slices.map(({ s, i, frac }) => {
          const shown = countUp(frac * 100, frame, 6, 30);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  background: PALETTE[i % PALETTE.length],
                  flex: "0 0 auto",
                }}
              />
              <span style={{ fontSize: legendSize, color: LABEL }}>{s.label}</span>
              <span style={{ fontSize: legendSize, color: TEXT, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {shown.toFixed(1)}
                {spec.unit ?? "%"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
