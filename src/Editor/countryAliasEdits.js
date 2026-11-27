/*!
 * Open Historia - Map Editor V2 country alias authoring
 * Uses the same name folding as canonical native identity resolution.
 */
import { nameKey } from "../../server/nameKey.js";

const clean = (value) => String(value ?? "").trim();
const aliasesOf = (record) =>
  Array.isArray(record?.aliases)
    ? record.aliases.filter((item) => typeof item === "string" && clean(item))
    : [];

// A deliberately small, pure authoring boundary. It refuses ambiguous new names
// and leaves existing records unchanged, including imported legacy collisions.
// Removing an alias is always possible so an author can repair those collisions.
export const planCountryAliasEdit = ({
  polities = {},
  countryKey,
  alias,
  action = "add",
  occupiedKeys = [],
} = {}) => {
  const key = clean(countryKey);
  const registry = polities && typeof polities === "object" && !Array.isArray(polities) ? polities : {};
  const isRegistered = Object.prototype.hasOwnProperty.call(registry, key);
  const isMapped = Array.isArray(occupiedKeys) && occupiedKeys.includes(key);
  if (!key || (!isRegistered && !isMapped)) {
    return { ok: false, reason: "Select a country on this map first." };
  }

  const existing = aliasesOf(registry[key]);
  const candidate = clean(alias);

  if (action === "remove") {
    if (!existing.includes(candidate)) {
      return { ok: false, reason: "That alternative name is not on this country's list." };
    }
    return { ok: true, aliases: existing.filter((value) => value !== candidate) };
  }

  if (action !== "add") {
    return { ok: false, reason: "Unknown alternative-name action." };
  }

  const folded = nameKey(candidate);
  if (!folded) return { ok: false, reason: "Enter an alternative name with at least one letter or number." };

  const ownNames = [
    key, registry[key]?.code, registry[key]?.name,
    ...(Array.isArray(registry[key]?.formerNames) ? registry[key].formerNames : []),
    ...existing,
  ];
  if (ownNames.some((value) => nameKey(value) === folded)) {
    return { ok: false, reason: "This country already uses that name." };
  }

  const otherKeys = new Set([
    ...Object.keys(registry).filter((other) => other !== key),
    ...(Array.isArray(occupiedKeys) ? occupiedKeys.filter((other) => clean(other) !== key) : []),
  ]);
  for (const otherKey of otherKeys) {
    const record = registry[otherKey] || {};
    const names = [
      otherKey, record.code, record.name,
      ...(Array.isArray(record.aliases) ? record.aliases : []),
      ...(Array.isArray(record.formerNames) ? record.formerNames : []),
    ];
    if (names.some((value) => nameKey(value) === folded)) {
      return { ok: false, reason: `"${candidate}" is already used by "${clean(record.name) || otherKey}". Choose a distinct alternative name.` };
    }
  }

  return { ok: true, aliases: [...existing, candidate] };
};
