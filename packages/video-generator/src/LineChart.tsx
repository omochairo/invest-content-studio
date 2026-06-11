import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { LineSpec } from "@ics/shared";

const LINE = "#3fb950";
const GRID = "#1b2838";
const TEXT = "#cdd9e5";

/** Data-driven trend line (e.g. multi-year revenue). The polyline draws in
 *  left-to-right via stroke-dashoffset, points pop in with a staggered spring. */
export const LineChart = ({ spec }: { spec: LineSpec }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  // 縦横判定 (1080x1920 = 縦型, 1920x1080 = 横型)
  const vertical = width < 1300;

  // レスポンシブ用パラメータの設定
  const W = vertical ? width - 144 : 1240;
  const H = vertical ? 450 : 540;
  const PAD = vertical ? 64 : 80;

  const valueSize = vertical ? 28 : 36;
  const labelSize = vertical ? 26 : 32;
  const circleRadius = vertical ? 8 : 10;
  const valueOffset = vertical ? 20 : 26;
  const labelOffset = vertical ? 34 : 44;

  const pts = spec.points;
  const max = Math.max(...pts.map((p) => p.value), 1);
  const min = Math.min(...pts.map((p) => p.value), 0);
  const span = max - min || 1;

  const xy = pts.map((p, i) => {
    const x = PAD + (i / Math.max(pts.length - 1, 1)) * (W - PAD * 2);
    const y = H - PAD - ((p.value - min) / span) * (H - PAD * 2);
    return { x, y, p };
  });

  const draw = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 40 });
  const path = xy.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  // Approximate path length for the dash animation (sum of segment lengths).
  let len = 0;
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[i - 1];
    if (a && b) len += Math.hypot(a.x - b.x, a.y - b.y);
  }

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      {/* baseline */}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={GRID} strokeWidth={2} />
      <path
        d={path}
        fill="none"
        stroke={LINE}
        strokeWidth={6}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={len}
        strokeDashoffset={len * (1 - draw)}
      />
      {xy.map((c, i) => {
        const pop = spring({ frame: frame - i * 6, fps, config: { damping: 200 } });
        return (
          <g key={i} opacity={pop}>
            <circle cx={c.x} cy={c.y} r={circleRadius} fill={LINE} />
            <text x={c.x} y={c.y - valueOffset} fill="#fff" fontSize={valueSize} fontWeight={800} textAnchor="middle">
              {c.p.value}
              {spec.unit ?? ""}
            </text>
            <text x={c.x} y={H - PAD + labelOffset} fill={TEXT} fontSize={labelSize} textAnchor="middle">
              {c.p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
