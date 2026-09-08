The common failures, and what actually fixes them.

Before anything else: the [cheats panel](/wiki/cheats/) has a **Diagnostics Log** showing errors,
API failures and the exact context the model was given. It usually explains the problem
immediately, and it is what to paste into a bug report.

## The map is blank

**In the browser.** The web build streams its map from community-run content nodes. If none is
reachable you get no map. Reload; if it persists, the node network is having a bad day — try
again later, or use the desktop app, which stores the map locally.

**On desktop.** The map data failed to download on first launch. It is about 200 MB fetched
separately from the installer. Restart the app and let the startup screen finish. From a source
checkout, run `node scripts/fetch-map-assets.mjs`.

**A full-screen WebGL warning.** The map cannot render without WebGL. Update your graphics
drivers; in a browser, check that hardware acceleration is enabled. On a virtual machine or over
remote desktop, WebGL is often unavailable.

## The AI is greyed out or does nothing

Work through these in order:

1. **Is a provider configured?** Settings → the provider section. No key, no world.
2. **Is the key right?** Paste it fresh; keys often pick up whitespace.
3. **Is the model name right?** OpenAI and OpenAI Compatible have no default model — you must
   type one, and it must exist on that provider.
4. **Is the endpoint right?** Compatible providers need the base URL, usually ending `/v1`.
5. **Are you in the browser build with a provider that needs a relay?** The hosted website
   cannot relay. Gemini and Anthropic work there; OpenAI and most compatible endpoints do not.
   Use the desktop app. See [connecting an AI provider](/wiki/ai-setup/).

## Turns fail, or always fall back to canned events

This is almost always the model failing to produce valid structured output.

- **Your model is too small.** Below about 7B this is common. See
  [AI providers and models](/wiki/ai-providers/).
- **Toggle Strict tool schema** (Settings). Some gateways and local servers handle the strict
  form of structured output badly, and flipping this fixes it outright.
- **Try a different model on the same provider.** Some are far better at this than others.
- **Check the Diagnostics Log** — it will show you what came back.

## Turns hang forever

**Turn on Limit AI generation** (Settings). It abandons a generation that has gone silent and
falls back rather than waiting indefinitely. It watches for silence rather than total time, so it
will not cut off a slow-but-working model.

Then: **Cancel** in the time panel always works and leaves the world untouched.

If it is a local model, it may genuinely be that slow — check whether it is producing tokens at
all. If it is a cloud model, you may be rate limited.

## When a request fails

<p class="beta-note"><b>Beta channel only.</b> The stable build has no retry controls — a failed
request there means redoing the action, or undoing the turn.</p>

Model calls fail: a provider is overloaded, a rate limit bites, a response comes back empty.
Beta's answer is that **a failure should cost you the thing that failed, and nothing else**.

### The advisor

A failed answer appears as an error in the thread with a **Retry** button. Press it and the same
question is asked again — you do not retype anything, and if it succeeds the thread reads as
though the error never happened.

![An advisor request that failed, with Retry](/wiki/img/retry-advisor.jpg)
*Your question is kept above the error, so Retry re-asks it as written. **Copy for a bug report**
puts the failure and its context on the clipboard in one go.*

Retry is offered on the **newest** error only. Most advisor failures are the transport or an
overloaded provider rather than anything about your question, and the transport has already
waited and tried once by the time you see this.

### Diplomatic messages

The same, in the chat. A message that fails to get a reply shows an error bubble with **Retry**
on it. Pressing it re-sends that message; the conversation carries on as if it had worked first
time.

![A diplomatic message that failed, with Retry](/wiki/img/retry-diplomacy.jpg)
*The message you sent stays in the thread. Retry asks Berlin again; nothing needs retyping.*

### A held time skip

This is the one that saves real time. When a long skip is generated in segments and one segment
does not come back, the turn is **held**, not failed:

- Nothing has been written. Your campaign is still on its old date.
- The segments that already succeeded are still in hand.
- **Retry re-runs only the segment that failed** — the minutes spent on the earlier ones are not
  spent again.

The panel goes amber rather than red for exactly that reason: a held turn is recoverable. If a
retry fails it says so plainly and counts the attempts, rather than re-showing the same message
and looking like a dead button. Discard the turn and run it as a shorter skip if it keeps
failing. See [time and turns](/wiki/time/).

### A held Projects board

The turn's events can succeed while the **Projects & Operations** update fails. When that happens
the turn is held the same way: *"Your events are ready, but the Projects & Operations board did
not update, so nothing has been saved yet."*

**Retry the board** and it finishes the turn, keeping the events that already came back. You do
not re-run the whole simulation to fix a board that was the only thing to fail. Discard it and
the turn runs again from the start.

The turn is released before the retry runs, so a turn can never be applied twice, and it is only
held again if the **board** fails a second time.

### If retrying does not help

Undo the turn from the time panel and try a shorter skip, or a different model.

## Rate limits

Symptoms: turns fail intermittently, or stall on long jumps while short ones work.

Free tiers have per-minute limits that a long jump can exceed. Options: use the smaller/faster
model in the family (limits are usually more generous), take shorter jumps, or move to a paid
tier.

## CORS errors with a local model

The error will name a blocked cross-origin request.

- **Ollama** — usually works as-is at `http://localhost:11434/v1`.
- **LM Studio** — make sure the local server is actually started, and check whether it has a
  CORS setting to enable.
- **llama.cpp** — `llama-server` may need to be started with CORS permitted.
- **Use the desktop app**, which relays around this automatically. The hosted website cannot.
- **Check `http` vs `https`** and that the port matches.

## Everything is slow

- Turn off **3D Terrain**. It is by far the most expensive thing in the game.
- Turn off the **3D Globe**.
- Turn on **Reduce motion**.
- Turn on **Hide country labels**.
- Zoom out, or switch to a lighter basemap such as Light Gray Canvas.
- On the desktop app, close and reopen it — a long session accumulates map tiles.

## I lost my games

**In the browser** — clearing site data clears your campaigns. There is no server-side copy
unless you signed in, which syncs them. Grant persistent storage permission when asked.

**On desktop** — saves are files in the app's data directory and are still there. If the library
looks empty, the app may be pointed at a different data directory.

**After installing the beta** — the beta build keeps a **separate library** by design. Your
stable campaigns are untouched; they are just not visible from the beta app. Open the stable app
and they are there.

## A country is behaving incoherently

The world drifted. Fix it rather than restarting:

- **Undo the turn** in the time panel and try different orders.
- **Roll Back Turn** in cheats, to go back further.
- **Master AI** in cheats — describe what should be true and let it apply the change properly.
- **Edit Country** or the **Events** editor, to correct a specific fact.

See [cheats and the GM console](/wiki/cheats/). Using these is normal; an AI-driven world
occasionally produces nonsense, and repairing it is part of running a long campaign.

## "Server stopped"

A full-screen **Server stopped** overlay means the local server the desktop app runs alongside
itself is no longer answering. Restart the app. If it happens repeatedly, the diagnostics log in
the cheats panel will usually name the cause — most often a port already in use, or the server
being shut down by something else.

The browser build never shows this: it has no server to lose.

## Windows says the installer is unsafe

The installer is not code-signed yet. Choose **More info → Run anyway** in SmartScreen.

## macOS will not open the app

Also not code-signed. Right-click the app and choose **Open**, then confirm. Once only.

## Reporting a bug

**Turn on detailed logging first** — Settings → Advanced — then reproduce the problem. It records
far more than the normal log, including the full text of the exchange that went wrong, and it is
usually the difference between a report someone can act on and one that cannot be diagnosed. See
[the settings reference](/wiki/settings/#detailed-logging).

Then copy the **Diagnostics Log** from the cheats panel and open an issue at
[GitHub](https://github.com/Open-Historia/open-historia/issues). On beta, an advisor or chat
error also has **Copy for a bug report** on the error itself, which grabs that failure and its
context without going near the log. The
[Discord](https://discord.gg/QaqAK7fQAg) is faster for "is this just me?".

Include your platform, your build (stable or beta), your provider and model, and what you were
doing.
