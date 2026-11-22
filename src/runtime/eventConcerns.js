/*! Open Historia — the polities an event is about © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Which polities an event is about: the country panel lists an event under
// each (runtime/countryInfoPanel.js createEventMatcher), and in a shared game
// an event is "yours" to each player it names (multiplayer/host/projection.js).
// Said by the event's own structured fields, never found in its words:
//   concerns     the polities the time skip says it is about (the event
//                schema's `concerns`), by their exact map names
//   combatants   the polities fighting in it
//   places       its places of the kind "country" (runtime/eventPlaces.js)
// An event written before the skip said `concerns` has the other two only.
// Reading the title and description for a polity's name listed "Allemagne"
// under no country at all, an event about the US state of Georgia under the
// country, and found "Oman" inside "Romania".
//
// Import-free, so the panel, a shared game's host and node all read it.

// As many as an event keeps.
export const MAX_EVENT_CONCERNS = 12;
const NAME_MOST = 120;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// A polity's name as names are compared: exact, but for case and spacing.
export const polityNameKey = (value) => clean(value).toLowerCase();

// An event's `concerns` as kept: each name once, none blank. `toName` turns a
// code the model wrote into the name it stands for (gameState.js passes
// ownerNames.js toCountryName), as an event's combatants are read.
export const normalizeEventConcerns = (value, { toName = null } = {}) => {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const written = clean(typeof raw === "string" ? raw : raw?.name ?? raw?.code);
    const name = clean(typeof toName === "function" ? toName(written) : "") || written;
    const key = polityNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name.slice(0, NAME_MOST));
    if (out.length >= MAX_EVENT_CONCERNS) break;
  }
  return out;
};

// Every polity an event names in its structured fields, as written there.
export const eventNamedPolities = (event) => [
  ...(Array.isArray(event?.concerns) ? event.concerns : []),
  ...(Array.isArray(event?.combatants) ? event.combatants : []),
  ...(Array.isArray(event?.places) ? event.places : [])
    .filter((place) => place && typeof place === "object" && place.kind === "country")
    .map((place) => place.name),
].map(clean).filter(Boolean);

// Whether an event names one of `names` (a polity's key, its names, its
// aliases) in those fields.
export const eventNamesPolity = (event, names) => {
  const wanted = new Set((Array.isArray(names) ? names : [names]).map(polityNameKey).filter(Boolean));
  return wanted.size > 0 && eventNamedPolities(event).some((name) => wanted.has(polityNameKey(name)));
};
