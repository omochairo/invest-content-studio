# Audio bed assets (#34)

`bgm.mp3` / `se-transition.wav` / `se-reveal.wav` are the channel-level BGM and
sound effects mixed at render time by `AudioBed.tsx` (BGM ducks under narration;
SE fire at scene boundaries and count-up reveals). Remotion `<Audio loop>` plays
mp3 natively, so the BGM needs no wav transcode.

## Current assets (#58)

- `bgm.mp3` — **real royalty-free BGM** (no attribution required). Primary track,
  wired via `BGM_FILE` in `src/theme.ts`.
- `bgm-alt.mp3` — a second royalty-free track kept for variety. **Not wired**;
  swap it with `bgm.mp3` (or repoint `BGM_FILE`) to use it.
- `se-transition.wav` / `se-reveal.wav` — still the algorithmically synthesized
  placeholders from `scripts/gen-placeholder-bed.mjs` (no third-party rights).
  Short blips; replace with real SE when available, keeping the same filenames.

Regenerate the SE placeholders: `npm run gen:bed` (from `packages/video-generator`).

Volumes and the SE timing model live in `src/theme.ts` (`BGM_BASE`, `BGM_DUCK`,
`BGM_RAMP_FRAMES`, `SE_VOLUME`, `SE_FRAMES`) and `src/audioMix.ts`. BGM volumes
are deliberately conservative so narration always sits clearly on top of a real
(spectrally dense) music track.
