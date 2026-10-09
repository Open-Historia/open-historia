/*! Open Historia — multiplayer: the wire © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the rest of the game uses of multiplayer's networking. The layers, from
// the bottom:
//
//   bytes.js, protocol/validate.js   safe parsing and closed, bounded schemas
//   protocol/codec.js                messages as frames over a data channel
//   identity.js                      device and host keys (Ed25519), signing
//   invite.js                        the invite token and what it derives
//   signaling/nostr.js               finding the host through public relays
//   transport/peer.js                one WebRTC connection
//   session/host.js, session/client.js
//                                    hosting with one token for many players,
//                                    and joining with it
//
// The game is a star: every player connects to the host alone and never to
// another player. Until the game has its own relay, connections are direct, so
// the host and each player can see each other's IP address (players never see
// each other's); the host's screen says so.

export { createHostSession } from "./session/host.js";
export { createClientSession } from "./session/client.js";
export { PROTOCOL_VERSION, DENY_REASONS, REJECT_REASONS } from "./session/messages.js";
export { createInvite, parseInvite, InviteError } from "./invite.js";
export { createIdentity, identityFromSecret, loadDeviceIdentity } from "./identity.js";
export { DEFAULT_RELAYS } from "./signaling/nostr.js";
export { DEFAULT_ICE_SERVERS } from "./transport/peer.js";
export * as schema from "./protocol/validate.js";
