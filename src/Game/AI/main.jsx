// main.jsx - Gemini API chat module
// Usage: import { sendMessage, sendDiplomaticMessage, startChat, startDiplomaticChat, loadHistory, loadDiplomaticHistory, buildDiplomaticSystemPrompt } from './main.jsx'

function getApiUrl() {
    const API_KEY = localStorage.getItem("gemini_api_key");
    if (!API_KEY) throw new Error("Go to the **settings** and paste your API key - you can get it at https://aistudio.google.com/app/api-keys");
        return `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${API_KEY}`;
}

// ── Prompt templates (loaded once from prompts.json) ──────────────────────────

let advisorTemplate = "";
let leaderTemplate  = "";

const promptsReady = fetch("/saves/save0/prompts.json")
.then(res => res.json())
.then(data => {
    advisorTemplate = data.advisor ?? "";
    leaderTemplate  = data.leader  ?? "";
})
.catch(() => { console.warn("Could not load prompts.json"); });

// ── Advisor prompt builder ────────────────────────────────────────────────────

async function buildAdvisorSystemPrompt() {
    await promptsReady;
    const gameData   = await fetch("/saves/save0/game.json").then(res => res.json());
    const actionData = await fetch("/saves/save0/storage/actions.json").then(res => res.json()).catch(() => []);
    const chatData   = await fetch("/saves/save0/storage/chat.json").then(res => res.json()).catch(() => []);

    return advisorTemplate
    .replace(/\$\{country\}/g,   gameData.country)
    .replace(/\$\{startdate\}/g, gameData.startDate)
    .replace(/\$\{date\}/g,      gameData.gameDate)
    .replace(/\$\{actions\}/g,   actionData.join("\n"))
    .replace(/\$\{chat\}/g,      JSON.stringify(chatData));
}

// ── Diplomatic prompt builder (exported so chat.jsx can call it) ──────────────

export async function buildDiplomaticSystemPrompt(countries, playerCountry, gameDate) {
    await promptsReady;
    const participantList = countries.map(c => `- ${c}`).join("\n");
    const gameData   = await fetch("/saves/save0/game.json").then(res => res.json());
    const actionData = await fetch("/saves/save0/storage/actions.json").then(res => res.json()).catch(() => []);
    const chatData   = await fetch("/saves/save0/storage/chat.json").then(res => res.json()).catch(() => []);

    return leaderTemplate
    .replace(/\$\{participantList\}/g,  participantList)
    .replace(/\$\{country\}/g,   gameData.country)
    .replace(/\$\{startdate\}/g, gameData.startDate)
    .replace(/\$\{date\}/g,      gameData.gameDate)
    .replace(/\$\{actions\}/g,   actionData.join("\n"))
    .replace(/\$\{chat\}/g,      JSON.stringify(chatData));
}

// ── Shared fetch helper ───────────────────────────────────────────────────────

async function callGemini(systemPrompt, history, { retries = 3, retryDelay = 15000 } = {}) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(getApiUrl(), {
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

// ─────────────────────────────────────────────────────────────────────────────
// ADVISOR — completely isolated state
// ─────────────────────────────────────────────────────────────────────────────

let advisorHistory = [];

/** Send a message to the advisor. Uses prompts.json advisor template. */
export async function sendMessage(userMessage, opts) {
    const systemPrompt = await buildAdvisorSystemPrompt();
    advisorHistory.push({ role: "user", parts: [{ text: userMessage }] });
    try {
        const reply = await callGemini(systemPrompt, advisorHistory, opts);
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

/**
 * Start a fresh diplomatic session.
 */
export function startDiplomaticChat() {
    diplomaticHistory = [];
}

/**
 * Restore a diplomatic session from saved messages.
 * @param {Array<{role:string, text:string}>} savedMessages
 */
export function loadDiplomaticHistory(savedMessages) {
    diplomaticHistory = savedMessages
    .filter(msg => ["user", "leader"].includes(msg.role))
    .map(msg => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
    }));
}

// ── Reaction parser ───────────────────────────────────────────────────────────
// The model sometimes puts REACTION: mid-line, sometimes with a newline, sometimes
// with a space, sometimes at the very end. This handles all variants robustly.

function parseReaction(raw) {
    // Match REACTION: (case-insensitive) followed by one or more non-whitespace
    // characters (the emoji / text). Allow any amount of whitespace before it,
    // and require it to be at the end of the string so it doesn't strip mid-text.
    const match = raw.match(/[\s]*REACTION\s*:\s*(\S+)\s*$/i);
    if (!match) return { reply: raw.trimEnd(), reaction: null };

    const reaction = match[1].trim();
    // Remove the entire REACTION token from the reply, then clean up trailing whitespace
    const reply = raw.slice(0, match.index).trimEnd();
    return { reply, reaction };
}

/**
 * Send a message in the current diplomatic session.
 * @param {string} playerMessage - What the player typed.
 * @param {string} speakingAs    - Country the AI should respond as.
 * @param {Array}  countries     - Full country list for prompt building.
 * @param {object} [opts]        - Optional retry settings.
 */
export async function sendDiplomaticMessage(playerMessage, speakingAs, countries, opts) {
    const freshPrompt = await buildDiplomaticSystemPrompt(countries, null, null);

    diplomaticHistory.push({ role: "user", parts: [{ text: playerMessage }] });

    const turnInstruction = `[It is now ${speakingAs}'s turn to respond to the above. Respond only as the leader of ${speakingAs}, naturally, without prefixing your country name.\n\nOptionally, if the message warrants a emotional reaction (surprise, offense, delight, suspicion, confusion etc.), append a single line at the very end in this exact format:\nREACTION:<emoji>\n— use only a single emoji after the colon, no spaces, no extra text. Otherwise omit it entirely.]`;

    const historyWithInstruction = [
        ...diplomaticHistory,
        { role: "user", parts: [{ text: turnInstruction }] },
    ];

    try {
        const raw = await callGemini(freshPrompt, historyWithInstruction, opts);

        const { reply, reaction } = parseReaction(raw);

        diplomaticHistory.push({ role: "model", parts: [{ text: `[${speakingAs}]: ${reply}` }] });
        return { reply, reaction };
    } catch (err) {
        diplomaticHistory.pop();
        throw err;
    }
}
