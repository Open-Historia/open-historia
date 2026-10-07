<!-- Open Historia — the public multiplayer server (server-mp) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->
# server-mp: the public multiplayer server

Open Historia's own server for public multiplayer games. It does three things:

- **Listing.** Hosts register their games, and players browse and filter them.
- **Signaling.** A player's WebRTC offer reaches a game's host, and the host's answer comes back.
- **TURN credentials.** It hands out short-lived credentials for the coturn relay that every game connection goes through.

It never sees a game. Once host and player are connected (through the relay, DTLS end to end), nothing passes through this server again, except to renew relay credentials.

Private games don't need it: they use an invite token over public Nostr relays (`src/multiplayer/`). Nothing in the game uses this server until a build is given its URL (see [Pointing the game at it](#pointing-the-game-at-it)). Until then, the public-server browser shows "Coming soon".

The package is self-contained, so it can be deployed on its own: one dependency (`ws`), and `node:crypto` for everything else. Deployment on an Oracle Cloud VM, next to coturn and Caddy, is in [../ops/README.md](../ops/README.md).

## Running it locally

```sh
cd server-mp
npm install
npm start          # http://127.0.0.1:8787, ws://127.0.0.1:8787/ws
npm test
```

With nothing configured it listens on loopback only, TURN is off (`turn` answers with an empty list), and any origin may connect. Settings are environment variables:

```sh
PORT=9000 ALLOWED_ORIGINS="http://localhost:*" npm start
```

(In PowerShell: `$env:PORT = "9000"; npm start`.)

A setting that makes no sense stops the start with a message naming it, for example `open-historia-mp-server: TURN_URLS is set but TURN_SECRET is empty…`. The server logs one line per event to stdout, and never an address: each client address is replaced by a keyed hash (`ip=#3f9a…`) whose key changes at every start. Nothing a player wrote is logged either.

Node 20 or later. The tests are written for Node 22 (what the container runs); `npm test` relies on `node --test` expanding the glob itself, which needs Node 21 or later.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port to listen on (1-65535). |
| `HOST` | `127.0.0.1` | Address to listen on; `0.0.0.0` in a container. |
| `TURN_SECRET` | *(empty)* | Shared with coturn (`static-auth-secret`). 32-256 characters of `A-Z a-z 0-9 . _ ~ + / = -`; make one with `openssl rand -hex 32`. Empty turns TURN off. |
| `TURN_URLS` | *(empty)* | Comma list of `turn:` / `turns:` URLs given to clients, e.g. `turn:mp.example.org:3478?transport=udp`. Set together with `TURN_SECRET`, or neither. |
| `TURN_TTL_SECONDS` | `900` | Lifetime of a TURN credential (60-3600). Connections renew ([TURN](#turn)). |
| `MAX_ROOMS` | `500` | Rooms on the server at once. |
| `MAX_ROOMS_PER_IP` | `3` | Rooms registered from one address. |
| `MAX_CONNECTIONS_PER_IP` | `10` | Sockets open from one address. |
| `MAX_CONNECTIONS` | `1000` | Sockets open in all. |
| `MAX_MEMORY_MB` | `256` | Above this resident size, new sockets are refused (503). Set it under the container's memory limit. |
| `TRUST_PROXY` | `false` | `true` only behind our own proxy (Caddy): the client's address is then the **last** `X-Forwarded-For` entry, the one the proxy added. Never set it on a server clients can reach directly, or they choose their own address. |
| `ALLOWED_ORIGINS` | *(empty)* | Comma list of origins whose pages may connect: exact (`https://openhistoria.com`, `http://app.paxhistoria`) or any port (`http://localhost:*`). Empty allows any origin, which is logged as a warning (`server.any-origin`) unless the server listens on loopback. With a list, a socket without an `Origin` header is refused too: browsers always send one, and any other program can send an allowed one itself. |

"One address" is an IPv4 address or an IPv6 /64, because one IPv6 home or phone holds a whole /64. An IPv6 /48 may hold four addresses' worth of sockets and rooms.

## Protocol

Everything is JSON text frames on `/ws`. `ts` is milliseconds since 1970, as everywhere on the multiplayer wire.

### Client to server

| Message | Does |
|---|---|
| `{ t: "host", v: 1, room: ROOM, ts, sig }` | Registers this socket's room, or updates it. Reply: `{ t: "hosted", roomId }`. |
| `{ t: "unhost", roomId }` | Takes this socket's room down at once. Reply: `{ t: "unhosted", roomId }`. |
| `{ t: "list", filters?: FILTERS, page?: 0-100 }` | One page of public rooms. Reply: `{ t: "rooms", rooms: [LISTING], total, page }`. |
| `{ t: "signal", roomId, to: "host", payload: offer }` | From a joiner: its offer, passed to the room's host as `{ t: "signal", roomId, from: <session>, payload }`. No reply. |
| `{ t: "signal", roomId, to: <session>, payload: answer \| deny }` | From the host: passed to the joiner whose offer opened that session, as `{ t: "signal", roomId, from: "host", payload }`. No reply. |
| `{ t: "turn" }` | From a room's host socket: a credential for one player's connection. |
| `{ t: "turn", roomId }` | From a joiner: a credential for its connection to that room. |
| `{ t: "ping", n }` | Reply: `{ t: "pong", n }`. |

A `turn` reply is `{ t: "turn", iceServers: [{ urls, username, credential }], ttl }`, or `iceServers: []` and `ttl: 0` when TURN is off. Anything refused gets `{ t: "error", code, message }`. Every object is closed: a key not listed here makes the message invalid.

A socket must send its first message within 30 seconds of opening.

### ROOM

| Field | Type |
|---|---|
| `roomId` | 32 lowercase hex, **derived** from `hostKey` and `nonce` (below) |
| `hostKey` | the host's Ed25519 public key, base64url (43 characters) |
| `nonce` | 32 lowercase hex, chosen by the host; a new nonce is a new room id |
| `name` | 1-60 characters, no control characters |
| `scenario` | `{ id: 1-80, name: 1-80 characters, hash: 64 lowercase hex }` |
| `seats` | 1-64 |
| `open` | 0-64, at most `seats` |
| `round` | `{ minutes: 1-10080, readyThreshold: 0.5-1, countdownSeconds: 0-3600 }` |
| `payment` | `"host"` or `"cycle"` |
| `fog` | boolean |
| `cheats` | `"off"`, `"host"` or `"vote"` |
| `language` | `en`, `pt-BR`…: `[a-z]{2,3}(-[A-Za-z0-9]{2,8})?` |
| `version` | the game's version, 1-40 characters of `0-9 A-Z a-z . _ + -` |
| `password` | boolean (the host checks the password; the server only lists the flag) |
| `visibility` | `"public"` (listed) or `"unlisted"` (reachable by its id, never listed) |

The room id is the first 32 hex digits of

```
sha256("oh-mp/v1/room-id" \n hostKey \n nonce)
```

(`roomIdFor` in `src/signatures.js`). A room whose id is not that is refused. So an id belongs to one host key for good: when a room is gone (a restart, an unhost, its grace run out), nobody else can register a room under its id and inherit the players who kept it. A joiner can check a listed id against the listed key itself.

A LISTING is the ROOM as its host signed it, plus `players` (`seats - open`) and `ageSeconds` (since first registered). The server checks a room's shape, not its truth: a host can claim more players than it has.

### Signing a room

A `host` message carries `sig`, an Ed25519 signature by `room.hostKey` over the bytes of identity.js's `signedMessage`:

```
"oh-mp/v1/room" \n roomId \n ts \n sha256hex(canonicalJson(room))
```

`canonicalJson` is JSON with every object's keys sorted, at every depth (`src/signatures.js` exports it). Otherwise it is exactly `JSON.stringify`, numbers included, so a client that is not JavaScript must write numbers the way ECMAScript does. In the game:

```js
import { signFields } from "../identity.js";
const ts = Date.now();
const digest = toHex(sha256(utf8(canonicalJson(room))));    // canonicalJson: the same function as signatures.js
socket.send(JSON.stringify({ t: "host", v: 1, room, ts, sig: signFields(hostIdentity, "room", [room.roomId, ts, digest]) }));
```

The server refuses the message in these cases:
- `ts` is more than 5 minutes from its clock (the error names the server's time, so a client can see its clock is off).
- `ts` is not later than the room's last accepted update. A signed registration can't be played back.
- The signature is wrong, or the room id is not derived from the key.

A room belongs to the socket that registered it: only that socket can update it or take it down. One socket hosts one room at a time. A host's socket that sends nothing for an hour is closed, so a host sends something (a `ping` will do) at least every half hour.

When the host's socket closes, the room enters a **30-second grace**. It stays listed but answers offers and joiners' `turn` requests with `host-away`, and the same host key can take it back from a new socket with a newer `ts`. After the grace it is gone. While the old socket is still open (a dropped network is noticed within a minute, by the pings), the room is `room-in-use` to any other socket, even one with the right key; a reconnecting host retries until the old socket is gone.

### Whom the listing can be trusted about

A joiner takes a room's host key from the listing, and checks every answer against it. What that is worth is what this server is worth:
- Nobody but the key's holder can register, change or take over a room under that key, or register a room under its id.
- The server itself could list a room of its own and answer as its host. A player who needs more than the server's word uses an invite token, which carries the host key itself.

### The listing

FILTERS, all optional:

| Filter | Matches |
|---|---|
| `scenario` | `scenario.id`, exactly |
| `language` | `en` finds `en` and every `en-…`; `en-GB` finds only `en-GB` (any case) |
| `version` | exactly |
| `fog`, `password` | the boolean |
| `cheats`, `payment` | the value |
| `minOpen` | `open >= minOpen` |
| `q` | up to 60 characters, found in `name` or `scenario.name` (case and Unicode form ignored); empty means no search |

Only public rooms are listed. They are sorted by most players, then the newest, 50 to a page. `total` counts every match. `GET /api/rooms?fog=true&minOpen=2&page=0` returns the same result, for a page that only browses. Booleans are written `true`/`false`, each parameter at most once, and an unknown parameter is a 400.

Pages are cached as the text that goes out, emptied when any room changes and recomputed at most once a second (for `ageSeconds`). Listings have a budget of their own: 1 a second per socket (bursts of 5), and 3 a second per address across sockets and HTTP (bursts of 15).

### Signaling

- An offer (`to: "host"`) goes only to the room's host socket. It opens a session: the offer's `session` id, tied to the joiner's socket for 2 minutes, renewed by each repeat of the offer.
- The host's answer or deny (`to: <session>`, whose `payload.session` must be the same) is accepted only from the room's host socket, and goes only to the socket that opened the session. No other socket can claim a session that is in use.
- **One answer or deny per offer.** Each offer delivered allows one answer or deny back. A host that repeats its answer to a repeated offer is fine; a second answer to one offer is refused (`no-offer`).
- **A session carries at most 24 offers.** A joiner repeats its offer until the host answers; after 24, it starts a new session.
- **Offer budgets, per room:** 1 every 2 seconds per socket (bursts of 4); 1 a second per address (bursts of 8); and 10 a second for the room as a whole (bursts of 40), the backstop. No one socket or address can use a room up.
- **An SDP must be SDP.** It starts `v=0`, every line is `<letter>=` and printable ASCII, at most 256 characters, and there are at most 100 lines. With TURN on, connections are relay-only, so the only candidates an SDP may carry are `typ relay`, and a relay candidate's `raddr` must be `0.0.0.0` (browsers in relay mode write that). A client that is not relay-only would otherwise give the other side its IP address through this server, so the server refuses it (`bad-sdp`). With TURN off (development, direct connections), any candidate passes.
- The server does not check the answer's signature. The joiner does, against the host key in the listing ([above](#whom-the-listing-can-be-trusted-about)).
- Unlisted rooms are reached by their id like public ones.

### TURN

Credentials follow coturn's `use-auth-secret` scheme:
- `username` is `"<expiry, unix seconds>:<32 random hex>"`.
- `credential` is `base64(HMAC-SHA1(TURN_SECRET, username))`.

Each credential covers **one connection**: coturn's `user-quota` is 6 allocations, and a browser makes one per TURN URL (up to three), with room for an ICE restart. Credentials go only where a game needs them:
- **A host** asks with `{ t: "turn" }` from the socket that hosts its room: one credential for each player connection it answers (or renews). Its budget is twice its seats plus two, per credential lifetime.
- **A joiner** asks with `{ t: "turn", roomId }`, before its offer, since a relay-only offer must already hold its relay candidates. The room must have a host to answer (not in its grace). The budgets are 3 per socket then 1 every 20 seconds, 6 per address then 1 every 10 seconds, and for the room, twice its seats plus two per credential lifetime.

A credential lasts `TURN_TTL_SECONDS` (900 by default). coturn refuses to refresh an allocation made with an expired credential, so a relayed connection dies within minutes of its credential's expiry. **A connection that must outlive its credential renews:** before the expiry (the number before the `:` in `username`), its end asks again the same way, and restarts ICE with the new credential (`setConfiguration`, then `restartIce`). A joiner whose signaling socket was closed as idle opens a new one to ask.

### Errors, strikes and limits

A message a correct client would never send counts a **strike**; the fifth strike closes the socket with 1008. These are:
- anything malformed: `bad-frame` (binary), `bad-json` (not JSON, nested deeper than 8, or a `__proto__` / `constructor` / `prototype` key), `unknown-type`, `invalid`;
- a flood: `rate-limited` (messages, room updates, offers from one socket);
- a bad signature, a bad SDP, or a payload out of place: `bad-signature`, `bad-sdp`, `wrong-payload`, `session-mismatch`, `session-spent`, `no-offer`.

Errors that can happen to a correct client are not strikes:
- `stale`, `one-room`, `room-taken`, `room-in-use`, `too-many-rooms`, `server-full`, `not-your-room`;
- `unknown-room`, `own-room`, `host-away`, `session-taken`, `unknown-session`, `not-host`;
- `busy` (a room's offer or TURN budget, a peer not keeping up, the server as a whole), `not-eligible`, and `rate-limited` for listings and TURN requests.

| Limit | Value |
|---|---|
| Messages | 64 KiB, in at most 4 frames. A bigger one closes the socket with 1009, a more broken-up one with 1008, before it is buffered whole. |
| Messages per socket | 20 a second, bursts of 40 |
| `host` messages per socket | 2 a second, bursts of 10 (each costs a signature check) |
| Offers, listings, TURN | as above |
| Sessions | 8 per socket, 256 per room (the oldest make way) |
| HTTP requests and upgrades per address | 10 a second, bursts of 30 |
| Queued to send | 256 KiB per socket for its own replies (more, and it is dropped); 64 KiB relayed to it (more is refused to the sender as `busy`); 16 MiB for the whole server (above it, a big reply becomes a short `busy`) |
| Memory | above `MAX_MEMORY_MB`, no new sockets |
| Pings | every 30 s; a socket that missed the last one is dropped |
| Quiet sockets | closed with 1000 if they send nothing in their first 30 s; after 10 minutes if they host nothing and wait on no host; after an hour if they host a room |

Upgrades are refused as bare HTTP statuses:
- 404 for any path but `/ws`;
- 403 for an origin not on the list;
- 429 for too many requests or sockets from one address or /48;
- 503 when the server is full, short of memory or restarting.

Close codes:
- 1000: quiet too long;
- 1001: the server is restarting;
- 1008: strikes, or a message in too many pieces;
- 1009: a message too big;
- 1011: a bug (which costs that one socket, not the server).

### HTTP

| Request | Answer |
|---|---|
| `GET /healthz` | `{ "ok": true }` |
| `GET /api/rooms?…` | the listing, as above; CORS for allowed origins (`*` when any origin is allowed). A page from another origin gets no CORS header, so its browser keeps the listing from it. |
| anything else | 404 |

Requests have no body (413), URLs at most 2048 characters (414), headers at most 8 KiB. A request must arrive within 15 seconds (headers within 10).

## Pointing the game at it

The game finds the server through one build-time URL, `VITE_OH_MP_SERVER`: the server's HTTPS origin, for example `https://mp.openhistoria.com`. From it the client uses:
- `wss://…/ws` for the socket;
- `https://…/api/rooms` for browsing;
- the TURN credentials it is given, for `iceTransportPolicy: "relay"` connections.

Set it the way the other `VITE_OH_*` URLs are set:
- in `.env.web` and `.env.android` for those builds;
- in the environment of the desktop build (`VITE_OH_MP_SERVER=https://… npm run build`).

Unset or empty, the public-server browser stays under "Coming soon" and hosting a public game is off. Add the page's origin to `ALLOWED_ORIGINS`, or the server refuses it.

What the client has to do, beyond sending the messages:
- Derive public room ids from the host key and a nonce.
- Ask for a TURN credential per connection, and renew it before it expires.
- Keep its connections relay-only.
- Send a first message promptly, and as a host, something at least every half hour.

## Keeping the copies in step

To stay deployable alone, the package copies two things from the game instead of importing them:
- `src/validate.js`, a byte-for-byte copy of `src/multiplayer/protocol/validate.js`;
- the signaling payload schemas in `src/schemas.js`, between the `copy of messages.js` markers, from `src/multiplayer/session/messages.js`.

`test/validateParity.test.js` fails when either drifts from the game's, comparing with LF line endings. The schema check goes both ways, so it also fails when the game adds a variant or a field. When the game changes one, copy it over. In a copy deployed without the game beside it, those two tests are skipped.

## Files

| File | What |
|---|---|
| `src/server.js` | HTTP and WebSocket transport, upgrade checks, strikes, heartbeats, what may be queued, and the program entry |
| `src/lobby.js` | the protocol: who may host, list, signal and get TURN credentials, and every budget for it |
| `src/rooms.js` | the room registry, the grace, the listing and its cache |
| `src/signatures.js` | `canonicalJson`, the signed bytes, room ids, Ed25519 verification (`node:crypto`) |
| `src/sdp.js` | what an SDP passed through the server may hold |
| `src/schemas.js` | every message's closed schema, and the HTTP query parser |
| `src/config.js` | settings from the environment, checked; origin matching |
| `src/turn.js` | TURN credentials |
| `src/net.js` | the client's address, and what the per-address limits count by |
| `src/bucket.js` | token buckets, and tables of them by key |
| `src/log.js` | the log, with keyed hashes in place of addresses |
| `src/validate.js` | the game's validator, copied |
| `Dockerfile` | the container image `../ops/docker-compose.yml` builds |
