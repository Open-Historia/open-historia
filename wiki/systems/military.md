Armies in Open Historia are formations on the map with a type, a strength, a posture and an
owner. You do not move them by hand. You state what you want, the turn decides what happens, and
the engine carries the movement out over however many turns it takes.

## The way to use your army

Write it as an order. *"Reinforce the eastern border with two armoured divisions"*,
*"Launch an offensive toward Kharkiv"*, *"Withdraw the fleet to home ports"*. The time skip
resolves it, and after the skip the game moves units to match what the events say — armies
advance, retreat and take losses where the events say they did. (The skip's own events
carry those moves; nothing is asked afterwards.)

The model owns movement; you own intent. A place an order or event names — "toward Kyiv", "the
Suwałki gap" — is read as an objective and found on the actual map, and new units and structures
are placed by name and kept off one another.

Clicking a unit on the map gives you an **intelligence card** — what the formation is, whose it
is, roughly how strong, what it is made of, and what it appears to be doing. It is a briefing,
not a command panel.

Hands-on control does exist — the **Force Manager**, under **Military** in the
[cheats panel](/wiki/cheats/) — for deploying, inspecting, editing and repairing forces directly.
That placement is deliberate: editing your order of battle by hand is a game-master tool, not the
normal loop.

<p class="beta-note"><b>On beta, land wars are fought on battlefields.</b> Where two sides at war
hold land that touches, a battlefield opens and the game fights the land war itself, with hundreds
of troops a side, before the time skip's story is written. Your infantry, armour and artillery
formations near the line join it as troops and come back as formations when it closes; fleets,
air wings and garrisons stay formations. You command your troops in the
<a href="/wiki/war-room/">War Room</a>, and your fleets there or by order: see
<a href="/wiki/war-at-sea/">war at sea</a>.</p>

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

## Strength and composition

Strength is a **percentage of the formation's established strength**, 0–100: 78 means about three
quarters of what that formation should have. A new unit starts at 100. A separate
**composition** says what it actually is — *"1 aircraft carrier, 2 frigates"*.

| Strength | Colour |
|---|---|
| Above 60 | Green |
| 26 – 60 | Amber |
| 25 or below | Red |

Strength only changes where the events narrate casualties or reinforcement (on beta, also where a
battlefield or a sea battle wears a formation down). A unit that reaches zero is destroyed and
removed. Saves from before the percentage scale are converted on load —
anything over 100 is divided by ten.

## Posture

What a formation is **doing**, as distinct from whether it is alive. Posture is what makes the map
readable at a glance: *massing* on a border and *on exercise* on the same border are the same
counter and a completely different message.

| Posture | |
|---|---|
| **Holding position** | In place. |
| **Massing** | Concentrating. |
| **Patrolling** | Working a station around a point. |
| **In transit** | On its way somewhere. |
| **On exercise** | Training, not threatening. |
| **Blockading** | Closing a sea or a port. |
| **Withdrawing** | Pulling back. |
| **Assaulting** | Attacking; arriving under this posture puts the unit in contact with the enemy. |

## Standing orders

A move that is further than the unit could cover in the time skipped becomes a **standing
order**, and the engine advances it every turn at the unit's pace until it arrives — within about
60 km of its destination. A patrol works its station, drifting to a new point each turn (the
same point every time you replay that turn, never at random). The map draws a heading line to a
destination and a ring around a patrol station, and counters glide between positions.

Travel is paced by what it is. A move is a **redeployment** unless the formation's posture is
assaulting, and a redeployment goes by rail, road and ship; an **advance** against an enemy is
much slower. Kilometres a day, by era:

| | Before 1500 | 1500 – 1849 | 1850 – 1944 | 1945 onward |
|---|---|---|---|---|
| Redeployed over land (infantry) | 25 | 28 | 300 | 500 |
| Redeployed by sea | 110 | 170 | 400 | 650 |
| Advancing, infantry | 18 | 20 | 20 | 30 |
| Advancing, armour or cavalry | 30 | 35 | 35 | 50 |
| Fleet | 130 | 200 | 480 | 750 |
| Air wing | 700 | 1000 | 1500 | 5000 |

A garrison does not travel. A redeployment that crosses water is paced by how much of its way
lies over the sea, so a division ordered from Texas to Korea in 2016 arrives in about three
weeks. Before the railways a march across a continent is still a campaign, not a turn. There is
no separate cap on how far one order may send a unit: the pace is the limit, and a long move simply
takes the turns it needs.

## Other countries' forces

AI countries' formations respond to the military events a turn wrote: the engine reuses an
existing formation before raising a new one, moves each at its type's pace, and only changes
strength where the events say so. The map holds at most **12** formations per AI country and
**80** in total; your own forces count against neither. On the stable build their formations are
moved by turns, not between them.

<p class="beta-note"><b>On beta, the world stirs between turns.</b> With <b>Background AI</b> and
the <b>Idle diplomacy</b> feature on, the pulse that lets other countries write to you while the
game sits open may also move or re-posture up to two of other countries' formations at a time:
never one of yours, and never a garrison on the move. A movement near your sphere that your
services would plausibly see is reported as a sighting.</p>

Combat itself is narrated by the time skip and bound to the [war ledger](/wiki/war/): a battle
needs an active war with named sides, so fighting cannot quietly appear out of nowhere.

<p class="beta-note"><b>On beta, what the events raise reaches the map.</b> A ship commissioned or
a squadron formed in an event becomes a unit; a deployment or garrison the skip resolves joins
the order of battle; a unit's move is listed once, not twice; and a renamed country's counters
carry its flag.</p>

## Men, money and military power

<p class="beta-note"><b>Beta channel only.</b></p>

On beta an army is drawn from a country's people and paid for by its economy, and how much it is
worth in a war is a figure of its own.

**Manpower.** A formation on a battlefield stands for so many men: 2,000 before 1500, 5,000 to
1849, 12,000 to 1944 and 10,000 after, unless the scenario or the country says otherwise. By
default 12% of a country's people are fit to serve. Every formation raised, drafted or sent to make good
a loss is drawn from that pool and leaves the country's population; those who come home when a
battlefield closes or a country leaves a war are given back. Those who do not come home are what a
war costs in people. A country with no men left to call up cannot raise more.

**Funding.** A share of a country's GDP goes to its forces, more with a budget in surplus and less
with a deficit or a heavy debt, and what its forces have to spend weighs in how strong it is.
Blockades and reparations cut into it.

**Military power.** Each country has military figures, shown as bars on the **⚔ Military** card
of its stat sheet: **Troop quality**, **Technology**, **Spending**, **Manpower share**, **War
weariness**, **War resources** (where the scenario counts them) and its **Land**, **Naval** and
**Air** arms. Its **Military power**, the figure at the top of the card and the one the Stats
pane's **🏆 Ranking** tab uses to rank military power, is the men it can put under arms times what
each of them is worth by those figures (spending, quality, technology and its arms), and never how
much land it holds. How far being better armed outweighs being more is the scenario's to say: its
**Importance of technology**, in the scenario editor's Features tab under Wars. Left empty it is
4.5, configured for the modern world, where a smaller, far better armed force outweighs a larger
one; at 1 the men and their arms count alike, as in a world where everyone fights with much the
same weapons; at 0 only the men count. The figures are rated by the AI
against every other country, twenty countries to a request: a scenario designer can rate every
country at once in the scenario editor's **Fronts** tab (**Rate every country**), and a country
nobody rated is rated the first time the game needs it. Time skips then move your figures with
what you do: training, new weapons, a bigger defence budget and a larger army raise them over the
years, and losses and cuts lower them. See
[national statistics](/wiki/statistics/).

## Structures do not move borders

Bases, ports, airfields and other built markers have an owner — whoever *runs* the facility —
which is not the same as who owns the ground beneath it. Building a base in an ally's country
does not annex it. See [cities and structures](/wiki/cities/).

## Next

- [Territory](/wiki/territory/) — what winning actually transfers.
- [Giving orders](/wiki/orders/) — phrasing military instructions.
- [The War Room](/wiki/war-room/) — commanding troops on a battlefield, on beta.
- [War at sea](/wiki/war-at-sea/) — fleets, sea battles and blockades, on beta.
- [Cheats](/wiki/cheats/) — where the Force Manager lives.
