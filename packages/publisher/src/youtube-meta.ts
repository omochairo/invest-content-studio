/**
 * YouTube metadata builder (#38). Derives the title / description / tags /
 * chapter markers for an upload deterministically from a ContentPackage + its
 * AudioManifest.
 *
 * Compliance (AGENTS.md §2): the description is assembled only from already
 * gate-checked fields (title, narration) plus fixed, hand-controlled boilerplate
 * (sources, disclaimer, hashtags). It introduces no new prose, so it cannot
 * smuggle a prohibited phrase past the §2 gate — no second guard needed here.
 *
 * Chapters: timestamps come from @ics/shared `sceneTimings`, the same layout
 * math the renderer uses, so markers land exactly on scene boundaries.
 *
 * This module is investment-flavored (tags/hashtags) and so lives in publisher,
 * not in the domain-agnostic shared package.
 */
import type { AudioManifest, ContentPackage } from "@ics/shared";
import { sceneTimings } from "@ics/shared";

export interface Chapter {
  startMs: number;
  /** "M:SS" or "H:MM:SS". */
  timestamp: string;
  label: string;
}

export interface YouTubeMeta {
  title: string;
  description: string;
  tags: string[];
  chapters: Chapter[];
}

/** YouTube chapter rules: >= 3 markers, the first at 0:00, each >= 10s long. */
const MIN_CHAPTERS = 3;
const MIN_CHAPTER_MS = 10_000;

function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/**
 * Group scenes into chapter markers from their `section` labels. A new marker
 * opens at a section change only once the current chapter has run >= 10s; a
 * shorter section is absorbed into the current chapter. This coalescing is what
 * keeps every chapter >= 10s by construction — real narration scenes are often
 * ~5-9s, so single-scene sections (e.g. 評価/リスク) would otherwise be too short
 * and YouTube would reject the whole chapter list. Returns [] when the result
 * can't satisfy YouTube's rules (no sections, or < 3 valid chapters), so a video
 * without chapters simply gets none rather than broken ones.
 */
export function buildChapters(
  pkg: ContentPackage,
  manifest: AudioManifest | null,
): Chapter[] {
  if (!pkg.scenes.some((s) => s.section?.trim())) return [];
  const times = sceneTimings(pkg, manifest);

  const markers: { startMs: number; label: string }[] = [];
  pkg.scenes.forEach((scene, i) => {
    const section = scene.section?.trim();
    const startMs = times[i]?.startMs ?? 0;
    if (markers.length === 0) {
      // First chapter owns 0:00 (the silent bumper belongs to the intro).
      markers.push({ startMs: 0, label: section ?? "" });
      return;
    }
    const current = markers[markers.length - 1]!;
    const longEnough = startMs - current.startMs >= MIN_CHAPTER_MS;
    if (section && section !== current.label && longEnough) {
      markers.push({ startMs, label: section });
    }
  });

  // Drop a too-short final chapter (merge it back into the previous one).
  const last = times[times.length - 1];
  const videoEndMs = last ? last.startMs + last.durationMs : 0;
  while (markers.length > 1 && videoEndMs - markers[markers.length - 1]!.startMs < MIN_CHAPTER_MS)
    markers.pop();

  if (markers.length < MIN_CHAPTERS) return [];
  return markers.map((m) => ({
    startMs: m.startMs,
    timestamp: formatTimestamp(m.startMs),
    label: m.label,
  }));
}

function buildTags(pkg: ContentPackage, symbol: string): string[] {
  const fmt = pkg.meta.format === "short" ? "Shorts" : "企業解説";
  const raw = ["決算", "決算速報", "図解", "投資", "株式", fmt, symbol];
  return [...new Set(raw.map((t) => t.trim()).filter(Boolean))];
}

function buildDescription(
  pkg: ContentPackage,
  chapters: Chapter[],
): string {
  const lead = pkg.narration[0]?.text?.trim() ?? pkg.meta.title;
  const blocks: string[] = [lead];

  if (chapters.length > 0) {
    blocks.push(
      ["▼ チャプター", ...chapters.map((c) => `${c.timestamp} ${c.label}`)].join("\n"),
    );
  }

  const sources = pkg.meta.sources.map((s) => `・${s.label}: ${s.url}`).join("\n");
  blocks.push(["― 出典 ―", sources].join("\n"));
  blocks.push(pkg.meta.disclaimer);

  const tagWord = pkg.meta.format === "short" ? "Shorts" : "企業解説";
  blocks.push(`#決算 #決算速報 #投資 #${tagWord}`);

  return blocks.join("\n\n");
}

/** Build the full YouTube upload metadata for one ContentPackage. */
export function buildYouTubeMeta(
  pkg: ContentPackage,
  manifest: AudioManifest | null,
  opts: { symbol: string },
): YouTubeMeta {
  const chapters = buildChapters(pkg, manifest);
  return {
    title: pkg.meta.title.trim(),
    description: buildDescription(pkg, chapters),
    tags: buildTags(pkg, opts.symbol),
    chapters,
  };
}
