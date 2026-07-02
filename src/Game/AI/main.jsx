/*! Pax Historia — portions (server relay for OpenAI-style APIs + reasoning toggle) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import {
    getProviderSettings,
    getReasoningEnabled,
    getStoredProvider,
    providerSupportsModelDiscovery,
    setProviderField,
} from "./providerConfig.js";
import { JSON_URLS, readJson } from "../../runtime/assets.js";
import { languageDirective } from "../../runtime/i18n.js";
import { difficultyDirective } from "../../runtime/difficulty.js";
import { normalizePromptPack } from "./gameplayPrompts.js";
import {
    buildActionDisplayText,
    normalizeActionEntry,
    normalizeChats,
    normalizeEvents,
    normalizeWorldState,
} from "../../runtime/gameState.js";

// main.jsx - AI chat module
// Supports Gemini, OpenAI, Anthropic, and OpenAI-compatible endpoints
// Usage: import { sendMessage, sendDiplomaticMessage, startChat, startDiplomaticChat, loadHistory, loadDiplomaticHistory, buildDiplomaticSystemPrompt } from './main.jsx'

const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";
const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
const OPENAI_API_ENDPOINT = "https://api.openai.com/v1";
const ANTHROPIC_API_ENDPOINT = "https://api.anthropic.com/v1";

const CHAT_MODEL_HINTS = [
    /^gpt/i,
    /^o\d/i,
    /claude/i,
    /gemini/i,
    /llama/i,
    /mistral/i,
    /mixtral/i,
    /qwen/i,
    /deepseek/i,
    /command/i,
    /phi/i,
];

const NON_CHAT_MODEL_HINTS = [
    /embedding/i,
    /moderation/i,
    /whisper/i,
    /tts/i,
    /transcribe/i,
    /speech/i,
    /image/i,
    /rerank/i,
];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEndpoint(endpoint) {
    return (endpoint ?? "").trim().replace(/\/$/, "");
}

function normalizeGeminiModel(model) {
    return (model ?? "").replace(/^models\//, "").trim();
}

async function readErrorPayload(response) {
    const text = await response.text();

    if (!text) return {};

    try {
        return JSON.parse(text);
    } catch {
        return { rawText: text };
    }
}

function extractErrorMessage(payload, fallback) {
    if (!payload) return fallback;
    if (typeof payload === "string" && payload.trim()) return payload.trim();
    if (payload.error?.message) return payload.error.message;
    if (payload.message) return payload.message;
    if (typeof payload.rawText === "string" && payload.rawText.trim()) return payload.rawText.trim();
    return fallback;
}

function pickLikelyChatModel(models) {
    const modelIds = models
    .map((entry) => entry?.id)
    .filter((id) => typeof id === "string" && id.trim());

    const preferredModel = modelIds.find((id) => (
        CHAT_MODEL_HINTS.some((pattern) => pattern.test(id))
        && !NON_CHAT_MODEL_HINTS.some((pattern) => pattern.test(id))
    ));

    if (preferredModel) return preferredModel;

    const safeFallbackModel = modelIds.find((id) => (
        !NON_CHAT_MODEL_HINTS.some((pattern) => pattern.test(id))
    ));

    return safeFallbackModel ?? modelIds[0] ?? "";
}

function joinGeminiParts(parts) {
    return (parts ?? [])
    .map((part) => part?.text ?? "")
    .join("")
    .trim();
}

function extractOpenAIMessageText(data) {
    const content = data?.choices?.[0]?.message?.content;

    if (typeof content === "string") {
        return content.trim();
    }

    if (Array.isArray(content)) {
        return content
        .map((part) => {
            if (typeof part === "string") return part;
            if (typeof part?.text === "string") return part.text;
            return "";
        })
        .join("")
        .trim();
    }

    return "";
}

function extractAnthropicText(data) {
    return (data?.content ?? [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function getGeminiUrl(model, apiKey) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
}

// OpenAI-style calls go through the game server's relay instead of straight to
// the endpoint: self-hosted endpoints (llama.cpp, LM Studio, NVIDIA NIM...)
// rarely send CORS headers, so the browser can't call them directly. The relay
// is same-origin for us and plain server-to-server for the endpoint. Gemini and
// Anthropic stay direct — both support browser calls explicitly.
const relayFetch = (url, { method = "POST", headers = {}, payload } = {}) =>
    fetch("/api/ai/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, method, headers, payload }),
    });

function toOpenAIMessages(systemPrompt, history) {
    const messages = [{ role: "system", content: systemPrompt }];

    for (const entry of history) {
        messages.push({
            role: entry.role === "model" ? "assistant" : "user",
            content: entry.parts?.[0]?.text ?? "",
        });
    }

    return messages;
}

function toAnthropicMessages(history) {
    return history.map((entry) => ({
        role: entry.role === "model" ? "assistant" : "user",
        content: [{
            type: "text",
            text: entry.parts?.[0]?.text ?? "",
        }],
    }));
}

async function resolveModel(provider, { endpoint = "", headers = {}, fallbackModel = "", providerLabel } = {}) {
    const settings = getProviderSettings(provider);
    const configuredModel = settings.model.trim();

    if (configuredModel) {
        return provider === "gemini" ? normalizeGeminiModel(configuredModel) : configuredModel;
    }

    if (fallbackModel) {
        return fallbackModel;
    }

    if (!providerSupportsModelDiscovery(provider)) {
        throw new Error(`Go to **settings** and enter a model for ${providerLabel}.`);
    }

    const normalizedEndpoint = normalizeEndpoint(endpoint);

    if (!normalizedEndpoint) {
        throw new Error(`Go to **settings** and enter an endpoint for ${providerLabel}.`);
    }

    try {
        const response = await relayFetch(`${normalizedEndpoint}/models`, { method: "GET", headers });

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            throw new Error(extractErrorMessage(payload, `Could not load models from ${providerLabel}.`));
        }

        const data = await response.json();
        const discoveredModel = pickLikelyChatModel(data?.data ?? []);

        if (!discoveredModel) {
            throw new Error(`No models were returned by ${providerLabel}.`);
        }

        console.log(`Auto-detected ${providerLabel} model:`, discoveredModel);
        setProviderField(provider, "model", discoveredModel);
        return discoveredModel;
    } catch (error) {
        console.warn(`Could not auto-detect model for ${providerLabel}:`, error);
        throw new Error(`Could not auto-detect a model for ${providerLabel}. Enter a model manually in **settings**.`);
    }
}

async function callGemini(systemPrompt, history, { retries = 3, retryDelay = 15000 } = {}) {
    const settings = getProviderSettings("gemini");
    const apiKey = settings.apiKey.trim();

    if (!apiKey) {
        throw new Error("Go to **settings** and paste your Gemini API key - you can get it at https://aistudio.google.com/app/apikey");
    }

    const model = await resolveModel("gemini", {
        fallbackModel: GEMINI_DEFAULT_MODEL,
        providerLabel: "Gemini",
    });

    for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(getGeminiUrl(model, apiKey), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: history,
                // Reasoning toggle (settings): let thinking-capable Gemini models think.
                ...(getReasoningEnabled()
                    ? { generationConfig: { thinkingConfig: { thinkingBudget: 8192 } } }
                    : {}),
            }),
        });

        if (response.status === 429) {
            const payload = await readErrorPayload(response);
            const details = extractErrorMessage(payload, "Gemini returned 429.");
            throw new Error(`Gemini returned 429. Your balance or quota appears to be exhausted. ${details}`.trim());
        }

        if (response.status === 503) {
            if (attempt === retries) {
                throw new Error(`Gemini is temporarily unavailable after ${retries} attempts. Try again in a minute.`);
            }

            console.warn(`Gemini is busy. Retrying in ${retryDelay / 1000}s... (attempt ${attempt}/${retries})`);
            await sleep(retryDelay);
            continue;
        }

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            throw new Error(extractErrorMessage(payload, `Gemini API request failed (${response.status})`));
        }

        const data = await response.json();
        const text = joinGeminiParts(data?.candidates?.[0]?.content?.parts);

        if (!text) {
            throw new Error("Gemini response did not contain text.");
        }

        return text;
    }
}

async function callOpenAIStyleChatCompletions({
    endpoint,
    headers,
    model,
    systemPrompt,
    history,
    providerLabel,
    retries = 3,
    retryDelay = 15000,
}) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await relayFetch(`${normalizeEndpoint(endpoint)}/chat/completions`, {
            headers,
            payload: {
                model,
                messages: toOpenAIMessages(systemPrompt, history),
                // Reasoning toggle (settings) — honored by o-series/gpt-5 models and
                // most OpenAI-compatible gateways; models that reject it surface a
                // clear API error so the user knows to pick a reasoning model.
                ...(getReasoningEnabled() ? { reasoning_effort: "medium" } : {}),
            },
        });

        if (response.status === 429 || response.status === 503) {
            if (attempt === retries) {
                const payload = await readErrorPayload(response);
                throw new Error(extractErrorMessage(payload, `${providerLabel} is busy right now. Try again in a moment.`));
            }

            console.warn(`${providerLabel} is busy. Retrying in ${retryDelay / 1000}s... (attempt ${attempt}/${retries})`);
            await sleep(retryDelay);
            continue;
        }

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            throw new Error(extractErrorMessage(payload, `${providerLabel} request failed (${response.status})`));
        }

        const data = await response.json();
        const text = extractOpenAIMessageText(data);

        if (!text) {
            throw new Error(`${providerLabel} response did not contain text.`);
        }

        return text;
    }
}

async function callOpenAI(systemPrompt, history, opts = {}) {
    const settings = getProviderSettings("openai");
    const apiKey = settings.apiKey.trim();

    if (!apiKey) {
        throw new Error("Go to **settings** and paste your OpenAI API key.");
    }

    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
    };

    const model = await resolveModel("openai", {
        endpoint: OPENAI_API_ENDPOINT,
        headers,
        providerLabel: "OpenAI",
    });

    return callOpenAIStyleChatCompletions({
        endpoint: OPENAI_API_ENDPOINT,
        headers,
        model,
        systemPrompt,
        history,
        providerLabel: "OpenAI",
        ...opts,
    });
}

async function callOpenAICompatible(systemPrompt, history, opts = {}) {
    const settings = getProviderSettings("openai-compatible");
    const endpoint = normalizeEndpoint(settings.endpoint);

    if (!endpoint) {
        throw new Error("Go to **settings**, select OpenAI Compatible, and enter your endpoint (for example http://localhost:11434/v1).");
    }

    const headers = {
        "Content-Type": "application/json",
        ...(settings.apiKey.trim() ? { Authorization: `Bearer ${settings.apiKey.trim()}` } : {}),
    };

    const model = await resolveModel("openai-compatible", {
        endpoint,
        headers,
        providerLabel: "OpenAI Compatible",
    });

    return callOpenAIStyleChatCompletions({
        endpoint,
        headers,
        model,
        systemPrompt,
        history,
        providerLabel: "OpenAI Compatible",
        ...opts,
    });
}

async function callAnthropic(systemPrompt, history, { retries = 3, retryDelay = 15000 } = {}) {
    const settings = getProviderSettings("anthropic");
    const apiKey = settings.apiKey.trim();

    if (!apiKey) {
        throw new Error("Go to **settings** and paste your Anthropic API key.");
    }

    const model = await resolveModel("anthropic", {
        fallbackModel: ANTHROPIC_DEFAULT_MODEL,
        providerLabel: "Anthropic",
    });

    const headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
    };

    // Reasoning toggle (settings): extended thinking. max_tokens must exceed the
    // thinking budget, so it is raised alongside; thinking blocks are filtered out
    // by extractAnthropicText, which only reads text blocks.
    const reasoning = getReasoningEnabled();

    for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(`${ANTHROPIC_API_ENDPOINT}/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model,
                system: systemPrompt,
                max_tokens: reasoning ? 8192 : 1024,
                ...(reasoning ? { thinking: { type: "enabled", budget_tokens: 4096 } } : {}),
                messages: toAnthropicMessages(history),
            }),
        });

        if (response.status === 429 || response.status === 503) {
            if (attempt === retries) {
                const payload = await readErrorPayload(response);
                throw new Error(extractErrorMessage(payload, "Anthropic is busy right now. Try again in a moment."));
            }

            console.warn(`Anthropic is busy. Retrying in ${retryDelay / 1000}s... (attempt ${attempt}/${retries})`);
            await sleep(retryDelay);
            continue;
        }

        if (!response.ok) {
            const payload = await readErrorPayload(response);
            throw new Error(extractErrorMessage(payload, `Anthropic request failed (${response.status})`));
        }

        const data = await response.json();
        const text = extractAnthropicText(data);

        if (!text) {
            throw new Error("Anthropic response did not contain text.");
        }

        return text;
    }
}

export async function callAI(systemPrompt, history, opts) {
    // Non-English players get replies in their language at the source —
    // native answers beat post-translating them (see runtime/i18n.js).
    const directive = languageDirective();
    if (directive) {
        systemPrompt = `${systemPrompt}\n\n${directive}`;
    }

    switch (getStoredProvider()) {
    case "openai":
        return callOpenAI(systemPrompt, history, opts);
    case "anthropic":
        return callAnthropic(systemPrompt, history, opts);
    case "openai-compatible":
        return callOpenAICompatible(systemPrompt, history, opts);
    case "gemini":
    default:
        return callGemini(systemPrompt, history, opts);
    }
}

let promptPack = normalizePromptPack({});
let promptsReady = null;
let promptsReadyKey = "";

const renderTemplate = (template, variables) =>
    String(template ?? "").replace(/\$\{([^}]+)\}/g, (_match, key) => {
        const value = variables[key];
        return value == null ? "" : String(value);
    });

const resolveHelperValues = (helperTemplates, variables) => {
    let resolved = {};

    for (let pass = 0; pass < 2; pass += 1) {
        resolved = Object.fromEntries(
            Object.entries(helperTemplates).map(([key, template]) => [
                key,
                renderTemplate(template, { ...variables, ...resolved }),
            ]),
        );
    }

    return resolved;
};

function formatActionsForPrompt(actions) {
    if (!Array.isArray(actions) || actions.length === 0) {
        return "";
    }

    return actions
    .map((entry) => {
        if (typeof entry === "string") {
            return entry.trim();
        }

        const normalized = normalizeActionEntry(entry);
        if (!normalized) {
            return "";
        }

        return `- ${normalized.title}: ${buildActionDisplayText(normalized)}`;
    })
    .filter(Boolean)
    .join("\n");
}

async function ensurePromptsLoaded() {
    const cacheKey = JSON_URLS.prompts;

    if (!promptsReady || promptsReadyKey !== cacheKey) {
        promptsReadyKey = cacheKey;
        promptsReady = readJson(JSON_URLS.prompts, { defaultValue: {} })
        .then((data) => {
            promptPack = normalizePromptPack(data);
            return promptPack;
        })
        .catch((error) => {
            console.warn("Could not load prompts.json", error);
            promptPack = normalizePromptPack({});
            return promptPack;
        });
    }

    await promptsReady;
}

function buildChatHistoryText(chats) {
    const normalizedChats = normalizeChats(chats);
    if (normalizedChats.length === 0) {
        return "No chats occurred in these rounds.";
    }

    return normalizedChats
    .slice(0, 8)
    .map((chat, index) => {
        const header = `Chat ${index + 1}: ${chat.countries.map((country) => country.name).join(", ")}`;
        const body = chat.messages.length > 0
            ? chat.messages.slice(-10).map((message) => `${message.speaker || message.role}: ${message.text}`).join("\n")
            : "No messages yet.";
        return `${header}\n${body}`;
    })
    .join("\n\n");
}

function buildEventHistoryText(events) {
    const normalizedEvents = normalizeEvents(events);
    if (normalizedEvents.length === 0) {
        return "No prior events have been recorded yet.";
    }

    return normalizedEvents
    .slice(-16)
    .map((event) => `- ${event.date || "undated"}: ${event.title}${event.description ? ` - ${event.description}` : ""}`)
    .join("\n");
}

function buildAdvisorHistoryText(messages) {
    const normalizedMessages = Array.isArray(messages)
        ? messages
            .map((entry) => {
                if (!entry || typeof entry !== "object") {
                    return "";
                }

                const role = (entry.role || entry.speaker || "message").toString().trim();
                const text = (entry.text || entry.content || entry.message || "").toString().trim();
                return role && text ? `${role}: ${text}` : "";
            })
            .filter(Boolean)
        : [];

    return normalizedMessages.length > 0
        ? normalizedMessages.slice(-18).join("\n")
        : "No advisor messages are currently recorded.";
}

function buildWorldSummary(gameData, worldData, eventData) {
    const world = normalizeWorldState(worldData);
    return [
        `Player polity: ${gameData.country || "Unknown polity"}`,
        `Current date: ${gameData.gameDate || "unknown"}`,
        `Difficulty: ${gameData.difficulty || "standard"}`,
        `World before round one: ${world.startingTimelineText || "No world briefing provided."}`,
        `Simulation rules: ${world.simulationRules || "No extra simulation rules were provided."}`,
        `Recent events:`,
        buildEventHistoryText(eventData),
    ].join("\n");
}

function buildPromptVariables({
    actionData,
    advisorData,
    chatData,
    eventData,
    gameData,
    speakingAs = "",
    worldData,
}) {
    const actionText = formatActionsForPrompt(actionData);
    const worldSummary = buildWorldSummary(gameData, worldData, eventData);
    const normalizedChats = normalizeChats(chatData);
    const currentChat = normalizedChats[0] ?? null;

    return {
        actionInput: "",
        actions: actionText,
        advisorMessages: buildAdvisorHistoryText(advisorData),
        allActions: actionText,
        chat: JSON.stringify(chatData ?? []),
        chatHistory: currentChat
            ? currentChat.messages.map((message) => `${message.speaker || message.role}: ${message.text}`).join("\n")
            : "No chat history.",
        chatHistoryLong: buildChatHistoryText(chatData),
        chatParticipants: currentChat
            ? currentChat.countries.map((country) => country.name).join(", ")
            : "",
        date: gameData.gameDate ?? "",
        difficulty: gameData.difficulty ?? "standard",
        difficultyGuidanceChats: "Diplomatic flexibility should reflect the configured difficulty.",
        gameMasterRequest: "",
        language: worldData.language ?? gameData.language ?? "English",
        lastSpeaker: currentChat?.messages?.at(-1)?.speaker ?? "",
        plannedActions: actionText || "No planned actions are currently queued.",
        playerPolity: gameData.country ?? "",
        recentEvents: buildEventHistoryText(eventData),
        recentEventsLong: buildEventHistoryText(eventData),
        respondingPolityName: speakingAs,
        simulationRules: worldData.simulationRules ?? "",
        startDate: gameData.startDate ?? "",
        targetDate: gameData.gameDate ?? "",
        worldBeforeRoundOne: worldData.startingTimelineText ?? "",
        worldSummary,
        worldSummaryNoCity: worldSummary,

        ALL_ADVISOR_MESSAGES: "${advisorMessages}",
        ALL_EVENTS_WITH_CONSOLIDATION: "${recentEventsLong}",
        ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS: "${recentEventsLong}",
        CHATS_NON_CONSOLIDATED_ROUNDS: "${chatHistoryLong}",
        CHAT_PARTICIPANTS: "${chatParticipants}",
        DIFFICULTY_DESCRIPTION_CHATS: "${difficultyGuidanceChats}",
        GRAND_MAP_DESCRIPTION: "${worldSummary}",
        GRAND_MAP_DESCRIPTION_NO_CITY: "${worldSummaryNoCity}",
        HISTORICAL_PRESET_SIMULATION_RULES: "${simulationRules}",
        ORIGIN_ROUND_DATE: "${date}",
        PLAYER_ACTIONS_THIS_ROUND: "${plannedActions}",
        PLAYER_POLITY: "${playerPolity}",
        RESPONDING_POLITY_NAME: "${respondingPolityName}",
        STARTING_ROUND_DATE: "${startDate}",
        THIS_CHATS_MOST_RECENT_SPEAKER: "${lastSpeaker}",
        THIS_CHAT_HISTORY: "${chatHistory}",
        WORLD_BEFORE_ROUND_ONE_TEXT: "${worldBeforeRoundOne}",
    };
}

async function buildAdvisorSystemPrompt() {
    await ensurePromptsLoaded();
    const [gameData, actionData, chatData, worldData, eventData, advisorData] = await Promise.all([
        readJson(JSON_URLS.game, { defaultValue: {} }),
        readJson(JSON_URLS.actions, { defaultValue: [] }),
        readJson(JSON_URLS.chat, { defaultValue: [] }),
        readJson(JSON_URLS.world, { defaultValue: {} }),
        readJson(JSON_URLS.events, { defaultValue: [] }),
        readJson(JSON_URLS.advisor, { defaultValue: [] }),
    ]);

    const variables = buildPromptVariables({
        actionData,
        advisorData,
        chatData,
        eventData,
        gameData,
        worldData,
    });
    const helperValues = resolveHelperValues(promptPack.helpers, variables);

    return renderTemplate(promptPack.advisor, { ...variables, ...helperValues });
}

export async function buildDiplomaticSystemPrompt(countries, playerCountry) {
    await ensurePromptsLoaded();
    const participantList = countries.map((country) => `- ${country}`).join("\n");
    const [gameData, actionData, chatData, worldData, eventData, advisorData] = await Promise.all([
        readJson(JSON_URLS.game, { defaultValue: {} }),
        readJson(JSON_URLS.actions, { defaultValue: [] }),
        readJson(JSON_URLS.chat, { defaultValue: [] }),
        readJson(JSON_URLS.world, { defaultValue: {} }),
        readJson(JSON_URLS.events, { defaultValue: [] }),
        readJson(JSON_URLS.advisor, { defaultValue: [] }),
    ]);

    const variables = {
        ...buildPromptVariables({
            actionData,
            advisorData,
            chatData,
            eventData,
            gameData,
            speakingAs: countries.find((country) => country !== playerCountry) || "",
            worldData,
        }),
        chatParticipants: participantList || "",
    };
    const helperValues = resolveHelperValues(promptPack.helpers, variables);

    // Leaders negotiate as softly or ruthlessly as the chosen difficulty.
    return `${renderTemplate(promptPack.leader, { ...variables, ...helperValues })}\n\n${difficultyDirective(gameData?.difficulty)}`;
}

let advisorHistory = [];

export async function sendMessage(userMessage, opts) {
    const systemPrompt = await buildAdvisorSystemPrompt();
    advisorHistory.push({ role: "user", parts: [{ text: userMessage }] });

    try {
        const reply = await callAI(systemPrompt, advisorHistory, opts);
        advisorHistory.push({ role: "model", parts: [{ text: reply }] });
        return reply;
    } catch (err) {
        advisorHistory.pop();
        throw err;
    }
}

export function loadHistory(savedMessages) {
    advisorHistory = savedMessages
    .filter((msg) => msg.role === "user" || msg.role === "advisor")
    .map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
    }));
}

export function startChat() {
    advisorHistory = [];
    console.log("Advisor chat started. History cleared.");
}

let diplomaticHistory = [];

export function startDiplomaticChat() {
    diplomaticHistory = [];
}

export function loadDiplomaticHistory(savedMessages) {
    diplomaticHistory = savedMessages
    .filter((msg) => ["user", "leader"].includes(msg.role))
    .map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
    }));
}

function parseReaction(raw) {
    const match = raw.match(/[\s]*REACTION\s*:\s*(\S+)\s*$/i);
    if (!match) return { reply: raw.trimEnd(), reaction: null };
    const reaction = match[1].trim();
    const reply = raw.slice(0, match.index).trimEnd();
    return { reply, reaction };
}

export async function sendDiplomaticMessage(playerMessage, speakingAs, countries, opts) {
    const freshPrompt = await buildDiplomaticSystemPrompt(countries, null, null);

    diplomaticHistory.push({ role: "user", parts: [{ text: playerMessage }] });

    const turnInstruction = `[It is now ${speakingAs}'s turn to respond to the above. Respond only as the leader of ${speakingAs}, naturally, without prefixing your country name.\n\nOptionally, if the message warrants a emotional reaction (surprise, offense, delight, suspicion, confusion etc.), append a single line at the very end in this exact format:\nREACTION:<emoji>\n- use only a single emoji in utf-8 format after the colon, no spaces, no extra text. Otherwise omit it entirely.]`;

    const historyWithInstruction = [
        ...diplomaticHistory,
        { role: "user", parts: [{ text: turnInstruction }] },
    ];

    try {
        const raw = await callAI(freshPrompt, historyWithInstruction, opts);
        const { reply, reaction } = parseReaction(raw);
        diplomaticHistory.push({ role: "model", parts: [{ text: `[${speakingAs}]: ${reply}` }] });
        return { reply, reaction };
    } catch (err) {
        diplomaticHistory.pop();
        throw err;
    }
}
