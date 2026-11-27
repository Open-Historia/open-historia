/*! Open Historia — the star on the label of a country a person plays © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In a shared game the map's label of a country a person plays (not the AI)
// reads "★ NAME": the owner asked for a star by the label, and clicking the
// country says who it is (Selection/Regions.jsx "Played by").
//
// Laid over the polity text records (polityTextRecords.js) as their `text`,
// so the renderer draws it with the name and fits both to the land. Only the
// starred records are new objects: the renderer prepares just the records
// that changed, and in single player (no one listed) the very same array comes
// back, so nothing is laid out again.
//
// A record is matched by its `owner`, the canonical name the host keys a seat
// by too, without case or spare spaces (client/seatRoster.js countryKey).

export const PLAYER_STAR = "★";

const keyOf = (name) => String(name ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export const withPlayerStars = (records, playedCountries) => {
  const list = Array.isArray(records) ? records : [];
  const keys = new Set((Array.isArray(playedCountries) ? playedCountries : []).map(keyOf).filter(Boolean));
  if (!keys.size || !list.length) return list;
  let starred = false;
  const out = list.map((record) => {
    if (!record || !keys.has(keyOf(record.owner))) return record;
    const text = String(record.text ?? "");
    if (!text || text.startsWith(`${PLAYER_STAR} `)) return record;
    starred = true;
    return { ...record, text: `${PLAYER_STAR} ${text}`, playedByPerson: true };
  });
  return starred ? out : list;
};
