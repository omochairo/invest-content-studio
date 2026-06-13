/** Shared label-collision layout (文字重なり自動回避).
 *
 *  Renderers place value/text labels at a *desired* position (the centre of the
 *  segment, dot, or step they annotate). When several of those desired spots
 *  fall close together the labels overlap and the frame becomes unreadable. This
 *  module is the single, domain-agnostic place that resolves such collisions: it
 *  takes the desired positions along ONE axis and nudges them the minimum amount
 *  needed so no two labels overlap, keeping every label as near its anchor as
 *  possible. Pure & deterministic — no rendering, no React — so it unit-tests in
 *  isolation and a still on any frame is reproducible.
 *
 *  The signature consumer is ProportionBox's "thin segment → escape to the
 *  right" labels (several thin segments stack their right-side labels on top of
 *  each other); the same helper declutters ScatterPlot point labels. */

export interface LabelAnchor {
  /** Desired centre along the layout axis (e.g. y in px). */
  target: number;
  /** Full extent of the label along that axis (e.g. its line height in px). */
  size: number;
}

export interface ResolveOptions {
  /** Extra breathing room enforced between adjacent labels, in px. */
  gap?: number;
  /** Optional lower bound for the near edge of the first label. */
  min?: number;
  /** Optional upper bound for the far edge of the last label. */
  max?: number;
}

/** Isotonic (non-decreasing) regression by pool-adjacent-violators. Returns the
 *  closest non-decreasing sequence to `values` in least-squares — the core that
 *  makes the declutter minimal-displacement rather than a greedy push. */
function isotonicNonDecreasing(values: number[]): number[] {
  const blocks: { sum: number; count: number }[] = [];
  for (const v of values) {
    blocks.push({ sum: v, count: 1 });
    while (blocks.length >= 2) {
      const a = blocks[blocks.length - 2]!;
      const b = blocks[blocks.length - 1]!;
      if (a.sum / a.count <= b.sum / b.count) break;
      blocks.pop();
      a.sum += b.sum;
      a.count += b.count;
    }
  }
  const out: number[] = [];
  for (const b of blocks) {
    const mean = b.sum / b.count;
    for (let k = 0; k < b.count; k++) out.push(mean);
  }
  return out;
}

/** Resolve 1-D label centres so no two labels overlap, each kept as close to its
 *  desired `target` as possible (minimum total squared displacement). Output is
 *  in the SAME order as the input anchors. Best-effort bounds: if `min`/`max` are
 *  given the whole solved block is shifted to fit (overlap-free is preserved);
 *  when there are more labels than fit, it overflows rather than overlapping. */
export function resolveLabelPositions(anchors: LabelAnchor[], opts: ResolveOptions = {}): number[] {
  const n = anchors.length;
  if (n === 0) return [];
  if (n === 1) return [anchors[0]!.target];
  const gap = opts.gap ?? 0;

  // Work in target order; remember the original slot to unsort at the end.
  const order = anchors.map((_, i) => i).sort((i, j) => anchors[i]!.target - anchors[j]!.target || i - j);
  const sorted = order.map((i) => anchors[i]!);

  // Subtract the cumulative minimum separation so the non-overlap constraint
  // c[i+1] >= c[i] + sep[i] collapses to "transformed sequence non-decreasing".
  const offset: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const sep = (sorted[i - 1]!.size + sorted[i]!.size) / 2 + gap;
    offset[i] = offset[i - 1]! + sep;
  }
  const transformed = sorted.map((a, i) => a.target - offset[i]!);
  const solved = isotonicNonDecreasing(transformed);
  let result = solved.map((v, i) => v + offset[i]!);

  // Best-effort bounds: a constant shift keeps the spacing (and thus non-overlap).
  if (opts.min != null) {
    const lowEdge = result[0]! - sorted[0]!.size / 2;
    if (lowEdge < opts.min) result = result.map((v) => v + (opts.min! - lowEdge));
  }
  if (opts.max != null) {
    const highEdge = result[n - 1]! + sorted[n - 1]!.size / 2;
    if (highEdge > opts.max) result = result.map((v) => v - (highEdge - opts.max!));
  }

  const out: number[] = new Array(n);
  order.forEach((origIdx, sortedIdx) => {
    out[origIdx] = result[sortedIdx]!;
  });
  return out;
}
