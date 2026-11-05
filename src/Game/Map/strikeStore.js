/*! Open Historia — which strikes the map is asked to play © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The map plays a strike (StrikeLayers.jsx) when it is asked to. Who asks:
//
//   - the Events panel, each time an event comes into view: the strikes that
//     event tells of are played then, as it is read (time.jsx announces it);
//   - an event's own card, to see one again;
//   - the map itself, for a strike no event tells of, when its turn lands.
//
// One small list of requests and whoever listens. It knows nothing of the map
// and loads anywhere.

let serial = 0;
let request = null;
const listeners = new Set();

const emit = () => {
  for (const listener of [...listeners]) listener();
};

// The last thing asked: { serial, eventId, ids, again }, or null.
export const getStrikeRequest = () => request;
export const subscribeStrikeRequests = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// An event has come into view: its strikes are played, once each.
export const showStrikesOfEvent = (eventId) => {
  const id = String(eventId ?? "").trim();
  if (!id) return;
  serial += 1;
  request = { serial, eventId: id, ids: null, again: false };
  emit();
};

// Play these again, whether or not they have been played: by their ids, or
// every strike of an event.
export const replayStrikes = ({ eventId = "", ids = null } = {}) => {
  const event = String(eventId ?? "").trim();
  const wanted = Array.isArray(ids) ? ids.map((id) => String(id ?? "").trim()).filter(Boolean) : null;
  if (!event && !(wanted && wanted.length > 0)) return;
  serial += 1;
  request = { serial, eventId: event, ids: wanted, again: true };
  emit();
};

// (For the tests: as if nothing had been asked.)
export const forgetStrikeRequests = () => {
  request = null;
};
