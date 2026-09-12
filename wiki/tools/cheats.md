The **🧪 Cheats** panel is the game master's toolbox. Fourteen tools for reaching into the world
and changing it by hand — plus manual control of your own army, which lives here rather than in
the normal interface.

Calling it "cheats" undersells it. Most of these are how you keep a long campaign on the rails
when the simulation drifts, or how you author a world deliberately.

Open it from the settings menu.
![Beta quick menu, Tools tab](/wiki/img/beta-quick-tools.jpg)
*On beta, cheats and the timeline are one click away on the quick menu's Tools tab.*


![The cheats panel](/wiki/img/cheats-tools.jpg)
*Fourteen tools. Master AI is the one to reach for first.*

## Master AI — the GM console

The most useful tool on the list. Describe a change in plain English and it is planned into a
proper set of world changes, shown to you, and then applied.

> *"Hungary leaves the alliance and signs a non-aggression pact with Serbia. Their relationship
> with Vienna sours."*

It works because it goes through the same machinery events do — territory transfers, country
changes, unit operations, structures — so whatever it does is a legitimate world state rather
than a hand-edited file.

Use it when something has gone wrong that no single tool fixes, or when you want to steer the
narrative rather than wait for the simulation to get there.

## Turn and campaign control

**Roll Back Turn** restores the world to the start of any earlier turn, discarding everything
after it. Broader than the **Undo** in the time panel, which only steps back one turn at a time.

**Your Country** switches which country you play. You can hand yourself a different nation
mid-campaign, or follow a war from the other side.

**Difficulty** changes the level after the fact. See [starting a game](/wiki/new-game/) for what
each level does.

## Territory

**Annex Country** — click a country on the map and all of its regions fold into a target.

**Annex Regions** — click regions one at a time to transfer them individually.

Both enter a click-capture mode: map clicks go to the tool instead of opening the usual popups,
and the panel gets out of the way until you are done.

**Regions** inspects any region — its name, tags and properties — and lets you edit them,
including renaming regions on custom maps.

## Countries

**Edit Country** opens a country's identity: name, colour, tags, reputation, and its stat sheet.
Useful when the simulation has drifted a country somewhere you do not want it, or when you want
to write a country's character deliberately.

**Add Country** creates a new one from nothing.

Both work on any country, not just yours. See [countries and identity](/wiki/countries/).

## Map features

**Edit Map Feature** and **Add Map Feature** work on cities and structures — position, name,
population, kind, owner.

**Clear Map Features** removes accumulated markers that have stopped mattering. Long campaigns
build up a lot of them.

Adding your first custom city to a scenario switches it to carrying its own city list rather
than the stock one.

## Events

The **Events** editor searches, creates, edits and deletes canonical events.

This is the tool for repairing history. If a turn produced an event that contradicts everything
before it, you can rewrite it rather than rolling back and re-rolling the whole turn. You can
also author events outright, which is how you run a scripted campaign.

Because events carry the world changes, editing one is editing history in both senses.

## Forces

**Manual force deployment** opens the [Forces panel](/wiki/military/): spawn units, set their
type and strength, move them, and command them directly.

It is filed here deliberately. In normal play you order a military outcome and the world carries
it out; placing divisions by hand is a game-master act.

## Diagnostics log

Errors, API failures, and the context the AI was actually given.

This is the first place to look when turns are failing, and the thing to copy into a bug report.
It shows you what was sent to the model, which usually explains a strange result immediately.

## Should you use any of this?

Yes. This is a single-player game with no score and nobody to cheat against. The tools exist
because an AI-driven world sometimes produces something incoherent, and the alternative to
fixing it is abandoning the campaign.

The one habit worth keeping: **prefer the GM console over the direct editors** where both would
work. Describing what happened produces a world that hangs together, including the knock-on
consequences. Hand-editing a border produces a border that moved for no reason anyone in the
world can remember.

## Next

- [Events and history](/wiki/events/) — what you are editing.
- [Saves and rollback](/wiki/saves/) — the safer undo.
- [The map editor](/wiki/editor/) — for changing the world itself rather than a campaign.
