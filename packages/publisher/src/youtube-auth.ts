/**
 * One-time LOCAL helper to mint a YouTube refresh token (run on your PC, not CI).
 *
 * Prereq: a Google Cloud "Desktop app" OAuth client, with YouTube Data API v3
 * enabled and the OAuth consent screen in PRODUCTION status (Testing-mode
 * refresh tokens expire in 7 days; Production gives a durable one even while
 * the app is "unverified" — you just click through the warning as the owner).
 *
 * Put the client creds in .env (repo root):
 *   YOUTUBE_CLIENT_ID=...
 *   YOUTUBE_CLIENT_SECRET=...
 *
 * Run: `npm run yt:auth`
 *   -> opens a consent URL (paste into a browser, choose the channel's Google
 *      account, accept), then prints YOUTUBE_REFRESH_TOKEN. Store all three as
 *      GitHub Actions secrets.
 */
import { createServer } from "node:http";

try {
  process.loadEnvFile();
} catch {
  /* rely on real env */
}

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const PORT = Number(process.env.YT_AUTH_PORT ?? "8731");
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/youtube.upload";

function authUrl(): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function exchange(code: string): Promise<Record<string, unknown>> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`token exchange -> HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function main(): void {
  if (!CLIENT_ID || !CLIENT_SECRET)
    throw new Error("set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", REDIRECT);
    const code = url.searchParams.get("code");
    const err = url.searchParams.get("error");
    if (!code && !err) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err ? `Auth error: ${err}` : "Done. Return to the terminal.");
    server.close();
    if (err) {
      console.error(`\nAuth failed: ${err}`);
      process.exit(1);
    }
    try {
      const tok = await exchange(code!);
      const refresh = tok.refresh_token as string | undefined;
      console.log("\n=== copy into GitHub Actions secrets ===");
      console.log(`YOUTUBE_REFRESH_TOKEN=${refresh ?? "(none returned — revoke prior grant and retry)"}`);
      console.log("\n(plus YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET)");
      process.exit(refresh ? 0 : 1);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    console.log(`Listening on ${REDIRECT}\n\nOpen this URL in a browser and grant access:\n\n${authUrl()}\n`);
  });
}

main();
