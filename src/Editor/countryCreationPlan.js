/*!
 * Open Historia Map Editor — preflight for a new canonical country identity.
 * Uses the same Unicode name fold as native polity resolution.
 */
import { nameKey } from "../../server/nameKey.js";

const clean = (text) => String(text ?? "").trim();
const namesOf = (key, record) => [
  key, record?.code, record?.name,
  ...(Array.isArray(record?.aliases) ? record.aliases : []),
  ...(Array.isArray(record?.formerNames) ? record.formerNames : []),
];

export const planCountryCreation = ({ name, polities = {}, occupiedKeys = [] } = {}) => {
  const candidate = clean(name);
  const folded = nameKey(candidate);
  if (!folded) return { ok: false, reason: "Enter a country name with at least one letter or number." };
  const registry = polities && typeof polities === "object" && !Array.isArray(polities) ? polities : {};
  const keys = new Set([...Object.keys(registry), ...(Array.isArray(occupiedKeys) ? occupiedKeys : [])]);
  for (const key of keys) {
    if (namesOf(key, registry[key]).some((value) => nameKey(value) === folded)) {
      const label = clean(registry[key]?.name) || key;
      return {
        ok: false,
        reason: `"${candidate}" already identifies "${label}". Choose a distinct name or edit the existing country.`,
      };
    }
  }
  return { ok: true, key: candidate };
};
