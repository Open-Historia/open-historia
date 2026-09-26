/*! Open Historia — the rooms a public multiplayer server knows, and who holds each © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A room is registered by a host's connection and belongs to that connection:
// only it can update the room or take it down, and only with a fresh
// signature by the room's host key (lobby.js checks the signature before it
// calls register; check, which changes nothing, may come first). A room's id
// is derived from its host key (signatures.js roomIdFor), so an id belongs to
// one key for good, even after its room is gone.
//
// When the host's connection closes, the room is not dropped at once. For a
// grace (30 s) it stays listed but refuses offers, and the same host key can
// take it back from a new connection: a host whose network blinked keeps its
// place in the listing. After the grace it is gone.
//
// Each update must carry a later timestamp than the last one accepted for the
// room, so a signed registration seen once cannot be played back to the server
// to undo a later change or to take the room back during its grace.
//
// Listing pages are cached as the text that goes out: asking again for a page
// costs a lookup, not a sort and a serialization. The cache is emptied when
// any room changes, and a page is recomputed at most once a second (for its
// ageSeconds).
//
// Nothing here is persisted. A restart empties the listing, and hosts register
// again when they reconnect.

import { canonicalJson } from "./signatures.js";
import { NETWORK_SHARE, networkKey } from "./net.js";

export const PAGE_SIZE = 50;
const CACHED_PAGES = 64;

// Case- and form-insensitive text for the search filter.
const fold = (text) => text.normalize("NFKC").toLowerCase();

const players = (record) => record.data.seats - record.data.open;

export const createRoomRegistry = ({
  maxRooms,
  maxRoomsPerIp,
  graceMs,
  now,
  timers = globalThis,
  onRemoved = () => {},
}) => {
  const rooms = new Map();
  // Rooms per address, and per wider network ("net " + its key).
  const perAddress = new Map();
  const pages = new Map();

  const countFor = (key) => perAddress.get(key) ?? 0;
  const bump = (key, delta) => {
    const next = countFor(key) + delta;
    if (next > 0) perAddress.set(key, next);
    else perAddress.delete(key);
  };
  const addTo = (address, delta) => {
    bump(address, delta);
    const network = networkKey(address);
    if (network) bump(`net ${network}`, delta);
  };
  // Whether one more room at `address` (moved from `from`, if it is a room in
  // its grace changing hands) would go past a limit.
  const overLimit = (address, from = null) => {
    if (address !== from && countFor(address) >= maxRoomsPerIp) return true;
    const network = networkKey(address);
    if (network === null || (from !== null && networkKey(from) === network)) return false;
    return countFor(`net ${network}`) >= maxRoomsPerIp * NETWORK_SHARE;
  };

  const changed = () => pages.clear();

  const setData = (record, room, ts) => {
    record.data = room;
    record.lastTs = ts;
    record.search = [fold(room.name), fold(room.scenario.name)];
    record.language = room.language.toLowerCase();
  };

  const refuse = (code, message) => ({ ok: false, code, message });

  // What registering `room` would do, changing nothing: "updated" (this owner
  // already holds it), "reclaimed" (it is in its grace), "hosted" (new), or a
  // refusal. None of it depends on the signature, so lobby.js asks first and
  // a message that would be refused anyway never costs a signature check.
  const decide = ({ owner, address, room, ts }) => {
    const existing = rooms.get(room.roomId);
    if (existing) {
      // Unreachable while ids are derived from host keys; kept so that the
      // binding holds even if that ever changes.
      if (existing.hostKey !== room.hostKey) return refuse("room-taken", "That room id is registered under another host key.");
      if (ts <= existing.lastTs) return refuse("stale", "Older than the room's last update: sign it again with a later ts.");
      if (existing.owner === owner) return { ok: true, how: "updated", existing };
      if (existing.owner !== null) return refuse("room-in-use", "Another connection is hosting that room.");
      if (overLimit(address, existing.address)) return refuse("too-many-rooms", "This address already hosts as many rooms as it may.");
      return { ok: true, how: "reclaimed", existing };
    }
    if (rooms.size >= maxRooms) return refuse("server-full", "This server is hosting as many rooms as it can.");
    if (overLimit(address)) return refuse("too-many-rooms", "This address already hosts as many rooms as it may.");
    return { ok: true, how: "hosted", existing: null };
  };

  // Register a new room, update one this owner holds, or take one back during
  // its grace. `room` is a validated ROOM with a verified signature.
  const register = ({ owner, address, room, ts }) => {
    const decision = decide({ owner, address, room, ts });
    if (!decision.ok) return decision;
    const { how, existing } = decision;
    changed();
    if (how === "updated") {
      setData(existing, room, ts);
      return { ok: true, record: existing, how };
    }
    if (how === "reclaimed") {
      timers.clearTimeout(existing.graceTimer);
      existing.graceTimer = null;
      addTo(existing.address, -1);
      addTo(address, 1);
      existing.address = address;
      existing.owner = owner;
      setData(existing, room, ts);
      return { ok: true, record: existing, how };
    }
    const record = {
      id: room.roomId,
      hostKey: room.hostKey,
      owner,
      address,
      createdAt: now(),
      graceTimer: null,
      // Joiners waiting on the host, by session id, and the budgets for this
      // room's offers and TURN credentials (all lobby.js's).
      sessions: new Map(),
      offers: null,
      offerAddresses: null,
      hostTurn: null,
      joinerTurn: null,
    };
    setData(record, room, ts);
    rooms.set(record.id, record);
    addTo(address, 1);
    return { ok: true, record, how: "hosted" };
  };

  const remove = (roomId, reason) => {
    const record = rooms.get(roomId);
    if (!record) return false;
    rooms.delete(roomId);
    timers.clearTimeout(record.graceTimer);
    record.graceTimer = null;
    addTo(record.address, -1);
    record.sessions.clear();
    changed();
    onRemoved(record, reason);
    return true;
  };

  // The owner's connection closed: the grace starts.
  const release = (owner, roomId) => {
    const record = rooms.get(roomId);
    if (!record || record.owner !== owner) return false;
    record.owner = null;
    record.graceTimer = timers.setTimeout(() => {
      if (rooms.get(roomId) === record && record.owner === null) remove(roomId, "expired");
    }, graceMs);
    return true;
  };

  // `q` is filters.q already folded (once per listing, not once per room).
  const matches = (record, filters, q) => {
    const room = record.data;
    if (room.visibility !== "public") return false;
    if (filters.scenario !== undefined && room.scenario.id !== filters.scenario) return false;
    if (filters.language !== undefined) {
      // "en" finds "en" and every "en-…"; "en-GB" finds only "en-GB".
      const wanted = filters.language.toLowerCase();
      if (record.language !== wanted && (wanted.includes("-") || !record.language.startsWith(`${wanted}-`))) return false;
    }
    if (filters.version !== undefined && room.version !== filters.version) return false;
    if (filters.fog !== undefined && room.fog !== filters.fog) return false;
    if (filters.cheats !== undefined && room.cheats !== filters.cheats) return false;
    if (filters.payment !== undefined && room.payment !== filters.payment) return false;
    if (filters.password !== undefined && room.password !== filters.password) return false;
    if (filters.minOpen !== undefined && room.open < filters.minOpen) return false;
    if (q && !record.search.some((text) => text.includes(q))) return false;
    return true;
  };

  // One page of public rooms: most players first, then the newest, then by id
  // so that paging is stable. A listing is the room as its host signed it,
  // plus the players it has and how long ago it was first registered.
  const list = (filters = {}, page = 0) => {
    const q = filters.q ? fold(filters.q) : "";
    const found = [];
    for (const record of rooms.values()) if (matches(record, filters, q)) found.push(record);
    found.sort((a, b) => players(b) - players(a) || b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const at = now();
    return {
      rooms: found.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((record) => ({
        ...record.data,
        players: players(record),
        ageSeconds: Math.max(0, Math.floor((at - record.createdAt) / 1000)),
      })),
      total: found.length,
      page,
    };
  };

  // The same page as the JSON text of { t: "rooms", rooms, total, page },
  // from the cache when it can be.
  const listingText = (filters = {}, page = 0) => {
    const second = Math.floor(now() / 1000);
    const key = canonicalJson({ filters, page });
    const cached = pages.get(key);
    if (cached && cached.second === second) return cached.text;
    const text = JSON.stringify({ t: "rooms", ...list(filters, page) });
    pages.delete(key);
    pages.set(key, { second, text });
    if (pages.size > CACHED_PAGES) pages.delete(pages.keys().next().value);
    return text;
  };

  return {
    // The refusal registering would meet, or null (see decide).
    check: (args) => {
      const decision = decide(args);
      return decision.ok ? null : decision;
    },
    register,
    remove,
    release,
    list,
    listingText,
    get: (roomId) => rooms.get(roomId) ?? null,
    records: () => rooms.values(),
    get size() {
      return rooms.size;
    },
    close() {
      for (const record of rooms.values()) timers.clearTimeout(record.graceTimer);
      rooms.clear();
      perAddress.clear();
      pages.clear();
    },
  };
};
