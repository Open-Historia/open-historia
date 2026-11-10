Open Historia is a free, open-source grand strategy game. You take a country on a world map,
write your orders in plain English, and skip time forward. A language model plays the rest of
the world — every other country's leader, the events that befall them, the wars they start and
the deals they cut — and hands you back a history of what happened.

It is not a game with a tech tree and a build queue. There are no ticks and no clock running
down. **Nothing happens until you decide to advance time**, and when you do, the world moves as
far as you asked and tells you about it.

## Start here

<div class="feature-grid">
  <div class="feature-tag"><a href="/wiki/install/">1. Install the game</a></div>
  <div class="feature-tag"><a href="/wiki/ai-setup/">2. Connect an AI provider</a></div>
  <div class="feature-tag"><a href="/wiki/how-to-play/">3. Learn the loop</a></div>
  <div class="feature-tag"><a href="/wiki/first-campaign/">4. Play your first campaign</a></div>
</div>

You need step 2. Open Historia ships with no model of its own and does not sell you one — you
bring a key from Google, OpenAI, Anthropic or any compatible service, or you point it at a model
running on your own machine. Without one, the game still opens and the map still works, but the
world stops responding: time skips fall back to canned events and the advisor cannot answer.
Google's free tier is enough for solo play — a time skip is a single request — and a local model
costs nothing at all.

<p class="beta-note"><b>On beta the desktop app can use your own Agent.</b> Instead of an API
key, your own Claude Code, Codex, OpenCode or Antigravity CLI, on your own subscription, can
answer the time skips, chats and scenes you start. See
<a href="/wiki/ai-setup/#your-own-agent">connecting an AI provider</a>.</p>

## Deep dives

Every system, with the actual rules and numbers rather than a summary.

<div class="feature-grid">
  <div class="feature-tag"><a href="/wiki/diplomacy/">Diplomacy</a></div>
  <div class="feature-tag"><a href="/wiki/war/">Relations, treaties &amp; war</a></div>
  <div class="feature-tag"><a href="/wiki/espionage/">Espionage</a></div>
  <div class="feature-tag"><a href="/wiki/military/">Military &amp; combat</a></div>
  <div class="feature-tag"><a href="/wiki/projects/">Projects &amp; operations</a></div>
  <div class="feature-tag"><a href="/wiki/territory/">Territory</a></div>
  <div class="feature-tag"><a href="/wiki/countries/">Countries &amp; identity</a></div>
  <div class="feature-tag"><a href="/wiki/statistics/">National statistics</a></div>
  <div class="feature-tag"><a href="/wiki/advisor/">The advisor</a></div>
  <div class="feature-tag"><a href="/wiki/cities/">Cities &amp; structures</a></div>
</div>

## Things worth knowing up front

**The game is single-player.** You can host it on your own machine and reach it from
your phone or another computer on the same network, and you can share scenarios with other
players through the [Community Hub](/wiki/community-hub/), but there is no shared session.

**Your API key never leaves your machine.** Provider settings live in your browser's local
storage, or in the desktop app's own profile. No Open Historia server ever sees it. On the
desktop build, requests to providers that refuse browser calls are relayed through the local
server, which listens on loopback only unless you deliberately open it up.

**The game is only as good as the model.** Diplomacy, events, combat adjudication and the
advisor are all model output. A larger model gives you a world that remembers what it did last
turn and reacts in character; a very small local model will give you a thinner one. See
[AI providers and models](/wiki/ai-providers/) for what to pick.

**Some features are beta-only.** Pages and sections marked <em>beta</em> describe systems that
have not reached the stable release — on the beta now: wars fought on battlefields from a War
Room, war at sea, peace terms, espionage orders, seasons and weather, and music. The
beta build installs alongside the stable app and keeps its own saves, so trying it costs you
nothing; see [installing the beta](/wiki/install/#the-beta-build).

**Updates take care of themselves.** The desktop app installs a waiting update when you open it,
fetching only the parts that changed, and the Android app and the website offer theirs as they
come. There is no update script to run. See [installing](/wiki/install/#updating).

## If something is broken

Start with [Troubleshooting](/wiki/troubleshooting/) — it covers the common ones: a blank map,
greyed-out AI, turns that take forever, and CORS errors from a local model. Beyond that, the
[Discord](https://discord.gg/QaqAK7fQAg) is the fastest place to get help, and bugs go to
[GitHub issues](https://github.com/Open-Historia/open-historia/issues).

Open Historia is licensed under the
[GNU Affero General Public License v3.0 or later](https://github.com/Open-Historia/open-historia/blob/main/LICENSE)
(AGPL-3.0-or-later) and built by
[contributors](https://github.com/Open-Historia/open-historia/graphs/contributors). If you want
to work on it rather than play it, start with
[`CONTRIBUTING.md`](https://github.com/Open-Historia/open-historia/blob/main/CONTRIBUTING.md) —
contributions are accepted under a contributor agreement that you sign on your first pull
request — and the developer documentation in
[`docs/`](https://github.com/Open-Historia/open-historia/tree/main/docs).
