# Multiplayer, end to end

One shared game, hosted, joined with an invite token and played for a round in
two real browsers. It runs the real built game (`dist/`), real WebRTC between
the two pages, and the game's real Nostr signaling code over a local relay. The
round is the game's own time skip, run in the host's engine page, with a
stand-in model answering it.

Nothing leaves this machine. The relay is `relay.mjs`, and the model's API
calls are answered inside the browser (Chrome DevTools `Fetch`), so no key is
used and no request reaches Google.

## Run it

```bash
npm run build      # at the repo root: the run serves dist/
cd tools/multiplayer-e2e
npm install        # once: the relay's WebSocket server
node e2e.mjs
```

- Chrome must be installed. Set `CHROME=<path>` if it is not in a usual place.
- Ports 3811 and 3812 (the host's and the guest's app servers) and 9461
  (Chrome's DevTools) must be free.
- A run takes two to three minutes. It exits 0 when every check passes, and
  writes screenshots of both screens to `shots/`.

## What it sets up

- **Two app servers**, each on a fresh data folder of its own (`app-server.mjs`).
  The host's server stands in for the desktop app's engine-window handle
  (`electron/main.cjs`), and the run opens `engine.html` in a tab itself. The
  host's game is a new game on the built-in scenario, which the guest has too.
- **One headless Chrome**, with three tabs: the host's engine, the host's screen
  and the guest's screen. The guest is on its own origin, with its own library
  and storage.

## What it checks

- **Hosting:** the host shares its game and gets an `oh1-` invite token.
- **Joining:** the guest joins through the relay, reaches the lobby and takes a
  country, and its view says it plays that country.
  - Its loading screen never names the stand-in game's placeholder country.
  - Its menu bar names the country it took.
- **Orders:** the game starts, and each player queues an order through the
  game's own Actions panel, seeing only its own.
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
  - The guest's view holds none of the narrator's own documents (summary,
    storylines, simulation history).
  - The round moves on to its reveal.
- **Stopping:** when the host stops, the guest is told.

The map's stock tiles are not in the fresh data folders, so a screen's loading
cover may wait out its 60-second ceiling. The game's checks do not depend on it.
