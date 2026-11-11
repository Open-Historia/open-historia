import { samePolityName } from "../../../server/polityRename.js";

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const operationOf = (change) => clean(change?.operation).toLowerCase();

export const successorTransfers = (impacts) => {
  const changes = list(impacts?.polityChanges);
  const heirs = changes.filter((change) => ["create", "restore"].includes(operationOf(change))).map((change) => clean(change?.code)).filter(Boolean);
  if (heirs.length !== 1) return [];
  const heir = heirs[0];
  const settled = (polity) => [...list(impacts?.regionTransfers), ...list(impacts?.regionControlOps)].some((entry) => samePolityName(clean(entry?.fromCode), polity));
  return changes
    .filter((change) => operationOf(change) === "dissolve")
    .map((change) => clean(change?.code))
    .filter((polity) => polity && !samePolityName(polity, heir) && !settled(polity))
    .map((polity) => ({
      regionId: `country: ${polity}`,
      regionName: polity,
      fromCode: polity,
      toCode: heir,
      wholeCountry: true,
      note: `${heir} succeeds ${polity}, which this event dissolves.`,
    }));
};

// The polities a skip founds (create or restore) that nothing in it gives any
// land: no transfer or control op, in any of its events, names them as the side
// that gains. "a movement ousted the Lebanese government ... nothing actually
// changed on map despite the events and AI recognizing the new Republic" (a
// player, 2026-11-10): the new republic was founded beside the old country, which
// kept every region. Nothing here moves land itself, since a landless polity
// can be meant (a government in exile, a movement); the next skip is told, and
// decides. `events` is the skip's impacts objects, in order, with their titles.
export const landlessFoundings = (events) => {
  const gains = list(events).flatMap(({ impacts }) => [...list(impacts?.regionTransfers), ...list(impacts?.regionControlOps)])
    .filter((entry) => clean(entry?.op).toLowerCase() !== "contest" && clean(entry?.op).toLowerCase() !== "clear_contest")
    .map((entry) => clean(entry?.toCode))
    .filter(Boolean);
  const found = [];
  for (const { impacts, title } of list(events)) {
    for (const change of list(impacts?.polityChanges)) {
      if (!["create", "restore"].includes(operationOf(change))) continue;
      const polity = clean(change?.code);
      if (!polity || gains.some((gainer) => samePolityName(gainer, polity))) continue;
      if (found.some((entry) => samePolityName(entry.polity, polity))) continue;
      found.push({ polity, title: clean(title) });
    }
  }
  return found;
};
