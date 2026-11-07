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
| Modern Day (built-in), Brazil, r67, 905 events | before | 179.7k ~44.9k | 17.9k (10%) | 3441 | 31.1k | 215.7k ~53.9k | 165.2k ~41.3k |
| New Dawn, Germany, r30, 259 events | before | 173.1k ~43.3k | 57.8k (33%) | 5152 | 30.4k | 211.7k ~52.9k | 120.5k ~30.1k |
| New Dawn, Germany, r30 — auto-jump | before | 174.9k ~43.7k | 59.5k (34%) | 5232 | 30.4k | 213.5k ~53.4k | 120.7k ~30.2k |
| Battle of Europe, UK, r7 | before | 126.3k ~31.6k | 18.2k (14%) | 1910 | 30.4k | 160.1k ~40.0k | 110.0k ~27.5k |
| Modern Day, Poland, r2 (report-poland) | before | 90.6k ~22.6k | 17.9k (20%) | 1602 | 28.7k | 122.3k ~30.6k | 74.3k ~18.6k |
| 1836 Victorian Era, Ottomans, r1 | before | 250.4k ~62.6k | 172.8k (69%) | 12.0k | 30.4k | 294.3k ~73.6k | 89.6k ~22.4k |


## By section

Sections of at least 1,000 characters in any run, the rest summed.


### 1836 Victorian Era, Ottomans, round 1 — jumpForward

| | before |
|---|---:|
| System prompt | 250.4k chars ~62.6k |
| Cacheable prefix | 172.8k chars ~43.2k |
| Cacheable share | 69.0% |
| User message | 12.0k chars ~3000 |
| Output schema (as Gemini gets it) | 30.4k chars ~7609 |
| All tools (Anthropic) | 31.9k chars ~7974 |
| Whole request | 294.3k chars ~73.6k |
| Not cacheable (Anthropic: tools ride with the prefix) | 89.6k chars ~22.4k |

| Section | before |
|---|---:|
| Extra Simulation Rules for This Preset | 110.4k |
| The World Before Round 1 | 44.4k |
| Levers | 9606 |
| Fronts | 8554 |
| Occupied and Contested Regions | 8389 |
| Projects & Operations | 6220 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 4996 |
| Every Event Carries Its Consequences | 4838 |
| Relations and Agreements | 4474 |
| Game Map Description | 3580 |
| How to Write an Event | 2694 |
| Player Focus | 2356 |
| Social Media | 2231 |
| Wars | 2129 |
| This Round | 2042 |
| The Map | 1972 |
| Difficulty | 1814 |
| Real History Is the Default | 1728 |
| Units and Structures | 1635 |
| The World Answers Back | 1621 |
| Figures the War Needs | 1591 |
| What Is in Motion | 1587 |
| Event History of This Game | 1469 |
| Espionage Orders | 1433 |
| Polities | 1427 |
| Current Military Units | 1409 |
| PRIORITY | 1405 |
| What an Order Can Do | 1262 |
| Military Strength | 1200 |
| (all smaller sections) | 12.0k |

### Battle of Europe, UK, round 7 — jumpForward

| | before |
|---|---:|
| System prompt | 126.3k chars ~31.6k |
| Cacheable prefix | 18.2k chars ~4539 |
| Cacheable share | 14.4% |
| User message | 1910 chars ~478 |
| Output schema (as Gemini gets it) | 30.4k chars ~7609 |
| All tools (Anthropic) | 31.9k chars ~7974 |
| Whole request | 160.1k chars ~40.0k |
| Not cacheable (Anthropic: tools ride with the prefix) | 110.0k chars ~27.5k |

| Section | before |
|---|---:|
| Game Map Description | 12.5k |
| Event History of This Game | 10.7k |
| Levers | 9606 |
| City Coordinates | 8811 |
| Fronts | 8554 |
| Every Event Carries Its Consequences | 4838 |
| War Weariness, Peace and Alliances | 4621 |
| Projects & Operations | 4543 |
| Relations and Agreements | 4474 |
| What Is in Motion | 4223 |
| Occupied and Contested Regions | 3559 |
| How to Write an Event | 2694 |
| Wars | 2356 |
| Figures the War Needs | 2277 |
| Social Media | 2231 |
| Diplomacy So Far | 2218 |
| The Map | 1975 |
| Current Military Units | 1935 |
| Seas | 1794 |
| Real History Is the Default | 1728 |
| Diplomatic Memory | 1658 |
| Units and Structures | 1635 |
| The World Answers Back | 1621 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1558 |
| Espionage Orders | 1433 |
| Polities | 1427 |
| Difficulty | 1394 |
| PRIORITY | 1330 |
| Military Strength | 1306 |
| This Round | 1303 |
| What an Order Can Do | 1262 |
| Player Focus | 1069 |
| (all smaller sections) | 13.6k |

### Modern Day 2026 (copy), Italy, round 130 — jumpForward

| | before |
|---|---:|
| System prompt | 257.4k chars ~64.3k |
| Cacheable prefix | 35.8k chars ~8952 |
| Cacheable share | 13.9% |
| User message | 12.2k chars ~3038 |
| Output schema (as Gemini gets it) | 32.8k chars ~8189 |
| All tools (Anthropic) | 34.0k chars ~8512 |
| Whole request | 303.6k chars ~75.9k |
| Not cacheable (Anthropic: tools ride with the prefix) | 233.7k chars ~58.4k |

| Section | before |
|---|---:|
| Event History of This Game | 25.6k |
| Projects & Operations | 22.0k |
| Game Map Description | 20.8k |
| Current Military Units | 13.1k |
| Extra Simulation Rules for This Preset | 13.0k |
| Fronts | 12.9k |
| Diplomacy So Far | 11.6k |
| Occupied and Contested Regions | 10.8k |
| Groups | 10.7k |
| Levers | 9606 |
| City Coordinates | 7419 |
| Structures Built During Play | 7181 |
| Social Media | 6939 |
| This Round | 6914 |
| What Is in Motion | 6355 |
| The World Before Round 1 | 5098 |
| War Weariness, Peace and Alliances | 4856 |
| Every Event Carries Its Consequences | 4838 |
| Relations and Agreements | 4486 |
| Scenario National Stats Sheet | 4062 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 3325 |
| Figures the War Needs | 3130 |
| Wars | 2910 |
| How to Write an Event | 2694 |
| Seas | 2529 |
| The Map | 1975 |
| Diplomatic Memory | 1972 |
| Hidden Backend | 1801 |
| Real History Is the Default | 1728 |
| Espionage | 1659 |
| The World Answers Back | 1657 |
| Units and Structures | 1635 |
| Espionage Orders | 1493 |
| Polities | 1439 |
| Difficulty | 1423 |
| Player Focus | 1326 |
| PRIORITY | 1309 |
| What an Order Can Do | 1274 |
| Military Strength | 1211 |
| Reports on File | 1046 |
| Player Agency | 1005 |
| (all smaller sections) | 10.5k |

### Modern Day (built-in), Brazil, round 67 — jumpForward

| | before |
|---|---:|
| System prompt | 179.7k chars ~44.9k |
| Cacheable prefix | 17.9k chars ~4475 |
| Cacheable share | 10.0% |
| User message | 3441 chars ~860 |
| Output schema (as Gemini gets it) | 31.1k chars ~7776 |
| All tools (Anthropic) | 32.6k chars ~8149 |
| Whole request | 215.7k chars ~53.9k |
| Not cacheable (Anthropic: tools ride with the prefix) | 165.2k chars ~41.3k |

| Section | before |
|---|---:|
| Event History of This Game | 20.7k |
| The World's Share | 17.9k |
| Game Map Description | 12.9k |
| Levers | 9606 |
| This Round | 9462 |
| City Coordinates | 8811 |
| Fronts | 8530 |
| Occupied and Contested Regions | 7107 |
| Language | 6878 |
| Current Military Units | 6337 |
| Projects & Operations | 5471 |
| Every Event Carries Its Consequences | 4838 |
| War Weariness, Peace and Alliances | 4763 |
| Relations and Agreements | 4466 |
| What Is in Motion | 4105 |
| Diplomacy So Far | 3353 |
| How to Write an Event | 2694 |
| Diplomatic Memory | 2634 |
| Wars | 2334 |
| Social Media | 2215 |
| Figures the War Needs | 1992 |
| The Map | 1975 |
| Seas | 1833 |
| Real History Is the Default | 1728 |
| Units and Structures | 1635 |
| The World Answers Back | 1597 |
| Difficulty | 1423 |
| Polities | 1419 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1399 |
| Espionage Orders | 1393 |
| PRIORITY | 1309 |
| Military Strength | 1300 |
| What an Order Can Do | 1254 |
| Player Focus | 1103 |
| Structures Built During Play | 1015 |
| (all smaller sections) | 12.2k |

### New Dawn, Germany, round 30 — autoJumpForward

| | before |
|---|---:|
| System prompt | 174.9k chars ~43.7k |
| Cacheable prefix | 59.5k chars ~14.9k |
| Cacheable share | 34.0% |
| User message | 5232 chars ~1308 |
| Output schema (as Gemini gets it) | 30.4k chars ~7609 |
| All tools (Anthropic) | 33.4k chars ~8347 |
| Whole request | 213.5k chars ~53.4k |
| Not cacheable (Anthropic: tools ride with the prefix) | 120.7k chars ~30.2k |

| Section | before |
|---|---:|
| What to Simulate | 14.7k |
| Event History of This Game | 13.7k |
| Game Map Description | 13.3k |
| Fronts | 12.8k |
| Levers | 9606 |
| City Coordinates | 7156 |
| The World Before Round 1 | 6086 |
| This Round | 5906 |
| Difficulty | 5345 |
| Diplomacy So Far | 5160 |
| Every Event Carries Its Consequences | 4838 |
| Relations and Agreements | 4467 |
| What Is in Motion | 4417 |
| Projects & Operations | 4415 |
| Diplomatic Memory | 3703 |
| Diplomacy | 3572 |
| War Weariness, Peace and Alliances | 3435 |
| Wars | 3369 |
| What a Polity Is | 3107 |
| Figures the War Needs | 2734 |
| How to Write an Event | 2694 |
| Current Military Units | 2658 |
| Seas | 2504 |
| Social Media | 2217 |
| Occupied and Contested Regions | 2085 |
| The Map | 1975 |
| Real History Is the Default | 1728 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1644 |
| Units and Structures | 1635 |
| The World Answers Back | 1599 |
| Polities | 1420 |
| Espionage Orders | 1398 |
| PRIORITY | 1375 |
| Military Strength | 1328 |
| Where the Auto-Jump Stops | 1294 |
| Player Focus | 1288 |
| What an Order Can Do | 1255 |
| Extra Simulation Rules for This Preset | 1134 |
| (all smaller sections) | 11.8k |

### New Dawn, Germany, round 30 — jumpForward

| | before |
|---|---:|
| System prompt | 173.1k chars ~43.3k |
| Cacheable prefix | 57.8k chars ~14.4k |
| Cacheable share | 33.4% |
| User message | 5152 chars ~1288 |
| Output schema (as Gemini gets it) | 30.4k chars ~7609 |
| All tools (Anthropic) | 33.4k chars ~8344 |
| Whole request | 211.7k chars ~52.9k |
| Not cacheable (Anthropic: tools ride with the prefix) | 120.5k chars ~30.1k |

| Section | before |
|---|---:|
| What to Simulate | 14.8k |
| Event History of This Game | 13.7k |
| Game Map Description | 13.3k |
| Fronts | 12.8k |
| Levers | 9606 |
| City Coordinates | 7156 |
| The World Before Round 1 | 6086 |
| This Round | 5938 |
| Difficulty | 5345 |
| Diplomacy So Far | 5160 |
| Every Event Carries Its Consequences | 4838 |
| Relations and Agreements | 4467 |
| What Is in Motion | 4416 |
| Projects & Operations | 4415 |
| Diplomatic Memory | 3703 |
| Diplomacy | 3572 |
| War Weariness, Peace and Alliances | 3435 |
| Wars | 3369 |
| What a Polity Is | 3107 |
| Figures the War Needs | 2734 |
| How to Write an Event | 2694 |
| Current Military Units | 2658 |
| Seas | 2503 |
| Social Media | 2217 |
| Occupied and Contested Regions | 2085 |
| The Map | 1975 |
| Real History Is the Default | 1728 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1644 |
| Units and Structures | 1635 |
| The World Answers Back | 1600 |
| Polities | 1420 |
| Espionage Orders | 1398 |
| PRIORITY | 1330 |
| Military Strength | 1328 |
| Player Focus | 1288 |
| What an Order Can Do | 1255 |
| Extra Simulation Rules for This Preset | 1134 |
| (all smaller sections) | 11.3k |

### Modern Day, Poland, round 2 (report-poland) — jumpForward

| | before |
|---|---:|
| System prompt | 90.6k chars ~22.6k |
| Cacheable prefix | 17.9k chars ~4475 |
| Cacheable share | 19.8% |
| User message | 1602 chars ~401 |
| Output schema (as Gemini gets it) | 28.7k chars ~7177 |
| All tools (Anthropic) | 30.1k chars ~7520 |
| Whole request | 122.3k chars ~30.6k |
| Not cacheable (Anthropic: tools ride with the prefix) | 74.3k chars ~18.6k |

| Section | before |
|---|---:|
| Game Map Description | 10.1k |
| Levers | 9606 |
| Fronts | 8530 |
| Event History of This Game | 5811 |
| What Is in Motion | 5728 |
| Every Event Carries Its Consequences | 4838 |
| Relations and Agreements | 4466 |
| Social Media | 3556 |
| How to Write an Event | 2694 |
| Wars | 2113 |
| The Map | 1975 |
| Figures the War Needs | 1732 |
| Real History Is the Default | 1728 |
| Units and Structures | 1635 |
| The World Answers Back | 1597 |
| Current Military Units | 1526 |
| Difficulty | 1423 |
| Polities | 1419 |
| Espionage Orders | 1393 |
| Canonical Diplomatic State v0.1.7-round-zero-baseline | 1337 |
| PRIORITY | 1309 |
| What an Order Can Do | 1254 |
| Military Strength | 1192 |
| (all smaller sections) | 13.7k |
