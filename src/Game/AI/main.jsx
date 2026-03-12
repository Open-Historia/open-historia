// gemini.js - Gemini API chat module
// Usage: import { sendMessage, startChat } from './main.jsx'

function getApiUrl() {
    const API_KEY = localStorage.getItem("gemini_api_key");
    if (!API_KEY) throw new Error("Go to the **settings** and paste your API key - you can get it at https://aistudio.google.com/app/api-keys");
    return `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${API_KEY}`;
}
const SYSTEM_PROMPT = `You are a senior strategic advisor to the leader of a nation.
You have decades of experience across geopolitics, economics, military strategy,
diplomacy, and domestic policy. Your role is to brief the leader concisely and
honestly — including uncomfortable truths. You speak with authority and precision,
never hedging unnecessarily. You provide:
- Clear assessments of situations with pros, cons, and risks
- Concrete recommendations with reasoning
- Historical context and precedent where relevant
- Awareness of internal politics, public opinion, and international perception
Address the leader respectfully but directly. Avoid bureaucratic filler.
When asked for a recommendation, give one — don't just list options.
Your loyalty is to the nation's long-term stability and prosperity.
Keep all responses concise and to the point — no more than 2-3 short paragraphs
Format your responses using markdown: use **bold** for key terms, ## for section headers, and bullet points where appropriate.
.`;
let conversationHistory = [];
/**
 * Send a message and get a response from Gemini.
 * Automatically retries on rate limit (429) and server overload (503) errors with a delay.
 * @param {string} userMessage
 * @param {{ retries?: number, retryDelay?: number }} options
 * @returns {Promise<string>} the model's reply
 */
export async function sendMessage(userMessage, { retries = 3, retryDelay = 15000 } = {}) {
    conversationHistory.push({
        role: "user",
        parts: [{ text: userMessage }],
    });
    for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(getApiUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
                contents: conversationHistory,
            }),
        });
        // Rate limited (429) or server overloaded (503) — wait and retry
        if (response.status === 429 || response.status === 503) {
            if (attempt === retries) {
                conversationHistory.pop(); // remove the undelivered user message
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


export function startChat() {
    conversationHistory = [];
    console.log("Chat started. History cleared.");
}
