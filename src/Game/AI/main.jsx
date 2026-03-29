// main.jsx - AI chat module
// Supports Gemini and custom OpenAI-compatible endpoints (e.g. Ollama)
// Usage: import { sendMessage, sendDiplomaticMessage, startChat, startDiplomaticChat, loadHistory, loadDiplomaticHistory, buildDiplomaticSystemPrompt } from './main.jsx'

import { JSON_URLS, readJson } from "../../runtime/assets.js";

// ── Provider detection ────────────────────────────────────────────────────────

function getProvider() {
    return localStorage.getItem("api_provider") || "gemini";
}

// ── Gemini API ────────────────────────────────────────────────────────────────

function getGeminiUrl() {
    const API_KEY = localStorage.getItem("gemini_api_key");
    if (!API_KEY) throw new Error("Go to the **settings** and paste your Gemini API key - you can get it at https://aistudio.google.com/app/apikey");
        return `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${API_KEY}`;
}

async function callGemini(systemPrompt, history, { retries = 3, retryDelay = 15000 } = {}) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(getGeminiUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: history,
            }),
        });

        if (response.status === 429 || response.status === 503) {
            if (attempt === retries) throw new Error(`Rate limit/server overload after ${retries} attempts. Try again in a minute.`);
            console.warn(`Rate limited. Retrying in ${retryDelay / 1000}s… (attempt ${attempt}/${retries})`);
            await new Promise(res => setTimeout(res, retryDelay));
            continue;
        }

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || "Gemini API request failed");
        }

        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    }
}

// ── Custom / Ollama API (OpenAI-compatible) ───────────────────────────────────

function getCustomUrl() {
    const endpoint = localStorage.getItem("custom_api_endpoint");
    if (!endpoint) throw new Error("Go to **settings**, select Custom API, and enter your endpoint (e.g. http://localhost:11434/v1)");
        return endpoint.replace(/\/$/, "") + "/chat/completions";
}

// Convert Gemini-style history to OpenAI messages format
function toOpenAIMessages(systemPrompt, history) {
    const messages = [{ role: "system", content: systemPrompt }];
    for (const entry of history) {
        messages.push({
            role: entry.role === "model" ? "assistant" : "user",
            content: entry.parts[0].text,
        });
    }
    return messages;
}
async function getFirstAvailableModel() {
    try {
        const endpoint = localStorage.getItem("custom_api_endpoint")?.replace(/\/$/, "");
        const res = await fetch(`${endpoint}/models`);
        const data = await res.json();
        const model = data.data?.[0]?.id;
        if (model) {
            console.log("Auto-detected model:", model);
            localStorage.setItem("custom_api_model", model); // cache it
            return model;
        }
    } catch (e) {
        console.warn("Could not auto-detect model:", e);
    }
    return "llama3"; // final fallback
}

async function callCustom(systemPrompt, history, { retries = 3, retryDelay = 15000 } = {}) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(getCustomUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: await getFirstAvailableModel(),
                messages: toOpenAIMessages(systemPrompt, history),
            }),
        });

        if (response.status === 429 || response.status === 503) {
            if (attempt === retries) throw new Error(`Server overloaded after ${retries} attempts. Try again in a moment.`);
            console.warn(`Server busy. Retrying in ${retryDelay / 1000}s… (attempt ${attempt}/${retries})`);
            await new Promise(res => setTimeout(res, retryDelay));
            continue;
        }

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `Custom API request failed (${response.status})`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }
}

// ── Unified call ──────────────────────────────────────────────────────────────

async function callAI(systemPrompt, history, opts) {
    return getProvider() === "gemini"
    ? callGemini(systemPrompt, history, opts)
    : callCustom(systemPrompt, history, opts);
}

// ── Prompt templates (loaded once from prompts.json) ──────────────────────────

let advisorTemplate = "";
let leaderTemplate  = "";
let promptsReady = null;

async function ensurePromptsLoaded() {
    if (!promptsReady) {
        promptsReady = readJson(JSON_URLS.prompts, { defaultValue: {} })
        .then((data) => {
            advisorTemplate = data.advisor ?? "";
            leaderTemplate  = data.leader  ?? "";
            return data;
        })
        .catch((error) => {
            console.warn("Could not load prompts.json", error);
            advisorTemplate = "";
            leaderTemplate = "";
            return {};
        });
    }

    await promptsReady;
}

// ── Advisor prompt builder ────────────────────────────────────────────────────

async function buildAdvisorSystemPrompt() {
    await ensurePromptsLoaded();
    const [gameData, actionData, chatData] = await Promise.all([
        readJson(JSON_URLS.game, { defaultValue: {} }),
        readJson(JSON_URLS.actions, { defaultValue: [] }),
        readJson(JSON_URLS.chat, { defaultValue: [] }),
    ]);

    return advisorTemplate
    .replace(/\$\{country\}/g,   gameData.country)
    .replace(/\$\{startdate\}/g, gameData.startDate)
    .replace(/\$\{date\}/g,      gameData.gameDate)
    .replace(/\$\{actions\}/g,   actionData.join("\n"))
    .replace(/\$\{chat\}/g,      JSON.stringify(chatData));
}

// ── Diplomatic prompt builder ─────────────────────────────────────────────────

export async function buildDiplomaticSystemPrompt(countries, playerCountry, gameDate) {
    await ensurePromptsLoaded();
    const participantList = countries.map(c => `- ${c}`).join("\n");
    const [gameData, actionData, chatData] = await Promise.all([
        readJson(JSON_URLS.game, { defaultValue: {} }),
        readJson(JSON_URLS.actions, { defaultValue: [] }),
        readJson(JSON_URLS.chat, { defaultValue: [] }),
    ]);

    return leaderTemplate
    .replace(/\$\{participantList\}/g, participantList)
    .replace(/\$\{country\}/g,   gameData.country)
    .replace(/\$\{startdate\}/g, gameData.startDate)
    .replace(/\$\{date\}/g,      gameData.gameDate)
    .replace(/\$\{actions\}/g,   actionData.join("\n"))
    .replace(/\$\{chat\}/g,      JSON.stringify(chatData));
}

// ─────────────────────────────────────────────────────────────────────────────
// ADVISOR — completely isolated state
// ─────────────────────────────────────────────────────────────────────────────

let advisorHistory = [];

/** Send a message to the advisor. */
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

/** Restore advisor history from saved messages. */
export function loadHistory(savedMessages) {
    advisorHistory = savedMessages
    .filter(msg => msg.role === "user" || msg.role === "advisor")
    .map(msg => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
    }));
}

/** Clear advisor history. */
export function startChat() {
    advisorHistory = [];
    console.log("Advisor chat started. History cleared.");
}

// ─────────────────────────────────────────────────────────────────────────────
// DIPLOMATIC CHAT — completely isolated state, one instance at a time
// ─────────────────────────────────────────────────────────────────────────────

let diplomaticHistory = [];

export function startDiplomaticChat() {
    diplomaticHistory = [];
}

export function loadDiplomaticHistory(savedMessages) {
    diplomaticHistory = savedMessages
    .filter(msg => ["user", "leader"].includes(msg.role))
    .map(msg => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
    }));
}

// ── Reaction parser ───────────────────────────────────────────────────────────

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

    const turnInstruction = `[It is now ${speakingAs}'s turn to respond to the above. Respond only as the leader of ${speakingAs}, naturally, without prefixing your country name.\n\nOptionally, if the message warrants a emotional reaction (surprise, offense, delight, suspicion, confusion etc.), append a single line at the very end in this exact format:\nREACTION:<emoji>\n— use only a single emoji in utf-8 format after the colon, no spaces, no extra text. Otherwise omit it entirely.]`;

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
