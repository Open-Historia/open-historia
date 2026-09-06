The map is divided into **regions**. Every region has someone who administers it, and possibly
other countries who say it should be theirs. Those are two different things, and the map draws
them differently.

## Control

Whoever administers a region owns it as far as the map is concerned: the region is painted in
their colour, it counts as their territory, and their units sit on it without asking.

Control moves when an event says it moves. That is the only route. A time skip produces an event
narrating a conquest, an annexation, a treaty cession or a peaceful hand-over, and the border
change ships attached to that event. There is no separate "conquer" button, and no event can
describe territory changing hands without actually changing it — the narration and the mechanical
change are the same object.

You can also move control by hand from the [cheats panel](/wiki/cheats/), which is the
game-master route rather than the gameplay one.

## Claims and disputes

A region can carry a list of **claimants** — up to **four** countries that assert it is theirs.

A region with claimants is **disputed**, and it renders **striped**: the administrator's colour
combined with each claimant's. This is how you read a contested border at a glance.

Claims are their own layer. They do not affect who administers the ground, they do not change
what your units can do, and they are not a countdown to anything. They are the game's record of
who is aggrieved — and a standing invitation for the world to do something about it.

Claims are added and withdrawn the same way control moves: through events. If you want a claim
recognised or dropped, that is a diplomatic outcome you have to argue for.

Scenario authors can also mark disputes directly when drawing a map. World-level claims override
whatever the scenario's geometry says, so a campaign can develop new disputes over time without
the underlying map being edited.

## Playing the difference

The gap between control and claim is most of what makes borders interesting.

- **Taking ground does not settle it.** Conquering a claimed region leaves the claim standing;
  the previous holder still says it is theirs, and so does the map.
- **Claims are diplomatic leverage.** A neighbour with a live claim against a third country is a
  neighbour with a reason to work with you.
- **Dropping a claim is a real concession** and can be traded for something. It is one of the
  more valuable things you can offer in a negotiation, because it costs you nothing material and
  costs your pride a great deal.
- **Stripes on your own territory are a warning.** Someone is building a case.

## Regions and names

Regions are identified by name rather than by code, which is why the map editor lets you type a
new country name to bring that country into existence. It also means renaming matters: a region's
owner is a name, and names are the game's identity system throughout. See
[countries and identity](/wiki/countries/).

The **Regions** tool in the cheats panel inspects any region — who holds it, its name, tags and
properties — and lets you edit them, including renaming regions on custom maps.

## What territory does for you

Territory is not a resource you spend. There is no per-province income to collect and no
buildings to place on it. What it gives you is:

- **Standing.** A larger, more coherent country is treated as a more consequential one.
- **Position.** Units act within [era-appropriate ranges](/wiki/military/); where your border is
  determines what you can reach.
- **Statistics.** Population, economy and the strategic indices reflect what you hold. See
  [national statistics](/wiki/statistics/).
- **Grievances.** Yours and other people's.

Losing territory is correspondingly not a stockpile draining — it is a country becoming less
consequential, more surrounded, and more likely to be pushed further.

## Landless countries

A country can hold no territory at all and still exist, act and be talked to — governments in
exile, movements, organisations. You can play one. See
[countries and identity](/wiki/countries/) for how they work.

## The sovereignty layer

<p class="beta-note"><b>Beta channel only.</b> The stable release has control and claims. The
beta channel adds a third layer between them.</p>

Beta separates **control** (who administers the ground) from **sovereignty** (who lawfully owns
it), so occupation, exiled governments and unrecognised annexations are all representable:
"control is not sovereignty".

Sovereignty is stored sparsely — ordinary territory has no entry, because control and sovereignty
agree. A row appears only where they diverge, which is exactly the interesting case.

Three explicit operations move control without touching who lawfully owns the ground:

| Operation | |
|---|---|
| `contest` | Mark the ground as fought over |
| `control` | Hand de-facto administration to someone |
| `clear_contest` | Settle it again |

Each can be applied to a single region or to a country's whole territory at once. Transferring
lawful **sovereignty** is a separate act — that is what a treaty does, and it is why an
occupation can run for years without the map ever conceding the point.

A Region Inspector shows all three layers for any region, plus how each came to be that way.

On the stable build, that distinction is narrative — an occupation is an occupation because the
events say so, not because the data models it separately.

## Next

- [Military and combat](/wiki/military/) — taking ground.
- [Relations, treaties and war](/wiki/war/) — the beta ledgers that formalise who is fighting
  whom.
- [The map editor](/wiki/editor/) — drawing regions and disputes yourself.
