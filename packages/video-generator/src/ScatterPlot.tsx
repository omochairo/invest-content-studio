import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveLabelPositions, type ScatterSpec } from "@ics/shared";

const AXIS = "#33425a";
const GRID = "#1b2838";
const TEXT = "#cdd9e5";
const LABEL = "#9fb3c8";
// Domain-neutral categorical palette (a position on two axes carries no
// sentiment, so we do not reuse the green/red tone colors here).
const PALETTE = ["#4a8fe0", "#3fb950", "#d29922", "#a371f7", "#db61a2", "#56d4dd", "#e0734a", "#7ee787"];

/** Extend [min,max] by a margin so points never sit on the frame edge. */
function bounds(vals: number[], mid: number | null | undefined): [number, number] {
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (mid != null) {
    lo = Math.min(lo, mid);
    hi = Math.max(hi, mid);
  }
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
  return [lo - pad, hi + pad];
}

/** 2-axis scatter (多社横比較). Points pop in with a staggered spring; optional
 *  median lines split the plane into quadrants and an optional y=x diagonal
 *  draws a reference. Domain-agnostic: the renderer only positions labeled
 *  points on two linear axes — no 割安/割高 meaning is attached here. */
export const ScatterPlot = ({ spec }: { spec: ScatterSpec }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const vertical = width < 1300;

  const W = vertical ? width - 120 : 1180;
  const H = vertical ? 760 : 640;
  const PL = vertical ? 96 : 110; // left pad (y axis)
  const PB = vertical ? 96 : 92; // bottom pad (x axis)
  const PT = 40;
  const PR = vertical ? 56 : 80;
  const plotW = W - PL - PR;
  const plotH = H - PT - PB;

  const pts = spec.points;
  const [xlo, xhi] = bounds(pts.map((p) => p.x), spec.xMid);
  const [ylo, yhi] = bounds(pts.map((p) => p.y), spec.yMid);
  const sx = (x: number) => PL + ((x - xlo) / (xhi - xlo || 1)) * plotW;
  const sy = (y: number) => PT + plotH - ((y - ylo) / (yhi - ylo || 1)) * plotH;

  const dotR = vertical ? 12 : 13;
  const labelSize = vertical ? 26 : 30;
  const axisSize = vertical ? 26 : 30;
  const tickSize = vertical ? 22 : 24;
  const fmt = (v: number, unit?: string) => `${Number(v.toFixed(1))}${unit ?? ""}`;

  // Reveal: axes/quadrants fade first, then dots pop staggered.
  const frameIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      {/* quadrant tint + median dividers */}
      {spec.xMid != null && (
        <line x1={sx(spec.xMid)} y1={PT} x2={sx(spec.xMid)} y2={PT + plotH}
          stroke={GRID} strokeWidth={2} strokeDasharray="6 8" opacity={frameIn} />
      )}
      {spec.yMid != null && (
        <line x1={PL} y1={sy(spec.yMid)} x2={PL + plotW} y2={sy(spec.yMid)}
          stroke={GRID} strokeWidth={2} strokeDasharray="6 8" opacity={frameIn} />
      )}
      {spec.diagonal && (
        <line
          x1={sx(Math.max(xlo, ylo))} y1={sy(Math.max(xlo, ylo))}
          x2={sx(Math.min(xhi, yhi))} y2={sy(Math.min(xhi, yhi))}
          stroke="#56d4dd" strokeWidth={2} strokeDasharray="4 6" opacity={frameIn * 0.7} />
      )}

      {/* axes */}
      <line x1={PL} y1={PT} x2={PL} y2={PT + plotH} stroke={AXIS} strokeWidth={2} />
      <line x1={PL} y1={PT + plotH} x2={PL + plotW} y2={PT + plotH} stroke={AXIS} strokeWidth={2} />

      {/* axis corner tick values */}
      <text x={PL} y={PT + plotH + tickSize + 6} fill={LABEL} fontSize={tickSize} textAnchor="middle">{fmt(xlo, spec.xUnit)}</text>
      <text x={PL + plotW} y={PT + plotH + tickSize + 6} fill={LABEL} fontSize={tickSize} textAnchor="middle">{fmt(xhi, spec.xUnit)}</text>
      <text x={PL - 12} y={PT + plotH} fill={LABEL} fontSize={tickSize} textAnchor="end" dominantBaseline="central">{fmt(ylo, spec.yUnit)}</text>
      <text x={PL - 12} y={PT} fill={LABEL} fontSize={tickSize} textAnchor="end" dominantBaseline="central">{fmt(yhi, spec.yUnit)}</text>

      {/* axis titles */}
      {spec.xLabel && (
        <text x={PL + plotW / 2} y={H - 14} fill={TEXT} fontSize={axisSize} fontWeight={700} textAnchor="middle">{spec.xLabel}</text>
      )}
      {spec.yLabel && (
        <text x={26} y={PT + plotH / 2} fill={TEXT} fontSize={axisSize} fontWeight={700} textAnchor="middle"
          transform={`rotate(-90 26 ${PT + plotH / 2})`}>{spec.yLabel}</text>
      )}

      {/* points — label y positions are decluttered (文字重なり自動回避) per
          horizontal cluster on the shared layout layer: labels only collide when
          their dots are close in BOTH axes, so we group points whose label boxes
          overlap in x and resolve overlaps within each group, leaving distant
          labels untouched. A leader line bridges any label nudged off its dot. */}
      {(() => {
        const charW = labelSize * 0.62; // CJK/latin mix estimate
        const dots = pts.map((p, i) => {
          const cx = sx(p.x);
          const cy = sy(p.y);
          const below = cy - 30 < PT;
          const ly = below ? cy + dotR + labelSize : cy - dotR - 10;
          return { p, i, cx, cy, below, ly, w: Math.max(p.label.length * charW, dotR * 4) };
        });
        const byX = [...dots].sort((a, b) => a.cx - b.cx);
        const clusters: (typeof dots)[] = [];
        let cur: typeof dots = [];
        let curRight = -Infinity;
        for (const d of byX) {
          if (cur.length && d.cx - d.w / 2 > curRight) {
            clusters.push(cur);
            cur = [];
          }
          cur.push(d);
          curRight = Math.max(curRight, d.cx + d.w / 2);
        }
        if (cur.length) clusters.push(cur);
        const lyById = new Map<number, number>();
        for (const cl of clusters) {
          if (cl.length === 1) {
            lyById.set(cl[0]!.i, cl[0]!.ly);
            continue;
          }
          const resolved = resolveLabelPositions(
            cl.map((d) => ({ target: d.ly, size: labelSize + 4 })),
            { gap: 4, min: PT + labelSize / 2, max: PT + plotH + PB - labelSize },
          );
          cl.forEach((d, k) => lyById.set(d.i, resolved[k]!));
        }
        return dots.map(({ p, i, cx, cy }) => {
          const pop = spring({ frame: frame - 10 - i * 4, fps, config: { damping: 14, stiffness: 120 } });
          const color = PALETTE[i % PALETTE.length];
          const ly = lyById.get(i) ?? cy - dotR - 10;
          const drift = Math.abs(ly - cy) > dotR + labelSize;
          return (
            <g key={i} opacity={Math.min(1, pop)}>
              <circle cx={cx} cy={cy} r={dotR * 2.2} fill={color} opacity={0.18 * pop} />
              <circle cx={cx} cy={cy} r={dotR * pop} fill={color} stroke="#0b1220" strokeWidth={2} />
              {drift && (
                <line x1={cx} y1={cy} x2={cx} y2={ly + (ly > cy ? -labelSize * 0.7 : labelSize * 0.3)}
                  stroke={color} strokeWidth={1.5} opacity={0.5 * pop} />
              )}
              <text x={cx} y={ly} fill="#fff" fontSize={labelSize} fontWeight={800} textAnchor="middle">{p.label}</text>
            </g>
          );
        });
      })()}
    </svg>
  );
};
