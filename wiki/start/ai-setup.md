Open Historia does not ship with a model and does not sell you one. You point it at a provider —
a cloud API you have a key for, or a model running on your own computer — and it uses that for
everything the world does.

This takes about two minutes. If you just want the shortest path: **get a free Google AI Studio
key and paste it in.**

## What the AI actually does

| | |
|---|---|
| **Diplomacy** | Every other country's leader replies to you in their own voice, and remembers what was said before. |
| **Events** | Each time you skip time, the model writes what happened — and those events carry machine-readable changes that move borders, units and countries. |
| **Advisor** | Answers questions about your own position, with charts. |
| **Intelligence briefings** | Summaries of any country you click. |
| **Combat adjudication** | Battles and their consequences are narrated and applied. |

Without a provider the game still runs — the map, the editor, saved games and the interface all
work — but time skips fall back to a small set of canned events and the advisor cannot answer.
On beta you get an explicit **Set up your AI provider** prompt the first time you open a
campaign without one. Stable has no such prompt — it simply falls back quietly, so if turns feel
lifeless on stable, check here first.

## Where to put the key

**Settings → AI → Provider.** (The settings button is **⋮** on the stable build and **☰** on beta.) Pick a provider, paste your key, optionally set a model, and
close the panel. That is the whole setup.

Your key is stored in your browser's local storage, or in the desktop app's own profile. It is
never sent to an Open Historia server, never written to your save files, and never included in a
scenario you export.

## The five provider types

| Provider | What it is |
|---|---|
| **Gemini** | Google AI Studio's native API. The default. |
| **OpenAI** | The official OpenAI API. |
| **Anthropic** | Claude via the Messages API. |
| **OpenAI Compatible** | Anything that speaks `/v1/chat/completions` — Ollama, LM Studio, llama.cpp, DeepSeek, Groq, Together, OpenRouter, vLLM. |
| **Anthropic Compatible** | A self-hosted proxy speaking the Anthropic Messages API. |

Most third-party services fall under **OpenAI Compatible**. If a service tells you its base URL
ends in `/v1` and it takes an `Authorization: Bearer` header, that is the one to pick.

### A note on browser restrictions

Some provider APIs refuse requests made directly from a web page. On the desktop and
self-hosted builds this is handled for you: the game tries the provider directly, and if the
browser blocks it, it retries through a relay on your own local server. On
**openhistoria.com there is no relay**, so a provider that refuses browser requests will not
work in the hosted browser build. Gemini and Anthropic's native APIs allow direct browser access
and work everywhere.

## Google Gemini — free, and the quickest start

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey), sign in, and click
   **Create API key**. It is free and needs no billing details.
2. In Open Historia: **Settings → AI**, provider **Gemini**, paste the key.
3. Leave the model alone. The default is `gemini-3.5-flash-lite`, which is fast and has generous
   free-tier limits.

If turns feel shallow, move up to a larger Gemini model — but check the free tier's rate limits
first, because hitting them mid-turn will stall a time skip.

## Anthropic Claude

1. Create a key at [console.anthropic.com](https://console.anthropic.com).
2. Provider **Anthropic**, paste the key.
3. The default model is `claude-haiku-4-5`. It is the cheap, fast one; a Sonnet model gives
   noticeably richer diplomacy for more money per turn.

Anthropic allows direct browser access, so this works in the hosted browser build too. It is
pay-per-token — there is no free tier.

## OpenAI

1. Create a key at [platform.openai.com](https://platform.openai.com) and load some credit.
2. Provider **OpenAI**, paste the key, and set a model — this one has no default, so you must
   type a model name.

Requires the desktop or a self-hosted build, because of the browser restriction above.

## A local model — free, private, offline

Runs entirely on your own hardware. No key, no bill, no internet once the model is downloaded.
Use the **OpenAI Compatible** provider for all of these.

### Ollama (easiest)

1. Install from [ollama.com](https://ollama.com).
2. Pull a model: `ollama pull llama3.2`
3. Provider **OpenAI Compatible**, endpoint `http://localhost:11434/v1` — this is already the
   default, so you may not have to type anything. Leave the API key blank. Set the model to
   whatever you pulled.

### LM Studio

1. Install from [lmstudio.ai](https://lmstudio.ai), download a model through its browser.
2. Open the **Local Server** tab, load the model, **Start Server**.
3. Provider **OpenAI Compatible**, endpoint `http://localhost:1234/v1`, no key.

### llama.cpp

```
./llama-server -m model.gguf --port 8080
```

Provider **OpenAI Compatible**, endpoint `http://localhost:8080/v1`, no key.

### Be realistic about model size

Open Historia asks a lot of the model: it has to return strictly structured data describing
territory changes, unit movements and diplomatic shifts, not just prose. Small models
(3B and below) frequently fail that and you will see turns fall back to canned events. A 7–14B
instruct model is a sensible floor, and larger is better. If you have the hardware, a local
model is genuinely good; if you do not, the Gemini free tier will serve you better than a tiny
local one.

## Other cloud services

All through **OpenAI Compatible** — paste the endpoint, your key from that service, and a model
name.

| Service | Endpoint |
|---|---|
| DeepSeek | `https://api.deepseek.com/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Together.ai | `https://api.together.xyz/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| DeepInfra | `https://api.deepinfra.com/v1/openai` |
| Fireworks | `https://api.fireworks.ai/inference/v1` |

## Worth knowing

- **You can switch provider at any time**, mid-campaign. Settings are per-provider, so your
  Gemini key stays put while you try a local model.
- **Cancel works.** A time skip that is taking too long can be stopped.
- **Limit AI generation** (Settings → AI) is off by default. Turned on, it gives up on a stalled
  generation and falls back to a canned event rather than waiting forever. It measures *silence*,
  not total time, so a slow-but-working model is not cut off.
- **Expert controls** (Settings → Advanced) let you send raw parameters to the provider, pick the
  structured-output mode, and enable reasoning on models that support it. You do not need these
  to play.

## Next

[How to play](/wiki/how-to-play/) — the core loop. Or if something is not connecting,
[Troubleshooting](/wiki/troubleshooting/) covers greyed-out AI, CORS errors and rate limits.
For picking between models in more detail, see [AI providers and models](/wiki/ai-providers/).
