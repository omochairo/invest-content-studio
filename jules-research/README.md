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

## Financial-explainer lane (epic #65)

The financial-explainer (読み解き層) uses the **same prose-only contract** under a
distinct filename: `<SYMBOL>-explainer.prose.json` (US ticker, e.g.
`NVDA-explainer.prose.json`). It is produced by `npm run request:jules:fin -- NVDA`
and harvested by `npm run harvest:jules:fin -- NVDA` into
`outputs/content/<SYMBOL>-explainer.json` — code re-derives the PL waterfall, BS
proportion, ratio grids and revenue trend; Jules supplies only `title` + `beats`.
Jules is the **primary** explainer path (evergreen 解説 has no daily-speed pressure);
Gemini `generate:fin` is the fast fallback. `npm run verify:jules:fin` regression-checks
the harvest (happy path / beat-count reject / §2 block), no network or quota.
