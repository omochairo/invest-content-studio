/**
 * VOICEVOX TTS step (Phase 0).
 *
 * Reads a ContentPackage, synthesizes one WAV per narration line via the
 * VOICEVOX engine (audio_query -> synthesis), writes the WAVs and an
 * AudioManifest into the renderer's public dir. The manifest's measured
 * durations drive scene timing in the Remotion composition.
 *
 * Env:
 *   VOICEVOX_URL      base URL of the engine (default http://localhost:50021)
 *                     e.g. http://<NAS-IP>:50021 when running on the NAS Docker
 *   VOICEVOX_SPEAKER  speaker id (default 2 = 四国めたん ノーマル)
 *
 * Run from repo root: `npm run tts`
 */
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type {
  AudioClip,
  AudioManifest,
  ContentPackage,
} from "@ics/shared";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.VOICEVOX_URL ?? "http://localhost:50021").replace(/\/$/, "");
const SPEAKER = Number(process.env.VOICEVOX_SPEAKER ?? "2");

const INPUT = resolve(HERE, "../../shared/samples/market-recap.json");
const OUT_DIR = resolve(HERE, "../../video-generator/public/audio");

/** Parse a canonical PCM WAV header to compute playback duration (ms). */
function wavDurationMs(buf: Buffer): { durationMs: number; sampleRate: number } {
  // Scan chunks after the 12-byte RIFF/WAVE header.
  let offset = 12;
  let sampleRate = 24000;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      sampleRate = buf.readUInt32LE(offset + 12);
      byteRate = buf.readUInt32LE(offset + 16);
    } else if (id === "data") {
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned
  }
  const durationMs = byteRate > 0 ? Math.round((dataSize / byteRate) * 1000) : 0;
  return { durationMs, sampleRate };
}

async function postJson(path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`VOICEVOX ${path} -> HTTP ${res.status} ${res.statusText}`);
  }
  return res;
}

async function synthesizeLine(text: string): Promise<Buffer> {
  // 1) audio_query: build the synthesis query from text.
  const queryRes = await postJson(
    `/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(text)}`,
  );
  const query = await queryRes.json();
  // 2) synthesis: render the query to a WAV.
  const wavRes = await postJson(`/synthesis?speaker=${SPEAKER}`, query);
  return Buffer.from(await wavRes.arrayBuffer());
}

async function main(): Promise<void> {
  const pkg = JSON.parse(await readFile(INPUT, "utf8")) as ContentPackage;
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`VOICEVOX: ${BASE} (speaker ${SPEAKER}), ${pkg.narration.length} lines`);

  const clips: AudioClip[] = [];
  let sampleRate = 24000;
  for (let i = 0; i < pkg.narration.length; i++) {
    const line = pkg.narration[i]!;
    const wav = await synthesizeLine(line.text);
    const file = `audio/line-${i}.wav`;
    await writeFile(resolve(OUT_DIR, `line-${i}.wav`), wav);
    const { durationMs, sampleRate: sr } = wavDurationMs(wav);
    sampleRate = sr;
    clips.push({ index: i, file, durationMs });
    console.log(`  [${i}] ${durationMs}ms  "${line.text.slice(0, 24)}…"`);
  }

  const manifest: AudioManifest = { speaker: SPEAKER, sampleRate, clips };
  await writeFile(
    resolve(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  const totalMs = clips.reduce((s, c) => s + c.durationMs, 0);
  console.log(`Wrote ${clips.length} WAV(s) + manifest.json (total ${totalMs}ms) -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
