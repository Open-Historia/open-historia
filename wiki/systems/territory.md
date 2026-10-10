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

After the skip, the game checks the turn's wording against the map: a place an event names in
plain words — a city, an alias, a region — is found on the scenario's actual geography, captured
towns change hands, and contested ones are striped. The game does this itself, at no
request. Ground handed to a country that does not exist yet founds it.

A scenario can also set a **tempo** for the map — at most so many regions changing hands per 30
days. A skip that moves more than that has the rest held back, and the next skip is told the
front moves this far and to carry the rest on.

You can also move control by hand from the [cheats panel](/wiki/cheats/), which is the
game-master route rather than the gameplay one.

![Disputed territory on the map](/wiki/img/territory-dispute.jpg)
*Western Sahara, between Morocco and Mauritania, drawn in faint diagonal stripes — a region more than one country claims.*

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
the underlying map being edited. A dispute that ends stays ended on the map.

## Groups

Not every force that holds ground is a country. A **group** — an insurgency, a cartel, a militia,
a zombie outbreak — controls an area of regions that stay their countries': no border moves. The
map outlines the group's whole area and tints it in the group's colour, and a region's card says
**Group control** with the group's name and what it is. The AI founds, spreads, pushes back and
erases groups as events call for it, and a town a government takes back from one is released
from its area. A scenario's author sets them up in the [map editor](/wiki/editor/).

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

## Regions and owners

A region's owner is a country with one stable identity. Renaming a country changes its label, not
who it is: every region, flag, tag, colour, war record and standing goal follows it, so a
country does not split in two the turn after it is renamed. In the map editor, typing a country
name that does not exist yet brings that country into existence. See
[countries and identity](/wiki/countries/).

The **Region Inspector** in the cheats panel inspects any region — who controls it, who is
sovereign, who claims it, its name and properties — and lets you edit control and make legal
transfers.

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

Between control and claims sits a third layer. The game separates **control** (who administers the ground) from **sovereignty** (who lawfully owns
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

The Region Inspector shows all three layers for any region, plus how each came to be that way,
and the map shows the displaced controller and sovereign on contested and occupied ground. A
wartime capture is recorded as a change of **control**, not a cession.

<p class="beta-note"><b>On beta, a puppet is not a fact about land.</b> A
<a href="/wiki/war/#puppets-and-overlords">puppet</a> keeps its own territory and sovereignty;
subordination lives in its own ledger. And a structure an event credits to a country with no
land goes to whoever holds the ground it stands on.</p>

## Next

- [Military and combat](/wiki/military/) — taking ground.
- [Relations, treaties and war](/wiki/war/) — the ledgers that formalise who is fighting whom.
- [The map editor](/wiki/editor/) — drawing regions and disputes yourself.
