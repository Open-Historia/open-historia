# Prompt budget: what a time skip sends the AI

How big a time skip's request is, part by part, and how much of it a provider's
prompt cache can take. Measured with `scripts/prompt-size.mjs` on real saves,
before and after each change that set out to make skips cheaper (the plan of
2026-11-07: the cache-friendly layout, sending nothing twice, one-line event
digests, a slimmer output function, and the events no list showed; then
Phase 2: what the turn is about in full and the rest in a line, compact tables,
the board's closed entries counted, and the history in tiers with its canon).

## How it is measured

```
node scripts/prompt-size.mjs <save> [--task jumpForward|autoJumpForward] [--days 30]
     [--regions regions.geojson] [--cities cities.geojson] [--json out.json] [--dump prompt.txt]
```

- `<save>` is a Game export (its `game.json`, or the folder it was unpacked into),
  or a folder holding the runtime files a game keeps (`game.json`, `world.json`,
  `events.json`, ...).
- The game's own code builds the skip: the save is served to the real engine from
  memory, `simulateTimelineJump` / `simulateAutoJump` runs, and the request it
  would send is caught at the provider's door. Nothing is written and nothing
  leaves the machine (the provider is Anthropic with a dummy key, answered locally).
- A save's map is the scenario's `regions.geojson`; without it the world summary
  has no region names and reads far smaller than it is in play.
- Sizes are characters; tokens are estimated as characters / 4.
- **Cacheable prefix**: the part of the system prompt that opens every skip of the
  campaign identically, as the request marks it for Anthropic (every system block
  but the last). OpenAI and Gemini cache identical openings on their own, so the
  same layout serves them.
- **Schema**: the output function as Gemini is sent it (`toGeminiSchema`).
  Anthropic and OpenAI get the raw JSON Schema, a little longer.
- **Not cacheable**: the whole request less the cacheable prefix and the functions
  (on Anthropic the functions come first and are cached with the prefix).
- A section is what a `[Heading]` at the start of a line opens. A heading the
  campaign wrote (a scenario's lore, an event's text, a chat line) is counted in the
  section it sits in. Detailed logging's prompt fingerprint names the same sections
  (`contextDiagnostics.js` `measurePromptSections`).

### Phase 0: the rig, and the logs measuring what was sent

The rig and the fingerprint came first (`7db0ca1d`), so that every later change
was measured the same way.

- `scripts/prompt-size.mjs` loads the game's own modules under Node (a loader
  lets Node read `main.jsx`, the JSON prompts and `import.meta.env`): it serves
  the save from memory through a stand-in `fetch` and `window`/`localStorage`,
  points the provider at Anthropic with a dummy key, and answers the provider's
  URL itself, so nothing is written and nothing leaves the machine. It prints the system prompt by
  section, the user message, the output function as Anthropic and as Gemini get
  it (`toGeminiSchema`), the cacheable prefix and its share; `--json` keeps the
  numbers and `--dump` the prompt itself. The same rig builds the skip
  `promptNamesNotIds.test.js` scans.
- Detailed logging's prompt fingerprint (`buildPromptFingerprint`) now measures
  what was sent: the rendered prompt by `[Section]` (`measurePromptSections`;
  a heading the campaign wrote is reported as `(campaign section)`, so no
  campaign text reaches the log), the output function's schema
  (`tool.schema`) and the cacheable prefix (`cacheablePrefixChars`). A variable
  that is a record the builders read rather than text (the fronts forecast,
  the stat sheets) is listed without a size: it used to be measured as JSON
  nobody sends, which made `frontsForecast` look like one of the largest parts
  of a skip in the players' logs of 2026-11.

### The saves

| Save | Where it came from | Map |
|---|---|---|
| Modern Day 2026 (copy), Italy, round 130 | the owner's Game export of 2026-11-05 | Modern Day 2026 scenario |
| Modern Day (built-in), Brazil, round 67 | Game export of 2026-10-18 | the built-in seed (`server/seed/default`) |
| New Dawn, Germany, round 30 | Game export of 2026-11-02 | the Modern Day map of `default-2` (the hub bundle is not on this machine) |
| Battle of Europe, UK, round 7 | Game export of 2026-10-25 (map embedded) | its own |
| Modern Day, Poland, round 2 | the report-poland save | the Modern Day map of `default-2` |
| 1836 Victorian Era, Ottomans, round 1 | the 2026-11-03 player report | none on this machine (region names missing: its world summary reads small) |

All three long campaigns are real saves; nothing below is synthetic.

## Summary

| Save | Run | System prompt | Cacheable prefix (share) | User msg | Schema (Gemini) | Whole request | Not cacheable |
|---|---|---:|---:|---:|---:|---:|---:|
| Modern Day 2026 (copy), Italy, r130, 769 events | before | 257.4k ~64.3k | 35.8k (14%) | 12.2k | 32.8k | 303.6k ~75.9k | 233.7k ~58.4k |
|  | 1-layout | 258.3k ~64.6k (+0%) | 70.4k (27%) | 12.2k | 36.1k (+10%) | 308.0k ~77.0k (+1%) | 200.0k ~50.0k (-14%) |
|  | 2-once | 256.6k ~64.2k (-0%) | 71.0k (28%) | 12.2k | 36.1k (+10%) | 306.3k ~76.6k (+1%) | 197.8k ~49.4k (-15%) |
|  | 3-digests | 248.6k ~62.1k (-3%) | 71.0k (29%) | 12.2k | 36.2k (+11%) | 298.4k ~74.6k (-2%) | 189.7k ~47.4k (-19%) |
|  | 5-gap | 248.6k ~62.1k (-3%) | 71.0k (29%) | 12.2k | 36.2k (+11%) | 298.4k ~74.6k (-2%) | 189.7k ~47.4k (-19%) |
|  | 4-schema | 248.1k ~62.0k (-4%) | 70.6k (28%) | 12.2k | 32.3k (-2%) | 293.9k ~73.5k (-3%) | 189.7k ~47.4k (-19%) |
| Modern Day (built-in), Brazil, r67, 905 events | before | 179.7k ~44.9k | 17.9k (10%) | 3441 | 31.1k | 215.7k ~53.9k | 165.2k ~41.3k |
|  | 1-layout | 180.6k ~45.1k (+1%) | 52.3k (29%) | 3441 | 33.8k (+9%) | 219.4k ~54.8k (+2%) | 131.7k ~32.9k (-20%) |
|  | 2-once | 178.3k ~44.6k (-1%) | 52.9k (30%) | 3441 | 33.8k (+9%) | 217.2k ~54.3k (+1%) | 128.9k ~32.2k (-22%) |
|  | 3-digests | 177.0k ~44.2k (-1%) | 52.9k (30%) | 3441 | 33.9k (+9%) | 215.9k ~54.0k (+0%) | 127.5k ~31.9k (-23%) |
|  | 5-gap | 179.9k ~45.0k (+0%) | 52.9k (29%) | 3441 | 33.9k (+9%) | 218.9k ~54.7k (+1%) | 130.5k ~32.6k (-21%) |
|  | 4-schema | 179.5k ~44.9k (-0%) | 52.5k (29%) | 3441 | 29.9k (-4%) | 214.3k ~53.6k (-1%) | 130.5k ~32.6k (-21%) |
| New Dawn, Germany, r30, 259 events | before | 173.1k ~43.3k | 57.8k (33%) | 5152 | 30.4k | 211.7k ~52.9k | 120.5k ~30.1k |
|  | 1-layout | 174.0k ~43.5k (+1%) | 92.2k (53%) | 5152 | 33.8k (+11%) | 216.1k ~54.0k (+2%) | 87.0k ~21.8k (-28%) |
|  | 2-once | 170.7k ~42.7k (-1%) | 92.8k (54%) | 5152 | 33.8k (+11%) | 212.7k ~53.2k (+0%) | 83.1k ~20.8k (-31%) |
|  | 3-digests | 170.0k ~42.5k (-2%) | 92.8k (55%) | 5152 | 33.9k (+11%) | 212.2k ~53.1k (+0%) | 82.4k ~20.6k (-32%) |
|  | 5-gap | 172.3k ~43.1k (-0%) | 92.8k (54%) | 5152 | 33.9k (+11%) | 214.4k ~53.6k (+1%) | 84.6k ~21.2k (-30%) |
|  | 4-schema | 171.8k ~43.0k (-1%) | 92.3k (54%) | 5152 | 29.9k (-2%) | 209.8k ~52.5k (-1%) | 84.6k ~21.2k (-30%) |
| New Dawn, Germany, r30 — auto-jump | before | 174.9k ~43.7k | 59.5k (34%) | 5232 | 30.4k | 213.5k ~53.4k | 120.7k ~30.2k |
|  | 1-layout | 175.7k ~43.9k (+0%) | 93.8k (53%) | 5232 | 33.8k (+11%) | 217.8k ~54.4k (+2%) | 87.1k ~21.8k (-28%) |
|  | 2-once | 172.3k ~43.1k (-1%) | 94.4k (55%) | 5232 | 33.8k (+11%) | 214.4k ~53.6k (+0%) | 83.2k ~20.8k (-31%) |
|  | 3-digests | 171.7k ~42.9k (-2%) | 94.4k (55%) | 5232 | 33.9k (+11%) | 213.9k ~53.5k (+0%) | 82.5k ~20.6k (-32%) |
|  | 5-gap | 173.9k ~43.5k (-1%) | 94.4k (54%) | 5232 | 33.9k (+11%) | 216.2k ~54.0k (+1%) | 84.7k ~21.2k (-30%) |
|  | 4-schema | 173.5k ~43.4k (-1%) | 94.0k (54%) | 5232 | 29.9k (-2%) | 211.6k ~52.9k (-1%) | 84.7k ~21.2k (-30%) |
| Battle of Europe, UK, r7 | before | 126.3k ~31.6k | 18.2k (14%) | 1910 | 30.4k | 160.1k ~40.0k | 110.0k ~27.5k |
|  | 1-layout | 127.2k ~31.8k (+1%) | 52.6k (41%) | 1910 | 33.8k (+11%) | 164.5k ~41.1k (+3%) | 76.5k ~19.1k (-30%) |
|  | 2-once | 125.7k ~31.4k (-0%) | 53.2k (42%) | 1910 | 33.8k (+11%) | 163.0k ~40.8k (+2%) | 74.4k ~18.6k (-32%) |
|  | 3-digests | 122.7k ~30.7k (-3%) | 53.2k (43%) | 1910 | 33.9k (+11%) | 160.1k ~40.0k (+0%) | 71.4k ~17.8k (-35%) |
|  | 5-gap | 124.2k ~31.0k (-2%) | 53.2k (43%) | 1910 | 33.9k (+11%) | 161.6k ~40.4k (+1%) | 72.8k ~18.2k (-34%) |
|  | 4-schema | 123.7k ~30.9k (-2%) | 52.8k (43%) | 1910 | 29.9k (-2%) | 157.0k ~39.3k (-2%) | 72.8k ~18.2k (-34%) |
| Modern Day, Poland, r2 (report-poland) | before | 90.6k ~22.6k | 17.9k (20%) | 1602 | 28.7k | 122.3k ~30.6k | 74.3k ~18.6k |
|  | 1-layout | 91.5k ~22.9k (+1%) | 52.3k (57%) | 1602 | 33.8k (+18%) | 128.5k ~32.1k (+5%) | 40.8k ~10.2k (-45%) |
|  | 2-once | 91.9k ~23.0k (+1%) | 52.9k (58%) | 1602 | 33.8k (+18%) | 128.9k ~32.2k (+5%) | 40.6k ~10.2k (-45%) |
|  | 3-digests | 91.9k ~23.0k (+1%) | 52.9k (58%) | 1602 | 33.9k (+18%) | 129.0k ~32.3k (+6%) | 40.6k ~10.2k (-45%) |
|  | 5-gap | 91.9k ~23.0k (+1%) | 52.9k (58%) | 1602 | 33.9k (+18%) | 129.0k ~32.3k (+6%) | 40.6k ~10.2k (-45%) |
|  | 4-schema | 91.5k ~22.9k (+1%) | 52.5k (57%) | 1602 | 29.9k (+4%) | 124.4k ~31.1k (+2%) | 40.6k ~10.2k (-45%) |
| 1836 Victorian Era, Ottomans, r1 | before | 250.4k ~62.6k | 172.8k (69%) | 12.0k | 30.4k | 294.3k ~73.6k | 89.6k ~22.4k |
|  | 1-layout | 251.3k ~62.8k (+0%) | 207.2k (82%) | 12.0k | 33.8k (+11%) | 298.7k ~74.7k (+1%) | 56.1k ~14.0k (-37%) |
|  | 2-once | 250.7k ~62.7k (+0%) | 207.8k (83%) | 12.0k | 33.8k (+11%) | 298.1k ~74.5k (+1%) | 54.9k ~13.7k (-39%) |
|  | 3-digests | 250.7k ~62.7k (+0%) | 207.8k (83%) | 12.0k | 33.9k (+11%) | 298.2k ~74.6k (+1%) | 54.9k ~13.7k (-39%) |
|  | 5-gap | 250.7k ~62.7k (+0%) | 207.8k (83%) | 12.0k | 33.9k (+11%) | 298.2k ~74.6k (+1%) | 54.9k ~13.7k (-39%) |
|  | 4-schema | 250.3k ~62.6k (-0%) | 207.4k (83%) | 12.0k | 29.9k (-2%) | 293.6k ~73.4k (-0%) | 54.9k ~13.7k (-39%) |


The runs, in the order the changes landed on beta (2026-11-07):

| Run | What changed |
|---|---|
| before | beta as it was (bd2a37df) |
| 1-layout | everything no turn changes first and cached: the shared opening of both skip templates up to `${CACHE_BREAK}`, the skip's standing rules at `${JUMP_STATIC_RULES}`, three Anthropic breakpoints and a one-hour prefix, one function from turn to turn |
| 2-once | orders, chats and the world summary's header sent once |
| 3-digests | older events told by their one-line digest (these saves have none yet: they show the 200-character fallback) |
| 5-gap | a line each for the recent events the ranking left out (adds 1.5k to 3k characters, on purpose) |
| 4-schema | the slimmer output function and `[Levers]` without its shapes |

The schema column in runs 1-layout to 5-gap is the folded skip's function with
the agents' reports always offered; 4-schema offers them only when agents are due
(the turn-to-turn function, under the 30,435 characters Gemini took).

### What it adds up to

- **The part a provider cannot cache** fell by 19 to 45% on every save (on
  Anthropic the functions are cached with the prefix): from 233.7k to 189.7k
  characters on the round-130 campaign, from 120.5k to 84.6k on New Dawn.
- **The cacheable share of the system prompt** went from 10-34% to 28-57% on the
  modern-day saves (83% on the 1836 save, whose lore is 152k characters).
- **The whole request** is 1 to 3% smaller. Phase 1 moved and de-duplicated; the
  bulk of a long campaign's prompt is its world, which Phase 2 is for: the map
  description (13k to 21k), the Projects board (22k on the round-130 save), units,
  occupied regions, groups, structures and city lists (7k to 13k each), and the
  event history.
- **The plan's targets** (prompt plus schema down 40%, the prefix 60% of the
  system prompt) are not met by Phase 1 on the long campaigns; they were set for
  the whole plan.

### How the cached part pays

On Anthropic a cache read costs a tenth of the input price, so on the round-130
campaign a skip within the hour pays full price for 189.7k characters and a tenth
for the 70.6k prefix and the functions, where it paid full price for 233.7k and a
tenth for 35.8k. On OpenAI the same prefix is cached implicitly (and now routed by
`prompt_cache_key`); on Gemini the implicit cache takes it when the opening is
identical, which it now is from skip to skip and between the two kinds of skip.
The sizes are the requests as the game builds them; how the skips read with them
is in [the quality A/B](prompt-compression-ab.md).

## Phase 2: what the turn is about in full, the rest in a line

| Save | Run | System prompt | Cacheable prefix (share) | User msg | Schema (Gemini) | Whole request | Not cacheable |
|---|---|---:|---:|---:|---:|---:|---:|
| Modern Day 2026 (copy), Italy, r130, 769 events | phase-1 | 248.1k ~62.0k | 70.6k (28%) | 12.2k | 32.3k | 293.9k ~73.5k | 189.7k ~47.4k |
|  | 6-focus | 243.2k ~60.8k (-2%) | 82.8k (34%) | 12.2k | 32.3k (+0%) | 288.9k ~72.2k (-2%) | 172.5k ~43.1k (-9%) |
|  | 8-tables | 236.3k ~59.1k (-5%) | 82.5k (35%) | 12.2k | 32.3k (+0%) | 282.1k ~70.5k (-4%) | 166.0k ~41.5k (-13%) |
|  | 10-projects | 224.6k ~56.1k (-9%) | 86.2k (38%) | 12.2k | 32.3k (+0%) | 270.4k ~67.6k (-8%) | 150.5k ~37.6k (-21%) |
|  | 7-history | 224.7k ~56.2k (-9%) | 95.1k (42%) | 12.2k | 32.1k (-1%) | 270.3k ~67.6k (-8%) | 141.7k ~35.4k (-25%) |
| Modern Day (built-in), Brazil, r67, 905 events | phase-1 | 179.5k ~44.9k | 52.5k (29%) | 3441 | 29.9k | 214.3k ~53.6k | 130.5k ~32.6k |
|  | 6-focus | 173.0k ~43.2k (-4%) | 62.0k (36%) | 3441 | 29.9k (+0%) | 207.8k ~51.9k (-3%) | 114.4k ~28.6k (-12%) |
|  | 8-tables | 169.3k ~42.3k (-6%) | 61.7k (36%) | 3441 | 29.9k (+0%) | 204.2k ~51.0k (-5%) | 111.1k ~27.8k (-15%) |
|  | 10-projects | 169.4k ~42.4k (-6%) | 65.4k (39%) | 3441 | 29.9k (+0%) | 204.2k ~51.1k (-5%) | 107.4k ~26.9k (-18%) |
|  | 7-history | 170.0k ~42.5k (-5%) | 74.3k (44%) | 3441 | 29.6k (-1%) | 204.6k ~51.2k (-4%) | 99.2k ~24.8k (-24%) |
| New Dawn, Germany, r30, 259 events | phase-1 | 171.8k ~43.0k | 92.3k (54%) | 5152 | 29.9k | 209.8k ~52.5k | 84.6k ~21.2k |
|  | 6-focus | 167.2k ~41.8k (-3%) | 93.3k (56%) | 5152 | 29.9k (+0%) | 205.2k ~51.3k (-2%) | 79.0k ~19.8k (-7%) |
|  | 8-tables | 166.8k ~41.7k (-3%) | 94.6k (57%) | 5152 | 29.9k (+0%) | 204.8k ~51.2k (-2%) | 77.4k ~19.4k (-9%) |
|  | 10-projects | 166.9k ~41.7k (-3%) | 98.3k (59%) | 5152 | 29.9k (+0%) | 204.9k ~51.2k (-2%) | 73.8k ~18.4k (-13%) |
|  | 7-history | 167.0k ~41.8k (-3%) | 103.0k (62%) | 5152 | 29.6k (-1%) | 204.8k ~51.2k (-2%) | 69.2k ~17.3k (-18%) |
| New Dawn, Germany, r30 — auto-jump | phase-1 | 173.5k ~43.4k | 94.0k (54%) | 5232 | 29.9k | 211.6k ~52.9k | 84.7k ~21.2k |
|  | 6-focus | 168.8k ~42.2k (-3%) | 94.9k (56%) | 5232 | 29.9k (+0%) | 206.9k ~51.7k (-2%) | 79.1k ~19.8k (-7%) |
|  | 8-tables | 168.5k ~42.1k (-3%) | 96.2k (57%) | 5232 | 29.9k (+0%) | 206.6k ~51.6k (-2%) | 77.5k ~19.4k (-9%) |
|  | 10-projects | 168.6k ~42.1k (-3%) | 99.9k (59%) | 5232 | 29.9k (+0%) | 206.7k ~51.7k (-2%) | 73.8k ~18.5k (-13%) |
|  | 7-history | 168.7k ~42.2k (-3%) | 104.6k (62%) | 5232 | 29.6k (-1%) | 206.6k ~51.6k (-2%) | 69.3k ~17.3k (-18%) |
| Battle of Europe, UK, r7 | phase-1 | 123.7k ~30.9k | 52.8k (43%) | 1910 | 29.9k | 157.0k ~39.3k | 72.8k ~18.2k |
|  | 6-focus | 115.7k ~28.9k (-6%) | 62.4k (54%) | 1910 | 29.9k (+0%) | 149.0k ~37.3k (-5%) | 55.3k ~13.8k (-24%) |
|  | 8-tables | 114.1k ~28.5k (-8%) | 62.0k (54%) | 1910 | 29.9k (+0%) | 147.4k ~36.8k (-6%) | 54.0k ~13.5k (-26%) |
|  | 10-projects | 114.1k ~28.5k (-8%) | 65.8k (58%) | 1910 | 29.9k (+0%) | 147.4k ~36.9k (-6%) | 50.3k ~12.6k (-31%) |
|  | 7-history | 114.3k ~28.6k (-8%) | 65.9k (58%) | 1910 | 29.6k (-1%) | 147.3k ~36.8k (-6%) | 50.2k ~12.6k (-31%) |
| Modern Day, Poland, r2 (report-poland) | phase-1 | 91.5k ~22.9k | 52.5k (57%) | 1602 | 29.9k | 124.4k ~31.1k | 40.6k ~10.2k |
|  | 6-focus | 89.8k ~22.5k (-2%) | 53.4k (59%) | 1602 | 29.9k (+0%) | 122.8k ~30.7k (-1%) | 38.0k ~9502 (-6%) |
|  | 8-tables | 89.9k ~22.5k (-2%) | 54.7k (61%) | 1602 | 29.9k (+0%) | 122.9k ~30.7k (-1%) | 36.8k ~9209 (-9%) |
|  | 10-projects | 89.9k ~22.5k (-2%) | 54.7k (61%) | 1602 | 29.9k (+0%) | 122.9k ~30.7k (-1%) | 36.8k ~9209 (-9%) |
|  | 7-history | 90.1k ~22.5k (-2%) | 54.9k (61%) | 1602 | 29.6k (-1%) | 122.8k ~30.7k (-1%) | 36.8k ~9203 (-9%) |
| 1836 Victorian Era, Ottomans, r1 | phase-1 | 250.3k ~62.6k | 207.4k (83%) | 12.0k | 29.9k | 293.6k ~73.4k | 54.9k ~13.7k |
|  | 6-focus | 247.1k ~61.8k (-1%) | 208.2k (84%) | 12.0k | 29.9k (+0%) | 290.5k ~72.6k (-1%) | 50.9k ~12.7k (-7%) |
|  | 8-tables | 247.1k ~61.8k (-1%) | 209.5k (85%) | 12.0k | 29.9k (+0%) | 290.5k ~72.6k (-1%) | 49.7k ~12.4k (-9%) |
|  | 10-projects | 246.9k ~61.7k (-1%) | 213.2k (86%) | 12.0k | 29.9k (+0%) | 290.3k ~72.6k (-1%) | 45.7k ~11.4k (-17%) |
|  | 7-history | 247.1k ~61.8k (-1%) | 213.4k (86%) | 12.0k | 29.6k (-1%) | 290.2k ~72.6k (-1%) | 45.7k ~11.4k (-17%) |


The runs, in the order the changes landed on beta (2026-11-07):

| Run | What changed |
|---|---|
| phase-1 | beta after Phase 1 (ee370a05), the same as 4-schema above |
| 6-focus | what the turn is about in full, the rest in a line: the powers in view (the player, its neighbours, every power at war, every power the orders name, the chat partners, the powers the recent events moved, those changed since the last skip or in a live storyline, and a rotating spotlight of three distant powers), every other power by name and size; territorial changes and tags grouped; polity lore and the city catalog in the cached opening; units, structures, contested regions and groups of powers out of view in a line; the air strikes and unruled-land caps |
| 8-tables | units, structures, cities and the hidden backend's figures as compact tables; the military feasibility doctrine once, among the standing rules |
| 10-projects | the newest 15 closed projects named and the rest counted; the board's rules in the cached opening (group chats and ballots, item 9, land in this run too, but the rig measures time skips only) |
| 7-history | the history in tiers (years, eras) and the canon that never fades; the story so far in the cached opening |

### What it adds up to

Against the requests before the plan (the `before` run above):

| Save | Run | System prompt | Cacheable prefix (share) | User msg | Schema (Gemini) | Whole request | Not cacheable |
|---|---|---:|---:|---:|---:|---:|---:|
| Modern Day 2026 (copy), Italy, r130, 769 events | before | 257.4k ~64.3k | 35.8k (14%) | 12.2k | 32.8k | 303.6k ~75.9k | 233.7k ~58.4k |
|  | 7-history | 224.7k ~56.2k (-13%) | 95.1k (42%) | 12.2k | 32.1k (-2%) | 270.3k ~67.6k (-11%) | 141.7k ~35.4k (-39%) |
| Modern Day (built-in), Brazil, r67, 905 events | before | 179.7k ~44.9k | 17.9k (10%) | 3441 | 31.1k | 215.7k ~53.9k | 165.2k ~41.3k |
|  | 7-history | 170.0k ~42.5k (-5%) | 74.3k (44%) | 3441 | 29.6k (-5%) | 204.6k ~51.2k (-5%) | 99.2k ~24.8k (-40%) |
| New Dawn, Germany, r30, 259 events | before | 173.1k ~43.3k | 57.8k (33%) | 5152 | 30.4k | 211.7k ~52.9k | 120.5k ~30.1k |
|  | 7-history | 167.0k ~41.8k (-4%) | 103.0k (62%) | 5152 | 29.6k (-3%) | 204.8k ~51.2k (-3%) | 69.2k ~17.3k (-43%) |
| New Dawn, Germany, r30 — auto-jump | before | 174.9k ~43.7k | 59.5k (34%) | 5232 | 30.4k | 213.5k ~53.4k | 120.7k ~30.2k |
|  | 7-history | 168.7k ~42.2k (-4%) | 104.6k (62%) | 5232 | 29.6k (-3%) | 206.6k ~51.6k (-3%) | 69.3k ~17.3k (-43%) |
| Battle of Europe, UK, r7 | before | 126.3k ~31.6k | 18.2k (14%) | 1910 | 30.4k | 160.1k ~40.0k | 110.0k ~27.5k |
|  | 7-history | 114.3k ~28.6k (-10%) | 65.9k (58%) | 1910 | 29.6k (-3%) | 147.3k ~36.8k (-8%) | 50.2k ~12.6k (-54%) |
| Modern Day, Poland, r2 (report-poland) | before | 90.6k ~22.6k | 17.9k (20%) | 1602 | 28.7k | 122.3k ~30.6k | 74.3k ~18.6k |
|  | 7-history | 90.1k ~22.5k (-1%) | 54.9k (61%) | 1602 | 29.6k (+3%) | 122.8k ~30.7k (+0%) | 36.8k ~9203 (-50%) |
| 1836 Victorian Era, Ottomans, r1 | before | 250.4k ~62.6k | 172.8k (69%) | 12.0k | 30.4k | 294.3k ~73.6k | 89.6k ~22.4k |
|  | 7-history | 247.1k ~61.8k (-1%) | 213.4k (86%) | 12.0k | 29.6k (-3%) | 290.2k ~72.6k (-1%) | 45.7k ~11.4k (-49%) |

- **The part a provider cannot cache** is down 39 to 54% on every save: from
  233.7k to 141.7k characters on the round-130 campaign,
  165.2k to 99.2k on the round-67 one, 120.5k to 69.2k on New Dawn. The median
  is down 43%, from 120.5k to 69.2k.
- **The cacheable share** of the system prompt has a median of 61% over the
  seven requests (target 60%): 58 to 62% on the shorter campaigns and New Dawn,
  86% on the 1836 save, but 42 to 44% on the two long modern-day campaigns,
  whose live records are still the bigger part.
- **The whole request** (prompt plus schema) is up to 11% smaller (the
  round-2 Poland save is the same size), a median of 4% smaller, against the plan's target of 40%. That target is not reached and cannot be
  reached by Phase 2's kind of change: the cached opening (55k to 105k, 213k
  with the 1836 scenario's lore: the rules, the scenario, and now the story so
  far, the polity lore and the cities) and the 30k output function are sent
  every time and make up 47 to 84% of each request, and much of what the two
  phases took out of the live part moved into that opening rather than out of
  the request. On Anthropic a
  cached read is a tenth of the price, so what a skip costs follows the part
  that cannot be cached far more than the whole; on Gemini and OpenAI the
  implicit caches take an identical opening, which every skip of a campaign now
  has between folds of its history and renewals of its lore.

### Where the long campaign's live records still go

On the round-130 campaign, after Phase 2, the biggest parts of what cannot be
cached are the map description (18.1k, most of it the region names of the
powers in view, which a regionTransfers entry copies), the player's diplomacy
(11.6k, untouched: each thread's memory and last words), the occupied and
contested regions (9.6k: this campaign's wars put most of them in view), the
recent events (8.8k), the fronts (7.6k), the units (7.2k), Rostra and this
round's orders (6.9k each), the structures (6.8k), the board (6.5k) and the
storylines in motion (6.4k).

### What the quality A/B should check

It has since been run: [the quality A/B](prompt-compression-ab.md) (2026-11-07,
five saves, gemini-3.5-flash-lite). What it was asked to look at, change by change:

- **Powers out of view in a line.** Do off-screen powers still act (count the
  events that name only powers out of view, and the spotlight's three)? Are
  regionTransfers between two powers out of view still resolved on the first
  try, or does the engine's retry fire more often (it costs a request)?
- **Changed since the last skip.** A power whose border moved is in view on the
  next skip: check it is (the snapshot is stored when the skip is written).
- **Units and structures of powers out of view by name only.** Are their moves
  still plausible without coordinates in the prompt?
- **Contested regions grouped.** Are occupations and claims still told right,
  and none forgotten (a region whose line names only the first six)?
- **Closed projects counted.** Does the model ever start a finished project
  again under its old name?
- **The history in tiers.** Do folds come back with years and canon (the judge
  logs every entry it leaves out)? Do dead leaders stay dead and treaties stay in
  force across forty skips? Is an era ever condensed so far that a war's cause is
  lost (a revision below a third of the eras' words is refused)?
- **The story so far and the polity lore in the opening.** The model reads them
  before the game's details now: check it still treats the records under
  [Game Map Description] and the ledgers as what is true now.

## After Phase 2

- **Names, never ids** (`40a19bd5`, after the runs above): the event history's
  impact lines, the groups' areas, the World Director's pressures and the
  lookups name regions instead of printing their ids. Measured with the rig:
  the round-130 skip is 806 characters smaller (nineteen groups' areas lose
  their ids), New Dawn 23 smaller, Battle of Europe 15 larger, Poland
  unchanged.
- **Related past events** (`92e3f141`) adds at most about 2,000 characters to a
  skip, once the model has loaded (opt-in then, built in and always on since
  2026-11-07); the runs above
  are without it.
- **The quality A/B's findings are fixed**: see [the fixes of 2026-11-07](#the-quality-ab-fixes-2026-11-07) below and
  [round 2 of the A/B](prompt-compression-ab.md#round-2-the-fixes).

## The quality A/B fixes (2026-11-07)

[The quality A/B](prompt-compression-ab.md) found five things; each is a commit
on beta:

| Commit | Fix |
|---|---|
| `dec54c13` | No spotlight. Idle diplomacy's relevant countries (`rankRelevantPolities`, twenty) are in view, scored as neighbours. |
| `5572ef54` | Places: the gazetteer ranks a region by the country it lies in on the base map; the places rule says where region names come from and whose country a place is; [City Coordinates] says what it is for; the region names fill their budget (480) with the next powers by rank after the powers in view. |
| `73006564` | A skip with no fold due is told to leave `history` out (one line, in the live part). |
| `ebf9318e` | The fold's `years`, `canon` and `eras` name their fields (+443 characters of schema as Gemini gets it). |
| `094dc518` | Each power in the one-line list carries its leader, wars, alliances, agreements, latest peace and who holds its land; a line says who holds a region the description never names; overrides for regions the map lacks are no longer printed as ids. |

Measured with `scripts/prompt-size.mjs` on the same seven requests, beta
`b48491a2` (before) against the fixes (after):

| Save | Run | System prompt | Cacheable prefix (share) | User msg | Schema (Gemini) | Whole request | Not cacheable |
|---|---|---:|---:|---:|---:|---:|---:|
| Modern Day 2026 (copy), Italy, r130 | before | 223.9k | 95.1k (42%) | 12.2k | 32.1k | 269.5k | 140.9k |
| | after | 226.7k (+1.3%) | 95.5k (42%) | 12.2k | 32.5k | 272.8k (+1.2%) | 143.4k (+1.8%) |
| Modern Day (built-in), Brazil, r67 | before | 170.4k | 74.3k (44%) | 3441 | 29.6k | 205.0k | 99.6k |
| | after | 170.5k (+0.1%) | 74.6k (44%) | 3441 | 30.1k | 205.5k (+0.2%) | 99.3k (-0.3%) |
| New Dawn, Germany, r30 | before | 167.0k | 103.0k (62%) | 5152 | 29.6k | 204.8k | 69.2k |
| | after | 168.8k (+1.1%) | 103.3k (61%) | 5152 | 30.1k | 207.0k (+1.1%) | 70.6k (+2.0%) |
| New Dawn, Germany, r30 — auto-jump | before | 168.7k | 104.6k (62%) | 5232 | 29.6k | 206.6k | 69.3k |
| | after | 170.4k (+1.0%) | 105.0k (62%) | 5232 | 30.1k | 208.8k (+1.1%) | 70.7k (+2.0%) |
| Battle of Europe, UK, r7 | before | 114.3k | 65.9k (58%) | 1910 | 29.6k | 147.4k | 50.3k |
| | after | 118.9k (+4.0%) | 66.3k (56%) | 1910 | 30.1k | 152.4k (+3.4%) | 54.5k (+8.3%) |
| Modern Day, Poland, r2 | before | 90.1k | 54.9k (61%) | 1602 | 29.6k | 122.8k | 36.8k |
| | after | 90.9k (+0.9%) | 55.2k (61%) | 1602 | 30.1k | 124.1k (+1.1%) | 37.3k (+1.4%) |
| 1836 Victorian Era, Ottomans, r1 | before | 247.0k | 213.4k (86%) | 12.0k | 29.6k | 290.1k | 45.6k |
| | after | 246.0k (-0.4%) | 213.7k (87%) | 12.0k | 30.1k | 289.6k (-0.2%) | 44.2k (-3.1%) |

- The whole request is 0.2 to 3.4% larger on six saves and 0.2% smaller on
  the 1836 save; the part a provider cannot cache moves -3% to +8%. Against
  the requests before the plan (the `before` run at the top), every save is
  still smaller: Battle of Europe's whole request is 152.4k against 160.1k,
  its uncached part 54.5k against 110.0k.
- Where it went: the one-line list's records (most on the round-130
  campaign, whose political world names a leader for most powers; nothing on
  saves without leaders, alliances or treaties on record), the region names
  filling their budget (Battle of Europe's powers in view hold 156 region
  names of the 480, so +4.2k there), the history items in the schema (+443 on
  every request) and the places rule (cached). The spotlight's sentence went,
  and so did the round-67 save's 120 region ids in its territorial changes
  (about 700 characters).
- Gemini's own count of the skips sent in [round 2](prompt-compression-ab.md#round-2-the-fixes):
  239,462 prompt tokens over the five, against 249,998 for the old prompt and
  236,662 for round 1's new one.

## By section

Sections of at least 1,000 characters in any run, the rest summed: before the
plan, after Phase 1 (4-schema) and after Phase 2 (7-history).

### 1836 Victorian Era, Ottomans, round 1 — jumpForward

| | before | 4-schema | 7-history |
|---|---:|---:|---:|
| System prompt | 250.4k chars ~62.6k | 250.3k chars ~62.6k (-0%) | 247.1k chars ~61.8k (-1%) |
| Cacheable prefix | 172.8k chars ~43.2k | 207.4k chars ~51.9k (20%) | 213.4k chars ~53.3k (23%) |
| Cacheable share | 69.0% | 82.9% (20%) | 86.4% (25%) |
| User message | 12.0k chars ~3000 | 12.0k chars ~3000 (0%) | 12.0k chars ~3000 (0%) |
| Output schema (as Gemini gets it) | 30.4k chars ~7609 | 29.9k chars ~7463 (-2%) | 29.6k chars ~7411 (-3%) |
| All tools (Anthropic) | 31.9k chars ~7974 | 31.4k chars ~7842 (-2%) | 31.2k chars ~7791 (-2%) |
| Whole request | 294.3k chars ~73.6k | 293.6k chars ~73.4k (-0%) | 290.2k chars ~72.6k (-1%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 89.6k chars ~22.4k | 54.9k chars ~13.7k (-39%) | 45.7k chars ~11.4k (-49%) |

| Section | before | 4-schema | 7-history |
|---|---:|---:|---:|
| Extra Simulation Rules for This Preset | 110.4k | 110.6k | 110.6k |
| The World Before Round 1 | 44.4k | 44.4k | 44.4k |
| Levers | 9606 | 9175 | 9175 |
| Fronts | 8554 | 3257 | 3257 |
| Occupied and Contested Regions | 8389 | 8389 | 6049 |
| Projects & Operations | 6220 | 6220 | 2272 |
| Front Orders | – | 5438 | 5438 |
| Taking Ground | 763 | 763 | 5229 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 4996 | 4024 | 4024 |
| Every Event Carries Its Consequences | 4838 | 4838 | 4838 |
| Relations and Agreements | 4474 | 207 | 207 |
| How Relations and Agreements Are Recorded | – | 4424 | 4424 |
| Game Map Description | 3580 | 3268 | 2373 |
| How to Write an Event | 2694 | 2695 | 2695 |
| Player Focus | 2356 | 1141 | 1141 |
| This Round | 2042 | 2350 | 2350 |
| Social Media | 2231 | 2231 | 2231 |
| Wars | 2129 | 227 | 227 |
| How Wars Are Recorded | – | 2013 | 2013 |
| Units and Structures on the Map | 730 | 730 | 1988 |
| The Map | 1972 | 1972 | 1972 |
| Difficulty | 1814 | 1814 | 1814 |
| Real History Is the Default | 1728 | 1728 | 1728 |
| Units and Structures | 1635 | 1635 | 1635 |
| The World Answers Back | 1621 | 1621 | 1621 |
| Reading the Diplomatic Ledger | – | 1616 | 1616 |
| Figures the War Needs | 1591 | 1591 | 1591 |
| What Is in Motion | 1587 | 1587 | 1587 |
| Event History of This Game | 1469 | 1469 | 1446 |
| Espionage Orders | 1433 | 1433 | 1433 |
| Polities | 1427 | 1427 | 1427 |
| Current Military Units | 1409 | 1409 | 175 |
| PRIORITY | 1405 | 1154 | 1154 |
| What an Order Can Do | 1262 | 1262 | 1262 |
| Military Strength | 1200 | 1200 | 1200 |
| (all smaller sections) | 10.5k | 10.9k | 10.5k |

### Battle of Europe, UK, round 7 — jumpForward

| | before | 4-schema | 7-history |
|---|---:|---:|---:|
| System prompt | 126.3k chars ~31.6k | 123.7k chars ~30.9k (-2%) | 114.3k chars ~28.6k (-10%) |
| Cacheable prefix | 18.2k chars ~4539 | 52.8k chars ~13.2k (191%) | 65.9k chars ~16.5k (263%) |
| Cacheable share | 14.4% | 42.7% (197%) | 57.7% (301%) |
| User message | 1910 chars ~478 | 1910 chars ~478 (0%) | 1910 chars ~478 (0%) |
| Output schema (as Gemini gets it) | 30.4k chars ~7609 | 29.9k chars ~7463 (-2%) | 29.6k chars ~7411 (-3%) |
| All tools (Anthropic) | 31.9k chars ~7974 | 31.4k chars ~7842 (-2%) | 31.2k chars ~7791 (-2%) |
| Whole request | 160.1k chars ~40.0k | 157.0k chars ~39.3k (-2%) | 147.3k chars ~36.8k (-8%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 110.0k chars ~27.5k | 72.8k chars ~18.2k (-34%) | 50.2k chars ~12.6k (-54%) |

| Section | before | 4-schema | 7-history |
|---|---:|---:|---:|
| Game Map Description | 12.5k | 12.1k | 6118 |
| Event History of This Game | 10.7k | 9161 | 9138 |
| Levers | 9606 | 9175 | 9175 |
| City Coordinates | 8811 | 9004 | 7409 |
| Fronts | 8554 | 3257 | 3257 |
| Front Orders | – | 5438 | 5438 |
| Taking Ground | 763 | 763 | 5229 |
| Every Event Carries Its Consequences | 4838 | 4838 | 4838 |
| War Weariness, Peace and Alliances | 4621 | 4621 | 4621 |
| Projects & Operations | 4543 | 4543 | 831 |
| Relations and Agreements | 4474 | 207 | 207 |
| How Relations and Agreements Are Recorded | – | 4424 | 4424 |
| What Is in Motion | 4223 | 4223 | 4223 |
| Occupied and Contested Regions | 3559 | 3559 | 1318 |
| How to Write an Event | 2694 | 2695 | 2695 |
| Wars | 2356 | 454 | 454 |
| Figures the War Needs | 2277 | 2277 | 2277 |
| Social Media | 2231 | 2231 | 2231 |
| Diplomacy So Far | 2218 | 2218 | 2218 |
| Units and Structures on the Map | 763 | 763 | 2021 |
| How Wars Are Recorded | – | 2013 | 2013 |
| The Map | 1975 | 1975 | 1975 |
| Current Military Units | 1935 | 1935 | 586 |
| Seas | 1794 | 1794 | 1794 |
| Real History Is the Default | 1728 | 1728 | 1728 |
| Diplomatic Memory | 1658 | – | – |
| Units and Structures | 1635 | 1635 | 1635 |
| The World Answers Back | 1621 | 1621 | 1621 |
| Reading the Diplomatic Ledger | – | 1616 | 1616 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1558 | 586 | 586 |
| Espionage Orders | 1433 | 1433 | 1433 |
| Polities | 1427 | 1427 | 1427 |
| Difficulty | 1394 | 1394 | 1394 |
| PRIORITY | 1330 | 1079 | 1079 |
| Military Strength | 1306 | 1306 | 1306 |
| This Round | 1303 | 1303 | 1303 |
| What an Order Can Do | 1262 | 1262 | 1262 |
| Player Focus | 1069 | 1069 | 1069 |
| (all smaller sections) | 12.0k | 12.6k | 12.3k |

### Modern Day 2026 (copy), Italy, round 130 — jumpForward

| | before | 4-schema | 7-history |
|---|---:|---:|---:|
| System prompt | 257.4k chars ~64.3k | 248.1k chars ~62.0k (-4%) | 224.7k chars ~56.2k (-13%) |
| Cacheable prefix | 35.8k chars ~8952 | 70.6k chars ~17.6k (97%) | 95.1k chars ~23.8k (166%) |
| Cacheable share | 13.9% | 28.4% (104%) | 42.3% (204%) |
| User message | 12.2k chars ~3038 | 12.2k chars ~3038 (0%) | 12.2k chars ~3038 (0%) |
| Output schema (as Gemini gets it) | 32.8k chars ~8189 | 32.3k chars ~8066 (-2%) | 32.1k chars ~8015 (-2%) |
| All tools (Anthropic) | 34.0k chars ~8512 | 33.6k chars ~8404 (-1%) | 33.4k chars ~8352 (-2%) |
| Whole request | 303.6k chars ~75.9k | 293.9k chars ~73.5k (-3%) | 270.3k chars ~67.6k (-11%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 233.7k chars ~58.4k | 189.7k chars ~47.4k (-19%) | 141.7k chars ~35.4k (-39%) |

| Section | before | 4-schema | 7-history |
|---|---:|---:|---:|
| Event History of This Game | 25.6k | 17.6k | 8808 |
| Projects & Operations | 22.0k | 22.0k | 6520 |
| Game Map Description | 20.8k | 20.5k | 18.1k |
| City Coordinates | 7419 | 7612 | 18.8k |
| Extra Simulation Rules for This Preset | 13.0k | 13.3k | 13.3k |
| Current Military Units | 13.1k | 13.1k | 7215 |
| Fronts | 12.9k | 7581 | 7581 |
| Diplomacy So Far | 11.6k | 11.6k | 11.6k |
| Occupied and Contested Regions | 10.8k | 10.8k | 9631 |
| Groups | 10.7k | 10.7k | 4792 |
| Levers | 9606 | 9175 | 9175 |
| Structures Built During Play | 7181 | 7181 | 6772 |
| Social Media | 6939 | 6939 | 6939 |
| This Round | 6914 | 6914 | 6914 |
| What Is in Motion | 6355 | 6355 | 6355 |
| Front Orders | – | 5438 | 5438 |
| Taking Ground | 763 | 763 | 5229 |
| The World Before Round 1 | 5098 | 5098 | 5098 |
| War Weariness, Peace and Alliances | 4856 | 4856 | 4856 |
| Every Event Carries Its Consequences | 4838 | 4838 | 4838 |
| Relations and Agreements | 4486 | 207 | 207 |
| How Relations and Agreements Are Recorded | – | 4436 | 4436 |
| Scenario National Stats Sheet | 4062 | 4062 | 4062 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 3325 | 2353 | 2353 |
| Figures the War Needs | 3130 | 3130 | 3130 |
| Wars | 2910 | 984 | 984 |
| How to Write an Event | 2694 | 2695 | 2695 |
| Seas | 2529 | 2529 | 2529 |
| How Wars Are Recorded | – | 2037 | 2037 |
| Units and Structures on the Map | 763 | 763 | 2021 |
| The Map | 1975 | 1975 | 1975 |
| Diplomatic Memory | 1972 | – | – |
| Hidden Backend | 1801 | 1801 | 1479 |
| Real History Is the Default | 1728 | 1728 | 1728 |
| Espionage | 1659 | 1659 | 1659 |
| The World Answers Back | 1657 | 1657 | 1657 |
| Units and Structures | 1635 | 1635 | 1635 |
| Reading the Diplomatic Ledger | – | 1616 | 1616 |
| Espionage Orders | 1493 | 1493 | 1493 |
| Polities | 1439 | 1439 | 1439 |
| Difficulty | 1423 | 1423 | 1423 |
| Player Focus | 1326 | 1326 | 1326 |
| PRIORITY | 1309 | 1058 | 1058 |
| What an Order Can Do | 1274 | 1274 | 1274 |
| Military Strength | 1211 | 1211 | 1211 |
| Reports on File | 1046 | 1046 | 1046 |
| Player Agency | 1005 | 1005 | 1005 |
| (all smaller sections) | 8937 | 9229 | 9229 |

### Modern Day (built-in), Brazil, round 67 — jumpForward

| | before | 4-schema | 7-history |
|---|---:|---:|---:|
| System prompt | 179.7k chars ~44.9k | 179.5k chars ~44.9k (-0%) | 170.0k chars ~42.5k (-5%) |
| Cacheable prefix | 17.9k chars ~4475 | 52.5k chars ~13.1k (193%) | 74.3k chars ~18.6k (315%) |
| Cacheable share | 10.0% | 29.2% (193%) | 43.7% (338%) |
| User message | 3441 chars ~860 | 3441 chars ~860 (0%) | 3441 chars ~860 (0%) |
| Output schema (as Gemini gets it) | 31.1k chars ~7776 | 29.9k chars ~7463 (-4%) | 29.6k chars ~7411 (-5%) |
| All tools (Anthropic) | 32.6k chars ~8149 | 31.4k chars ~7842 (-4%) | 31.2k chars ~7791 (-4%) |
| Whole request | 215.7k chars ~53.9k | 214.3k chars ~53.6k (-1%) | 204.6k chars ~51.2k (-5%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 165.2k chars ~41.3k | 130.5k chars ~32.6k (-21%) | 99.2k chars ~24.8k (-40%) |

| Section | before | 4-schema | 7-history |
|---|---:|---:|---:|
| Event History of This Game | 20.7k | 21.3k | 12.6k |
| The World's Share | 17.9k | 18.9k | 19.1k |
| City Coordinates | 8811 | 9004 | 16.1k |
| Game Map Description | 12.9k | 12.7k | 11.2k |
| Levers | 9606 | 9175 | 9175 |
| This Round | 9462 | 9462 | 9462 |
| Fronts | 8530 | 3233 | 3233 |
| Language | 6878 | 6878 | 7197 |
| Occupied and Contested Regions | 7107 | 7107 | 1855 |
| Current Military Units | 6337 | 6337 | 3110 |
| Projects & Operations | 5471 | 5471 | 1797 |
| Front Orders | – | 5438 | 5438 |
| Taking Ground | 763 | 763 | 5229 |
| Every Event Carries Its Consequences | 4838 | 4838 | 4838 |
| War Weariness, Peace and Alliances | 4763 | 4763 | 4763 |
| Relations and Agreements | 4466 | 207 | 207 |
| How Relations and Agreements Are Recorded | – | 4416 | 4416 |
| What Is in Motion | 4105 | 4105 | 4105 |
| Diplomacy So Far | 3353 | 3353 | 3353 |
| How to Write an Event | 2694 | 2695 | 2695 |
| Diplomatic Memory | 2634 | – | – |
| Wars | 2334 | 448 | 448 |
| Social Media | 2215 | 2215 | 2215 |
| Units and Structures on the Map | 763 | 763 | 2021 |
| How Wars Are Recorded | – | 1997 | 1997 |
| Figures the War Needs | 1992 | 1992 | 1992 |
| The Map | 1975 | 1975 | 1975 |
| Seas | 1833 | 1833 | 1833 |
| Real History Is the Default | 1728 | 1728 | 1728 |
| Units and Structures | 1635 | 1635 | 1635 |
| Reading the Diplomatic Ledger | – | 1616 | 1616 |
| The World Answers Back | 1597 | 1597 | 1597 |
| Difficulty | 1423 | 1423 | 1423 |
| Polities | 1419 | 1419 | 1419 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1399 | 427 | 427 |
| Espionage Orders | 1393 | 1393 | 1393 |
| PRIORITY | 1309 | 1058 | 1058 |
| Structures Built During Play | 1015 | 1015 | 1302 |
| Military Strength | 1300 | 1300 | 1300 |
| What an Order Can Do | 1254 | 1254 | 1254 |
| Player Focus | 1103 | 1103 | 1103 |
| (all smaller sections) | 10.7k | 11.2k | 10.6k |

### New Dawn, Germany, round 30 — autoJumpForward

| | before | 4-schema | 7-history |
|---|---:|---:|---:|
| System prompt | 174.9k chars ~43.7k | 173.5k chars ~43.4k (-1%) | 168.7k chars ~42.2k (-4%) |
| Cacheable prefix | 59.5k chars ~14.9k | 94.0k chars ~23.5k (58%) | 104.6k chars ~26.2k (76%) |
| Cacheable share | 34.0% | 54.2% (59%) | 62.0% (82%) |
| User message | 5232 chars ~1308 | 5232 chars ~1308 (0%) | 5232 chars ~1308 (0%) |
| Output schema (as Gemini gets it) | 30.4k chars ~7609 | 29.9k chars ~7463 (-2%) | 29.6k chars ~7411 (-3%) |
| All tools (Anthropic) | 33.4k chars ~8347 | 32.9k chars ~8215 (-2%) | 32.7k chars ~8164 (-2%) |
| Whole request | 213.5k chars ~53.4k | 211.6k chars ~52.9k (-1%) | 206.6k chars ~51.6k (-3%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 120.7k chars ~30.2k | 84.7k chars ~21.2k (-30%) | 69.3k chars ~17.3k (-43%) |

| Section | before | 4-schema | 7-history |
|---|---:|---:|---:|
| Event History of This Game | 13.7k | 15.3k | 10.7k |
| What to Simulate | 14.7k | 14.7k | 14.7k |
| Game Map Description | 13.3k | 13.0k | 9546 |
| Fronts | 12.8k | 7549 | 7549 |
| City Coordinates | 7156 | 7651 | 12.2k |
| Levers | 9606 | 9175 | 9175 |
| The World Before Round 1 | 6086 | 6086 | 6086 |
| This Round | 5906 | 5934 | 5934 |
| Front Orders | – | 5438 | 5438 |
| Difficulty | 5345 | 5345 | 5345 |
| Taking Ground | 763 | 763 | 5229 |
| Diplomacy So Far | 5160 | 5160 | 5160 |
| Every Event Carries Its Consequences | 4838 | 4838 | 4838 |
| Relations and Agreements | 4467 | 207 | 207 |
| What Is in Motion | 4417 | 4417 | 4417 |
| How Relations and Agreements Are Recorded | – | 4417 | 4417 |
| Projects & Operations | 4415 | 4415 | 741 |
| Diplomatic Memory | 3703 | – | – |
| Diplomacy | 3572 | 3572 | 3572 |
| War Weariness, Peace and Alliances | 3435 | 3435 | 3435 |
| Wars | 3369 | 1481 | 1481 |
| What a Polity Is | 3107 | 3107 | 3107 |
| Figures the War Needs | 2734 | 2734 | 2734 |
| How to Write an Event | 2694 | 2695 | 2695 |
| Current Military Units | 2658 | 2658 | 1105 |
| Seas | 2504 | 2504 | 2504 |
| Social Media | 2217 | 2217 | 2217 |
| Occupied and Contested Regions | 2085 | 2085 | 634 |
| Units and Structures on the Map | 763 | 763 | 2021 |
| How Wars Are Recorded | – | 1999 | 1999 |
| The Map | 1975 | 1975 | 1975 |
| Real History Is the Default | 1728 | 1728 | 1728 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1644 | 672 | 672 |
| Units and Structures | 1635 | 1635 | 1635 |
| Reading the Diplomatic Ledger | – | 1616 | 1616 |
| The World Answers Back | 1599 | 1600 | 1600 |
| Polities | 1420 | 1420 | 1420 |
| Espionage Orders | 1398 | 1398 | 1398 |
| PRIORITY | 1375 | 1079 | 1079 |
| Military Strength | 1328 | 1328 | 1328 |
| Where the Auto-Jump Stops | 1294 | 1294 | 1294 |
| Player Focus | 1288 | 1292 | 1292 |
| What an Order Can Do | 1255 | 1255 | 1255 |
| Extra Simulation Rules for This Preset | 1134 | 1134 | 1134 |
| Structures Built During Play | 765 | 765 | 1076 |
| (all smaller sections) | 9483 | 9627 | 8981 |

### New Dawn, Germany, round 30 — jumpForward

| | before | 4-schema | 7-history |
|---|---:|---:|---:|
| System prompt | 173.1k chars ~43.3k | 171.8k chars ~43.0k (-1%) | 167.0k chars ~41.8k (-4%) |
| Cacheable prefix | 57.8k chars ~14.4k | 92.3k chars ~23.1k (60%) | 103.0k chars ~25.7k (78%) |
| Cacheable share | 33.4% | 53.7% (61%) | 61.6% (85%) |
| User message | 5152 chars ~1288 | 5152 chars ~1288 (0%) | 5152 chars ~1288 (0%) |
| Output schema (as Gemini gets it) | 30.4k chars ~7609 | 29.9k chars ~7463 (-2%) | 29.6k chars ~7411 (-3%) |
| All tools (Anthropic) | 33.4k chars ~8344 | 32.8k chars ~8212 (-2%) | 32.6k chars ~8161 (-2%) |
| Whole request | 211.7k chars ~52.9k | 209.8k chars ~52.5k (-1%) | 204.8k chars ~51.2k (-3%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 120.5k chars ~30.1k | 84.6k chars ~21.2k (-30%) | 69.2k chars ~17.3k (-43%) |

| Section | before | 4-schema | 7-history |
|---|---:|---:|---:|
| Event History of This Game | 13.7k | 15.3k | 10.7k |
| What to Simulate | 14.8k | 14.8k | 14.8k |
| Game Map Description | 13.3k | 13.0k | 9546 |
| Fronts | 12.8k | 7485 | 7485 |
| City Coordinates | 7156 | 7591 | 12.1k |
| Levers | 9606 | 9175 | 9175 |
| The World Before Round 1 | 6086 | 6086 | 6086 |
| This Round | 5938 | 5966 | 5966 |
| Front Orders | – | 5438 | 5438 |
| Difficulty | 5345 | 5345 | 5345 |
| Taking Ground | 763 | 763 | 5229 |
| Diplomacy So Far | 5160 | 5160 | 5160 |
| Every Event Carries Its Consequences | 4838 | 4838 | 4838 |
| Relations and Agreements | 4467 | 207 | 207 |
| How Relations and Agreements Are Recorded | – | 4417 | 4417 |
| What Is in Motion | 4416 | 4416 | 4416 |
| Projects & Operations | 4415 | 4415 | 741 |
| Diplomatic Memory | 3703 | – | – |
| Diplomacy | 3572 | 3572 | 3572 |
| War Weariness, Peace and Alliances | 3435 | 3435 | 3435 |
| Wars | 3369 | 1481 | 1481 |
| What a Polity Is | 3107 | 3107 | 3107 |
| Figures the War Needs | 2734 | 2734 | 2734 |
| How to Write an Event | 2694 | 2695 | 2695 |
| Current Military Units | 2658 | 2658 | 1105 |
| Seas | 2503 | 2503 | 2503 |
| Social Media | 2217 | 2217 | 2217 |
| Occupied and Contested Regions | 2085 | 2085 | 634 |
| Units and Structures on the Map | 763 | 763 | 2021 |
| How Wars Are Recorded | – | 1999 | 1999 |
| The Map | 1975 | 1975 | 1975 |
| Real History Is the Default | 1728 | 1728 | 1728 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1644 | 672 | 672 |
| Units and Structures | 1635 | 1635 | 1635 |
| Reading the Diplomatic Ledger | – | 1616 | 1616 |
| The World Answers Back | 1600 | 1600 | 1600 |
| Polities | 1420 | 1420 | 1420 |
| Espionage Orders | 1398 | 1398 | 1398 |
| PRIORITY | 1330 | 1079 | 1079 |
| Military Strength | 1328 | 1328 | 1328 |
| Player Focus | 1288 | 1292 | 1292 |
| What an Order Can Do | 1255 | 1255 | 1255 |
| Extra Simulation Rules for This Preset | 1134 | 1134 | 1134 |
| Structures Built During Play | 765 | 765 | 1076 |
| (all smaller sections) | 9039 | 9331 | 8685 |

### Modern Day, Poland, round 2 (report-poland) — jumpForward

| | before | 4-schema | 7-history |
|---|---:|---:|---:|
| System prompt | 90.6k chars ~22.6k | 91.5k chars ~22.9k (1%) | 90.1k chars ~22.5k (-1%) |
| Cacheable prefix | 17.9k chars ~4475 | 52.5k chars ~13.1k (193%) | 54.9k chars ~13.7k (206%) |
| Cacheable share | 19.8% | 57.4% (190%) | 60.9% (208%) |
| User message | 1602 chars ~401 | 1602 chars ~401 (0%) | 1602 chars ~401 (0%) |
| Output schema (as Gemini gets it) | 28.7k chars ~7177 | 29.9k chars ~7463 (4%) | 29.6k chars ~7411 (3%) |
| All tools (Anthropic) | 30.1k chars ~7520 | 31.4k chars ~7842 (4%) | 31.2k chars ~7791 (4%) |
| Whole request | 122.3k chars ~30.6k | 124.4k chars ~31.1k (2%) | 122.8k chars ~30.7k (0%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 74.3k chars ~18.6k | 40.6k chars ~10.2k (-45%) | 36.8k chars ~9203 (-50%) |

| Section | before | 4-schema | 7-history |
|---|---:|---:|---:|
| Game Map Description | 10.1k | 9859 | 7968 |
| Levers | 9606 | 9175 | 9175 |
| Fronts | 8530 | 3233 | 3233 |
| Event History of This Game | 5811 | 5811 | 5788 |
| What Is in Motion | 5728 | 5728 | 5728 |
| Front Orders | – | 5438 | 5438 |
| Every Event Carries Its Consequences | 4838 | 4838 | 4838 |
| Relations and Agreements | 4466 | 207 | 207 |
| How Relations and Agreements Are Recorded | – | 4416 | 4416 |
| Social Media | 3556 | 3556 | 3556 |
| How to Write an Event | 2694 | 2695 | 2695 |
| Wars | 2113 | 227 | 227 |
| Units and Structures on the Map | 763 | 763 | 2021 |
| How Wars Are Recorded | – | 1997 | 1997 |
| The Map | 1975 | 1975 | 1975 |
| Figures the War Needs | 1732 | 1732 | 1732 |
| Real History Is the Default | 1728 | 1728 | 1728 |
| Units and Structures | 1635 | 1635 | 1635 |
| Reading the Diplomatic Ledger | – | 1616 | 1616 |
| The World Answers Back | 1597 | 1597 | 1597 |
| Current Military Units | 1526 | 1526 | 353 |
| Taking Ground | 763 | 763 | 1486 |
| Difficulty | 1423 | 1423 | 1423 |
| Polities | 1419 | 1419 | 1419 |
| Espionage Orders | 1393 | 1393 | 1393 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1337 | 365 | 365 |
| PRIORITY | 1309 | 1058 | 1058 |
| What an Order Can Do | 1254 | 1254 | 1254 |
| Military Strength | 1192 | 1192 | 1192 |
| (all smaller sections) | 12.1k | 12.9k | 12.5k |
