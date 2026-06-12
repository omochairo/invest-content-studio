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
  /** Optional chapter label for long-form layouts (e.g. "財務"). Short. */
  section?: string | null;
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
  /** When true (default), values are signed deltas: "+"/"-" prefix and
   *  green/red coloring (e.g. daily % change). Set false for absolute
   *  magnitudes (e.g. PER, counts) — no sign prefix, neutral coloring. */
  signed?: boolean;
  bars: ChartBar[];
}

/** A point in a trend line (e.g. revenue by fiscal year). */
export interface LinePoint {
  label: string;
  value: number;
}

/** Declarative trend-line spec (e.g. multi-year revenue / profit). */
export interface LineSpec {
  kind: "line";
  /** Unit suffix shown on the axis/values, e.g. "兆円". */
  unit?: string;
  points: LinePoint[];
}

/** One headline metric in a stat grid (e.g. PER, 自己資本比率). */
export interface StatItem {
  label: string;
  /** Pre-formatted display value (kept as a string so the renderer never
   *  reformats a load-bearing number). */
  value: string;
  /** Optional small note under the value (e.g. "前年比" or a source year). */
  note?: string | null;
}

/** Declarative grid of headline metrics. */
export interface StatGridSpec {
  kind: "stats";
  items: StatItem[];
}

/** One slice of a donut (e.g. a revenue segment, a category share). */
export interface DonutSegment {
  label: string;
  /** Raw magnitude. The renderer normalizes the segments to a total, so the
   *  generator may emit either absolute amounts or pre-computed shares. */
  value: number;
}

/** Declarative composition (part-to-whole) spec, drawn as a donut. The
 *  renderer derives each arc from value / sum(values) — it never assumes the
 *  values already sum to 100, so this stays domain-agnostic. */
export interface DonutSpec {
  kind: "donut";
  /** Unit suffix shown on legend values, e.g. "%" or "億円". */
  unit?: string;
  segments: DonutSegment[];
  /** Optional label inside the ring (e.g. a total). Text-only; the renderer
   *  never reformats a load-bearing number, so pass it pre-formatted. */
  centerLabel?: string | null;
}

/** One bar in a waterfall (bridge) chart. */
export interface WaterfallStep {
  label: string;
  /** A signed delta by default (added to the running cumulative). When
   *  `isTotal` is true this is an absolute value drawn from the baseline
   *  (e.g. an opening/closing total), not a delta. */
  value: number;
  /** True = an absolute total/subtotal column sitting on the baseline. */
  isTotal?: boolean;
}

/** Declarative increment/decrement decomposition, drawn as a waterfall. The
 *  renderer tracks the running cumulative and colors deltas by sign (up/down);
 *  no domain meaning is attached to the direction. */
export interface WaterfallSpec {
  kind: "waterfall";
  /** Unit suffix shown on values, e.g. "億円". */
  unit?: string;
  steps: WaterfallStep[];
}

/** Declarative single-value gauge (one headline ratio, e.g. a %). Domain-
 *  agnostic: the renderer only knows value within [min, max]. */
export interface GaugeSpec {
  kind: "gauge";
  /** Current value. */
  value: number;
  /** Scale bounds. Default 0..100 when omitted. */
  min?: number;
  max?: number;
  /** Unit suffix shown with the value, e.g. "%". */
  unit?: string;
  /** Optional metric name shown under the gauge. */
  label?: string | null;
}

/** One segment within a proportional column (e.g. a balance-sheet line group). */
export interface ProportionSegment {
  label: string;
  /** Raw magnitude in the spec's shared unit. Must be >= 0 (a stack height has
   *  no sign). The renderer scales every segment of every column by one
   *  value→pixel ratio, so thicknesses and column heights are comparable. */
  value: number;
}

/** One column = a labeled stack of segments (e.g. "資産" or "負債・純資産"). */
export interface ProportionColumn {
  label: string;
  segments: ProportionSegment[];
}

/** Declarative proportional stacked-columns spec (比例縮尺). Every segment of
 *  every column shares one value→pixel scale, so two columns with equal totals
 *  render at equal height — the signature balance-sheet box (資産 | 負債・純資産),
 *  but domain-agnostic: the renderer only knows "N columns of non-negative
 *  stacks on a shared scale", so any part-to-whole comparison can reuse it. */
export interface ProportionSpec {
  kind: "proportion";
  /** Unit suffix shown on values, e.g. "億ドル" / "億円". */
  unit?: string;
  columns: ProportionColumn[];
}

/** Any data-driven visual. Discriminated by `kind`. All variants are
 *  domain-agnostic so omochairo (toys) can reuse the same renderer. */
export type AssetSpec =
  | ChartSpec
  | LineSpec
  | StatGridSpec
  | DonutSpec
  | WaterfallSpec
  | GaugeSpec
  | ProportionSpec;

export interface Asset {
  id: string;
  type: "chart" | "line" | "stats" | "image" | "donut" | "waterfall" | "gauge" | "proportion";
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
