/*! Open Historia — a scenario's language packs: the request to its author's AI © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The one request the Workshop's Languages tab makes, as many times as its plan
// needs (runtime/scenarioLanguagePacks.js generateScenarioLanguagePacks): the
// strings of one batch into the languages of that request, answered through an
// output function. Through callAI, like every request the game makes: the
// author's Fallback list, the task's own pick in Settings > AI (Task routing),
// and the request count.

// Its key in Settings > AI > Task routing (providerConfig.js AI_TASK_ROUTING).
export const SCENARIO_TRANSLATION_TASK = "scenarioTranslation";

// The output function a request asks the model to call: one flat list, which
// every provider's structured mode takes (no keys made up by the answer, no
// array bounds: Gemini refuses those).
export const SCENARIO_TRANSLATION_TOOL = Object.freeze({
  name: "submit_translations",
  description: "Submit the translation of every string into every language asked for.",
  schema: {
    type: "object",
    properties: {
      translations: {
        type: "array",
        description: "One entry per string and language.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "The string's id, as given." },
            lang: { type: "string", description: "The language code, as given." },
            text: { type: "string", description: "The translation." },
          },
          required: ["id", "lang", "text"],
        },
      },
    },
    required: ["translations"],
  },
});

// The author's AI, as the game asks it for anything (Game/AI/main.jsx callAI):
// the Fallback list, the task's own pick in Settings, the request count. In no
// language but the translation's own, and with nothing about a game.
export const askCreatorsAI = async (systemPrompt, userMessage, tool, { signal } = {}) => {
  const [{ callAI }, { extractJsonPayload, unwrapMimickedToolCall }] = await Promise.all([
    import("./main.jsx"),
    import("./jsonSalvage.js"),
  ]);
  const response = await callAI(systemPrompt, [{ role: "user", parts: [{ text: userMessage }] }], {
    tool,
    taskKey: SCENARIO_TRANSLATION_TASK,
    logLabel: `task "${SCENARIO_TRANSLATION_TASK}"`,
    languageMode: "none",
    ...(signal ? { signal } : {}),
  });
  if (response?.toolInput) return response.toolInput;
  const rawText = typeof response === "string" ? response : String(response?.rawText ?? "");
  return unwrapMimickedToolCall(extractJsonPayload(rawText), tool.name);
};

