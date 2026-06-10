/**
 * Phase 2 (2a) field-discovery probe — TEMPORARY, deleted once the real
 * fetch-jp-equity.ts is built. Hits J-Quants v2 (x-api-key) and the
 * ラジ株ナビ MCP (Bearer) for Toyota (7203) and prints HTTP status + the
 * available JSON keys + a sample row, so we can confirm which fields the FREE
 * plans actually return before designing the intermediate CompanyProfile type.
 *
 * Never prints the keys themselves. Env: JQUANTS_API_KEY, RADIKABUNAVI_API_KEY.
 * Run: npm run probe:jp   (or in CI with the secrets wired in).
 */
try {
  process.loadEnvFile();
} catch {
  /* rely on real env */
}

const JQ_BASE = "https://api.jquants.com/v2";
const JQ_KEY = process.env.JQUANTS_API_KEY;
const MCP_URL = "https://radikabunavi.com/mcp";
const MCP_KEY = process.env.RADIKABUNAVI_API_KEY;

/** code5: J-Quants wants the 5-digit form (7203 -> 72030). */
const CODE4 = "7203";
const CODE5 = "72030";

function preview(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 240 ? `${s.slice(0, 240)}…` : s;
}

/** Dump status + shape of a J-Quants response (array of rows under `data`). */
async function jq(path: string): Promise<void> {
  const url = `${JQ_BASE}/${path}`;
  const safe = url.replace(/code=\d+/, "code=***"); // codes are fine, but be tidy
  try {
    const res = await fetch(url, { headers: { "x-api-key": JQ_KEY ?? "" } });
    console.log(`\n[JQ] ${safe} -> HTTP ${res.status}`);
    if (!res.ok) {
      console.log(`     body: ${preview(await res.text())}`);
      return;
    }
    const json = (await res.json()) as Record<string, unknown>;
    console.log(`     top-level keys: ${Object.keys(json).join(", ")}`);
    const rows = (json.data ?? json) as unknown;
    if (Array.isArray(rows) && rows.length) {
      console.log(`     rows: ${rows.length}`);
      console.log(`     row[0] keys: ${Object.keys(rows[0] as object).join(", ")}`);
      console.log(`     row[0]: ${preview(rows[0])}`);
      console.log(`     row[last]: ${preview(rows[rows.length - 1])}`);
    } else {
      console.log(`     payload: ${preview(json)}`);
    }
  } catch (err) {
    console.log(`\n[JQ] ${safe} -> ERROR ${err instanceof Error ? err.message : err}`);
  }
}

// ── ラジ株ナビ MCP (JSON-RPC over HTTP, SSE replies) ────────────────
let sessionId: string | undefined;
let rpcId = 1;

async function mcp(method: string, params: Record<string, unknown>, notify = false): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${MCP_KEY ?? ""}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const body: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (!notify) body.id = rpcId++;
  const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${preview(await res.text())}`);
  if (notify) return null;
  const text = await res.text();
  const lines = [...text.matchAll(/^data:\s*(.+)$/gm)];
  const last = lines.at(-1);
  const raw = last?.[1] ?? text;
  const parsed = JSON.parse(raw) as { result?: unknown; error?: { message: string } };
  if (parsed.error) throw new Error(parsed.error.message);
  return parsed.result;
}

async function radikabunavi(): Promise<void> {
  console.log("\n[RKN] initialize…");
  await mcp("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "ics-probe", version: "0.0.0" },
  });
  await mcp("notifications/initialized", {}, true);

  const toolsRes = (await mcp("tools/list", {})) as { tools?: { name: string; description?: string; inputSchema?: unknown }[] };
  const tools = toolsRes.tools ?? [];
  console.log(`[RKN] ${tools.length} tools:`);
  for (const t of tools) {
    console.log(`  • ${t.name} — ${preview(t.description ?? "")}`);
    console.log(`    inputSchema: ${preview(t.inputSchema)}`);
  }

  // Confirmed tool names (from tools/list above). Dump fuller output so we can
  // see the real financial field structure for Toyota.
  const attempts: { tool: string; args: Record<string, unknown>; cap: number }[] = [
    { tool: "get_edinet_financial_data", args: { code: CODE4 }, cap: 3000 },
    { tool: "get_earnings_forecast", args: { code: CODE4 }, cap: 2000 },
    { tool: "get_ideal_price", args: { code: CODE4 }, cap: 1500 },
    { tool: "get_stock_score", args: { code: CODE4 }, cap: 1500 },
  ];
  for (const a of attempts) {
    if (!tools.some((t) => t.name === a.tool)) {
      console.log(`\n[RKN] ${a.tool}: NOT in catalog, skipped`);
      continue;
    }
    try {
      const r = (await mcp("tools/call", { name: a.tool, arguments: a.args })) as {
        content?: { type: string; text?: string }[];
      };
      const text = (r.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      const out = text || JSON.stringify(r);
      console.log(`\n[RKN] ${a.tool}(${JSON.stringify(a.args)}) ->\n${out.slice(0, a.cap)}${out.length > a.cap ? "…[truncated]" : ""}`);
    } catch (err) {
      console.log(`\n[RKN] ${a.tool} -> ERROR ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`JQUANTS_API_KEY set: ${!!JQ_KEY} / RADIKABUNAVI_API_KEY set: ${!!MCP_KEY}`);
  // Free plan is ~12-week delayed: covered window ends ~2026-03-18 (per the
  // first probe). Request inside it so bars actually return.
  const to = "2026-03-18";
  const from = "2026-01-06";

  if (JQ_KEY) {
    await jq(`equities/master?code=${CODE5}`);
    await jq(`equities/bars/daily?code=${CODE5}&from=${from}&to=${to}`);
  } else {
    console.log("\n[JQ] skipped (no key)");
  }

  if (MCP_KEY) {
    try {
      await radikabunavi();
    } catch (err) {
      console.log(`\n[RKN] fatal: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    console.log("\n[RKN] skipped (no key)");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
