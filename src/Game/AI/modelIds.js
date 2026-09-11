/*! Open Historia — model ids against what a local server actually serves © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Issue #721: a player routed the Projects & Operations task to
// `F:\Models\LLM\gemma-4-31B-it-APEX-Quality.gguf` and every turn failed on
// "model … not found", while their llama-server, in router mode, was serving
// that exact model as `gemma-4-31B-it-APEX-Quality`.
//
// Where the path comes from: classic single-model llama-server reports the file
// it was started with (-m) as its model id unless --alias is given. The game
// auto-detects that id, keeps it as the default model, and offers it again as a
// suggestion in every model field — the per-task ones included. The same server
// in router mode serves models by NAME, so the remembered path stops resolving.
//
// Pure and import-free so it is testable under `node --test`; the network side
// (fetching /models) stays in main.jsx.

// A configured id that names a model FILE rather than a model. Only these are
// worth a /models lookup; every other id is sent exactly as configured.
export const looksLikeModelFilePath = (id) => {
  const text = String(id ?? "").trim();
  if (!text) return false;
  return /\.gguf$/i.test(text) || text.includes("\\");
};

const baseName = (id) => String(id).trim().split(/[\\/]/).pop() || "";

// Names a server might list the same file under, best first. The configured id
// itself always comes first, so a server whose ids genuinely ARE paths — vLLM
// serving a file without --served-model-name, LM Studio's org/repo/file.gguf —
// keeps getting exactly what the player typed.
export const modelFileCandidates = (id) => {
  const exact = String(id ?? "").trim();
  if (!exact) return [];
  const file = baseName(exact);
  const stem = file.replace(/\.gguf$/i, "");
  // The first shard of a split model: model-00001-of-00003.gguf.
  const unsharded = stem.replace(/-\d{5}-of-\d{5}$/i, "");
  return [...new Set([exact, file, stem, unsharded].filter(Boolean))];
};

// The id to send: the first candidate the server actually serves, matched exactly
// and then ignoring case. null when none is served — the caller then sends the
// configured id unchanged, which is exactly the behaviour before this existed.
export const resolveServedModelId = (configured, servedIds) => {
  const served = (Array.isArray(servedIds) ? servedIds : [])
    .filter((id) => typeof id === "string" && id.trim());
  if (!served.length) return null;

  const candidates = modelFileCandidates(configured);
  for (const candidate of candidates) {
    if (served.includes(candidate)) return candidate;
  }
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    const hit = served.find((id) => id.toLowerCase() === lower);
    if (hit) return hit;
  }
  return null;
};
