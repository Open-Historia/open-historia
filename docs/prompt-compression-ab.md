# Prompt compression: the quality A/B

Did the smaller time-skip prompts (Phases 1 and 2 of the plan of 2026-11-07,
and on-device related events; [prompt budget](prompt-budget.md)) make the
skips any worse? This compares a real skip with the old prompt and with the
new one on five saves, through gemini-3.5-flash-lite on the owner's key, run on
2026-11-07.

**Short answer.** The new prompt is no worse on everything the code can check:
valid answers, region transfers, dead leaders, closed projects and wars. It
still recalls nearly as many facts about the world. One thing is worse, and the
judge found it every time: the **spotlight** line ("give each a development of
its own") makes the model spend about a quarter of a skip's events on random
small powers. A judge model preferred the old skip in 9 of 10 verdicts. With
that one sentence removed, the judge has no consistent preference on 3 of 4
saves. Separately, the **history tiers never fill on Gemini**: the skip's
`years` and `canon` come back as empty objects, so a fold keeps only the
document, as it did before Phase 2.

## Method

### The two prompts

- **Old:** beta `bd2a37df`, with the prompt rig copied in (the `pb-base`
  worktree, as used for the "before" run in [prompt budget](prompt-budget.md)).
  It builds the same prompt as `ad26ec16`, whose only change is the
  unlimited-requests mode, and that mode is off by default.
- **New:** beta `9b599e23` (Phase 1, Phase 2 and related past events).
  Related past events needs the on-device model (opt-in then; built in and always on since), so it is not in
  these requests: this measures Phases 1 and 2.
- The later beta commit `40a19bd5` (prompts name regions, never their ids) is
  not covered.

### How each request was made

- A copy of `scripts/prompt-size.mjs` ran the game's own `simulateTimelineJump`
  in each tree. The provider was Gemini, the model gemini-3.5-flash-lite, and
  the key a dummy. The rig caught the request at the provider's door.
- The skip asks no temperature. The game's own custom parameters
  (`gemini_custom_params`) set `generationConfig.temperature = 0` in both arms.
- Each captured body was sent unchanged to the game's own URL
  (`streamGenerateContent?alt=sse`), with the key in `x-goog-api-key`.

### Two saves needed the game's second request

- **Modern Day 2026, r130.** Gemini refused the function-call form in both arms
  (400 "Request contains an invalid argument"). The game then asks again with
  the answer as JSON text. The rig caught that second request by answering the
  first with the same 400, and that request was sent. Its `responseMimeType`
  was restored next to the temperature, because a custom `generationConfig`
  replaces the game's whole object.
- **New Dawn, r30, new arm.** The model first called `order_troops` with
  "German-Czech Frontier~Germany~withdraw~all": the player's order was "END THE
  WAR RIGHT NOW". The rig answered the first call with that function call, so
  the game fought the period again and built its second request, which was
  sent. The old arm answered in one request.

### The five saves

Each save was skipped 30 days. These are five of the seven in
[prompt budget](prompt-budget.md). The 1836 save is left out because its map is
not on this machine.

| Save | Player | Round | Events in the save | Fold due |
|---|---|---:|---:|---|
| Modern Day 2026 (copy) | People's Republic Of Italy | 130 | 769 | no |
| Modern Day (built-in) | Brazil | 67 | 905 | yes |
| New Dawn | Germany | 30 | 259 | no |
| Battle of Europe | United Kingdom | 7 | 43 | no |
| Modern Day (report-poland) | Poland | 2 | 12 | no |

### What was measured

- **Code checks** (`ab-check.mjs`). Each answer went through the game's
  `normalizeEventEntry` and, for the fold, `judgeSkipHistoryAnswer`, both from
  the new tree, for both arms. Regions, owners, polities, wars, projects and
  agreements were checked against the save's own records.
  - "Gone leaders" are people the save's events retired, removed or killed:
    - r130: Ali Khamenei, Evika Siliņa and Keir Starmer;
    - r67: Nursultan Nazarbayev, plus Bolsonaro, Biden, Boris Johnson and
      Trump, all out of office by 2038.
  - Powers acting are the distinct powers, other than the player, named in an
    event's title, text, places or map operations. Each is classed by how the
    new prompt shows it: in view (full detail), in one line, in the spotlight,
    or not named at all (past the one-line list's cut).
- **Pairwise judge.** gemini-3.5-flash-lite was given a compact fact sheet of
  the save (active and ended wars, agreements, relations, projects, the last 15
  event titles) and both answers. It picked the better one on five criteria
  plus overall, in both orders (A/B, then B/A).
- **Retention probe.** Ten questions per save were built in code from the
  save's records, and the old prompt's map listing for who holds what. They
  were asked against each arm's system prompt in one request, at temperature 0,
  with a JSON answer. Scoring is automatic: names are normalised and their
  aliases accepted, yes/no is matched on the first word, numbers exactly.
  - The mix of questions:
    - who holds a region (one that changed hands, one of a power the new prompt
      shows in one line);
    - war yes/no;
    - the agreement or treaty in force;
    - the relation status;
    - the player's region count;
    - the year of an old event;
    - whether the oldest closed project is finished;
    - a one-line power's region count.
  - Three are phrased without the prompt's wording: "Which government's writ
    runs in X", "Whose armed forces is X currently fighting", and "carried
    through to its end".
- **Follow-up (no spotlight).** The judge's reasons all named the spotlight
  powers, so the new request was sent again on four saves with only the
  spotlight sentence deleted from the captured body (no game code changed),
  then judged against the old answer in both orders.

### Requests

53 in all, under the cap of 70.

| Purpose | Requests | Refused or retried |
|---|---:|---|
| Skips, old and new | 18 | 4 × 400 (the r130 function-call form, both arms, sent twice before the JSON-text form was caught), 2 × 429 |
| Skips without the spotlight | 5 | 1 × 503 |
| Retention probe | 10 | none |
| Judge | 11 | 1 × 503 |
| Judge, without the spotlight | 9 | 1 × 503 |

- Each 429 and 503 was waited out and retried.
- No daily quota was hit.
- Raw requests, answers, verdicts and the ledger are in the scratchpad
  (`ab-results/`), not in the repo.

With one skip per arm per save, every per-save difference below could be
chance. Read the counts as counts.

## Per save

### The skips

| Save | Arm | Valid | Events | Description chars | Output tokens | Prompt tokens |
|---|---|---|---:|---:|---:|---:|
| Italy r130 | old | yes (JSON text) | 10 | 7,128 | 3,865 | 73,978 |
| | new | yes (JSON text) | 11 | 3,704 | 3,596 | 66,346 |
| Brazil r67 | old | yes | 10 | 4,413 | 5,809 | 54,037 |
| | new | yes | 12 | 4,220 | 5,394 | 51,987 |
| Germany r30 | old | yes | 8 | 2,190 | 2,145 | 50,536 |
| | new | yes (2nd request) | 8 | 2,501 | 2,634 | 50,133 |
| UK r7 | old | yes | 11 | 4,229 | 3,805 | 41,461 |
| | new | yes | 10 | 5,590 | 3,487 | 38,082 |
| Poland r2 | old | yes | 10 | 4,875 | 3,220 | 29,986 |
| | new | yes | 10 | 4,855 | 3,385 | 30,114 |
| **All five** | old | 5/5 | 49 | 22,835 | 18,844 | 249,998 |
| | new | 5/5 | 51 | 20,870 | 18,496 | 236,662 (−5%) |

- The new arm wrote a `digest` on every event (51/51).
- Gemini's implicit cache took 45k–63k tokens on three sends that shared an
  opening with an earlier one (`cachedContentTokenCount`), so the cached prefix works on
  Gemini too.

### What the answers did to the world

| Save | Arm | Powers acting: in view / one line / spotlight / unnamed | Region ops: bad region / bad polity / "from" not the owner | Places (unresolved) | Gone leaders in office | Closed projects restarted | War issues | Fold |
|---|---|---|---|---|---:|---:|---:|---|
| Italy r130 | old | 6: 5 / 1 / 0 / 0 | 0: 0 / 0 / 0 | 6 (2) | 0 | 0 | 0 | not due |
| | new | 8: 5 / 0 / 3 / 0 | 0: 0 / 0 / 0 | 5 (5) | 0 | 0 | 1 | not due |
| Brazil r67 | old | 4: 4 / 0 / 0 / 0 | 0 | 5 (0) | 0 | 0 | 0 | document 1,019 words, taken |
| | new | 4: 1 / 0 / 3 / 0 | 0 | 7 (0) | 0 | 0 | 0 | document 1,078 words, taken; years 1 and canon 2, **all empty `{}`**; no tier taken |
| Germany r30 | old | 5: 5 / 0 / 0 / 0 | 4: 0 / 0 / 4 | 0 | 0 | 0 | 1 | not due |
| | new | 4: 1 / 1 / 2 / 0 | 1: 0 / 0 / 0 | 0 | 0 | 0 | 0 | not due (filled anyway, ignored) |
| UK r7 | old | 6: 2 / 3 / 0 / 1 | 6: 0 / 0 / 1 | 6 (0) | 0 | 0 | 0 | not due |
| | new | 6: 2 / 1 / 3 / 0 | 5: 0 / 0 / 1 | 8 (2) | 0 | 0 | 0 | not due (filled anyway, ignored) |
| Poland r2 | old | 7: 5 / 2 / 0 / 0 | 0 | 5 (0) | 0 | 0 | 0 | not due |
| | new | 14: 6 / 3 / 2 / 3 | 0 | 2 (0) | 0 | 0 | 0 | not due (filled anyway, ignored) |
| **All five** | old | 28: 21 / 6 / 0 / 1 | 10: 0 / 0 / 5 | 22 (2) | 0 | 0 | 1 | |
| | new | 36: 15 / 5 / 13 / 3 | 6: 0 / 0 / 1 | 22 (7) | 0 | 0 | 1 | |

Notes on the table:

- **Gone leaders.** On r67 both arms name Bolsonaro and Trump, but only in the
  history document's 2016–2019 lines. Nobody gone acts in office.
- **Wars.**
  - Old, r30: it ended the player's war by a `warUpdates` "end" line. The engine
    refuses that, and the previous turn's result had already told the model
    so.
  - New, r130: one event carries the war id `storyline-war-r0v1-1te3pmm`, which
    the ledger marks ended. The ledger's active Russia–Ukraine war is a
    corrupted twin, `storyline-war-r0v1-1te3pmm},{combatants:[],date:`. This
    is a fault in the save, not in the prompt.
- **"From" not the owner.**
  - Old, r30: four transfers from the Protectorate of regions Germany already
    holds.
  - UK r7, both arms: Dublin "from Ireland" when the map already gives it to
    the United Kingdom.

### Retention probe

| Save | Old | New | Where they differ |
|---|---:|---:|---|
| Italy r130 | 7/10 | 8/10 | at war, ended war: old "yes" (wrong), new "no" |
| Brazil r67 | 8/10 | 6/10 | Borski (Serbia, a one-line power): new "unknown"; the year of "Saudi Arabia Severs Diplomatic Ties With Iran": new "unknown". Neither prompt carries that event, so old answered 2016 from real history. |
| Germany r30 | 9/10 | 8/10 | Chaouia - Ouardigha (Morocco, one line): new "unknown" |
| UK r7 | 10/10 | 9/10 | Anhui (China, one line): new "unknown" |
| Poland r2 | 10/10 | 8/10 | Aerodrom (North Macedonia, one line) and Las Piedras (Puerto Rico, not in view): new "unknown" |
| **All five** | **44/50 = 88%** (95% Wilson 76–94%) | **39/50 = 78%** (65–87%) | |
| Without the five one-line region-holder questions | 39/45 = 87% (74–94%) | 38/45 = 84% (71–92%) | |

By kind of question (old right / new right):

| Question | n | Old | New |
|---|---:|---:|---:|
| Who holds a region that changed hands | 5 | 5 | 5 |
| Who holds a region of a one-line power | 5 | 5 | 1 |
| Who holds another region | 3 | 3 | 2 |
| Which government's writ runs in a region (paraphrased) | 3 | 3 | 3 |
| At war, yes | 3 | 3 | 3 |
| At war, no | 5 | 3 | 4 |
| Agreement in force | 2 | 2 | 2 |
| Relation status | 4 | 3 | 3 |
| Peace treaty date | 1 | 0 | 0 |
| The player's region count | 5 | 5 | 5 |
| A one-line power's region count | 3 | 3 | 3 |
| Year of an old event | 5 | 3 | 2 |
| Oldest closed project finished (paraphrased) | 4 | 4 | 4 |
| The player's enemy (paraphrased) | 2 | 2 | 2 |

The new arm never gave a wrong answer where the old gave a right one. Every
loss is an "unknown", and five of the six are a region of a power the new
prompt deliberately shows only by name and size. The intervals overlap
completely; this is no evidence of a difference in recall.

### Pairwise judge

Verdicts with the old answer as A, then the new answer as A (each mapped back
to old/new):

| Save | Order | Consistency | Plausibility | Agency | Continuity | Writing | Overall |
|---|---|---|---|---|---|---|---|
| Italy r130 | A=old | old | old | old | old | old | old |
| | A=new | old | old | old | old | old | old |
| Brazil r67 | A=old | old | old | old | old | old | old |
| | A=new | old | old | old | old | old | old |
| Germany r30 | A=old | old | old | old | old | old | old |
| | A=new | old | old | old | old | old | old |
| UK r7 | A=old | old | old | old | old | old | old |
| | A=new | old | old | old | old | old | old |
| Poland r2 | A=old | old | new | new | old | new | new |
| | A=new | tie | old | old | old | old | old |
| **10 verdicts** | | old 9, tie 1 | old 9, new 1 | old 9, new 1 | old 10 | old 9, new 1 | **old 9, new 1** |

Without the spotlight sentence, on the same four saves:

| Save | A=old | A=new | Consistent winner |
|---|---|---|---|
| Italy r130 | old | old | old: the new answer told the same Malian border action twice (events 1 and 10) |
| Brazil r67 | old | new | none (each order prefers its first answer) |
| Germany r30 | new | old | none (each order prefers its second answer) |
| UK r7 | old | new | none |
| **8 verdicts** | | | overall old 5, new 3 |

Four of the five judge rounds with the spotlight complained about it. Its
reasons:

- On Brazil r67: the new answer "relies on random micro-states like San
  Marino and Botswana enacting reforms out of nowhere".
- Filler of the same kind was named on UK r7 (Bhutan, Bolivia),
  on Germany r30 (Romania, Turkey, Cuba, Guernsey) and on Italy r130 (Myanmar,
  Ecuador).

The judge has limits:

- It is the same small model.
- It sees only a fact sheet, not the engine's rules. It credited the old r30
  answer for ending the war "cleanly", an end the engine refuses.
- It shows a position bias once the spotlight is gone.

The size and the consistency of the preference with the spotlight in (4 saves
of 5 in both orders) are still the clearest signal in this A/B.

## Verdict

| Dimension | Verdict | Numbers |
|---|---|---|
| Valid answers | no worse | 5/5 and 5/5. Both arms hit the same Gemini refusal on r130 and recovered the same way. |
| Size of the answer | no worse | 49 → 51 events; descriptions −9%; output tokens −2%; prompt tokens −5% |
| Region transfers | no worse | 0 unknown regions or owners in either arm; "from" not the owner 5 → 1 |
| Event places | slightly worse | unresolved places 2 → 7 of 22, five of them in one skip (r130); one says Paris is France's |
| Dead and retired leaders | no worse | 0 in office in either arm |
| Closed projects | no worse | 0 restarted in either arm |
| Wars | no worse | 1 issue each. The new r30 run kept to the engine's rule; without the spotlight it broke it the way the old one did, so that is noise. |
| Off-screen powers | more of them, the wrong kind | 28 → 36 distinct powers, but 13 of the 36 are spotlight powers and the powers in view fell 21 → 15. Without the spotlight, 21 → 16 on four saves. |
| History fold | worse for the new tiers, no worse for what is kept | the document was taken in both (1,019 and 1,078 words); the new `years`/`canon` came back as `{}` and nothing went into the canon |
| Fact recall | no worse within the noise | 88% → 78% overall, 87% → 84% without the by-design one-line regions; no wrong answers, only "unknown" |
| Judge: consistency, plausibility, agency, continuity, writing | worse | old 9 of 10 overall. Without the spotlight sentence: no consistent winner on 3 of 4 saves. |

Without the spotlight, the new prompt is no worse anywhere the A/B can see,
at 5% fewer prompt tokens on Gemini's count, and far less on the part a
provider cannot cache ([prompt budget](prompt-budget.md)). With it, the skips
read worse.

## The specific failures

1. **Spotlight filler.** Every new-arm skip gave the three spotlight powers
   events of their own, about a quarter of the skip:
   - Brazil r67: "San Marino Grand and General Council Enacts Administrative
     Trade Reforms", during a Brazil–Russia war;
   - UK r7: "Bhutan Inaugurates Nationwide Gross National Happiness Community
     Welfare Initiative", in the middle of Operation Shamrock in Ireland;
   - Germany r30: "Guernsey Royal Court Debates Revised Maritime Trade and
     Financial Rules".

   They took the place of powers in view. On r67 the old skip had Ukraine,
   the United States, Japan and the UN, while the new one had only Russia plus
   Finland, San Marino and Botswana.
2. **History tiers empty on Gemini.** On the r67 fold the skip answered
   `"years": [{}], "canon": [{}, {}]`. `judgeSkipHistoryAnswer` took the
   document (1,078 words), so the fold landed as before Phase 2, but the canon
   that "never fades" got nothing. The run without the spotlight wrote no tiers
   at all. The cause is in `foldJumpTool` (`gameplaySchemas.js`): the skip's
   `history.years`, `canon` and `eras` are `{ type: "array", items: { type:
   "object" } }` with no properties. Gemini's function calling then produces
   empty objects, while `socialPosts`, whose items have properties, comes back
   full.
3. **A wrong owner in a place.** Italy r130, new: "region: Métropole du Grand
   Paris, country: France". Both prompts list Métropole du Grand Paris under
   the People's Republic Of Italy. The old answer had "region: Métropole du
   Grand Paris", "country: People's Republic Of Italy". Its other unresolved
   places, Ile-de-France, Zaporizhzhia and Kayin State, are not region names
   on that map.
4. **An offensive nobody ordered.** Brazil r67, new: "Brazilian Expeditionary
   Forces Launch Coordinated Northward Offensive Toward Moscow Approaches".
   There were no orders this round, and the last events had the advance
   stalled near Tikhoretsk and a defensive line dug. The run without the
   spotlight stayed on the defensive, so this is one sample and may be chance.
5. **The history field answered with no fold due.** The new tool always
   declares `history`, and flash-lite filled it in 3 of 4 skips without a fold
   job (summary of 426–728 characters, once with a 66-word document).
   `gameplay.js` drops it when no fold rides on the skip, so it costs only
   output tokens.

Not caused by the compression, but found on the way:

- The r130 campaign's skip is refused as a function call by
  gemini-3.5-flash-lite in both arms (400, invalid argument). Every skip there
  costs a second request in the JSON-text form. Its schema differs from the
  other saves only in the scenario's 21 bounded custom stats (11 more
  `minimum`/`maximum` pairs). That is the likely cause, but it was not
  bisected (it would cost requests).
- The war ledgers of two saves are malformed:
  - r130 has an active war whose id has JSON glued to it;
  - Battle of Europe has the UK–Ireland war with sides `["United Kingdom",
    "Ireland"]` against `["1", "2"]`.

## What to fix

None of this is changed here. The owner decides.

1. **The spotlight** (`promptContext.js` line 2208, `promptFocus.js`
   `pickSpotlight`). Options, cheapest first:
   - **Make it a permission, not a quota.** For example: "Powers the story has
     not followed lately: X, Y, Z. If one of them has something that bears on
     this period, it may act; leave them out otherwise."
   - **Name one power, not three.** Pick it by size or by a link to the
     period's storylines, relations or wars, instead of a hash rotation over
     everything with three regions (San Marino, Guernsey and Bhutan all
     qualified).
   - **Remove the sentence.** The off-screen breadth then falls a little below
     the old prompt's (16 powers against 21 on four saves).

   Re-run the judge on the same saves after the change: about 4 skips and 8
   judge requests.
2. **The history tiers' item shapes** (`gameplaySchemas.js` `foldJumpTool`,
   around line 3909). Give the items the consolidator's own properties: years
   `{year, text}`, canon `{date, kind, text, key}`, eras `{from, to, text}`.
   This is a few hundred characters of schema, and the consolidator's own
   function already has them.
3. **Optional:**
   - Bisect the r130 function-call refusal: try `toGeminiSchema` without the
     custom stats' bounds.
   - Leave `history` undeclared when no fold is due, if the cache does not
     depend on it.
