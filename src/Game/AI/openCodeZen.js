/*! Open Historia — portions (OpenCode Zen model selection) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

export const OPENCODE_ZEN_ENDPOINT = "https://opencode.ai/zen/v1";

export function normalizeZenModel(model) {
    return String(model ?? "").trim().replace(/^opencode\//, "");
}

// Zen is NOT one OpenAI-compatible endpoint for its entire catalogue. Its
// documented GPT/Grok/Muse, Claude/Qwen and Gemini models use Responses,
// Messages and generateContent respectively. Offer only the Chat Completions
// families this adapter actually speaks, rather than discovering an expensive
// Claude model that cannot answer this request. Keep this list aligned with
// https://opencode.ai/docs/zen/#endpoints when adding another family.
export function isZenChatModel(model) {
    return /^(?:big-pickle$|(?:deepseek|glm|minimax|kimi|mimo|ling|nemotron)-)/.test(normalizeZenModel(model));
}

export function isZenFreeModel(model) {
    const id = normalizeZenModel(model);
    return isZenChatModel(id) && (id === "big-pickle" || id.endsWith("-free"));
}

export function zenChatModels(data) {
    const entries = Array.isArray(data?.data) ? data.data : [];
    const ids = entries.map((entry) => entry?.id).filter((id) => typeof id === "string" && isZenChatModel(id));
    return [...new Set(ids.map(normalizeZenModel))].sort((a, b) => (
        Number(isZenFreeModel(b)) - Number(isZenFreeModel(a)) || a.localeCompare(b)
    ));
}

export function pickZenFreeModel(models) {
    // No paid fallback, even when paid models are enabled. That switch permits
    // an EXPLICIT selection; an empty model field must never start spending credits.
    return models.find((model) => isZenFreeModel(model)) ?? "";
}

export function validateZenModel(model, allowPaid = false) {
    const id = normalizeZenModel(model);
    if (!isZenChatModel(id)) {
        throw new Error("OpenCode Zen currently supports Chat Completions models here (for example Big Pickle, MiMo, DeepSeek, GLM, Kimi and MiniMax). Choose one from Load models; Responses, Claude/Qwen Messages and Gemini models are not supported by this connection yet.");
    }
    if (!allowPaid && !isZenFreeModel(id)) {
        throw new Error("Paid OpenCode Zen models are disabled. Choose a free model, or enable paid Zen models in AI settings and check your Zen balance. A Go subscription does not pay for Zen requests.");
    }
    return id;
}
