/*! Open Historia — military feasibility doctrine © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Folded into ${CURRENT_UNITS} by buildTemplateVariables (gameplay.js). Kept
// apart so node --test can load it.
import { normalizeActions } from "../../runtime/gameState.js";

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

// Reach/logistics doctrine for the AI. CONDITIONAL, but not on the orders'
// wording: it rides along whenever there are units on the map or the player
// has an order queued (an English-only keyword test used to leave a French or
// German invasion order without it). A turn with neither doesn't pay the
// context cost; the block is about 1k characters and never a request.
export const buildMilitaryFeasibilityText = (world, actions) => {
  const hasUnits = normalizeArray(world?.units).length > 0;
  const hasPlannedOrders = normalizeActions(actions).some((action) => action.status === "planned" && action.kind !== "chat");
  if (!hasUnits && !hasPlannedOrders) {
    return "";
  }

  return [
    "",
    "MILITARY FEASIBILITY — test every deploy request, move/attack order and your own unitOps against the era and the unit's type before honoring it:",
    "- Era reach: before ~1500, armies march on foot or horse and cross water only by coastal shipping — intercontinental operations are impossible. ~1500–1850 (age of sail): overseas action needs fleets and friendly ports and takes months. 1850–1945: rail and steamships speed logistics; aircraft stay short-ranged until the 1940s. After 1945: global power projection belongs only to major powers with bases, carriers or allies along the route.",
    "- Unit type: air units are fastest but need airbases or carriers within range and cannot hold ground; naval units move only by sea; infantry, armor and artillery crawl overland and need supply lines; garrisons do not travel.",
    "- Distance: compare the unit's coordinates with the target's. An order beyond plausible reach or pace is NOT executed as given — reject it, or convert it into a partial advance with an event explaining the delay, the transport it would need, or why it failed.",
    "- Never teleport units: each move op may only cover what that unit could actually travel in the elapsed time; long campaigns should progress across several turns.",
  ].join("\n");
};
