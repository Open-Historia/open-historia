# Multiplayer, end to end

One shared game, hosted, joined with an invite code and played for a round in
two real browsers. It runs:
- the real built game (`dist/`);
- real WebRTC between the two pages;
- the game's real Nostr signaling code, over a local relay or the public ones;
- the game's own time skip in the host's engine page, with a stand-in model
  answering it.

The model's API calls are answered inside the browser (Chrome DevTools
`Fetch`), so no key is used and no request reaches Google. By default the relay
is local too (`relay.mjs`), and nothing leaves this machine.

## Run it

```bash
npm run build      # at the repo root: the run serves dist/
cd tools/multiplayer-e2e
npm install        # once: the local relay's WebSocket server
node e2e.mjs
```

- `RELAYS=public node e2e.mjs` signals over the game's own public Nostr relays
  (`src/multiplayer/signaling/nostr.js`), as players do. They carry only
  encrypted signaling, but they see this machine's IP address. WebRTC then asks
  the public STUN servers too.
- Chrome must be installed. Set `CHROME=<path>` if it is not in a usual place.
- Ports 3811 and 3812 (the host's and the guest's app servers) and 9461
  (Chrome's DevTools) must be free. When another run holds them,
  `E2E_PORT_BASE=10 node e2e.mjs` moves all three (to 3821, 3822 and 9471):
  on a port someone else's Chrome holds, the run would drive that browser.
- A run takes about five minutes. On a machine busy with something else,
  `PATIENCE=4 node e2e.mjs` waits four times as long for every step.
  It exits 0 when every check passes, and
  writes screenshots of both screens to `shots/`.

## What it sets up

- **Two app servers**, each on a fresh data folder of its own (`app-server.mjs`).
  The host's server stands in for the desktop app's engine-window handle
  (`electron/main.cjs`), and the run opens `engine.html` in a tab itself. The
  host's game is a new game on the built-in scenario, which the guest has too.
- **One headless Chrome**, with three tabs: the host's engine, the host's screen
  and the guest's screen. The guest is on its own origin, with its own library
  and storage.

- **A first opening that is behind both screens:** the first-time setup is
  done, the question about counting visits is answered with a no, and the
  newest update's notice has been seen. The run opens the vault door by its
  wheel, as a player does. The game's own buttons answer under all of these,
  so the checks never needed them out of the way, but the screenshots did.

The real desktop app's hidden engine window is not part of this run.

## What it checks

- **The Lobbies tab:**
  - It is in the main menu.
  - Its "Host a lobby" action opens the host's settings.
  - The invite code is at the top of the tab, above the public lobbies, which
    are under "Coming soon".
- **Hosting:** the host opens its lobby, gets an `oh1-` invite code, and
  reaches its signaling relays.
- **Joining:** the guest joins through the relay, reaches the lobby and takes a
  country, and its view says it plays that country.
  - Its loading screen never names the stand-in game's placeholder country.
  - Its menu bar names the country it took.
- **Diplomacy:**
  - Between two people: the host opens a thread with the guest's country. The
    guest reads it as a thread with the host, answers in it, and the model is
    asked nothing.
  - With an AI government at the table: that government answers for itself, to
    everyone at the table. The model is told who the people are, whichever of
    them is writing.
  - A vote at that table: the host calls it from its panel, and the guest
    votes in it from its own screen; the host keeps the guest's vote.
- **Orders:** the game starts, and each player queues an order through the
  game's own Actions panel, seeing only its own.
- **A player's own saves:**
  - AI suggestions asked in a shared game are shown, and stay on the device
    that asked.
  - The host's screen opens a project from its own Projects panel (a plan
    the stand-in model writes): the host applies it to its own board by the
    game's project operations, and no other player sees it. A guest's agent
    stands on the guest's own board, which goes to the skip and comes home.
- **The round:** everyone readies, the host runs the round, and its events
  reach the guest.
  - The model is told who plays what, and whose each order is.
  - The world never chooses for a human: the guest's unordered declaration of
    war is withheld.
  - Each order's answer reaches everyone, but cites the order only for the
    player who gave it.
- **After the round:**
  - The guest is never asked for an AI key.
  - Both menu bars move on to the round's new date.
  - The guest's view holds none of the narrator's own (summary, storylines);
    of the turn it holds the dates, the events and its own orders.
  - The round moves on to its reveal: the Events panel opens on every screen,
    its first event shown and the rest still to come.
  - Everyone reads the round through, and the next round's planning begins
    without waiting out the reveal's timer.
  - The host's AI debug console and diagnostics log cover the calls its engine
    made.
  - No save was turned away with an error on either screen.
  - No screen made a change that no request carries to the host (the one
    door: `client/seatWrites.js` `unroutedChanges`, logged by the page). It
    compares a save with the view in the shape the page saves it in: its first
    runs flagged the empty defaults a save fills in for the engine's own fields,
    which no view carries.
- **Whose AI answers for the AI's governments** (the host's choice,
  `host/settings.js` `replies`): until here the host's AI answered. Then:
  - The host changes it under Players, and the guest is told that its own AI
    answers from now on.
  - The guest, given a key of its own only now, writes to a government the AI
    plays. The reply is written on the guest's own page with the guest's own
    key, the host's engine is asked nothing, and the host keeps the words: the
    model there tried to rename the conversation too, and only what it said is
    kept.
  - The guest's AI is out for its next line: the thread says so, and Retry
    answers the same line without saying it twice.
- **A change of country, mid-game:** the guest asks under Players to play
  another country. The host's Players button says someone is asking, and the
  host is shown who asks, with Allow and Refuse, and Release and Ban on the
  guest's seat. The host refuses, and the guest is told it keeps its country.
- **One writer:** while the game is shared, the host's server refuses a write
  to it from anything but the engine tab (which the run opens with the engine's
  credential in its address, as the desktop app does), a forged credential
  too, and the world is left as it was.
- **The host's page reloads:** it comes back to the shared game as the host's
  screen; the round waited for it, the guest was told it was away and back,
  and the page wrote nothing meanwhile.
- **Stopping:** when the host stops, the guest is told.
- **The session kept with the game** (`host/sessionRecord.js`): it is in the
  campaign (`/api/runtime/json/shared`), the guest's seat bound to its device,
  with the round to plan next. The host shares the game again in a new engine
  window: it goes on at the round it was at, paused, with the same invite code
  under Players. The guest joins again with that code and plays its own country
  without choosing it, and the host resumes.

The map's stock tiles are not in the fresh data folders, so a screen's loading
cover may wait out its 60-second ceiling. The game's checks do not depend on it.
