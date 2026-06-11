import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { GaugeSpec } from "@ics/shared";
import { countUp } from "./useCountUp";

const TRACK = "#1b2838";
const FILL = "#4a8fe0";
const LABEL = "#9fb3c8";

/** Point on a circle at angle `a` (radians). */
function pt(cx: number, cy: number, rad: number, a: number) {
  return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) };
}

/** Single-value semicircular gauge (one headline ratio). Domain-agnostic: the
 *  renderer only positions `value` within [min, max]. The needle/fill sweep in
 *  and the value counts up to the exact reading on settle. */
export const Gauge = ({ spec }: { spec: GaugeSpec }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const vertical = width < 1300;

  const min = spec.min ?? 0;
  const max = spec.max ?? 100;
  const frac = Math.max(0, Math.min(1, (spec.value - min) / (max - min || 1)));

  const size = vertical ? 460 : 520;
  const cx = size / 2;
  const cy = size * 0.62;
  const R = size / 2 - 40;
  const stroke = vertical ? 36 : 44;

  // 180° arc from left (π) to right (2π=0), swept clockwise over the top.
  const a0 = Math.PI;
  const sweep = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 40 });
  const aFill = a0 + Math.PI * frac * sweep;

  const start = pt(cx, cy, R, a0);
  const end = pt(cx, cy, R, a0 + Math.PI); // full track end (right)
  const fillEnd = pt(cx, cy, R, aFill);
  const large = frac * sweep > 0.5 ? 1 : 0;

  const valueSize = vertical ? 88 : 104;
  const labelSize = vertical ? 30 : 36;
  const shown = countUp(spec.value, frame, 6, 30);
  const decimals = (String(spec.value).split(".")[1] ?? "").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={size} height={size * 0.74} style={{ overflow: "visible" }}>
        {/* track (full semicircle) */}
        <path
          d={`M ${start.x} ${start.y} A ${R} ${R} 0 1 1 ${end.x} ${end.y}`}
          fill="none"
          stroke={TRACK}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* filled progress */}
        {frac * sweep > 0.001 ? (
          <path
            d={`M ${start.x} ${start.y} A ${R} ${R} 0 ${large} 1 ${fillEnd.x} ${fillEnd.y}`}
            fill="none"
            stroke={FILL}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        ) : null}
        {/* center value */}
        <text x={cx} y={cy - valueSize * 0.1} fill="#fff" fontSize={valueSize} fontWeight={800} textAnchor="middle" dominantBaseline="alphabetic">
          {shown.toFixed(decimals)}
          {spec.unit ?? ""}
        </text>
      </svg>
      {spec.label ? <div style={{ fontSize: labelSize, color: LABEL, marginTop: 8 }}>{spec.label}</div> : null}
    </div>
  );
};
