import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { WaterfallSpec } from "@ics/shared";

const UP = "#3fb950";
const DOWN = "#f85149";
const TOTAL = "#4a8fe0";
const GRID = "#1b2838";
const TEXT = "#cdd9e5";

/** Increment/decrement decomposition (bridge). Each non-total step floats from
 *  the running cumulative; total steps sit on the baseline. Deltas color by
 *  sign (up/down); the direction carries no domain meaning. Bars grow in with a
 *  staggered spring; a still on a settled frame shows the exact values. */
export const Waterfall = ({ spec }: { spec: WaterfallSpec }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const vertical = width < 1300;

  const W = vertical ? width - 144 : 1240;
  const H = vertical ? 480 : 540;
  const PAD = vertical ? 64 : 80;
  const valueSize = vertical ? 24 : 30;
  const labelSize = vertical ? 22 : 28;

  // Running cumulative -> each bar's [from, to] in data units.
  let run = 0;
  const bars = spec.steps.map((s) => {
    const from = s.isTotal ? 0 : run;
    const to = s.isTotal ? s.value : run + s.value;
    if (!s.isTotal) run += s.value;
    else run = s.value;
    return { s, from, to };
  });

  const tops = bars.flatMap((b) => [b.from, b.to]);
  const yMax = Math.max(...tops, 0);
  const yMin = Math.min(...tops, 0);
  const span = yMax - yMin || 1;
  const toY = (v: number) => H - PAD - ((v - yMin) / span) * (H - PAD * 2);

  const n = bars.length;
  const slot = (W - PAD * 2) / n;
  const barW = slot * 0.56;
  const decimals = Math.max(...spec.steps.map((s) => (String(s.value).split(".")[1] ?? "").length));

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      {/* zero baseline */}
      <line x1={PAD} y1={toY(0)} x2={W - PAD} y2={toY(0)} stroke={GRID} strokeWidth={2} />

      {bars.map((b, i) => {
        const grow = spring({ frame: frame - i * 5, fps, config: { damping: 200 }, durationInFrames: 26 });
        const x = PAD + slot * i + (slot - barW) / 2;
        const yTop = toY(Math.max(b.from, b.to));
        const yBot = toY(Math.min(b.from, b.to));
        const fullH = yBot - yTop;
        const h = Math.max(fullH * grow, 1);
        const color = b.s.isTotal ? TOTAL : b.s.value >= 0 ? UP : DOWN;
        // connector to the next bar's starting cumulative
        const next = bars[i + 1];
        const connY = toY(b.to);
        const connX0 = x + barW;
        const connX1 = PAD + slot * (i + 1) + (slot - barW) / 2;

        const sign = b.s.isTotal ? "" : b.s.value >= 0 ? "+" : "";
        const valText = `${sign}${b.s.value.toFixed(decimals)}${spec.unit ?? ""}`;

        return (
          <g key={i}>
            {next ? (
              <line
                x1={connX0}
                y1={connY}
                x2={connX1}
                y2={connY}
                stroke={GRID}
                strokeWidth={2}
                strokeDasharray="4 4"
                opacity={grow}
              />
            ) : null}
            <rect x={x} y={yBot - h} width={barW} height={h} rx={4} fill={color} />
            <text
              x={x + barW / 2}
              y={(b.to >= b.from ? yTop : yBot) - 12}
              fill="#fff"
              fontSize={valueSize}
              fontWeight={800}
              textAnchor="middle"
              opacity={grow}
            >
              {valText}
            </text>
            <text x={x + barW / 2} y={H - PAD + (vertical ? 34 : 42)} fill={TEXT} fontSize={labelSize} textAnchor="middle">
              {b.s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
