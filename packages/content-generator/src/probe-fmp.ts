/**
 * TEMP diagnostic: discover which FMP endpoints this API key's plan allows.
 * Legacy /api/v3 returns 403 on newer keys; FMP migrated to /stable. Prints
 * HTTP status and the JSON shape (keys) of each candidate — never the URL (the
 * key lives in the query string). Delete once fetch-earnings.ts is migrated.
 *
 * Run: `npm run probe`  (needs FMP_API_KEY)
 */
try {
  process.loadEnvFile();
} catch {
  /* rely on real env */
}

const KEY = process.env.FMP_API_KEY;
const SYM = process.argv[2] ?? "NVDA";

const candidates: { label: string; url: string }[] = [
  { label: "v3 quote", url: `https://financialmodelingprep.com/api/v3/quote/${SYM}` },
  { label: "stable quote", url: `https://financialmodelingprep.com/stable/quote?symbol=${SYM}` },
  { label: "stable profile", url: `https://financialmodelingprep.com/stable/profile?symbol=${SYM}` },
  { label: "stable earnings", url: `https://financialmodelingprep.com/stable/earnings?symbol=${SYM}` },
  {
    label: "stable earnings-surprises",
    url: `https://financialmodelingprep.com/stable/earnings-surprises?symbol=${SYM}`,
  },
  {
    label: "stable analyst-estimates",
    url: `https://financialmodelingprep.com/stable/analyst-estimates?symbol=${SYM}&period=annual&limit=2`,
  },
  {
    label: "stable income-statement",
    url: `https://financialmodelingprep.com/stable/income-statement?symbol=${SYM}&limit=2`,
  },
  {
    label: "stable sec-filings-search/symbol",
    url: `https://financialmodelingprep.com/stable/sec-filings-search/symbol?symbol=${SYM}&from=2024-01-01&to=2026-06-10&page=0&limit=5`,
  },
  {
    label: "stable sec-filings-8k",
    url: `https://financialmodelingprep.com/stable/sec-filings-8k?from=2026-01-01&to=2026-06-10&page=0&limit=5`,
  },
];

function shape(json: unknown): string {
  const first = Array.isArray(json) ? json[0] : json;
  if (first && typeof first === "object") {
    const keys = Object.keys(first as Record<string, unknown>).slice(0, 30).join(", ");
    const sample = JSON.stringify(first).slice(0, 400);
    return `keys=[${keys}]\n      sample=${sample}`;
  }
  return JSON.stringify(json).slice(0, 200);
}

async function main(): Promise<void> {
  if (!KEY) throw new Error("FMP_API_KEY not set");
  console.log(`FMP probe for ${SYM}\n`);
  for (const { label, url } of candidates) {
    const sep = url.includes("?") ? "&" : "?";
    try {
      const res = await fetch(`${url}${sep}apikey=${KEY}`);
      const text = await res.text();
      let detail = "";
      try {
        detail = res.ok ? shape(JSON.parse(text)) : text.slice(0, 200);
      } catch {
        detail = text.slice(0, 200);
      }
      console.log(`[${res.status}] ${label}\n      ${detail}\n`);
    } catch (err) {
      console.log(`[ERR] ${label}: ${err instanceof Error ? err.message : err}\n`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
