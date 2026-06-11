/**
 * Domain-agnostic visual treatment derived from ContentPackage data.
 *
 * The renderer must stay free of domain concepts (earnings "beat/miss",
 * toys, ...). Instead we read the *shape* of the data a scene carries —
 * the sign of its headline number, whether values are signed deltas — and
 * map that to a visual TONE (accent color, background tint, motion). A bar
 * trending up reads "positive" whether it is an EPS surprise or a toy's
 * review score delta, so this stays reusable across domains.
 */
import type { Asset, AssetSpec, ChartSpec } from "@ics/shared";

export type ToneKey = "positive" | "negative" | "neutral";

export interface Tone {
  key: ToneKey;
  /** Accent for title bars, hero number, chips. */
  accent: string;
  /** Background gradient stops (top -> bottom), tinted toward the tone. */
  bgFrom: string;
  bgTo: string;
}

const BASE = "#0b1220";
export const TONES: Record<ToneKey, Tone> = {
  positive: { key: "positive", accent: "#3fb950", bgFrom: "#0c2016", bgTo: BASE },
  negative: { key: "negative", accent: "#f85149", bgFrom: "#21121a", bgTo: BASE },
  neutral: { key: "neutral", accent: "#4a8fe0", bgFrom: "#0d1626", bgTo: BASE },
};

/** The scene's headline bar: the first bar (generators put the lead metric
 *  first). Returns null for non-bar specs or empty charts. */
export function headlineBar(spec: AssetSpec | undefined): ChartSpec["bars"][number] | null {
  if (!spec || spec.kind !== "bar" || spec.bars.length === 0) return null;
  return spec.bars[0] ?? null;
}

/** Derive a tone from the data a scene carries. Signed bar charts color by
 *  the headline bar's sign; everything else is neutral (no fake sentiment). */
export function toneForAsset(asset: Asset | undefined): Tone {
  const spec = asset?.spec;
  if (spec?.kind === "bar" && (spec.signed ?? true)) {
    const head = headlineBar(spec);
    if (head) return head.value >= 0 ? TONES.positive : TONES.negative;
  }
  return TONES.neutral;
}

/** A CSS linear-gradient string for a tone's background. */
export function bgGradient(tone: Tone): string {
  return `linear-gradient(160deg, ${tone.bgFrom} 0%, ${tone.bgTo} 60%)`;
}

/** Format a signed bar value the same way the Chart does, so the hero number
 *  and the chart row never disagree (e.g. "+1.2%", "-2.0%"). */
export function formatBarValue(
  value: number,
  unit: string | undefined,
  signed: boolean,
): string {
  const sign = signed && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}${unit ?? ""}`;
}

// Intra-scene cross-dissolve length. MUST stay <= the PAD_MS silence appended
// after each narration clip (PAD_MS=350ms ≈ 10.5f @30fps), so the fade-out sits
// in silence and never clips speech. See #35 design invariant B (audio sync).
export const SCENE_FADE_FRAMES = 8;

// Brand sequences (silent, additive, fixed-length). Imported by Root.tsx so the
// total-duration math (calculateMetadata) shares a single source of truth.
export const BUMPER_FRAMES = 45; // 1.5s @30fps
export const ENDCARD_FRAMES = 75; // 2.5s @30fps

// Channel chrome (domain-neutral on purpose: the same renderer serves toys too,
// so no investment vocabulary here). channelName is a placeholder — confirm.
export const BRAND = {
  channelName: "IC Studio",
  tagline: "データで読み解く",
  ctaPrimary: "チャンネル登録で最新をチェック",
  ctaSecondary: "詳細・出典は概要欄から",
};
