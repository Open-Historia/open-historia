/*! Open Historia — which readings the host leaves to a player's own device © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// With settings.replies "own" the host leaves a country's stat sheet and its
// military figures to the device of the player who opens it first, which
// writes them on its own AI key and sends them (host/gameHost.js "sheet",
// "ratings"). Those figures are what the war and the spies act on: military,
// population, economy, the service's rating. A device could open its own
// country and send every figure at its most, or a country it was at war with
// and send that army at nothing, and the figures stood for the rest of the
// game (the review of 2026-11-18, security S6). A device's reply to a
// government is words alone (the owner's decision 2); a figure is not.
//
// So a reading is never left to the device of a player with a stake in it:
// its own country's, and a country at war with it. The host's AI writes those,
// once, as it writes them in a game where the host's AI answers (each a
// country with none, and nothing written twice). Another person's country was
// already never left to a rival's device (gameHost.js playedByAnother). What
// a device sends is held to the game's own ranges as the AI's own reading is
// (gameplay.js takeCountryStatSheet, takeMilitaryRatings).
//
// Pure.

import { warBetween } from "../../runtime/peaceTerms.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();

// Whether `seat` ({ country }) has a stake in `country`'s figures, in `world`.
export const stakeIn = (country, seat, world) => same(country, seat?.country)
  || Boolean(warBetween(world?.wars, country, seat?.country));
