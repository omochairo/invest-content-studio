/**
 * Quality gates for a ContentPackage (AGENTS.md §6).
 *
 *  1) validateContentPackage — structural / schema conformance (SPEC.md §3).
 *  2) complianceGate         — 金融商品取引法 §2: zero prohibited phrases,
 *                              mandatory disclaimer + at least one source.
 *
 * The compliance gate is the load-bearing one: per AGENTS.md §5/§6 a §2
 * failure must STOP the pipeline (never publish). validate failures route to
 * a fix loop. Both return structured results so callers can decide.
 */
import type { ContentPackage } from "@ics/shared";

export interface GateResult {
  ok: boolean;
  errors: string[];
}

/** Structural check that the object matches the ContentPackage contract. */
export function validateContentPackage(pkg: unknown): GateResult {
  const errors: string[] = [];
  const p = pkg as Partial<ContentPackage> | null;
  if (!p || typeof p !== "object") return { ok: false, errors: ["not an object"] };

  const meta = p.meta;
  if (!meta || typeof meta !== "object") {
    errors.push("meta: missing");
  } else {
    if (!meta.title?.trim()) errors.push("meta.title: empty");
    if (meta.lang !== "ja") errors.push(`meta.lang: expected "ja", got ${meta.lang}`);
    if (meta.format !== "short" && meta.format !== "wide")
      errors.push(`meta.format: invalid (${meta.format})`);
    if (!meta.disclaimer?.trim()) errors.push("meta.disclaimer: empty");
    if (!Array.isArray(meta.sources)) errors.push("meta.sources: not an array");
  }

  const narration = p.narration;
  if (!Array.isArray(narration) || narration.length === 0) {
    errors.push("narration: empty");
  } else {
    narration.forEach((n, i) => {
      if (!n?.text?.trim()) errors.push(`narration[${i}].text: empty`);
    });
  }

  const scenes = p.scenes;
  const nLen = Array.isArray(narration) ? narration.length : 0;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    errors.push("scenes: empty");
  } else {
    scenes.forEach((s, i) => {
      if (typeof s?.narrationIndex !== "number" || s.narrationIndex < 0 || s.narrationIndex >= nLen)
        errors.push(`scenes[${i}].narrationIndex: out of range (${s?.narrationIndex})`);
      if (typeof s?.caption !== "string") errors.push(`scenes[${i}].caption: not a string`);
      if (s?.visualRef && !p.assets?.some((a) => a.id === s.visualRef))
        errors.push(`scenes[${i}].visualRef: no asset "${s.visualRef}"`);
    });
  }

  if (!Array.isArray(p.assets)) errors.push("assets: not an array");

  return { ok: errors.length === 0, errors };
}

/**
 * Prohibited expressions (AGENTS.md §2.1). Substrings or regexes; any hit
 * fails the gate. Kept conservative — we'd rather block a borderline phrase
 * than risk 投資助言業 territory.
 */
const PROHIBITED: { pattern: string | RegExp; label: string }[] = [
  // 売買の推奨・指示
  { pattern: "買うべき", label: "売買推奨" },
  { pattern: "買い時", label: "売買推奨" },
  { pattern: "売り時", label: "売買推奨" },
  { pattern: "売るべき", label: "売買推奨" },
  { pattern: "仕込め", label: "売買推奨" },
  { pattern: "仕込み時", label: "売買推奨" },
  { pattern: "狙い目", label: "売買推奨" },
  { pattern: "買い推奨", label: "売買推奨" },
  { pattern: "売り推奨", label: "売買推奨" },
  { pattern: "押し目買い", label: "売買推奨" },
  { pattern: /今(すぐ|が)?買い/, label: "売買推奨" },
  // 断定的な将来予測
  { pattern: /必ず(上が|下が|儲)/, label: "断定的予測" },
  { pattern: "確実に上が", label: "断定的予測" },
  { pattern: "間違いなく", label: "断定的予測" },
  { pattern: "絶対に", label: "断定的予測" },
  { pattern: /(急騰|暴落|上昇|下落)は確定/, label: "断定的予測" },
  // 利回り・元本の保証
  { pattern: "儲かる", label: "利回り保証" },
  { pattern: "損しない", label: "利回り保証" },
  { pattern: "元本保証", label: "利回り保証" },
  { pattern: "元本割れしない", label: "利回り保証" },
  { pattern: "リスクなし", label: "利回り保証" },
  { pattern: "ノーリスク", label: "利回り保証" },
  { pattern: /年利[^。]{0,12}(確実|保証)/, label: "利回り保証" },
];

/** §2 compliance gate: prohibited phrases + mandatory disclaimer + sources. */
export function complianceGate(pkg: ContentPackage): GateResult {
  const errors: string[] = [];
  const corpus = [
    pkg.meta?.title ?? "",
    ...(pkg.narration ?? []).map((n) => n.text),
    ...(pkg.scenes ?? []).map((s) => s.caption),
  ].join("\n");

  for (const { pattern, label } of PROHIBITED) {
    const hit = typeof pattern === "string" ? corpus.includes(pattern) : pattern.test(corpus);
    if (hit) errors.push(`禁止表現(${label}): ${pattern}`);
  }

  if (!pkg.meta?.disclaimer?.trim()) errors.push("必須: meta.disclaimer が空");
  const sources = pkg.meta?.sources ?? [];
  if (sources.length === 0) errors.push("必須: meta.sources に一次情報リンクが0件");
  else if (!sources.some((s) => /^https?:\/\//.test(s.url ?? "")))
    errors.push("必須: meta.sources に有効な URL が無い");

  return { ok: errors.length === 0, errors };
}
