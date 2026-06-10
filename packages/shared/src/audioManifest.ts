/**
 * AudioManifest — output of the TTS step, input to the renderer.
 *
 * The TTS step (audio-generator) synthesizes one WAV per narration line and
 * records its measured duration here. The renderer (video-generator) reads
 * this to derive each scene's length and the total video duration, so audio
 * and video stay in sync without hand-authored timings.
 */

export interface AudioClip {
  /** Index into ContentPackage.narration. */
  index: number;
  /** WAV filename, relative to the renderer's public dir (e.g. "audio/line-0.wav"). */
  file: string;
  /** Measured playback duration in milliseconds. */
  durationMs: number;
}

export interface AudioManifest {
  /** VOICEVOX speaker id used for synthesis. */
  speaker: number;
  /** Sample rate of the synthesized WAVs (Hz). */
  sampleRate: number;
  clips: AudioClip[];
}
