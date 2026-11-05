A country in Open Historia is not a row in a table of stats. It is a name, a set of things it is
known for, a reputation, a flag, a colour, and whatever territory it holds — and the world reads
all of that when deciding how to treat it.

## Identity and names

Every country is known by **one name**, and that name is its identity. A scenario keeps a
registry of its countries — independently of the regions they hold, so a country can exist with
no land at all — and region ownership, the colour palette, flags, tags, statistics, diplomacy,
the war records and your standing goal are all kept under that name.

Three practical consequences:

- **In the map editor, typing a new country name creates that country.** There is no separate
  "add nation" step: type a name nobody has yet as a region's owner and press Enter (or
  **Create**), and the country is made and given the region. Leaving the field only ever assigns
  a country that already exists, so a typo cannot quietly mint a one-province country.
- **Renaming moves the country, not just its label.** A country renamed after a revolution keeps
  every region, flag, tag, colour, statistic, conversation and war record: the rename carries all
  of it over to the new name, and the map labels it by that name. A name that already belongs to
  another country is refused — a rename cannot merge two countries. The world renames a country
  you do not play only on a regime change, a change in its fundamental way of governing, never
  for a new leader or ruling party; your own country is renamed whenever you order it.
- **Territory handed to a country that does not exist yet founds it**, under exactly the name
  given.

Countries also carry **aliases**: alternative names the game will recognise as the same country.
This is what lets a scenario use a historical name while still matching modern data. A rename in
play keeps the old name among them, so events and conversations written under it still find the
country; a rename in the map editor keeps no old name, since everything that used it is renamed
with it.

## The country card

Click a country, then **ⓘ** on its map card. The card shows the country's flag (**Flag** changes
it), its tags, its **Alternative Names**, its **Sovereign Regions** and, where they differ, the
regions it holds that are not its own (**Controlled, Not Sovereign**) and its own that someone else
holds (**Under Foreign Control**). Below them are its **Related Events**, which you can search and
filter by importance, and two buttons: **Advisor Report**, an AI reading of the country on request,
and **Open Diplomacy**.

<p class="beta-note"><b>On beta the card does more.</b> It says what you know of any
<a href="/wiki/war/#puppets-and-overlords">puppet arrangement</a> the country is part of, and has
a <b>Stats</b> button, which opens the country in the <b>Country</b> panel (see
<a href="/wiki/statistics/">national statistics</a>).</p>

## Tags

Tags are short descriptors of **what a country is** — its ideology, alignment, character,
whatever matters about it. "Socialist", "nuclear", "military-junta", "non-aligned".

- Up to **8 tags**, each up to **32 characters**.
- They are fed to the world as context, so they genuinely change how a country behaves and how
  others treat it.
- When a country's alignment shifts, the world rewrites the **complete** tag list rather than
  adding one — tags are a full replacement, not a running log.

You can see a country's tags on its card. A scenario's starting tags are set in the
[map editor](/wiki/editor/); in play the world rewrites them, and the
[GM console](/wiki/cheats/#gm-console) can change them like anything else about a country.

## Reputation

**International reputation** runs 0–100, where **0 is a pariah** and **100 is universally
trusted**.

It moves only when a turn's events genuinely change how a country is seen — breaking a treaty,
brokering a peace, being caught doing something indefensible. It is not a score you grind up; it
is a summary of how you have behaved.

Low reputation makes diplomacy harder in exactly the way you would expect: fewer countries will
take your word, and more will assume the worst reading of what you do.

## Intelligence rating

Also 0–100, and it works the same way — moved by events, absent meaning ordinary (40). It is the
espionage system's master statistic. See [espionage](/wiki/espionage/) and
[national statistics](/wiki/statistics/#intelligence-service).

## Leaders

A country has a named leader, stored on its stat sheet. When a leader is overthrown,
assassinated, dies, resigns or is voted out, the successor's name is written there as part of the
same event — so the stat sheet and the story never disagree about who is in charge.

The leader is who you are talking to in [diplomacy](/wiki/diplomacy/), and their voice changes
when they change.

<p class="beta-note"><b>On beta a country has a government, not just a leader.</b> A scenario can
generate its Political World: each country's government, its head of state and head of
government, and the parties or power blocs that compete for it. The <b>🏛 Politics</b> tab of the
Country panel shows them (see <a href="/wiki/statistics/#the-politics-tab">the Politics tab</a>),
and the panel says whether a country is a <b>Major power</b>, <b>Regional power</b> or <b>Minor
power</b>.</p>

## Colours

How a country paints on the map. Resolution order:

1. The scenario's own palette.
2. A colour explicitly set on the country.
3. A match against the country's aliases.
4. A colour derived from the name itself.

Step 4 is the fallback that guarantees every country has *a* colour, including one you invented
five seconds ago and never picked a colour for. It is also why two countries very occasionally
land on similar shades — the derivation does not know about the rest of the map.

## Flags

Countries can carry a flag from the built-in set, from a scenario's own flag pack, or from a
community flag pack. Invented factions can pick one or go without. In play, **Flag** on a
country's card changes its flag.

The diplomacy and spy pickers show the scenario's own flags, and a flag changed mid-campaign
updates live. One deliberate rule: **a country that holds no land never borrows a real country's
flag**. A
government in exile that happens to share a name with a modern state does not get that state's
flag, because it is not that state.

## Landless countries

A country can exist while holding no territory at all: governments in exile, national movements,
international organisations, rebel administrations. They are full participants — they talk, they
are talked about, they can be spied on, and they can acquire territory later. An armed force that
holds ground without being a country at all is a [group](/wiki/territory/#groups) instead.

You can play one. It is a genuinely different game: nothing to defend, nothing to lose
territorially, and everything resting on what you can talk other people into.

## Inventing a country

The **Create a faction** tab of the new-game picker creates one. You choose the name, colour, flag,
starting regions (or none), and — the part that matters most — the **lore**.

The lore is read by the world. A faction with a paragraph explaining who you are, what you want
and why you exist gets treated as that thing. A faction with a blank lore field is a blank to
everyone, and gets treated accordingly. It is worth writing properly.

Any regions you claim at creation are taken from whoever held them, and that country will have
opinions.

<p class="beta-note"><b>On beta, Create a faction is part of Play as a group.</b> The picker's
second tab is <b>Play as a group</b>. Where the scenario has
<a href="/wiki/territory/#groups">groups</a>, you lead one of its groups or make a new one, which
controls an area without owning it. In a scenario with groups switched off, the same form invents
a country, as above.</p>

## Editing countries mid-campaign

The [cheats panel](/wiki/cheats/) has a **Country Editor** — the country's name and colour, and,
once it has a stat sheet, the sheet itself: population, GDP and growth, capital, currency,
stability, inflation, unemployment, debt, budget balance, the six strategic indices
(international reputation among them) and the GDP sector split — and an **Add Country** tool. Useful for repairing a country the
simulation has drifted on, or for authoring the world by hand.

<p class="beta-note"><b>On beta the Country Editor also edits the country's Political World</b>:
its government and political system, its strategic outlook, its parties and power blocs, and its
political traits.</p>

## Next

- [National statistics](/wiki/statistics/) — the numbers behind a country.
- [Diplomacy](/wiki/diplomacy/) — dealing with them.
- [Territory](/wiki/territory/) — what they hold.
