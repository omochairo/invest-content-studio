import { test } from "node:test";
import assert from "node:assert/strict";
import type { AudioManifest, ContentPackage, Scene } from "@ics/shared";
import { buildChapters, buildYouTubeMeta } from "./youtube-meta";

function pkg(scenes: Scene[], format: "short" | "wide" = "wide"): ContentPackage {
  return {
    meta: {
      title: "  株式会社サンプル 決算速報  ",
      lang: "ja",
      format,
      disclaimer: "本コンテンツは情報提供を目的としたものです。投資判断はご自身で。",
      sources: [{ label: "決算短信", url: "https://example.com/tanshin.pdf" }],
    },
    narration: scenes.map((s) => ({ text: `ナレーション${s.narrationIndex}` })),
    scenes,
    assets: [],
  };
}

/** Clips long enough (10s) that single-scene chapters clear the 10s minimum. */
function manifest(n: number): AudioManifest {
  return {
    speaker: 1,
    sampleRate: 24000,
    clips: Array.from({ length: n }, (_, index) => ({
      index,
      file: `audio/line-${index}.wav`,
      durationMs: 10000,
    })),
  };
}

const longForm: Scene[] = [
  { narrationIndex: 0, caption: "c", section: "イントロ" },
  { narrationIndex: 1, caption: "c", section: "事業" },
  { narrationIndex: 2, caption: "c", section: "事業" }, // same section -> no new chapter
  { narrationIndex: 3, caption: "c", section: "財務" },
  { narrationIndex: 4, caption: "c", section: "まとめ" },
  { narrationIndex: 5, caption: "c", section: "まとめ" },
];

test("buildChapters - groups sections, first at 0:00, aligned to scene starts", () => {
  const chapters = buildChapters(pkg(longForm), manifest(6));
  assert.deepEqual(chapters.map((c) => c.label), ["イントロ", "事業", "財務", "まとめ"]);
  assert.equal(chapters[0]!.timestamp, "0:00"); // bumper folded into the intro
  assert.equal(chapters[0]!.startMs, 0);
  // ascending and on real scene boundaries (11.8s / 32.6s / 43.0s).
  assert.equal(chapters[1]!.timestamp, "0:11");
  assert.equal(chapters[2]!.timestamp, "0:32");
  assert.ok(chapters.every((c, i) => i === 0 || c.startMs > chapters[i - 1]!.startMs));
});

test("buildChapters - omitted when there are no sections (e.g. a short)", () => {
  const short: Scene[] = [0, 1, 2, 3, 4].map((i) => ({ narrationIndex: i, caption: "c" }));
  assert.deepEqual(buildChapters(pkg(short, "short"), manifest(5)), []);
});

test("buildChapters - omitted when fewer than three chapters", () => {
  const two: Scene[] = [
    { narrationIndex: 0, caption: "c", section: "イントロ" },
    { narrationIndex: 1, caption: "c", section: "まとめ" },
  ];
  assert.deepEqual(buildChapters(pkg(two), manifest(2)), []);
});

test("buildChapters - short scenes coalesce; omitted if < 3 valid chapters", () => {
  const fast = manifest(6);
  fast.clips.forEach((c) => (c.durationMs = 3000)); // each scene ~3.3s
  // Sub-10s sections merge into the previous chapter, leaving too few to qualify.
  assert.deepEqual(buildChapters(pkg(longForm), fast), []);
});

test("buildChapters - absorbs a single-scene section under 10s into the prior chapter", () => {
  // Mirrors the long-form sample: イントロ, 事業×2, 財務×2, 評価, リスク, まとめ×2.
  const scenes: Scene[] = [
    { narrationIndex: 0, caption: "c", section: "イントロ" },
    { narrationIndex: 1, caption: "c", section: "事業" },
    { narrationIndex: 2, caption: "c", section: "事業" },
    { narrationIndex: 3, caption: "c", section: "財務" },
    { narrationIndex: 4, caption: "c", section: "財務" },
    { narrationIndex: 5, caption: "c", section: "評価" },
    { narrationIndex: 6, caption: "c", section: "リスク" },
    { narrationIndex: 7, caption: "c", section: "まとめ" },
    { narrationIndex: 8, caption: "c", section: "まとめ" },
  ];
  const m = manifest(9);
  m.clips.forEach((c) => (c.durationMs = 9000)); // ~9.4s each -> single-scene sections too short
  const chapters = buildChapters(pkg(scenes), m);
  // 財務 (2 scenes) is long enough, so 評価 opens a chapter; 評価 alone is < 10s,
  // so the following リスク scene is absorbed into the 評価 chapter (label = 評価).
  assert.deepEqual(chapters.map((c) => c.label), ["イントロ", "事業", "財務", "評価", "まとめ"]);
  assert.ok(chapters.every((c, i) => i === 0 || c.startMs - chapters[i - 1]!.startMs >= 10000));
});

test("buildYouTubeMeta - title trimmed, compliance + lead + hashtags in description", () => {
  const meta = buildYouTubeMeta(pkg(longForm), manifest(6), { symbol: "6758" });
  assert.equal(meta.title, "株式会社サンプル 決算速報");
  assert.ok(meta.description.startsWith("ナレーション0")); // lead = first narration line
  assert.ok(meta.description.includes("▼ チャプター"));
  assert.ok(meta.description.includes("0:00 イントロ"));
  assert.ok(meta.description.includes("― 出典 ―"));
  assert.ok(meta.description.includes("https://example.com/tanshin.pdf"));
  assert.ok(meta.description.includes("投資判断はご自身で")); // disclaimer
  assert.ok(meta.description.includes("#決算"));
});

test("buildYouTubeMeta - tags are deterministic and format-aware", () => {
  const wide = buildYouTubeMeta(pkg(longForm), manifest(6), { symbol: "6758" });
  assert.ok(wide.tags.includes("企業解説") && wide.tags.includes("6758"));
  const short = buildYouTubeMeta(pkg(longForm, "short"), null, { symbol: "NVDA" });
  assert.ok(short.tags.includes("Shorts") && short.tags.includes("NVDA"));
  assert.equal(new Set(short.tags).size, short.tags.length); // no dupes
});
