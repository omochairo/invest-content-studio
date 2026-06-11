import { test } from "node:test";
import assert from "node:assert/strict";
import type { AudioManifest, ContentPackage } from "./index";
import { sceneTimings } from "./sceneTiming";

function pkg(narrationIndexes: number[]): ContentPackage {
  return {
    meta: { title: "t", lang: "ja", format: "wide", disclaimer: "d", sources: [] },
    narration: narrationIndexes.map((i) => ({ text: `line ${i}` })),
    scenes: narrationIndexes.map((i) => ({ narrationIndex: i, caption: "c" })),
    assets: [],
  };
}

function manifest(durs: number[]): AudioManifest {
  return {
    speaker: 1,
    sampleRate: 24000,
    clips: durs.map((durationMs, index) => ({ index, file: `audio/line-${index}.wav`, durationMs })),
  };
}

test("sceneTimings - absolute layout from a manifest (bumper offset, frame math)", () => {
  const t = sceneTimings(pkg([0, 1, 2]), manifest([2000, 3000, 1000]));
  // frames: ceil((dur+350)/1000*30); start cursor begins at bumperFrames=45.
  assert.deepEqual(t.map((s) => s.startFrame), [45, 116, 217]);
  assert.deepEqual(t.map((s) => s.totalFrames), [71, 101, 41]);
  assert.equal(t[0]!.narrationFrames, 60); // ceil(2000/1000*30)
  // ms = round(frame * 1000/30); first scene sits right after the 1.5s bumper.
  assert.deepEqual(t.map((s) => s.startMs), [1500, 3867, 7233]);
});

test("sceneTimings - falls back to estMs when no manifest (studio preview)", () => {
  const t = sceneTimings(pkg([0, 1, 2]), null);
  assert.deepEqual(t.map((s) => s.startFrame), [45, 146, 247]); // 101 frames each
  assert.deepEqual(t.map((s) => s.narrationFrames), [0, 0, 0]);
});

test("sceneTimings - matches clips by narrationIndex, not array position", () => {
  // Scenes reference narration out of order; each must pick its own clip.
  const t = sceneTimings(pkg([2, 0]), manifest([1000, 9999, 5000]));
  assert.equal(t[0]!.totalFrames, 161); // index 2 -> 5000ms -> ceil(5350/1000*30)
  assert.equal(t[1]!.totalFrames, 41); //  index 0 -> 1000ms -> ceil(1350/1000*30)
});
