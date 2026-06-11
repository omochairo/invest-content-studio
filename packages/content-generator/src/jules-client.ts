/**
 * Minimal Jules API client (https://jules.googleapis.com/v1alpha), mirroring the
 * proven omochairo workflow calls. Jules is an async coding agent: createSession
 * starts work against a connected GitHub source and (AUTO_CREATE_PR) opens a PR
 * with its changes; we poll getSession and harvest the PR's committed file.
 *
 * IMPORTANT: the Jules quota is SHARED with omochairo (Pro = 100 tasks/day,
 * rolling 24h). recentCreationCount() lets callers gate before creating, so this
 * lane never starves omochairo's article generation. Auth = X-Goog-Api-Key.
 */
const BASE = "https://jules.googleapis.com/v1alpha";

function key(): string {
  const k = process.env.JULES_API_KEY;
  if (!k) throw new Error("JULES_API_KEY is not set (add it to .env / CI secret)");
  return k;
}

async function jules<T>(path: string, init?: RequestInit): Promise<{ status: number; json: T | null; raw: string }> {
  const res = await fetch(`${BASE}/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key(), ...(init?.headers ?? {}) },
  });
  const raw = await res.text();
  let json: T | null = null;
  try {
    json = raw ? (JSON.parse(raw) as T) : null;
  } catch {
    /* non-JSON body (error pages) — keep raw */
  }
  return { status: res.status, json, raw };
}

/** Resolve the Jules source name for a connected GitHub repo. */
export async function resolveSource(owner: string, repo: string): Promise<string> {
  const r = await jules<{ sources?: { name: string; githubRepo?: { owner: string; repo: string } }[] }>("sources");
  if (r.status === 200 && r.json?.sources) {
    const hit = r.json.sources.find((s) => s.githubRepo?.owner === owner && s.githubRepo?.repo === repo);
    if (hit?.name) return hit.name;
  }
  // Conventional fallback (same as omochairo) when the list is empty/forbidden.
  return `sources/github/${owner}/${repo}`;
}

/** Count sessions created within the last `hours` (shared-quota gate). */
export async function recentCreationCount(hours = 24): Promise<number> {
  const cutoff = Date.now() - hours * 3600_000;
  let token = "";
  let count = 0;
  for (let page = 0; page < 20; page++) {
    const q = `sessions?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
    const r = await jules<{ sessions?: { createTime?: string }[]; nextPageToken?: string }>(q);
    if (r.status !== 200 || !r.json?.sessions) break;
    for (const s of r.json.sessions) {
      const t = s.createTime ? Date.parse(s.createTime) : NaN;
      if (Number.isFinite(t) && t >= cutoff) count++;
    }
    token = r.json.nextPageToken ?? "";
    if (!token) break;
  }
  return count;
}

export interface CreatedSession {
  id: string;
  name: string;
  status: string;
}

/** Create a session that researches + writes a file and opens a PR. */
export async function createSession(opts: { prompt: string; source: string; title: string }): Promise<CreatedSession> {
  const r = await jules<{ id?: string; name?: string; status?: string }>("sessions", {
    method: "POST",
    body: JSON.stringify({
      prompt: opts.prompt,
      sourceContext: { source: opts.source, githubRepoContext: { startingBranch: "main" } },
      automationMode: "AUTO_CREATE_PR",
      title: opts.title,
    }),
  });
  if (r.status !== 200 || !r.json?.id) {
    throw new Error(`Jules createSession HTTP ${r.status}: ${r.raw.slice(0, 800)}`);
  }
  return { id: r.json.id, name: r.json.name ?? "", status: r.json.status ?? "UNKNOWN" };
}

/** Poll one session's coarse status. */
export async function getSession(id: string): Promise<string> {
  const r = await jules<{ status?: string; state?: string }>(`sessions/${encodeURIComponent(id)}`);
  return r.json?.status ?? r.json?.state ?? "unknown";
}
