/*! Open Historia — which signaling relays a shared game uses © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The public Nostr relays (signaling/nostr.js DEFAULT_RELAYS), unless this device
// names others in localStorage "oh:mp:relays" (a JSON list of wss:// or ws://
// URLs): a local relay for development and tests, or the user's own relay later.
// Read by both the host's engine window and a player's page.

import { createNostrChannel, DEFAULT_RELAYS } from "./nostr.js";

export const RELAYS_STORAGE_KEY = "oh:mp:relays";

export const configuredRelays = (storage = globalThis.localStorage) => {
  try {
    const custom = JSON.parse(storage?.getItem(RELAYS_STORAGE_KEY) || "null");
    if (Array.isArray(custom) && custom.length && custom.every((url) => /^wss?:\/\/\S+$/.test(String(url)))) return custom.map(String);
  } catch {
    // the defaults
  }
  return [...DEFAULT_RELAYS];
};

export const relayChannelFactory = (options) => createNostrChannel({ ...options, relays: configuredRelays() });
