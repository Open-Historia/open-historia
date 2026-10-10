/*! Open Historia — the public game listing, from a player's side © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Public games are listed by a multiplayer server (server-mp/, GET /api/rooms).
// The server checks a listing's shape, not its truth, and the host wrote it, so
// every row is checked again here against a closed schema: a malformed row is
// dropped, not shown. Names are anyone's text: the screen isolates them from
// the text around them (bidi) and never renders them as markup.
//
// Which server: localStorage "oh:mp:server" (an https:// or, for development,
// http:// origin). None is configured yet: the browser waits behind "Coming
// soon" (ui/PublicLobbies.jsx) until the user's own server exists.

import { B64URL, HEX_ID, NAME, bool, int, json, list, num, obj, safeParse, str, validate } from "../protocol/validate.js";

export const SERVER_STORAGE_KEY = "oh:mp:server";

export const configuredServer = (storage = globalThis.localStorage) => {
  try {
    const value = String(storage?.getItem(SERVER_STORAGE_KEY) || "").trim();
    return /^https?:\/\/[^\s/]+$/.test(value) ? value : "";
  } catch {
    return "";
  }
};

const ROW = obj({
  roomId: HEX_ID(16),
  hostKey: B64URL(32),
  name: NAME(60),
  scenario: obj({ id: NAME(80), name: NAME(80), hash: str(64) }),
  seats: int(1, 64),
  open: int(0, 64),
  round: obj({ minutes: int(1, 10_080), readyThreshold: num(0.5, 1), countdownSeconds: int(0, 3600) }),
  payment: str(5, { enum: ["host", "cycle"] }),
  fog: bool(),
  cheats: str(4, { enum: ["off", "host", "vote"] }),
  language: str(12, { min: 2 }),
  version: str(40, { min: 1 }),
  password: bool(),
  visibility: str(8, { enum: ["public", "unlisted"] }),
  players: int(0, 64),
  ageSeconds: int(0, 10 * 365 * 24 * 3600),
});
const PAGE = obj({ rooms: list(json(6), 50), total: int(0, 100_000), page: int(0, 100) });

export const FILTER_KEYS = Object.freeze(["q", "scenario", "language", "version", "fog", "cheats", "payment", "password", "minOpen"]);

// The query string for a set of filters: only the ones set, spelled plainly.
export const listingQuery = (filters = {}, page = 0) => {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value === undefined || value === null || value === "") continue;
    params.set(key, typeof value === "boolean" ? String(value) : String(value).trim());
  }
  if (page) params.set("page", String(Math.max(0, Math.min(100, Math.trunc(page)))));
  return params.toString();
};

// One page of the listing: { rooms, total, page }, rows that fail the schema
// left out; or { error }.
export const listPublicRooms = async ({ server = configuredServer(), filters = {}, page = 0, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) => {
  if (!server) return { error: "No public server is set up yet." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = listingQuery(filters, page);
    const response = await fetchImpl(`${server}/api/rooms${query ? `?${query}` : ""}`, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) return { error: `The server answered ${response.status}.` };
    const parsed = safeParse(await response.text(), { maxLength: 256 * 1024, maxDepth: 12 });
    if (!parsed.ok) return { error: "The server's answer was not a listing." };
    const shape = validate(PAGE, parsed.value);
    if (!shape.ok) return { error: "The server's answer was not a listing." };
    const rooms = shape.value.rooms.map((row) => validate(ROW, row)).filter((row) => row.ok).map((row) => row.value);
    return { rooms, total: shape.value.total, page: shape.value.page };
  } catch (error) {
    return { error: error?.name === "AbortError" ? "The server did not answer." : "The server could not be reached." };
  } finally {
    clearTimeout(timer);
  }
};
