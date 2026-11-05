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
