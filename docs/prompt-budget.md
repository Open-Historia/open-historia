# Prompt budget: what a time skip sends the AI

How big a time skip's request is, part by part, and how much of it a provider's
prompt cache can take. Measured with `scripts/prompt-size.mjs` on real saves,
before and after each change that set out to make skips cheaper (the plan of
2026-11-07: the cache-friendly layout, sending nothing twice, one-line event
digests, a slimmer output function, and the events no list showed).

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
None of this has been run against a live API (the quality A/B waits for the
owner's permission); the sizes are the requests as the game builds them.

## By section

Sections of at least 1,000 characters in any run, the rest summed.


### 1836 Victorian Era, Ottomans, round 1 — jumpForward

| | before | 4-schema |
|---|---:|---:|
| System prompt | 250.4k chars ~62.6k | 250.3k chars ~62.6k (-0%) |
| Cacheable prefix | 172.8k chars ~43.2k | 207.4k chars ~51.9k (20%) |
| Cacheable share | 69.0% | 82.9% (20%) |
| User message | 12.0k chars ~3000 | 12.0k chars ~3000 (0%) |
| Output schema (as Gemini gets it) | 30.4k chars ~7609 | 29.9k chars ~7463 (-2%) |
| All tools (Anthropic) | 31.9k chars ~7974 | 31.4k chars ~7842 (-2%) |
| Whole request | 294.3k chars ~73.6k | 293.6k chars ~73.4k (-0%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 89.6k chars ~22.4k | 54.9k chars ~13.7k (-39%) |

| Section | before | 4-schema |
|---|---:|---:|
| Extra Simulation Rules for This Preset | 110.4k | 110.6k |
| The World Before Round 1 | 44.4k | 44.4k |
| Levers | 9606 | 9175 |
| Fronts | 8554 | 3257 |
| Occupied and Contested Regions | 8389 | 8389 |
| Projects & Operations | 6220 | 6220 |
| Front Orders | – | 5438 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 4996 | 4024 |
| Every Event Carries Its Consequences | 4838 | 4838 |
| Relations and Agreements | 4474 | 207 |
| How Relations and Agreements Are Recorded | – | 4424 |
| Game Map Description | 3580 | 3268 |
| How to Write an Event | 2694 | 2695 |
| Player Focus | 2356 | 1141 |
| This Round | 2042 | 2350 |
| Social Media | 2231 | 2231 |
| Wars | 2129 | 227 |
| How Wars Are Recorded | – | 2013 |
| The Map | 1972 | 1972 |
| Difficulty | 1814 | 1814 |
| Real History Is the Default | 1728 | 1728 |
| Units and Structures | 1635 | 1635 |
| The World Answers Back | 1621 | 1621 |
| Reading the Diplomatic Ledger | – | 1616 |
| Figures the War Needs | 1591 | 1591 |
| What Is in Motion | 1587 | 1587 |
| Event History of This Game | 1469 | 1469 |
| Espionage Orders | 1433 | 1433 |
| Polities | 1427 | 1427 |
| Current Military Units | 1409 | 1409 |
| PRIORITY | 1405 | 1154 |
| What an Order Can Do | 1262 | 1262 |
| Military Strength | 1200 | 1200 |
| (all smaller sections) | 12.0k | 12.4k |

### Battle of Europe, UK, round 7 — jumpForward

| | before | 4-schema |
|---|---:|---:|
| System prompt | 126.3k chars ~31.6k | 123.7k chars ~30.9k (-2%) |
| Cacheable prefix | 18.2k chars ~4539 | 52.8k chars ~13.2k (191%) |
| Cacheable share | 14.4% | 42.7% (197%) |
| User message | 1910 chars ~478 | 1910 chars ~478 (0%) |
| Output schema (as Gemini gets it) | 30.4k chars ~7609 | 29.9k chars ~7463 (-2%) |
| All tools (Anthropic) | 31.9k chars ~7974 | 31.4k chars ~7842 (-2%) |
| Whole request | 160.1k chars ~40.0k | 157.0k chars ~39.3k (-2%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 110.0k chars ~27.5k | 72.8k chars ~18.2k (-34%) |

| Section | before | 4-schema |
|---|---:|---:|
| Game Map Description | 12.5k | 12.1k |
| Event History of This Game | 10.7k | 9161 |
| Levers | 9606 | 9175 |
| City Coordinates | 8811 | 9004 |
| Fronts | 8554 | 3257 |
| Front Orders | – | 5438 |
| Every Event Carries Its Consequences | 4838 | 4838 |
| War Weariness, Peace and Alliances | 4621 | 4621 |
| Projects & Operations | 4543 | 4543 |
| Relations and Agreements | 4474 | 207 |
| How Relations and Agreements Are Recorded | – | 4424 |
| What Is in Motion | 4223 | 4223 |
| Occupied and Contested Regions | 3559 | 3559 |
| How to Write an Event | 2694 | 2695 |
| Wars | 2356 | 454 |
| Figures the War Needs | 2277 | 2277 |
| Social Media | 2231 | 2231 |
| Diplomacy So Far | 2218 | 2218 |
| How Wars Are Recorded | – | 2013 |
| The Map | 1975 | 1975 |
| Current Military Units | 1935 | 1935 |
| Seas | 1794 | 1794 |
| Real History Is the Default | 1728 | 1728 |
| Diplomatic Memory | 1658 | – |
| Units and Structures | 1635 | 1635 |
| The World Answers Back | 1621 | 1621 |
| Reading the Diplomatic Ledger | – | 1616 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1558 | 586 |
| Espionage Orders | 1433 | 1433 |
| Polities | 1427 | 1427 |
| Difficulty | 1394 | 1394 |
| PRIORITY | 1330 | 1079 |
| Military Strength | 1306 | 1306 |
| This Round | 1303 | 1303 |
| What an Order Can Do | 1262 | 1262 |
| Player Focus | 1069 | 1069 |
| (all smaller sections) | 13.6k | 14.1k |

### Modern Day 2026 (copy), Italy, round 130 — jumpForward

| | before | 4-schema |
|---|---:|---:|
| System prompt | 257.4k chars ~64.3k | 248.1k chars ~62.0k (-4%) |
| Cacheable prefix | 35.8k chars ~8952 | 70.6k chars ~17.6k (97%) |
| Cacheable share | 13.9% | 28.4% (104%) |
| User message | 12.2k chars ~3038 | 12.2k chars ~3038 (0%) |
| Output schema (as Gemini gets it) | 32.8k chars ~8189 | 32.3k chars ~8066 (-2%) |
| All tools (Anthropic) | 34.0k chars ~8512 | 33.6k chars ~8404 (-1%) |
| Whole request | 303.6k chars ~75.9k | 293.9k chars ~73.5k (-3%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 233.7k chars ~58.4k | 189.7k chars ~47.4k (-19%) |

| Section | before | 4-schema |
|---|---:|---:|
| Event History of This Game | 25.6k | 17.6k |
| Projects & Operations | 22.0k | 22.0k |
| Game Map Description | 20.8k | 20.5k |
| Extra Simulation Rules for This Preset | 13.0k | 13.3k |
| Current Military Units | 13.1k | 13.1k |
| Fronts | 12.9k | 7581 |
| Diplomacy So Far | 11.6k | 11.6k |
| Occupied and Contested Regions | 10.8k | 10.8k |
| Groups | 10.7k | 10.7k |
| Levers | 9606 | 9175 |
| City Coordinates | 7419 | 7612 |
| Structures Built During Play | 7181 | 7181 |
| Social Media | 6939 | 6939 |
| This Round | 6914 | 6914 |
| What Is in Motion | 6355 | 6355 |
| Front Orders | – | 5438 |
| The World Before Round 1 | 5098 | 5098 |
| War Weariness, Peace and Alliances | 4856 | 4856 |
| Every Event Carries Its Consequences | 4838 | 4838 |
| Relations and Agreements | 4486 | 207 |
| How Relations and Agreements Are Recorded | – | 4436 |
| Scenario National Stats Sheet | 4062 | 4062 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 3325 | 2353 |
| Figures the War Needs | 3130 | 3130 |
| Wars | 2910 | 984 |
| How to Write an Event | 2694 | 2695 |
| Seas | 2529 | 2529 |
| How Wars Are Recorded | – | 2037 |
| The Map | 1975 | 1975 |
| Diplomatic Memory | 1972 | – |
| Hidden Backend | 1801 | 1801 |
| Real History Is the Default | 1728 | 1728 |
| Espionage | 1659 | 1659 |
| The World Answers Back | 1657 | 1657 |
| Units and Structures | 1635 | 1635 |
| Reading the Diplomatic Ledger | – | 1616 |
| Espionage Orders | 1493 | 1493 |
| Polities | 1439 | 1439 |
| Difficulty | 1423 | 1423 |
| Player Focus | 1326 | 1326 |
| PRIORITY | 1309 | 1058 |
| What an Order Can Do | 1274 | 1274 |
| Military Strength | 1211 | 1211 |
| Reports on File | 1046 | 1046 |
| Player Agency | 1005 | 1005 |
| (all smaller sections) | 10.5k | 10.8k |

### Modern Day (built-in), Brazil, round 67 — jumpForward

| | before | 4-schema |
|---|---:|---:|
| System prompt | 179.7k chars ~44.9k | 179.5k chars ~44.9k (-0%) |
| Cacheable prefix | 17.9k chars ~4475 | 52.5k chars ~13.1k (193%) |
| Cacheable share | 10.0% | 29.2% (193%) |
| User message | 3441 chars ~860 | 3441 chars ~860 (0%) |
| Output schema (as Gemini gets it) | 31.1k chars ~7776 | 29.9k chars ~7463 (-4%) |
| All tools (Anthropic) | 32.6k chars ~8149 | 31.4k chars ~7842 (-4%) |
| Whole request | 215.7k chars ~53.9k | 214.3k chars ~53.6k (-1%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 165.2k chars ~41.3k | 130.5k chars ~32.6k (-21%) |

| Section | before | 4-schema |
|---|---:|---:|
| Event History of This Game | 20.7k | 21.3k |
| The World's Share | 17.9k | 18.9k |
| Game Map Description | 12.9k | 12.7k |
| Levers | 9606 | 9175 |
| This Round | 9462 | 9462 |
| City Coordinates | 8811 | 9004 |
| Fronts | 8530 | 3233 |
| Occupied and Contested Regions | 7107 | 7107 |
| Language | 6878 | 6878 |
| Current Military Units | 6337 | 6337 |
| Projects & Operations | 5471 | 5471 |
| Front Orders | – | 5438 |
| Every Event Carries Its Consequences | 4838 | 4838 |
| War Weariness, Peace and Alliances | 4763 | 4763 |
| Relations and Agreements | 4466 | 207 |
| How Relations and Agreements Are Recorded | – | 4416 |
| What Is in Motion | 4105 | 4105 |
| Diplomacy So Far | 3353 | 3353 |
| How to Write an Event | 2694 | 2695 |
| Diplomatic Memory | 2634 | – |
| Wars | 2334 | 448 |
| Social Media | 2215 | 2215 |
| How Wars Are Recorded | – | 1997 |
| Figures the War Needs | 1992 | 1992 |
| The Map | 1975 | 1975 |
| Seas | 1833 | 1833 |
| Real History Is the Default | 1728 | 1728 |
| Units and Structures | 1635 | 1635 |
| Reading the Diplomatic Ledger | – | 1616 |
| The World Answers Back | 1597 | 1597 |
| Difficulty | 1423 | 1423 |
| Polities | 1419 | 1419 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1399 | 427 |
| Espionage Orders | 1393 | 1393 |
| PRIORITY | 1309 | 1058 |
| Military Strength | 1300 | 1300 |
| What an Order Can Do | 1254 | 1254 |
| Player Focus | 1103 | 1103 |
| Structures Built During Play | 1015 | 1015 |
| (all smaller sections) | 12.2k | 12.7k |

### New Dawn, Germany, round 30 — autoJumpForward

| | before | 4-schema |
|---|---:|---:|
| System prompt | 174.9k chars ~43.7k | 173.5k chars ~43.4k (-1%) |
| Cacheable prefix | 59.5k chars ~14.9k | 94.0k chars ~23.5k (58%) |
| Cacheable share | 34.0% | 54.2% (59%) |
| User message | 5232 chars ~1308 | 5232 chars ~1308 (0%) |
| Output schema (as Gemini gets it) | 30.4k chars ~7609 | 29.9k chars ~7463 (-2%) |
| All tools (Anthropic) | 33.4k chars ~8347 | 32.9k chars ~8215 (-2%) |
| Whole request | 213.5k chars ~53.4k | 211.6k chars ~52.9k (-1%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 120.7k chars ~30.2k | 84.7k chars ~21.2k (-30%) |

| Section | before | 4-schema |
|---|---:|---:|
| Event History of This Game | 13.7k | 15.3k |
| What to Simulate | 14.7k | 14.7k |
| Game Map Description | 13.3k | 13.0k |
| Fronts | 12.8k | 7549 |
| Levers | 9606 | 9175 |
| City Coordinates | 7156 | 7651 |
| The World Before Round 1 | 6086 | 6086 |
| This Round | 5906 | 5934 |
| Front Orders | – | 5438 |
| Difficulty | 5345 | 5345 |
| Diplomacy So Far | 5160 | 5160 |
| Every Event Carries Its Consequences | 4838 | 4838 |
| Relations and Agreements | 4467 | 207 |
| What Is in Motion | 4417 | 4417 |
| How Relations and Agreements Are Recorded | – | 4417 |
| Projects & Operations | 4415 | 4415 |
| Diplomatic Memory | 3703 | – |
| Diplomacy | 3572 | 3572 |
| War Weariness, Peace and Alliances | 3435 | 3435 |
| Wars | 3369 | 1481 |
| What a Polity Is | 3107 | 3107 |
| Figures the War Needs | 2734 | 2734 |
| How to Write an Event | 2694 | 2695 |
| Current Military Units | 2658 | 2658 |
| Seas | 2504 | 2504 |
| Social Media | 2217 | 2217 |
| Occupied and Contested Regions | 2085 | 2085 |
| How Wars Are Recorded | – | 1999 |
| The Map | 1975 | 1975 |
| Real History Is the Default | 1728 | 1728 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1644 | 672 |
| Units and Structures | 1635 | 1635 |
| Reading the Diplomatic Ledger | – | 1616 |
| The World Answers Back | 1599 | 1600 |
| Polities | 1420 | 1420 |
| Espionage Orders | 1398 | 1398 |
| PRIORITY | 1375 | 1079 |
| Military Strength | 1328 | 1328 |
| Where the Auto-Jump Stops | 1294 | 1294 |
| Player Focus | 1288 | 1292 |
| What an Order Can Do | 1255 | 1255 |
| Extra Simulation Rules for This Preset | 1134 | 1134 |
| (all smaller sections) | 11.8k | 11.9k |

### New Dawn, Germany, round 30 — jumpForward

| | before | 4-schema |
|---|---:|---:|
| System prompt | 173.1k chars ~43.3k | 171.8k chars ~43.0k (-1%) |
| Cacheable prefix | 57.8k chars ~14.4k | 92.3k chars ~23.1k (60%) |
| Cacheable share | 33.4% | 53.7% (61%) |
| User message | 5152 chars ~1288 | 5152 chars ~1288 (0%) |
| Output schema (as Gemini gets it) | 30.4k chars ~7609 | 29.9k chars ~7463 (-2%) |
| All tools (Anthropic) | 33.4k chars ~8344 | 32.8k chars ~8212 (-2%) |
| Whole request | 211.7k chars ~52.9k | 209.8k chars ~52.5k (-1%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 120.5k chars ~30.1k | 84.6k chars ~21.2k (-30%) |

| Section | before | 4-schema |
|---|---:|---:|
| Event History of This Game | 13.7k | 15.3k |
| What to Simulate | 14.8k | 14.8k |
| Game Map Description | 13.3k | 13.0k |
| Fronts | 12.8k | 7485 |
| Levers | 9606 | 9175 |
| City Coordinates | 7156 | 7591 |
| The World Before Round 1 | 6086 | 6086 |
| This Round | 5938 | 5966 |
| Front Orders | – | 5438 |
| Difficulty | 5345 | 5345 |
| Diplomacy So Far | 5160 | 5160 |
| Every Event Carries Its Consequences | 4838 | 4838 |
| Relations and Agreements | 4467 | 207 |
| How Relations and Agreements Are Recorded | – | 4417 |
| What Is in Motion | 4416 | 4416 |
| Projects & Operations | 4415 | 4415 |
| Diplomatic Memory | 3703 | – |
| Diplomacy | 3572 | 3572 |
| War Weariness, Peace and Alliances | 3435 | 3435 |
| Wars | 3369 | 1481 |
| What a Polity Is | 3107 | 3107 |
| Figures the War Needs | 2734 | 2734 |
| How to Write an Event | 2694 | 2695 |
| Current Military Units | 2658 | 2658 |
| Seas | 2503 | 2503 |
| Social Media | 2217 | 2217 |
| Occupied and Contested Regions | 2085 | 2085 |
| How Wars Are Recorded | – | 1999 |
| The Map | 1975 | 1975 |
| Real History Is the Default | 1728 | 1728 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1644 | 672 |
| Units and Structures | 1635 | 1635 |
| Reading the Diplomatic Ledger | – | 1616 |
| The World Answers Back | 1600 | 1600 |
| Polities | 1420 | 1420 |
| Espionage Orders | 1398 | 1398 |
| PRIORITY | 1330 | 1079 |
| Military Strength | 1328 | 1328 |
| Player Focus | 1288 | 1292 |
| What an Order Can Do | 1255 | 1255 |
| Extra Simulation Rules for This Preset | 1134 | 1134 |
| (all smaller sections) | 11.3k | 11.6k |

### Modern Day, Poland, round 2 (report-poland) — jumpForward

| | before | 4-schema |
|---|---:|---:|
| System prompt | 90.6k chars ~22.6k | 91.5k chars ~22.9k (1%) |
| Cacheable prefix | 17.9k chars ~4475 | 52.5k chars ~13.1k (193%) |
| Cacheable share | 19.8% | 57.4% (190%) |
| User message | 1602 chars ~401 | 1602 chars ~401 (0%) |
| Output schema (as Gemini gets it) | 28.7k chars ~7177 | 29.9k chars ~7463 (4%) |
| All tools (Anthropic) | 30.1k chars ~7520 | 31.4k chars ~7842 (4%) |
| Whole request | 122.3k chars ~30.6k | 124.4k chars ~31.1k (2%) |
| Not cacheable (Anthropic: tools ride with the prefix) | 74.3k chars ~18.6k | 40.6k chars ~10.2k (-45%) |

| Section | before | 4-schema |
|---|---:|---:|
| Game Map Description | 10.1k | 9859 |
| Levers | 9606 | 9175 |
| Fronts | 8530 | 3233 |
| Event History of This Game | 5811 | 5811 |
| What Is in Motion | 5728 | 5728 |
| Front Orders | – | 5438 |
| Every Event Carries Its Consequences | 4838 | 4838 |
| Relations and Agreements | 4466 | 207 |
| How Relations and Agreements Are Recorded | – | 4416 |
| Social Media | 3556 | 3556 |
| How to Write an Event | 2694 | 2695 |
| Wars | 2113 | 227 |
| How Wars Are Recorded | – | 1997 |
| The Map | 1975 | 1975 |
| Figures the War Needs | 1732 | 1732 |
| Real History Is the Default | 1728 | 1728 |
| Units and Structures | 1635 | 1635 |
| Reading the Diplomatic Ledger | – | 1616 |
| The World Answers Back | 1597 | 1597 |
| Current Military Units | 1526 | 1526 |
| Difficulty | 1423 | 1423 |
| Polities | 1419 | 1419 |
| Espionage Orders | 1393 | 1393 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1337 | 365 |
| PRIORITY | 1309 | 1058 |
| What an Order Can Do | 1254 | 1254 |
| Military Strength | 1192 | 1192 |
| (all smaller sections) | 13.7k | 14.4k |
