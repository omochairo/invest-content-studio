/**
 * ContentPackage — the domain-agnostic contract (SPEC.md §3).
 *
 * This is the most important type in the project. Both the investment
 * pipeline ("market data -> ContentPackage") and, later, omochairo
 * ("toy data -> ContentPackage") emit this same shape, so the SAME
 * renderer (Remotion) and TTS layer can consume either. Keep this type
 * free of domain-specific (investment / toy) concepts.
 *
 * Scene duration is intentionally NOT authored here: it is derived from
 * the synthesized narration audio (see AudioManifest). The renderer reads
 * the manifest to size each scene and the total video length.
 */

export type VideoFormat = "short" | "wide";

/** A cited primary source. Required by the compliance gate (AGENTS.md §2.2). */
export interface Source {
  label: string;
  url: string;
}

export interface ContentMeta {
  title: string;
  /** BCP-47-ish language tag, e.g. "ja". */
  lang: string;
  /** "short" = 1080x1920 vertical, "wide" = 1920x1080. */
  format: VideoFormat;
  /** Mandatory disclaimer overlaid on every output (compliance). */
  disclaimer: string;
  /** At least one primary-source link is required (compliance). */
  sources: Source[];
}

/** One spoken line. `text` is sent to TTS; `ssml` is an optional override. */
export interface NarrationLine {
  text: string;
  ssml?: string | null;
}

/**
 * One on-screen scene. Aligns to a narration line by index; the scene's
 * duration equals that line's synthesized audio length (+ padding).
 */
export interface Scene {
  /** Index into ContentPackage.narration this scene speaks. */
  narrationIndex: number;
  /** On-screen caption (telop). Kept short for vertical layout. */
  caption: string;
  /** Asset id to display during this scene, or null for text-only. */
  visualRef?: string | null;
}

/** A single bar in a bar chart (e.g. an index's daily % change). */
export interface ChartBar {
  label: string;
  value: number;
}

/** Declarative chart spec. Rendered as a data-driven animation by Remotion. */
export interface ChartSpec {
  kind: "bar";
  /** Unit suffix shown on values, e.g. "%". */
  unit?: string;
  bars: ChartBar[];
}

export type AssetSpec = ChartSpec;

export interface Asset {
  id: string;
  type: "chart" | "image";
  spec: AssetSpec;
}

export interface ContentPackage {
  meta: ContentMeta;
  narration: NarrationLine[];
  scenes: Scene[];
  assets: Asset[];
}

/** Look up an asset by id (used by the renderer to resolve Scene.visualRef). */
export function findAsset(
  pkg: ContentPackage,
  id: string | null | undefined,
): Asset | undefined {
  if (!id) return undefined;
  return pkg.assets.find((a) => a.id === id);
}
