A country in Open Historia is not a row in a table of stats. It is a name, a set of things it is
known for, a reputation, a flag, a colour, and whatever territory it holds — and the world reads
all of that when deciding how to treat it.

## Names are identity

Countries are identified by their **display name, verbatim** — not by an ISO code or a database
id. "France" is the identity. This runs all the way through the game: region ownership, the
colour palette, flags, diplomacy and the map editor all key off the name.

Two practical consequences:

- **In the map editor, typing a new country name creates that country.** There is no separate
  "add nation" step; painting a region with a name that does not exist brings it into being.
- **Renaming is a real event.** A country renamed after a revolution is, as far as the game's
  identity system is concerned, being re-labelled — which is why the world only does it on an
  actual regime change, never for a mere change of leader.

Countries also carry **aliases**: alternative names the game will recognise as the same country.
This is what lets a scenario use a historical name while still matching modern data.

## Tags

Tags are short descriptors of **what a country is** — its ideology, alignment, character,
whatever matters about it. "NATO member", "nuclear power", "military junta", "resource
exporter".

- Up to **8 tags**, each up to **32 characters**.
- They are fed to the world as context, so they genuinely change how a country behaves and how
  others treat it.
- When a country's alignment shifts, the world rewrites the **complete** tag list rather than
  adding one — tags are a full replacement, not a running log.

You can see a country's tags in its dossier, and edit your own (or anyone's) in the
[cheats panel](/wiki/cheats/).

## Reputation

**International reputation** runs 0–100, where **0 is a pariah** and **100 is universally
trusted**.

It moves only when a turn's events genuinely change how a country is seen — breaking a treaty,
brokering a peace, being caught doing something indefensible. It is not a score you grind up; it
is a summary of how you have behaved.

Low reputation makes diplomacy harder in exactly the way you would expect: fewer countries will
take your word, and more will assume the worst reading of what you do.

## Intelligence rating

Also 0–100, and it works the same way — moved by events, absent meaning ordinary. It is the
espionage system's master statistic. See [espionage](/wiki/espionage/).

## Leaders

A country has a named leader, stored on its stat sheet. When a leader is overthrown,
assassinated, dies, resigns or is voted out, the successor's name is written there as part of the
same event — so the stat sheet and the story never disagree about who is in charge.

The leader is who you are talking to in [diplomacy](/wiki/diplomacy/), and their voice changes
when they change.

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
community flag pack. Invented factions can pick one or go without.

One deliberate rule: **a country that holds no land never borrows a real country's flag**. A
government in exile that happens to share a name with a modern state does not get that state's
flag, because it is not that state.

## Landless countries

A country can exist while holding no territory at all: governments in exile, national movements,
international organisations, rebel administrations. They are full participants — they talk, they
are talked about, they can be spied on, and they can acquire territory later.

You can play one. It is a genuinely different game: nothing to defend, nothing to lose
territorially, and everything resting on what you can talk other people into.

## Inventing a country

The **Faction** tab of the new-game picker creates one. You choose the name, colour, flag,
starting regions (or none), and — the part that matters most — the **lore**.

The lore is read by the world. A faction with a paragraph explaining who you are, what you want
and why you exist gets treated as that thing. A faction with a blank lore field is a blank to
everyone, and gets treated accordingly. It is worth writing properly.

Any regions you claim at creation are taken from whoever held them, and that country will have
opinions.

## Editing countries mid-campaign

The [cheats panel](/wiki/cheats/) has a country editor — identity, colour, tags, reputation, the
stat sheet — and an add-country tool. Useful for repairing a country the simulation has drifted
on, or for authoring the world by hand.

## Next

- [National statistics](/wiki/statistics/) — the numbers behind a country.
- [Diplomacy](/wiki/diplomacy/) — dealing with them.
- [Territory](/wiki/territory/) — what they hold.
