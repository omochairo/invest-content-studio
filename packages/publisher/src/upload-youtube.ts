/**
 * 1e: upload a rendered earnings short to YouTube (resumable upload, raw fetch).
 *
 * Auth: a refresh token (see youtube-auth.ts) exchanged for an access token.
 * Metadata (title/description) is built from the ContentPackage so the mandatory
 * disclaimer + primary sources travel with the video (compliance, AGENTS.md §2).
 *
 * NOTE: unaudited Google Cloud projects force every API upload to PRIVATE
 * regardless of privacyStatus; "unlisted/public" only sticks after Google's
 * audit. Expected for testing — the owner can still view it.
 *
 * Env: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
 *      YOUTUBE_PRIVACY (default "unlisted"), YOUTUBE_CATEGORY_ID (default "25")
 * Run: `npm run yt:upload -- NVDA`
 */
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ContentPackage } from "@ics/shared";

try {
  process.loadEnvFile();
} catch {
  /* rely on real env */
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REFRESH = process.env.YOUTUBE_REFRESH_TOKEN;
const PRIVACY = process.env.YOUTUBE_PRIVACY ?? "unlisted";
const CATEGORY = process.env.YOUTUBE_CATEGORY_ID ?? "25"; // News & Politics

async function accessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      refresh_token: REFRESH!,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as { access_token?: string };
  if (!res.ok || !data.access_token)
    throw new Error(`refresh -> HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data.access_token;
}

function buildDescription(pkg: ContentPackage): string {
  const script = pkg.narration.map((n) => n.text).join("\n");
  const sources = pkg.meta.sources.map((s) => `・${s.label}: ${s.url}`).join("\n");
  return [
    script,
    "",
    "― 出典 ―",
    sources,
    "",
    pkg.meta.disclaimer,
    "",
    "#決算 #米国株 #投資 #Shorts",
  ].join("\n");
}

async function main(): Promise<void> {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH)
    throw new Error("set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN");
  const symbol = process.argv[2];
  if (!symbol) throw new Error("usage: npm run yt:upload -- <SYMBOL>");

  const pkg = JSON.parse(
    await readFile(resolve(ROOT, `outputs/content/${symbol}.json`), "utf8"),
  ) as ContentPackage;
  const mp4 = resolve(ROOT, `packages/video-generator/out/${symbol}.mp4`);
  const size = (await stat(mp4)).size;

  const metadata = {
    snippet: {
      title: pkg.meta.title.slice(0, 100),
      description: buildDescription(pkg).slice(0, 4900),
      categoryId: CATEGORY,
      tags: ["決算", "米国株", "投資", symbol],
    },
    status: { privacyStatus: PRIVACY, selfDeclaredMadeForKids: false },
  };

  const token = await accessToken();

  // 1) start a resumable session
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!init.ok) throw new Error(`resumable init -> HTTP ${init.status}: ${await init.text()}`);
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("no upload URL in resumable init response");

  // 2) upload the bytes (file is small; send as one buffered body)
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: await readFile(mp4),
  });
  const result = (await put.json()) as { id?: string; error?: unknown };
  if (!put.ok || !result.id)
    throw new Error(`upload -> HTTP ${put.status}: ${JSON.stringify(result)}`);

  console.log(`uploaded ${symbol} [${PRIVACY}] -> https://youtu.be/${result.id}`);
  console.log(`manage: https://studio.youtube.com/video/${result.id}/edit`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
