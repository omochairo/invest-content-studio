import { test } from "node:test";
import assert from "node:assert/strict";
import { bgmVolumeAt, seTriggers, SceneSpan, DuckOpts } from "./audioMix";

test("bgmVolumeAt - basic volume levels", () => {
  const spans: SceneSpan[] = [
    { startFrame: 0, narrationFrames: 30, totalFrames: 60 },
  ];
  const opts: DuckOpts = { base: 0.2, duckTo: 0.1, rampFrames: 10 };

  assert.equal(bgmVolumeAt(50, spans, opts), 0.2);
  assert.equal(bgmVolumeAt(15, spans, opts), 0.1);
});

test("bgmVolumeAt - linear ramp transition", () => {
  const spans: SceneSpan[] = [
    { startFrame: 20, narrationFrames: 30, totalFrames: 60 },
  ];
  const opts: DuckOpts = { base: 0.2, duckTo: 0.1, rampFrames: 10 };

  assert.equal(bgmVolumeAt(10, spans, opts), 0.2);
  assert.ok(Math.abs(bgmVolumeAt(15, spans, opts) - 0.15) < 1e-9);
  assert.equal(bgmVolumeAt(20, spans, opts), 0.1);

  assert.equal(bgmVolumeAt(50, spans, opts), 0.1);
  assert.ok(Math.abs(bgmVolumeAt(55, spans, opts) - 0.15) < 1e-9);
  assert.equal(bgmVolumeAt(60, spans, opts), 0.2);
});

test("bgmVolumeAt - range clamping", () => {
  const spans: SceneSpan[] = [
    { startFrame: 10, narrationFrames: 20, totalFrames: 40 },
  ];
  const opts: DuckOpts = { base: 0.2, duckTo: 0.1, rampFrames: 5 };

  assert.equal(bgmVolumeAt(0, spans, opts), 0.2);
  assert.equal(bgmVolumeAt(38, spans, opts), 0.2);
});

test("seTriggers - transitions and reveals", () => {
  const spans: SceneSpan[] = [
    { startFrame: 0, narrationFrames: 30, totalFrames: 60 },
    { startFrame: 60, narrationFrames: 40, totalFrames: 110, revealFrame: 80 },
    { startFrame: 110, narrationFrames: 0, totalFrames: 140, revealFrame: 110 },
  ];

  const triggers = seTriggers(spans);

  assert.equal(triggers.length, 4);
  assert.deepEqual(triggers[0], { frame: 60, kind: "transition" });
  assert.deepEqual(triggers[1], { frame: 80, kind: "reveal" });
  assert.deepEqual(triggers[2], { frame: 110, kind: "transition" });
  assert.deepEqual(triggers[3], { frame: 110, kind: "reveal" });
});
