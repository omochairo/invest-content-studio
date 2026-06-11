import { Audio, Sequence, staticFile } from "remotion";
import { bgmVolumeAt, type SceneSpan, seTriggers } from "./audioMix";
import {
  BGM_BASE,
  BGM_DUCK,
  BGM_FILE,
  BGM_RAMP_FRAMES,
  SE_FRAMES,
  SE_REVEAL_FILE,
  SE_TRANSITION_FILE,
  SE_VOLUME,
} from "./theme";

/**
 * BGM + SE bed (#34). A render-time audio layer that sits OUTSIDE the scene
 * <Series>, so it spans the whole timeline in absolute frames:
 *
 *  - BGM: one looping track whose volume ducks under narration. The duck timing
 *    comes from the same SceneSpan[] the compositions build, so picture and
 *    audio never disagree. Narration <Audio> lives in the scenes and is never
 *    touched here — only the BGM is attenuated (#34 invariant B: total length
 *    and per-scene narration timing are unchanged; this is an additive layer).
 *  - SE: short one-shots at scene boundaries (transition) and count-up reveals.
 *
 * Domain-agnostic: nothing here reads investment/toy concepts — only frame
 * timings and channel-level asset paths (theme.ts).
 */
export const AudioBed = ({ spans }: { spans: SceneSpan[] }) => {
  const triggers = seTriggers(spans);
  return (
    <>
      <Audio
        src={staticFile(BGM_FILE)}
        loop
        volume={(f) =>
          bgmVolumeAt(f, spans, {
            base: BGM_BASE,
            duckTo: BGM_DUCK,
            rampFrames: BGM_RAMP_FRAMES,
          })
        }
      />
      {triggers.map((t, i) => (
        <Sequence
          key={`se-${t.kind}-${t.frame}-${i}`}
          from={t.frame}
          durationInFrames={SE_FRAMES}
        >
          <Audio
            src={staticFile(
              t.kind === "transition" ? SE_TRANSITION_FILE : SE_REVEAL_FILE,
            )}
            volume={SE_VOLUME}
          />
        </Sequence>
      ))}
    </>
  );
};
