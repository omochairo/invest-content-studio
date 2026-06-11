import { type ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { VideoFormat } from "@ics/shared";
import type { Tone } from "./theme";

/** Numeric run = optional sign, digits (with grouping/decimals), optional unit.
 *  Keys purely off numeric SHAPE, never off what a number means, so it stays
 *  domain-agnostic (a "+6.3%" earnings delta and a "1.1兆円" revenue read alike). */
const NUM_RE = /([+\-±]?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|％|兆円|億円|万円|円|倍|ドル|pt|\$))?)/g;

/** Color the numeric runs of a caption with the tone accent so the figure
 *  pops out of the surrounding prose. Non-numeric text is left untouched. */
function withNumberAccent(text: string, accent: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  let i = 0;
  while ((m = NUM_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={i++} style={{ color: accent, fontWeight: 800 }}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const TELOP = {
  short: { fontSize: 56, bottom: 200, side: 56 },
  wide: { fontSize: 52, bottom: 150, side: 96 },
} as const;
const HERO = { short: 84, wide: 92 } as const;

type Props = {
  text: string;
  tone: Tone;
  format: VideoFormat;
  /** Scene-level fade (0..1) the parent already computed; used by the telop. */
  enter: number;
};

/** Bottom telop band: dark pill, centered, numbers accented, balanced wrap. */
export const Telop = ({ text, tone, format, enter }: Props) => {
  const s = TELOP[format];
  return (
    <div
      style={{
        position: "absolute",
        left: s.side,
        right: s.side,
        bottom: s.bottom,
        textAlign: "center",
        fontSize: s.fontSize,
        fontWeight: 800,
        color: "#fff",
        background: "rgba(0,0,0,0.45)",
        borderRadius: 20,
        padding: "18px 28px",
        opacity: enter,
        textWrap: "balance",
        wordBreak: "keep-all",
        overflowWrap: "anywhere",
        lineHeight: 1.25,
      }}
    >
      {withNumberAccent(text, tone.accent)}
    </div>
  );
};

/** Center "hero" caption for text-only scenes: phrases reveal one-by-one
 *  (kinetic typography) so a wall of text never lands all at once. Phrases are
 *  split on Japanese punctuation / spaces — structural, not domain-specific. */
export const HeroCaption = ({ text, tone, format }: Omit<Props, "enter">) => {
  const frame = useCurrentFrame();
  // Chunk into phrases at punctuation / whitespace boundaries while KEEPING the
  // original characters (trailing space/punct stay on their chunk) so the
  // caption text is never silently altered. Captions with no breaks reveal as
  // one chunk — still fades/blurs in, just not phrase-by-phrase.
  const phrases = text.match(/[^、。！？!?\s]+[、。！？!?]*\s*/g) ?? [text];
  const fontSize = HERO[format];
  return (
    <div
      style={{
        fontSize,
        fontWeight: 800,
        color: "#fff",
        textAlign: "center",
        lineHeight: 1.35,
        padding: "0 60px",
        textWrap: "balance",
        wordBreak: "keep-all",
        overflowWrap: "anywhere",
      }}
    >
      {phrases.map((p, i) => {
        const start = 6 + i * 8;
        const reveal = interpolate(frame, [start, start + 14], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <span
            key={i}
            style={{
              display: "inline",
              opacity: reveal,
              // settles upward into place as it fades in
              filter: `blur(${(1 - reveal) * 6}px)`,
            }}
          >
            {withNumberAccent(p, tone.accent)}
          </span>
        );
      })}
    </div>
  );
};
