import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { LineSpec } from "@ics/shared";
import { countUp } from "./useCountUp";

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

  // 面塗り用クローズドパス (baseline: H - PAD)
  const firstPt = xy[0];
  const lastPt = xy[xy.length - 1];
  const areaPath = firstPt && lastPt
    ? `${path} L ${lastPt.x} ${H - PAD} L ${firstPt.x} ${H - PAD} Z`
    : "";

  // Approximate path length for the dash animation (sum of segment lengths).
  let len = 0;
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[i - 1];
    if (a && b) len += Math.hypot(a.x - b.x, a.y - b.y);
  }

  // 小数点桁数を判定する関数
  const getDecimals = (val: number) => (String(val).split(".")[1] ?? "").length;

  // 成長デルタバッジ用計算
  const first = pts[0] as typeof pts[number] | undefined;
  const last = pts[pts.length - 1] as typeof pts[number] | undefined;
  const delta = (last?.value ?? 0) - (first?.value ?? 0);
  const deltaDecimals = Math.max(...pts.map((p) => getDecimals(p.value)));

  const badgeText = `${delta >= 0 ? "▲ +" : "▼ "}${delta.toFixed(deltaDecimals)}${spec.unit ?? ""}`;
  const badgeColor = delta >= 0 ? "#3fb950" : "#f85149";

  const badgeW = vertical ? 110 : 130;
  const badgeH = vertical ? 34 : 40;
  const badgeFontSize = vertical ? 16 : 20;

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      <defs>
        {/* 面塗り用のグラデーション */}
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={LINE} stopOpacity={0.28} />
          <stop offset="100%" stopColor={LINE} stopOpacity={0.0} />
        </linearGradient>
        {/* 線描画と同期するためのクリップパス */}
        <clipPath id="chartClip">
          <rect x="0" y="0" width={PAD + (W - PAD * 2) * draw} height={H} />
        </clipPath>
        {/* 最新点用のグローフィルター */}
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      {/* baseline */}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={GRID} strokeWidth={2} />

      {/* 面塗り領域 */}
      <path
        d={areaPath}
        fill="url(#areaGrad)"
        clipPath="url(#chartClip)"
        opacity={draw}
      />

      {/* 折れ線 */}
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
        const decimals = getDecimals(c.p.value);
        const shownVal = Number(countUp(c.p.value, frame - i * 6, 0, 20).toFixed(decimals));

        const isLast = i === pts.length - 1;
        const currentRadius = isLast ? circleRadius * 1.3 : circleRadius;

        return (
          <g key={i} opacity={pop}>
            {/* 最新点のグロー効果 */}
            {isLast && (
              <circle
                cx={c.x}
                cy={c.y}
                r={circleRadius * 2.2}
                fill={LINE}
                opacity={0.4}
                filter="url(#glow)"
              />
            )}

            <circle cx={c.x} cy={c.y} r={currentRadius} fill={LINE} />
            <text x={c.x} y={c.y - valueOffset} fill="#fff" fontSize={valueSize} fontWeight={800} textAnchor="middle">
              {shownVal}
              {spec.unit ?? ""}
            </text>
            <text x={c.x} y={H - PAD + labelOffset} fill={TEXT} fontSize={labelSize} textAnchor="middle">
              {c.p.label}
            </text>

            {/* 最新点上部の成長デルタバッジ */}
            {isLast && (
              <g transform={`translate(${c.x}, ${c.y - valueOffset - (vertical ? 48 : 58)})`}>
                <rect
                  x={-badgeW / 2}
                  y={-badgeH / 2}
                  width={badgeW}
                  height={badgeH}
                  rx={badgeH / 2}
                  fill={badgeColor}
                />
                <text
                  fill="#fff"
                  fontSize={badgeFontSize}
                  fontWeight={800}
                  textAnchor="middle"
                  dominantBaseline="central"
                  y={1} // 垂直方向の微調整
                >
                  {badgeText}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
};

