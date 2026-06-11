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

// Channel chrome for the investment channel "決算図解室" (#58, confirmed).
// The renderer itself stays domain-neutral so it can be reused for toys later
// (逆輸入); when that happens, parameterize BRAND per channel rather than
// hardcoding here — these values are investment-specific on purpose.
export const BRAND = {
  channelName: "決算図解室",
  tagline: "図解でわかる決算速報",
  ctaPrimary: "チャンネル登録で最新をチェック",
  ctaSecondary: "詳細・出典は概要欄から",
};

// Audio bed (#34): channel chrome, mixed at render time. The files in public/bed/
// are domain-neutral (no music "meaning" in ContentPackage). Volumes are mixing-
// layer concerns, not domain data. bgm.mp3 is a royalty-free track (#58); Remotion
// <Audio loop> plays mp3 natively so no wav transcode is needed. bgm-alt.mp3 is a
// second track kept for variety (not wired). Volumes are conservative on purpose:
// a mastered music track is far denser in the vocal band than the old sine
// placeholder, so narration must stay clearly on top.
export const BGM_FILE = "bed/bgm.mp3";
export const SE_TRANSITION_FILE = "bed/se-transition.wav";
export const SE_REVEAL_FILE = "bed/se-reveal.wav";
export const BGM_BASE = 0.15; // BGM volume in silence (~ -16 dBFS mult)
export const BGM_DUCK = 0.045; // ducked under narration (~ -27 dBFS mult)
export const BGM_RAMP_FRAMES = 6; // base<->duck ramp
export const SE_VOLUME = 0.5;
export const SE_FRAMES = 12; // one-shot SE sequence length
