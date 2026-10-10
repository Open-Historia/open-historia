# Detailed maps are scenario maps, each shown over a drawn map

A Scenario offers a list of **scenario's maps**: one **starting map** and the maps players may switch to. A **detailed map** ([ADR 0006](0006-official-basemap-list.md)) is an entry in that list like any basemap, and a Scenario may name several. The Scenario names each one (an official map by id and version, the author's own by checksum) and never carries it: each player downloads it. Each detailed map is **shown over** one of the scenario's drawn maps, which the author chooses (the first drawn map by default): it is laid over that map and is what a player without the detailed map sees. A detailed map may be the starting map.

Scenarios made before this name their one detailed map in `world.background.tiled`, over the drawn `world.background`. That is read as a detailed starting map shown over the scenario's drawn map, so nothing already published has to be saved again.

## Considered Options

- **One detailed map per Scenario, attached to its basemap (how it was).** Rejected. The Map Editor then had two kinds of choice for one question, which map players see: a basemap picked in one place and a detailed map switched on over it in another, plus a player setting to turn it off. Authors could not offer a detailed map as one choice among several, and players could not pick between them.
- **Each detailed map falls back to the Scenario's starting map.** Rejected. A Scenario starting on a picture could then offer no detailed map at all, even with a drawn map in its list.
- **Each detailed map falls back to the drawing kept with it in Your detailed maps.** Rejected. That drawing is on the author's device, not in the Scenario, and is not always one of the maps the Scenario offers, so players would meet a map the author never chose to show them.

## Consequences

- A detailed map needs a drawn map in the Scenario to be shown over. Removing that drawn map moves the detailed map to another drawn map in the list, and is refused when there is none.
- Loading a game offers to download only the detailed map the player starts on, and says the Scenario has others. Installing a Scenario from the hub lists all of them, the starting one ticked.
- A player's **basemap pick** is kept on their device for each game, and never sent to other players. Countries are in the same place on every map, so players in one game may each see a different one.
