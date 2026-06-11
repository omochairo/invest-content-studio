// Generate PLACEHOLDER, CC0 (algorithmically synthesized) audio bed assets for
// #34: a soft looping BGM pad + two short SE one-shots. These are intentionally
// quiet and unremarkable — replace them with real royalty-free assets before
// publishing (see public/bed/README.md). Self-generated tones carry no rights.
//
// Run: node scripts/gen-placeholder-bed.mjs   (writes public/bed/*.wav)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "public", "bed");
const RATE = 32000;

/** Write mono 16-bit PCM samples (Float -1..1) as a canonical WAV file. */
function writeWav(path, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
  console.log(`  wrote ${path} (${(data.length / 1024).toFixed(0)}KB)`);
}

const TAU = Math.PI * 2;

// BGM: 4.0s loop. Frequencies + tremolo chosen so the buffer holds an integer
// number of cycles -> the end meets the start seamlessly when looped.
function bgm() {
  const dur = 4.0;
  const n = Math.round(RATE * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const pad =
      Math.sin(TAU * 110 * t) * 0.5 + // A2
      Math.sin(TAU * 165 * t) * 0.35 + // E3
      Math.sin(TAU * 220 * t) * 0.2; // A3
    const tremolo = 0.85 + 0.15 * Math.sin(TAU * 0.25 * t); // 1 cycle / 4s
    out[i] = pad * 0.08 * tremolo; // very quiet bed
  }
  return out;
}

// SE transition: ~140ms soft filtered-noise "whoosh" with a fast decay.
function seTransition() {
  const dur = 0.14;
  const n = Math.round(RATE * dur);
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const env = Math.exp(-i / (n * 0.25));
    const noise = Math.random() * 2 - 1;
    prev = prev * 0.85 + noise * 0.15; // crude low-pass -> softer
    out[i] = prev * env * 0.35;
  }
  return out;
}

// SE reveal: ~260ms bright two-tone "ding" with an exponential decay.
function seReveal() {
  const dur = 0.26;
  const n = Math.round(RATE * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.exp(-i / (n * 0.3));
    const tone = Math.sin(TAU * 880 * t) * 0.6 + Math.sin(TAU * 1320 * t) * 0.4;
    out[i] = tone * env * 0.3;
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
console.log("Generating placeholder bed assets ->", OUT);
writeWav(join(OUT, "bgm.wav"), bgm());
writeWav(join(OUT, "se-transition.wav"), seTransition());
writeWav(join(OUT, "se-reveal.wav"), seReveal());
console.log("Done. Replace these with real royalty-free assets before publishing.");
