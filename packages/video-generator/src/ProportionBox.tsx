import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveLabelPositions, type ProportionSpec } from "@ics/shared";

const TEXT = "#cdd9e5";
const LABEL = "#9fb3c8";
const GRID = "#1b2838";
// Domain-neutral categorical palette (a stacked composition carries no
// sentiment), reused index-continuous across columns so every segment is a
// distinct, legend-free color. Matches Donut's palette so the two read as one
// visual language.
const PALETTE = ["#4a8fe0", "#56d4dd", "#d29922", "#a371f7", "#3fb950", "#db61a2"];

/** Proportional stacked columns (比例縮尺). Every segment of every column is
 *  drawn on ONE value→pixel scale, so two columns with equal totals reach equal
 *  height — the signature balance-sheet box (資産 = 負債 + 純資産 reads at a glance).
 *  Columns grow in with a staggered spring; a still on a settled frame shows the
 *  exact (load-bearing) values. Domain-agnostic: the renderer only knows "N
 *  columns of non-negative stacks on a shared scale". */
export const ProportionBox = ({ spec }: { spec: ProportionSpec }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const vertical = width < 1300;

  const cols = spec.columns;
  const unit = spec.unit ?? "";

  const W = vertical ? width - 144 : 1240;
  const H = vertical ? 560 : 600;
  const PAD = vertical ? 56 : 80;
  const TOP = vertical ? 84 : 96; // header: column name + total
  const BOT = 8;
  const chartTop = TOP;
  const chartBottom = H - BOT;
  const chartH = chartBottom - chartTop;

  const totals = cols.map((c) => c.segments.reduce((s, x) => s + x.value, 0));
  const maxTotal = Math.max(...totals, 0) || 1;
  const pxPerUnit = chartH / maxTotal;

  const n = Math.max(cols.length, 1);
  const slot = (W - PAD * 2) / n;
  const barW = Math.min(slot * 0.56, vertical ? 220 : 300);

  const allValues = cols.flatMap((c) => c.segments.map((s) => s.value));
  const decimals = Math.max(...allValues.map((v) => (String(v).split(".")[1] ?? "").length), 0);

  const nameSize = vertical ? 30 : 34;
  const totalSize = vertical ? 26 : 30;
  const segLabelSize = vertical ? 24 : 28;
  const segValueSize = vertical ? 22 : 26;

  // Running palette index across all columns so colors never repeat between
  // adjacent segments (assets vs liabilities/equity stay distinguishable).
  let colorIdx = 0;

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      {/* shared baseline both columns sit on */}
      <line x1={PAD} y1={chartBottom} x2={W - PAD} y2={chartBottom} stroke={GRID} strokeWidth={2} />

      {cols.map((col, ci) => {
        const grow = spring({ frame: frame - ci * 6, fps, config: { damping: 200 }, durationInFrames: 30 });
        const cx = PAD + slot * ci + slot / 2;
        const x = cx - barW / 2;
        const total = totals[ci] ?? 0;

        let yCursor = chartBottom;
        let settledCursor = chartBottom;
        const rects = col.segments.map((s, si) => {
          const fullH = s.value * pxPerUnit;
          const h = fullH * grow;
          const y = yCursor - h;
          yCursor -= h;
          // Settled (grow=1) mid-height: stable anchor for an escaped label so it
          // never jitters relative to its siblings while bars animate in.
          const settledMid = settledCursor - fullH / 2;
          settledCursor -= fullH;
          const color = PALETTE[colorIdx++ % PALETTE.length];
          const showInside = fullH > (vertical ? 56 : 60);
          return { s, si, y, h, fullH, color, showInside, settledMid };
        });

        // Thin segments escape their labels to the right; several thin segments
        // in a row would stack those labels on top of each other, so declutter
        // them on the shared label-layout layer and draw a leader line whenever a
        // label is pushed off its segment's mid-height.
        const escaped = rects.filter((r) => !r.showInside);
        const escapedY = resolveLabelPositions(
          escaped.map((r) => ({ target: r.settledMid, size: segValueSize + 8 })),
          { gap: 6, min: chartTop + segValueSize / 2, max: chartBottom - segValueSize / 2 },
        );
        const labelYBySeg = new Map<number, number>();
        escaped.forEach((r, k) => labelYBySeg.set(r.si, escapedY[k]!));

        return (
          <g key={ci}>
            {/* column header: name + total */}
            <text
              x={cx}
              y={chartTop - (vertical ? 44 : 52)}
              fill="#fff"
              fontSize={nameSize}
              fontWeight={800}
              textAnchor="middle"
              opacity={grow}
            >
              {col.label}
            </text>
            <text
              x={cx}
              y={chartTop - (vertical ? 14 : 18)}
              fill={LABEL}
              fontSize={totalSize}
              fontWeight={700}
              textAnchor="middle"
              opacity={grow}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {total.toFixed(decimals)}
              {unit}
            </text>

            {rects.map((r) => (
              <g key={r.si}>
                <rect x={x} y={r.y} width={barW} height={Math.max(r.h, 0)} fill={r.color} />
                {r.showInside ? (
                  <>
                    <text
                      x={cx}
                      y={r.y + r.h / 2 - 4}
                      fill="#fff"
                      fontSize={segLabelSize}
                      fontWeight={700}
                      textAnchor="middle"
                      dominantBaseline="central"
                      opacity={grow}
                    >
                      {r.s.label}
                    </text>
                    <text
                      x={cx}
                      y={r.y + r.h / 2 + segLabelSize - 2}
                      fill="#e6edf3"
                      fontSize={segValueSize}
                      textAnchor="middle"
                      dominantBaseline="central"
                      opacity={grow}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {r.s.value.toFixed(decimals)}
                      {unit}
                    </text>
                  </>
                ) : (
                  // Thin segment: label escapes to the right, decluttered against
                  // its siblings; a leader line bridges the gap when it is nudged
                  // off the segment's own mid-height.
                  (() => {
                    const ly = labelYBySeg.get(r.si) ?? r.settledMid;
                    const segMid = r.y + r.h / 2;
                    const lx = x + barW;
                    const drift = Math.abs(ly - segMid) > segValueSize * 0.6;
                    return (
                      <>
                        {drift && (
                          <polyline
                            points={`${lx},${segMid} ${lx + 8},${ly} ${lx + 12},${ly}`}
                            fill="none"
                            stroke={GRID}
                            strokeWidth={1.5}
                            opacity={grow}
                          />
                        )}
                        <text
                          x={lx + 14}
                          y={ly}
                          fill={TEXT}
                          fontSize={segValueSize}
                          textAnchor="start"
                          dominantBaseline="central"
                          opacity={grow}
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {r.s.label} {r.s.value.toFixed(decimals)}
                          {unit}
                        </text>
                      </>
                    );
                  })()
                )}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
};
