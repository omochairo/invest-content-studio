# jules-research

Committed prose written by the **Jules deep-dive lane** (Phase 2 JP long-form).

Each file `<code>.prose.json` is `{ "title": string, "beats": [{ "narration", "caption" }] }`
produced by a Jules session (`npm run request:jules:jp -- <code>`, AUTO_CREATE_PR).
It holds **prose only** — every load-bearing number and every chart/stat asset is
re-derived in code by the harvest step (`npm run harvest:jules:jp -- <code>`), which
turns the prose into a gated ContentPackage (`outputs/content/<code>.json`), the same
shape the Gemini path emits.

This directory is tracked (unlike `outputs/`, which is gitignored) so Jules's PR has
a real diff. The numbers stay code-owned (AGENTS.md §3), so Jules cannot hallucinate them.
