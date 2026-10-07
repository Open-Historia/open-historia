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
  (Chrome's DevTools) must be free.
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
- **Orders:** the game starts, and each player queues an order through the
  game's own Actions panel, seeing only its own.
- **A player's own saves:**
  - AI suggestions asked in a shared game are shown, and stay on the device
    that asked.
  - A guest's Projects board is saved without an error, and the host keeps it
    for that country alone.
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
- **Stopping:** when the host stops, the guest is told.

The map's stock tiles are not in the fresh data folders, so a screen's loading
cover may wait out its 60-second ceiling. The game's checks do not depend on it.
