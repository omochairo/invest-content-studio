# Audio bed assets (#34)

`bgm.wav` / `se-transition.wav` / `se-reveal.wav` are the channel-level BGM and
sound effects mixed at render time by `AudioBed.tsx` (BGM ducks under narration;
SE fire at scene boundaries and count-up reveals).

> [!IMPORTANT]
> The committed files are **placeholders**, algorithmically synthesized by
> `scripts/gen-placeholder-bed.mjs` (so they carry no third-party rights). They
> are intentionally quiet and unremarkable. **Replace them with real
> royalty-free / CC0 assets before publishing**, keeping the same filenames.

Regenerate the placeholders: `npm run gen:bed` (from `packages/video-generator`).

Volumes and the SE timing model live in `src/theme.ts` (`BGM_BASE`, `BGM_DUCK`,
`BGM_RAMP_FRAMES`, `SE_VOLUME`, `SE_FRAMES`) and `src/audioMix.ts`.
