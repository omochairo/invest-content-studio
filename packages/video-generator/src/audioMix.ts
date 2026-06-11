/** 1 シーンの絶対 frame レイアウト。呼び出し側（コンポジション）が構築して渡す。 */
export interface SceneSpan {
  startFrame: number;       // このシーンの Series.Sequence が始まる絶対 frame
  narrationFrames: number;  // ナレーション音声の長さ(frame)。無音シーンは 0
  totalFrames: number;      // シーンのシーケンス尺(frame, narration+pad)
  revealFrame?: number | null; // カウントアップ完了の絶対 frame（hero bar のみ）。無ければ null
}

export interface DuckOpts {
  base: number;       // 無音区間の BGM 音量 (例 0.18)
  duckTo: number;     // ナレーション区間の BGM 音量 (例 0.06)
  rampFrames: number; // base<->duckTo の遷移 frame 数 (例 6)
}

export type SeKind = "transition" | "reveal";
export interface SeTrigger {
  frame: number;
  kind: SeKind;
}

export function bgmVolumeAt(
  frame: number,
  spans: SceneSpan[],
  opts: DuckOpts
): number {
  const { base, duckTo, rampFrames } = opts;
  if (rampFrames <= 0) {
    let isNarrating = false;
    for (const span of spans) {
      if (span.narrationFrames > 0) {
        const start = span.startFrame;
        const end = start + span.narrationFrames;
        if (frame >= start && frame < end) {
          isNarrating = true;
          break;
        }
      }
    }
    return isNarrating ? duckTo : base;
  }

  let maxDuckIntensity = 0;

  for (const span of spans) {
    if (span.narrationFrames <= 0) {
      continue;
    }

    const start = span.startFrame;
    const end = start + span.narrationFrames;

    let intensity = 0;
    if (frame >= start && frame < end) {
      intensity = 1;
    } else if (frame >= start - rampFrames && frame < start) {
      intensity = (frame - (start - rampFrames)) / rampFrames;
    } else if (frame >= end && frame < end + rampFrames) {
      intensity = 1 - (frame - end) / rampFrames;
    }

    if (intensity > maxDuckIntensity) {
      maxDuckIntensity = intensity;
    }
  }

  if (maxDuckIntensity < 0) maxDuckIntensity = 0;
  if (maxDuckIntensity > 1) maxDuckIntensity = 1;

  const volume = base + maxDuckIntensity * (duckTo - base);

  const minVol = Math.min(base, duckTo);
  const maxVol = Math.max(base, duckTo);
  if (volume < minVol) return minVol;
  if (volume > maxVol) return maxVol;
  return volume;
}

export function seTriggers(spans: SceneSpan[]): SeTrigger[] {
  const triggers: SeTrigger[] = [];

  spans.forEach((span, index) => {
    if (index > 0) {
      triggers.push({
        frame: span.startFrame,
        kind: "transition",
      });
    }

    if (span.revealFrame !== undefined && span.revealFrame !== null) {
      triggers.push({
        frame: span.revealFrame,
        kind: "reveal",
      });
    }
  });

  return triggers.sort((a, b) => {
    if (a.frame !== b.frame) {
      return a.frame - b.frame;
    }
    if (a.kind === b.kind) {
      return 0;
    }
    return a.kind === "transition" ? -1 : 1;
  });
}
