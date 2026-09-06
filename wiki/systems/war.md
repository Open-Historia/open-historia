On the stable release, who is at war with whom is a matter of what the events say. The beta
channel makes it a matter of record: four **ledgers** that the engine owns, validates and
enforces.

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
invasions, offensives, bombardments, active fronts and unit attacks all qualify.

An event describing a battle with no war behind it is rejected. So is one pointing at a war that
is in ceasefire or already over.

The practical effect: fighting cannot quietly appear out of nowhere. Someone has to have started
a war, and the record says who and when.

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

Relations move for concrete reasons. Having a spy ring publicly exposed in someone else's
country, for instance, costs that pair 20 points.

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

This is what turns "we agreed to an alliance in a conversation twelve turns ago" into something
the world still knows about and can be held to.

## Storylines

The fourth ledger, and the least visible: persistent world processes running underneath the
events. A storyline is a thing that is *developing* — a rivalry sharpening, an economy
unravelling, a succession crisis building.

Each carries a status (`active`, `dormant`, `resolved`), a **pressure** and **momentum** value
from 0 to 100, and a date at which it is next due attention. Every live war gets a mirrored
storyline.

Storylines are why a beta campaign has continuity between turns that nothing in the event log
explains: something has been building for six turns and is now due.

## What this changes to play

- **Wars have a beginning.** You cannot drift into one; someone declared it, and the ledger
  says so.
- **Ceasefire is a real state.** It is not peace, and resuming from it is a distinct act.
- **Relations are legible.** You can see the number rather than inferring the mood.
- **Treaties persist properly.** An alliance signed in turn three still constrains people in
  turn thirty.
- **Old saves are migrated.** A campaign started before the ledgers existed has them seeded from
  its existing treaty events and conversations on the next jump.

## On the stable release

None of this is modelled. Wars, relations and treaties exist because events and conversations
say they do, and the world's memory of them comes from the
[event history](/wiki/events/) and each country's own
[diplomatic memory](/wiki/diplomacy/). In practice it works, and it drifts more.

## Next

- [Diplomacy](/wiki/diplomacy/) — the conversations these ledgers record the results of.
- [Military and combat](/wiki/military/) — the fighting a war authorises.
- [Territory](/wiki/territory/) — what a war moves.
