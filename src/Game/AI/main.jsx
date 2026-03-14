// gemini.js - Gemini API chat module
// Usage: import { sendMessage, startChat } from './main.jsx'
function getApiUrl() {
    const API_KEY = localStorage.getItem("gemini_api_key");
    if (!API_KEY) throw new Error("Go to the **settings** and paste your API key - you can get it at https://aistudio.google.com/app/api-keys");
        return `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${API_KEY}`;
}

let advisorTemplate = '';
const promptsReady = fetch('/saves/save0/prompts.json')
.then(res => res.json())
.then(data => { advisorTemplate = data.advisor; });

async function buildSystemPrompt() {
    await promptsReady;
    const gameData = await fetch('/saves/save0/game.json').then(res => res.json());
    return advisorTemplate
    .replace(/\$\{country\}/g, gameData.country)
    .replace(/\$\{startdate\}/g, gameData.startDate)
    .replace(/\$\{date\}/g, gameData.gameDate);
}

let conversationHistory = [];
export async function sendMessage(userMessage, { retries = 3, retryDelay = 15000 } = {}) {
    const systemPrompt = await buildSystemPrompt();
    conversationHistory.push({
        role: "user",
        parts: [{ text: userMessage }],
    });
    for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(getApiUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: conversationHistory,
            }),
        });
        if (response.status === 429 || response.status === 503) {
            if (attempt === retries) {
                conversationHistory.pop();
                throw new Error(`Rate limit/server overload after ${retries} attempts. Try again in a minute.`);
            }
            console.warn(`Rate limited or server overloaded. Retrying in ${retryDelay / 1000}s... (attempt ${attempt}/${retries})`);
            await new Promise(res => setTimeout(res, retryDelay));
            continue;
        }
        if (!response.ok) {
            conversationHistory.pop();
            const err = await response.json();
            throw new Error(err.error?.message || "Gemini API request failed");
        }
        const data = await response.json();
        const reply = data.candidates[0].content.parts[0].text;
        conversationHistory.push({
            role: "model",
            parts: [{ text: reply }],
        });
        return reply;
    }
}

export function loadHistory(savedMessages) {
    conversationHistory = savedMessages
    .filter(msg => msg.role === "user" || msg.role === "advisor")
    .map(msg => ({
        role: msg.role === "advisor" ? "model" : "user",
        parts: [{ text: msg.text }],
    }));
}

export function startChat() {
    console.log("Chat started. History cleared.");
}
