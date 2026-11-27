/*!
 * Scenario Map Editor government identity bridge.
 * Reads the scenario's canonical Political Actor, overlays only author edits.
 */
import { samePolityName } from "../../server/polityRename.js";

const matches = (a,b) => Boolean(a && b) && samePolityName(a,b);

export const findGovernmentActor = (actors, polity, renames = []) => {
  const byPolity = actors && typeof actors === "object" && !Array.isArray(actors) ? actors : {};
  const direct = Object.keys(byPolity).find((key) => matches(key,polity));
  if (direct) return byPolity[direct];
  let lookup = polity;
  // The scenario world still holds the old key until Apply. Walk back through
  // the map's authored rename chain to resolve the correct existing actor.
  for (let i = renames.length - 1; i >= 0; i--) {
    const change = renames[i];
    if (matches(change?.to,lookup)) lookup = change.from;
  }
  const inherited = Object.keys(byPolity).find((key) => matches(key,lookup));
  return inherited ? byPolity[inherited] : null;
};

export const governmentFieldsForPolity = (actors, polity, edits = [], renames = []) => {
  const actor = findGovernmentActor(actors,polity,renames);
  const staged = (Array.isArray(edits) ? edits : []).find((row) => matches(row?.polity,polity));
  const base = actor?.government || {};
  return {
    form: Object.prototype.hasOwnProperty.call(staged || {},"form") ? staged.form || "" : base.form || "",
    ideology: Object.prototype.hasOwnProperty.call(staged || {},"ideology") ? staged.ideology || "" : base.ideology || "",
    hasActor: Boolean(actor),
    staged: Boolean(staged),
  };
};
