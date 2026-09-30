/*! Open Historia — what the engine writes when the model cannot © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// When a provider fails, the engine writes the turn itself (gameplay.js
// fallbackJumpSimulation, fallbackActionSuggestions, fallbackDescriptionToAction):
// a placeholder event per queued order, a quiet-period event, a summary, a set
// of suggested orders. That text goes into the permanent timeline and the
// Actions panel, where the model's own writing is in the player's language
// (languageDirective) and marked data-no-translate. The fallback's was English
// whatever the game's language, so a French player who hit one outage had
// English written into their history for good.
//
// The sentences live here, in a *_TEXTS table the string extractor reads
// (scripts/i18n/), so the shipped language packs carry them. Each is one whole
// sentence or title with {{slots}}, looked up whole in the player's pack when
// it is written (uiString: the shipped pack and what the server's pack has
// learned, never a request), with the English as the fallback.
import { uiString } from "./translator.js";

export const FALLBACK_TURN_TEXTS = Object.freeze({
  // A time skip the model could not write.
  chatEventTitle: "{{country}} opens a diplomatic channel",
  chatEventDescription: "{{country}} opens a deliberate diplomatic channel over \"{{order}}\", forcing counterparts to weigh terms instead of guessing intent.",
  orderEventTitle: "{{country}} acts on the order \"{{order}}\"",
  orderEventDescription: "{{country}} begins carrying out \"{{order}}\", producing immediate administrative and political consequences that other powers start to notice.",
  quietEventTitle: "The international balance remains in motion",
  quietEventDescription: "Foreign ministries and general staffs keep adjusting to the current balance of power while {{country}} gathers its next move.",
  summaryWithOrders: "{{country}} moves from planning into execution, and the world begins adjusting to the turn's most concrete orders.",
  summaryWithoutOrders: "Time advances without a direct order from {{country}}, but the wider system keeps shifting and building pressure.",

  // Suggested orders the model could not write.
  topicDomesticTitle: "Stabilize the domestic front",
  topicDomesticDescription: "Keep the home front orderly and reduce the chance of internal drift while outside pressure builds.",
  topicDiplomaticTitle: "Shape the diplomatic field",
  topicDiplomaticDescription: "Use talks, signals, and leverage to narrow hostile options before the next crisis hardens.",
  topicMilitaryTitle: "Prepare military leverage",
  topicMilitaryDescription: "Create visible readiness and practical reserves so rivals must factor your capability into their plans.",
  topicEconomicTitle: "Secure economic depth",
  topicEconomicDescription: "Expand the industrial and fiscal base that decides whether later gambles are sustainable.",
  suggestionOrderText: "Issue a concrete order addressing \"{{subject}}\" and assign a responsible ministry or command.",
  suggestionRespondTitle: "Respond to the event \"{{event}}\"",
  suggestionActTitle: "Act on the priority \"{{topic}}\"",
  suggestionContingencyText: "Prepare a second-order measure that protects {{country}} if this line of effort triggers resistance.",
  suggestionContingencyTextNoCountry: "Prepare a second-order measure that protects the country if this line of effort triggers resistance.",
  suggestionContingencyTitle: "Create a contingency layer",

  // An order the model could not improve.
  chatOrderExpanded: "{{order}}. Clarify the objective, the concession you can offer, and the outcome you want before the exchange hardens.",
  actionOrderExpanded: "{{order}}. Define the instrument, timing, and expected political or military effect so the move can be executed cleanly.",
});

// The four suggestion topics, in the order they are offered.
export const FALLBACK_SUGGESTION_TOPICS = Object.freeze([
  { title: "topicDomesticTitle", description: "topicDomesticDescription" },
  { title: "topicDiplomaticTitle", description: "topicDiplomaticDescription" },
  { title: "topicMilitaryTitle", description: "topicMilitaryDescription" },
  { title: "topicEconomicTitle", description: "topicEconomicDescription" },
]);

// One sentence in the player's language. `translate` is the pack's lookup,
// (english, params) => text; tests pass their own.
export const fallbackTurnText = (key, params = {}, translate = uiString) => {
  const english = FALLBACK_TURN_TEXTS[key];
  if (!english) return "";
  return String(translate(english, params) ?? "");
};
