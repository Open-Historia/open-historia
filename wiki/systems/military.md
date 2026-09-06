Armies in Open Historia are formations on the map with a type, a strength and an owner. Most of
the time you do not move them by hand — you order a military outcome and the world carries it
out. Combat, when it resolves locally, uses a deterministic formula you can plan against.

## The intended way to use your army

Write it as an order. *"Reinforce the eastern border with two armoured divisions"*,
*"Launch an offensive toward Kharkiv"*, *"Withdraw the fleet to home ports"*. The turn resolves
it and the units on the map move accordingly.

Hands-on troop control does exist — the **Forces panel** — but on the stable build it is opened
from the **🧪 Cheats** panel, and its own description calls it spawning and commanding units by
hand. That placement is deliberate: directly editing your order of battle is a game-master tool,
not the normal loop.

Clicking a unit on the map gives you an **intelligence card** — what the formation is, whose it
is, roughly how strong, and what it appears to be doing. It is a briefing, not a command panel.

## Unit types

| Type | Glyph |
|---|---|
| Infantry | 🛡 |
| Armor | ⚙ |
| Air | ✈ |
| Naval | ⚓ |
| Artillery | 💥 |
| Garrison | 🏰 |

A scenario can restrict which types exist — there is no air force in 1200 AD — so the deploy
options you see depend on the world you are playing.

## Strength

Strength runs from **1 to 1000**, and a new deployment defaults to 100. The Forces panel colours
it:

| Strength | Colour |
|---|---|
| Above 600 | Green |
| 251 – 600 | Amber |
| 250 or below | Red |

A unit that reaches zero strength is destroyed and removed.

## Status

| Status | Meaning |
|---|---|
| `idle` | In place, doing nothing in particular |
| `moving` | Under way |
| `engaged` | In contact with the enemy |
| `pending` | A deployment you have ordered that the world has not yet resolved — drawn translucent |
| `defeated` | Destroyed; removed from the map |

`pending` is the one to understand: a unit you place does not simply exist. It is an intention
until a time skip resolves it, and the world may resolve it differently from how you imagined.

## Reach: how far a unit can act

Units cannot act across the planet at will. Two separate limits apply, and both scale with the
era.

**Engagement range** — how far a unit can strike *right now*:

| Type | km |
|---|---|
| Garrison | 60 |
| Infantry | 100 |
| Armor | 150 |
| Artillery | 200 |
| Naval | 500 |
| Air | 1200 |

**Movement leash** — how far a single move order may relocate a unit before it has to become a
multi-turn campaign instead of a teleport:

| Type | km |
|---|---|
| Garrison | 200 |
| Infantry | 800 |
| Artillery | 800 |
| Armor | 1000 |
| Air | 3000 |
| Naval | 4000 |

**Era factor** — both tables are multiplied by the period:

| Period | Factor |
|---|---|
| Before 1500 | ×0.5 |
| 1500 – 1849 | ×0.7 |
| 1850 – 1944 | ×1.0 |
| 1945 onward | ×1.15 |

So infantry in 1200 AD reach 50 km, not 100. A Bronze Age campaign genuinely does move at Bronze
Age speed.

## How combat resolves

When a clash resolves locally, it uses a seeded formula. The seed is the attacking unit's id,
the defending unit's id and the round number — which means **the same clash in the same save
always produces the same result**, and reloading does not reroll it.

### Type advantage

The attacker's type is multiplied against the defender's:

| Attacker ↓ / Defender → | Infantry | Armor | Artillery | Air | Naval | Garrison |
|---|---|---|---|---|---|---|
| **Armor** | 1.5 | 1.0 | 1.3 | 0.7 | 0.5 | 1.2 |
| **Infantry** | 1.0 | 0.7 | 1.4 | 0.6 | 0.5 | 1.1 |
| **Artillery** | 1.2 | 1.0 | 1.0 | 0.5 | 0.8 | 1.5 |
| **Air** | 1.2 | 1.4 | 1.3 | 1.0 | 1.5 | 1.1 |
| **Naval** | 1.1 | 1.3 | 1.0 | 0.7 | 1.0 | 1.2 |
| **Garrison** | 1.2 | 0.8 | 0.7 | 0.6 | 0.7 | 1.0 |

The readable version: armour eats infantry and artillery but loses to aircraft and ships.
Aircraft beat almost everything and are only matched by other aircraft. Artillery smashes
garrisons and is helpless against air. Garrisons are defensive and bad at attacking anything
mobile.

### The maths

```
attacker power = strength × type advantage × (0.85 + 0.3 × random)
defender power = strength × type advantage × (0.85 + 0.3 × random) × 1.1
```

The defender gets a flat **×1.1 bonus** for fighting on its own ground. The random factor is
between 0.85 and 1.15, so luck moves a result by about ±15% — enough to matter, not enough to
overturn a real disadvantage.

Whoever has more power wins. Then losses are worked out from how *decisive* it was:

```
decisiveness = |attacker power − defender power| / total power     (0 = even, 1 = rout)

winner loses  0.10 + 0.25 × (1 − decisiveness)
loser  loses  0.35 + 0.45 × decisiveness
```

This has a consequence worth internalising: **a narrow win is expensive**. Win decisively and
you lose about 10% of your strength; win by a hair and you lose closer to 35%. The loser,
conversely, loses 35% in a close fight and up to 80% in a rout.

If the defender is reduced to zero, the region is captured.

### Planning against it

- **Bring overwhelming force or don't bother.** The loss curve punishes narrow victories hard.
- **Type matters more than numbers at the margin.** A 1.5 advantage is worth 50% more strength.
- **Attacking is expensive**, because of the defender's ground bonus. Being the one who is
  attacked is mechanically good.
- **The dice are already cast.** Outcomes are seeded, so reloading the same save will not change
  a specific clash. Undoing the whole turn and doing something different will.

## Structures do not move borders

Bases, ports, airfields and other built markers have an owner — whoever *runs* the facility —
which is not the same as who owns the ground beneath it. Building a base in an ally's country
does not annex it. See [cities and structures](/wiki/cities/).

## The beta unit system

The beta channel replaces hands-on control with an AI-driven system: units carry postures and
standing orders, the engine advances them at era-appropriate speeds across multiple turns, and
the model adjudicates combat rather than the local resolver. Saves are compatible in both
directions.

It is not in the stable release. See [relations, treaties and war](/wiki/war/) for the other
half of the beta military model.

## Next

- [Territory](/wiki/territory/) — what winning actually transfers.
- [Giving orders](/wiki/orders/) — phrasing military instructions.
- [Cheats](/wiki/cheats/) — where the Forces panel lives.
