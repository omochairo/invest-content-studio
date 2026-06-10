/**
 * TEMP diagnostic: find a Gemini model with non-zero free-tier quota for this
 * key. gemini-2.0-flash returned free-tier limit:0; probe alternatives with a
 * 1-token request and report status per model. Delete once a model is chosen.
 *
 * Run: `npm run probe:gemini`  (needs GEMINI_API_KEY)
 */
try {
  process.loadEnvFile();
} catch {
  /* rely on real env */
}

const KEY = process.env.GEMINI_API_KEY;
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-flash-latest",
];

async function tryModel(model: string): Promise<void> {
  try {
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ok" }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    });
    const body = await res.text();
    const note = res.ok ? "OK" : body.replace(/\s+/g, " ").slice(0, 160);
    console.log(`[${res.status}] ${model}  ${note}`);
  } catch (err) {
    console.log(`[ERR] ${model}: ${err instanceof Error ? err.message : err}`);
  }
}

async function main(): Promise<void> {
  if (!KEY) throw new Error("GEMINI_API_KEY not set");
  // Which models does the key even see?
  try {
    const res = await fetch(`${BASE}/models?key=${KEY}&pageSize=100`);
    const data = (await res.json()) as { models?: { name: string }[] };
    const names = (data.models ?? [])
      .map((m) => m.name.replace("models/", ""))
      .filter((n) => n.includes("flash"))
      .join(", ");
    console.log(`ListModels flash: ${names || "(none/err)"}\n`);
  } catch {
    console.log("ListModels failed\n");
  }
  for (const m of MODELS) await tryModel(m);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
