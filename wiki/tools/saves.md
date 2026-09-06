Open Historia saves continuously. There is no save button, and there is no way to lose an hour
of play to a crash.

![The games library](/wiki/img/saves-library.jpg)
*Each campaign card carries its country, date and round, with Clone and Archive alongside.*

## Games and scenarios

Two different things, and the distinction matters:

- A **scenario** is a world — the map, the borders, who owns what, the start date, the available
  troop types, the author's house rules. It never changes when you play.
- A **game** is one playthrough of a scenario. It starts as a copy of that world and diverges
  from the first turn.

One scenario seeds as many games as you like. Editing a scenario later does not touch games
already running on it.

## Autosave

Every time skip writes the whole campaign — world state, game state, events, your order queue,
chat history and the colour palette — and then captures a rollback snapshot.

There is nothing to do and nothing to remember. Closing the game mid-turn loses at most the
orders you had typed but not queued.

## Undo and rollback

**Undo last turn**, in the time panel, restores everything to how it was before the last jump.
The game keeps **12** turns of snapshots, so you can step back repeatedly. The panel tells you
how many are available.

**Roll Back Turn**, in the [cheats panel](/wiki/cheats/), jumps straight to the start of any
earlier turn in the stack and discards everything after it.

Both restore the full campaign, not just the map — the events, the conversations and your queued
orders all come back as they were.

Use undo freely. See [time and turns](/wiki/time/).

## Cloning

Both games and scenarios have a **Clone** button on their card in the library.

Cloning a **game** is the closest thing to a manual save slot: fork the campaign before doing
something reckless, and you keep both branches. Cloning a **scenario** gives you an editable copy
of someone else's world.

## Where saves live

**Desktop and self-hosted** — files on disk, in the app's own data directory. You can back the
directory up like any other folder.

**Browser** — in your browser's storage. This is the one to be careful with: **clearing site data
clears your campaigns.** The game will ask for persistent storage permission when you first
play, and you should grant it.

**Android** — on the phone, in the app's storage.

The beta desktop build keeps a **completely separate** library from the stable one. Installing
the beta cannot touch your stable campaigns, and vice versa.

## Moving a campaign between machines

Scenarios export and import cleanly — as a `.zip` bundle carrying the map, cities, colours,
flags and any custom basemap, or as plain `.json`.

Use **Import** in the library's Scenarios tab, or the **Download** buttons in a scenario's editor
drawer. This is also how you [publish to the Community Hub](/wiki/community-hub/).

Games are less portable by design: a game is a running playthrough, tied to the scenario it
started from. To carry a *situation* to another machine, the practical route is to export the
scenario and start there.

## Syncing between devices

Only in the browser build. You can create an account, and games and scenarios sync between
devices.

Everything is encrypted **in your browser** before it is uploaded, with a key derived from your
account. The server stores ciphertext and cannot read your campaigns. Sync reconciles by
comparing both sides in full, so it is safe to play on two devices and let them catch up.

Your API key is never synced. Provider settings are per device.

## Archiving

Games can be archived rather than deleted, which takes them out of the main library view without
throwing them away. Useful once you have accumulated a dozen half-finished campaigns.

## What a save contains

For the curious: five documents per game — the world, the game state, the events, the actions
queue and the chat history — plus siblings for colours, flags, tags, rollback snapshots, advisor
history and intercepts, and the map geometry.

Intercepts are the exception to "it is all just JSON": they are
[encrypted at rest](/wiki/espionage/) with a key unique to the campaign.

## Next

- [Time and turns](/wiki/time/) — undo in context.
- [The community hub](/wiki/community-hub/) — sharing scenarios.
- [Hosting a server](/wiki/self-hosting/) — where the files actually live.
