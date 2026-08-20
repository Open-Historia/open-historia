/*!
 * open historia enhanced — save-aware polity identity resolver
 * v0.2.0 — lifecycle-aware
 *
 * ownerNames.js answers "what stock country name does this code mean?"
 * this answers the much more annoying question:
 * "which polity in THIS save does that name actually mean?"
 *
 * a polityOverride key is treated as the stable campaign identity/lineage key.
 * a rename changes its display/current name and aliases, not every key in the
 * save. that lets old/new regime names resolve back to one established actor.
 */

import COUNTRY_NAMES from "./generated/countryNames.js";
import { toCountryName } from "./ownerNames.js";

const normalizeString = (value) => String(value ?? "").trim();

const normalizeIdentityText = (value) =>
  normalizeString(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const STOCK_COUNTRY_NAMES = new Set(
  Object.values(COUNTRY_NAMES)
    .map(normalizeIdentityText)
    .filter(Boolean),
);

export const isStockPolityName = (value) =>
  STOCK_COUNTRY_NAMES.has(
    normalizeIdentityText(toCountryName(value)),
  );

// strip regime wrappers only. do NOT try to turn "german" into "germany",
// "ottoman" into "turkey", etc. that way lies a whole new pile of bullshit.
const polityCore = (value) => {
  let text = normalizeIdentityText(value);
  if (!text) return "";

  text = text.replace(/^the\s+/, "");

  const prefixes = [
    "federal democratic republic of ",
    "federal republic of ",
    "peoples democratic republic of ",
    "people s democratic republic of ",
    "peoples republic of ",
    "people s republic of ",
    "democratic republic of ",
    "socialist republic of ",
    "united republic of ",
    "grand duchy of ",
    "kingdom of ",
    "republic of ",
    "empire of ",
    "principality of ",
    "duchy of ",
    "sultanate of ",
    "emirate of ",
    "caliphate of ",
    "commonwealth of ",
    "federation of ",
    "confederation of ",
  ];

  for (const prefix of prefixes) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length).trim();
      break;
    }
  }

  const suffixes = [
    " federal republic",
    " democratic republic",
    " peoples republic",
    " people s republic",
    " socialist republic",
    " grand duchy",
    " kingdom",
    " republic",
    " empire",
    " principality",
    " duchy",
    " sultanate",
    " emirate",
    " caliphate",
    " commonwealth",
    " federation",
    " confederation",
  ];

  for (const suffix of suffixes) {
    if (text.endsWith(suffix)) {
      text = text.slice(0, -suffix.length).trim();
      break;
    }
  }

  return text;
};

const normalizeAliases = (value) =>
  Array.isArray(value)
    ? value.map((entry) => normalizeString(entry)).filter(Boolean)
    : [];

const countOwnedRegions = (world) => {
  const counts = new Map();

  for (const owner of Object.values(
    world?.regionOwnershipOverrides || {},
  )) {
    const name = normalizeString(owner);
    if (!name) continue;

    counts.set(
      name,
      (counts.get(name) || 0) + 1,
    );
  }

  return counts;
};

const buildDeclaredPolities = (world) => {
  const ownershipCounts = countOwnedRegions(world);

  return Object.entries(
    world?.polityOverrides || {},
  )
    .map(([key, value]) => {
      const canonical = normalizeString(key);
      if (!canonical) return null;

      const names = [
        canonical,
        normalizeString(value?.code),
        normalizeString(value?.name),
        ...normalizeAliases(value?.aliases),
      ].filter(Boolean);

      const lifecycleStatus =
        normalizeString(value?.status).toLowerCase();
      const ownedRegions =
        ownershipCounts.get(canonical) || 0;

      return {
        canonical,
        names: [...new Set(names)],
        normalizedNames: [
          ...new Set(
            names
              .map(normalizeIdentityText)
              .filter(Boolean),
          ),
        ],
        cores: [
          ...new Set(
            names
              .map(polityCore)
              .filter(Boolean),
          ),
        ],
        ownedRegions,
        lifecycleStatus,
        active:
          lifecycleStatus === "active" ||
          ownedRegions > 0,
      };
    })
    .filter(Boolean);
};

const chooseUnique = (candidates) => {
  if (candidates.length === 1) {
    return {
      candidate: candidates[0],
      ambiguous: false,
    };
  }

  if (candidates.length === 0) {
    return {
      candidate: null,
      ambiguous: false,
    };
  }

  // if several regime identities share a base name, prefer exactly one current
  // actor. if two are current, congratulations, you probably have a civil war.
  const active = candidates.filter(
    (candidate) => candidate.active,
  );

  if (active.length === 1) {
    return {
      candidate: active[0],
      ambiguous: false,
    };
  }

  return {
    candidate: null,
    ambiguous: true,
  };
};

export const buildPolityIdentityIndex = (world) => ({
  declared: buildDeclaredPolities(world),
  ownershipCounts: countOwnedRegions(world),
});

export const resolvePolityIdentity = (
  token,
  world,
  {
    allowUnknown = true,
    requireActive = false,
    allowCoreMatch = true,
    allowStockBase = true,
  } = {},
) => {
  const stockName =
    toCountryName(normalizeString(token));

  if (!stockName) {
    return {
      input: normalizeString(token),
      normalizedInput: "",
      resolved: "",
      status: "empty",
      candidates: [],
    };
  }

  const normalizedInput =
    normalizeIdentityText(stockName);

  const coreInput =
    polityCore(stockName);

  const index =
    buildPolityIdentityIndex(world);

  const declaredRelated = index.declared.filter(
    (candidate) =>
      candidate.normalizedNames.includes(normalizedInput) ||
      (coreInput && candidate.cores.includes(coreInput)),
  );

  // 1. exact declared identity/current name/alias.
  // declared state beats raw ownership strings, because a poisoned save may
  // already contain one bogus owner called "Greece".
  const exact = index.declared.filter(
    (candidate) =>
      candidate.normalizedNames.includes(
        normalizedInput,
      ) &&
      (
        !requireActive ||
        candidate.active
      ),
  );

  {
    const choice = chooseUnique(exact);

    if (choice.candidate) {
      return {
        input: normalizeString(token),
        normalizedInput,
        resolved:
          choice.candidate.canonical,
        status: "exact-declared",
        candidates:
          exact.map(
            (candidate) =>
              candidate.canonical,
          ),
      };
    }

    if (choice.ambiguous) {
      return {
        input: normalizeString(token),
        normalizedInput,
        resolved: "",
        status: "ambiguous-exact",
        candidates:
          exact.map(
            (candidate) =>
              candidate.canonical,
          ),
      };
    }
  }

  // 2. conservative regime-wrapper match:
  // "Greece" -> "Kingdom of Greece"
  // "Bulgaria" -> "Kingdom of Bulgaria"
  //
  // this deliberately does NOT make "Germany" equal "German Empire". the old
  // devtools resolver had stronger lineage/geography evidence for that; we will
  // port that evidence later instead of pretending fuzzy spelling is state law.
  const coreMatches =
    allowCoreMatch && coreInput
      ? index.declared.filter(
          (candidate) =>
            candidate.cores.includes(
              coreInput,
            ) &&
            (
              !requireActive ||
              candidate.active
            ),
        )
      : [];

  {
    const choice =
      chooseUnique(coreMatches);

    if (choice.candidate) {
      return {
        input: normalizeString(token),
        normalizedInput,
        resolved:
          choice.candidate.canonical,
        status: "core-match",
        candidates:
          coreMatches.map(
            (candidate) =>
              candidate.canonical,
          ),
      };
    }

    if (choice.ambiguous) {
      return {
        input: normalizeString(token),
        normalizedInput,
        resolved: "",
        status: "ambiguous-core",
        candidates:
          coreMatches.map(
            (candidate) =>
              candidate.canonical,
          ),
      };
    }
  }

  // 3. stock/base-map polity. this keeps an ordinary modern scenario working
  // even when it has no polityOverride record yet. but if this save already
  // declares a related historical/current identity, do NOT resurrect the base
  // label as a second country just because GADM knows the name.
  if (
    allowStockBase &&
    isStockPolityName(stockName) &&
    declaredRelated.length === 0
  ) {
    return {
      input: normalizeString(token),
      normalizedInput,
      resolved: stockName,
      status: "stock-base",
      candidates: [],
    };
  }

  // 4. nothing in this save safely claims the name. unknown pass-through is for
  // explicit lifecycle code only; ordinary world mutations should set it false.
  if (allowUnknown) {
    return {
      input: normalizeString(token),
      normalizedInput,
      resolved: stockName,
      status: "unknown-pass-through",
      candidates: [],
    };
  }

  return {
    input: normalizeString(token),
    normalizedInput,
    resolved: "",
    status: "unresolved",
    candidates:
      declaredRelated.map(
        (candidate) => candidate.canonical,
      ),
  };
};

// Territory is stricter than metadata. A dormant historical identity does not
// suddenly get land because the model used an old/base name. A same-event
// create/restore/rename becomes status=active before transfers are resolved, so
// newborn or restored states still work without a hardcoded exception list.
export const resolveTerritorialPolityIdentity = (
  token,
  world,
) =>
  resolvePolityIdentity(
    token,
    world,
    {
      allowUnknown: false,
      requireActive: true,
      allowCoreMatch: true,
      allowStockBase: true,
    },
  );

export const resolvePolityName = (
  token,
  world,
  options,
) =>
  resolvePolityIdentity(
    token,
    world,
    options,
  ).resolved;
