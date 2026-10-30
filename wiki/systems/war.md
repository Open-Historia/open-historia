Who is at war with whom is not just a matter of what the events say. It is a matter of record:
four **ledgers** that the engine owns, validates and enforces.

The model does not write these directly. It emits compact updates, the engine checks them
against the rules, and folds the valid ones in once per turn. That is what stops the world
drifting into a state where two countries are simultaneously allied and at war.

## Wars

The war ledger is the **single authority on who is fighting whom**. Each war has a status:

| Status | |
|---|---|
| `active` | Being fought |
| `ceasefire` | Suspended, not settled |
| `ended` | Over |

Transitions are explicit and validated. A war can be **started**, **joined** on either side,
**left**, put into **ceasefire**, **resumed** from ceasefire, or **ended**. Illegal moves are
rejected outright — you cannot start a war that already exists, join a war that is not active,
resume one that is not in ceasefire, or end one that has already ended.

### Combat requires a war

This is the rule that makes the ledger worth having. **An event that narrates battlefield
combat must name an active canonical war and the countries fighting on each side.** Battles,
invasions, offensives, bombardments, active fronts and unit attacks all qualify. An offensive
that is plainly not military — diplomatic, economic, trade, legal, media, a charm or peace
offensive — does not, so a *"diplomatic offensive for sanctions relief"* is not mistaken for a
battle. A cyber offensive still counts as hostile.

An event describing a battle with no war behind it is rejected while the turn still has a retry
left, as is one pointing at a war that is in ceasefire or already over. On the final attempt the
turn is repaired rather than thrown away: a war record that still cannot be bound to an event is
dropped, along with the war bindings of its events, and the rest of the turn stands. The events
survive as narrative; only the canonical war change is lost, and it is written to the diagnostics
log.

The practical effect: fighting cannot quietly appear out of nowhere. Someone has to have started
a war, and the record says who and when — but a single unbindable record no longer costs you the
whole turn.

<p class="beta-note"><b>On beta, the battlefields write to the ledger too.</b> Where a land war is
fought on a <a href="/wiki/war-room/">battlefield</a>, an attack across a border two countries are
at peace on opens a war between them only when it is a real offensive (a major or total effort),
or when the story opens that war itself; a border clash or a minor incident opens nothing. An order
a player gives always counts. A route you draw in the War Room into a country that is not in the
war is an attack on it: when your troops reach its border, it joins the war against you.</p>

## Relations

One score per pair of countries, from **−100 to +100**, sorted into bands:

| Score | Band |
|---|---|
| 55 and above | **friendly** |
| 20 to 54 | **cordial** |
| −10 to 19 | **neutral** |
| −30 to −11 | **cautious** |
| −60 to −31 | **strained** |
| −89 to −61 | **hostile** |
| −90 and below | **rival** |

The band is always derived from the score rather than declared separately, which prevents the
world from claiming two countries are "cordial" while their score says otherwise.

A pair with no entry is **unknown**, which is not the same as neutral — it means these two
countries have no tracked relationship yet, not that they are indifferent to each other.

Relations move for concrete reasons rather than drifting. A ring of yours exposed publicly in
someone else's country sours that pair; so does breaking an agreement, and so does backing their
rival. The size of each move is the simulation's to decide — there is no fixed tariff per
offence. A score that contradicts a pair's declared status — "friendly" while at war — is
reconciled rather than left standing.

**The world is allowed to move against you.** Nothing spares the player: a foreign power may
start something with you, and when there is a fight both sides fight. What the simulation is
told not to do is **invent** a rivalry the record does not support — neighbours are not enemies
for sharing a border — and that applies to every pair of countries on the map, you included.

## Agreements

A register of what has actually been signed:

| Type | |
|---|---|
| `alliance` | Full alliance |
| `mutual_defense` | Defensive pact |
| `guarantee` | One-sided security guarantee |
| `non_aggression` | Non-aggression pact |
| `friendship_consultation` | Friendship and consultation treaty |
| `trade_economic` | Trade or economic agreement |
| `military_cooperation` | Military cooperation |
| `military_access` | Basing and transit rights |
| `neutrality` | Neutrality agreement |
| `peace_settlement` | The settlement ending a war |
| `other` | Anything else |

Each is `active`, `suspended`, `ended` or `expired`.

The register only holds what earlier turns recorded. If a turn tries to end, suspend or update an
agreement that was never recorded, the game re-aims it at the one recorded agreement with exactly
the same parties and type, if there is exactly one. Otherwise that single change is dropped, with
a note in the diagnostics log, and the rest of the turn stands. It would rather lose one change
than end the wrong treaty.

This is what turns "we agreed to an alliance in a conversation twelve turns ago" into something
the world still knows about and can be held to.

## Alliances that bind

On the stable build an alliance is a record, not a trigger. The ledger is told that an alliance
does not by itself put anyone at war, so an ally fights beside you only if the story has it join.

<p class="beta-note"><b>Beta channel only.</b></p>

On beta, treaties call their members in. When a war **begins** and a country is attacked, every
country bound to defend it is called: partners in an **alliance** or a **defensive pact**, a
country that gave it a **guarantee**, and full members of an institution that is a security
alliance or a defence pact with it. Only the country attacked calls, and only in a war that began
that turn, so an old save is not swept into wars that were already being fought. A country bound
to both sides stands aside and breaks nothing.

- **A country nobody plays** comes in on the defender's side, strongest first, unless its
  relations with the defender are below −30 or its own war weariness is 70 or more. Then it breaks
  the treaty instead.
- **You** are asked. A **Call to arms** card appears over the map: **Honour the alliance** puts you
  at war; **Break the treaty** costs you 15 points of reputation and takes you out of the
  agreement (an institution keeps your seat). A call left unanswered for two turns counts as
  broken.

The cards can be folded away to a small **Waiting for your answer** button while you think.

## War weariness

<p class="beta-note"><b>Beta channel only.</b></p>

Every country at war grows **weary** of it, on a scale from 0 to 100 that the game keeps itself;
no request is made for it. It rises with every year at war, with the men a war calls up, with the
ground a country loses, under a blockade, and sharply with the troops that weather and being cut
off wear away, a hard winter above all. Taking ground eases it a little, and it falls away in
peace. One period can add at most 35.

Past 50 it tells on a country's armies: they come back up to strength more slowly, with fewer
reserves, and fight and move a little worse. The story is told who is weary, so it shows at home.
Each government at war is told its own weariness, with the rest of its war, whenever it talks
diplomacy: a weary one may seek peace, but nothing forces it to (see below).

You can read it under each war in the **🤝 Diplomacy** tab of your country panel (open it from your flag), under **Current
conflicts** (**War weariness:** and each side's leading country with its figure), and on a
country's **⚔ Military** card. See [national statistics](/wiki/statistics/).

## Ending a war: peace on terms

<p class="beta-note"><b>Beta channel only.</b></p>

On the stable build a war ends when the story ends it. On beta a war can also end **on terms**,
which the game carries out itself. Terms are two things:

| | |
|---|---|
| **The ground** | **Each side keeps the ground it holds**: what was taken is ceded. Or **the old borders**: every region goes back to whose it lawfully was. |
| **Reparations** | One side pays the other a share of its economy every year for a number of years, out of its public finances. Or nobody pays. |

**Peace offered to you.** A country nobody plays that is at war with you offers peace when it
decides to, never at a fixed weariness: its leader writes to you in your diplomatic chat with it,
and the terms are shown on that message with **Accept** and **Decline**. A weary or losing country
may still fight on, and one that is winning may still want peace. Its leader may also offer peace
in a reply when you are talking to it. An open offer lapses after four turns, or when a new one
takes its place.

**Peace you propose.** In your chat with an enemy, **Peace** opens two choices, the ground and the
reparations (nobody pays, or 1% a year for 5 years, or 3% a year for 10, either way round), and
**Send terms**. They are sent as your message, and the enemy's leader answers them in its reply:
it accepts, declines or offers other terms of its own. **Propose peace in the chat**, under each of
your wars in the **🤝 Diplomacy** tab, opens that chat. A war fought against another player is ended
by talking to them.

**Between countries nobody plays**, a war ends on terms when the story says the two made peace.

**What each side knows.** A government at war is told its own war whenever it talks diplomacy, in
a time skip, in a reply to you or in a group chat: how weary it is, its supplies, the ground each
side holds, how its battlefields go, a blockade, its allies and calls to arms, and the terms on the
table. It decides what to do with them: one running short may ask its allies, or you, for help.

A peace made ends the war in the ledger at once. Its battlefields close when time next passes, so
the map shows them until then. The reparations a country is paying or being paid, and for how
many more years, are listed in the same tab.

**A ceasefire can still be settled.** A war under a ceasefire or an armistice can be ended on
terms like one still being fought, and the ground moves with them.

## Storylines

The fourth ledger, and the least visible: persistent world processes running underneath the
events. A storyline is a thing that is *developing* — a rivalry sharpening, an economy
unravelling, a succession crisis building.

Each carries a status (`active`, `dormant`, `resolved`), a **pressure** and **momentum** value
from 0 to 100, and a date at which it is next due attention. Every live war gets a mirrored
storyline. At most **96** are kept.

Storylines are why a campaign has continuity between turns that nothing in the event log
explains: something has been building for six turns and is now due.

**They are not allowed to stall.** An active war, or any storyline at pressure **55** or above,
that goes **45 days** of game time without a visible milestone has to move: link a real event,
change status, or shift pressure by at least 4 points or momentum by at least 6. If a time skip
leaves one stuck, the game makes a short repair call for it once the skip is done, with up to
**ten minutes** in total per skip. A repair that fails or runs out of time leaves the storyline
where it was and overdue for the next turn. It never costs you the turn itself.

## What this changes to play

- **Wars have a beginning.** You cannot drift into one; someone declared it, and the ledger
  says so.
- **Ceasefire is a real state.** It is not peace, and resuming from it is a distinct act. (On
  beta, peace terms can still be made from it.)
- **Relations are legible.** You can see the number rather than inferring the mood.
- **Treaties persist properly.** An alliance signed in turn three still constrains people in
  turn thirty.
- **Old saves are migrated.** A campaign started before the ledgers existed has them seeded from
  its existing treaty events and conversations on the next jump.

## Puppets and overlords

<p class="beta-note"><b>Beta channel only.</b></p>

On beta a fifth ledger records who **directs** whom. A **puppet** is a country whose will is
directed by an **overlord** while it stays a separate country: it keeps its own territory, its own
sovereignty and its own colour. One puppet has one overlord; an overlord may hold many; and there
are no chains — making a country that holds puppets into a puppet hands its puppets to the new
overlord, permanently.

| Kind | What the overlord holds |
|---|---|
| **Protectorate** | Its foreign policy and defence; it governs itself at home. |
| **Puppet state** | Its government. It keeps the flag and the name; the decisions are the overlord's. |
| **Client state** | Its lead: it depends on the overlord's backing but makes most of its own decisions. |

An arrangement is either **open** — a published protectorate, a satellite every government knows
about — or **covert**. A covert puppet knows it is one and behaves accordingly with whoever in the
room has not found out. Other governments learn of a covert arrangement through an **active agent**
inside either party, and go on believing what they last learned until fresh reporting corrects
them. The country panel and the map card show what *you* know: the kind, one sentence on what it
means from your side, and chips for mood, since when, and open or covert.

**Loyalty** is how far a puppet accepts direction, 0–100. It is always hidden — even for an open
arrangement — and shown to the overlord only as a band: **Loyal** (75+), **Content**, **Restless**
or **Seething** (below 25). A puppet whose loyalty falls below 35 is given a hidden storyline
toward revolt; whether anything comes of it is the simulation's call, and a rising can be
suppressed as well as won — at a cost in standing. Annexing a puppet costs the overlord standing
too: 8 points of international reputation (out of 100) for a covert arrangement, 16 for one
the world could see.

**Demands.** In the one-on-one thread between an overlord and its puppet, a message can be a
**demand**. It appears as a card hanging off the message that made it. The puppet can
**Accept**, **Refuse**, or offer an **alternative** in its own words, which the overlord either
accepts or answers by demanding again. Only a refusal costs loyalty, charged once per turn; a
refusal can still be thought better of ("Accept after all"), and what has been agreed is final.
When you are the overlord, a toggle in the composer makes your message a demand. The cards are
choices, so answering one costs no request.

The [GM console](/wiki/cheats/) can make, reclassify or release a puppet directly. A scenario can
switch the whole system off with its **Puppet states** feature, and then nothing mentions
subordination at all.

## Next

- [Diplomacy](/wiki/diplomacy/) — the conversations these ledgers record the results of.
- [Military and combat](/wiki/military/) — the fighting a war authorises.
- [The War Room](/wiki/war-room/) — battlefields and fronts, on beta.
- [War at sea](/wiki/war-at-sea/) — fleets, sea battles and blockades, on beta.
- [Territory](/wiki/territory/) — what a war moves.
