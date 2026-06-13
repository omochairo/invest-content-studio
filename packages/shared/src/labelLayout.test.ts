import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLabelPositions, type LabelAnchor } from "./labelLayout";

/** True iff no two labels overlap given their sizes and the required gap. */
function noOverlap(centres: number[], anchors: LabelAnchor[], gap = 0): boolean {
  const order = anchors.map((_, i) => i).sort((i, j) => centres[i] - centres[j]);
  for (let k = 1; k < order.length; k++) {
    const a = order[k - 1];
    const b = order[k];
    const need = (anchors[a].size + anchors[b].size) / 2 + gap;
    if (centres[b] - centres[a] < need - 1e-6) return false;
  }
  return true;
}

test("returns [] for no anchors and the target for a single anchor", () => {
  assert.deepEqual(resolveLabelPositions([]), []);
  assert.deepEqual(resolveLabelPositions([{ target: 42, size: 20 }]), [42]);
});

test("leaves well-separated labels exactly on their targets", () => {
  const anchors: LabelAnchor[] = [
    { target: 0, size: 20 },
    { target: 100, size: 20 },
    { target: 200, size: 20 },
  ];
  assert.deepEqual(resolveLabelPositions(anchors), [0, 100, 200]);
});

test("separates two overlapping labels symmetrically around their mean", () => {
  // both want y=100, each 30 tall → need 30 apart → 85 / 115 (mean preserved)
  const anchors: LabelAnchor[] = [
    { target: 100, size: 30 },
    { target: 100, size: 30 },
  ];
  const out = resolveLabelPositions(anchors);
  assert.ok(noOverlap(out, anchors));
  assert.ok(Math.abs((out[0] + out[1]) / 2 - 100) < 1e-6);
  assert.ok(Math.abs(Math.abs(out[1] - out[0]) - 30) < 1e-6);
});

test("declutters a tight cluster of thin-segment labels (the ProportionBox case)", () => {
  const anchors: LabelAnchor[] = [
    { target: 300, size: 26 },
    { target: 312, size: 26 },
    { target: 320, size: 26 },
    { target: 500, size: 26 },
  ];
  const out = resolveLabelPositions(anchors, { gap: 4 });
  assert.ok(noOverlap(out, anchors, 4));
  // the lone far label is untouched
  assert.ok(Math.abs(out[3] - 500) < 1e-6);
});

test("keeps output in input order regardless of target order", () => {
  const anchors: LabelAnchor[] = [
    { target: 320, size: 26 },
    { target: 300, size: 26 },
    { target: 310, size: 26 },
  ];
  const out = resolveLabelPositions(anchors, { gap: 4 });
  assert.equal(out.length, 3);
  // input[0] had the largest target, so it stays the largest centre
  assert.ok(out[0] > out[2]);
  assert.ok(out[2] > out[1]);
  assert.ok(noOverlap(out, anchors, 4));
});

test("shifts the block down to honour a min bound", () => {
  const anchors: LabelAnchor[] = [
    { target: 5, size: 20 },
    { target: 12, size: 20 },
  ];
  const out = resolveLabelPositions(anchors, { min: 10 });
  assert.ok(noOverlap(out, anchors));
  assert.ok(out[0] - anchors[0].size / 2 >= 10 - 1e-6);
});

test("shifts the block up to honour a max bound", () => {
  const anchors: LabelAnchor[] = [
    { target: 590, size: 20 },
    { target: 598, size: 20 },
  ];
  const out = resolveLabelPositions(anchors, { max: 600 });
  assert.ok(noOverlap(out, anchors));
  assert.ok(out[1] + anchors[1].size / 2 <= 600 + 1e-6);
});
