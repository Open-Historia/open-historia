/*!
 * open historia enhanced — save-aware polity identity resolver
 * v0.3.0 — lifecycle + map-reference aware
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
import OFFICIAL_COUNTRY_CODES_BY_NAME from "./generated/officialCountryAliases.js";
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

const STOCK_CODES_BY_NAME = (() => {
  const out = new Map();

  const add = (normalizedName, normalizedCode) => {
    if (!normalizedName || !normalizedCode) return;
    const list = out.get(normalizedName) || [];
    if (!list.includes(normalizedCode)) list.push(normalizedCode);
    out.set(normalizedName, list);
  };

  for (const [code, name] of Object.entries(COUNTRY_NAMES)) {
    add(
      normalizeIdentityText(name),
      normalizeString(code).toUpperCase(),
    );
  }

  // Formal ISO names are asset/provenance aliases, not new polity identities.
  // This closes the gap between GADM's short names ("Belarus") and imported
  // official names ("Republic of Belarus") without teaching every UI its own
  // country-name hacks.
  for (const [normalizedName, code] of Object.entries(OFFICIAL_COUNTRY_CODES_BY_NAME)) {
    add(
      normalizeIdentityText(normalizedName),
      normalizeString(code).toUpperCase(),
    );
  }

  return out;
})();

const normalizeMapRefs = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const gadm0 = Array.isArray(source.gadm0) ? source.gadm0 : [];
  return {
    gadm0: [...new Set(
      gadm0
        .map((entry) => normalizeString(entry).toUpperCase())
        .filter((entry) => Boolean(COUNTRY_NAMES[entry])),
    )],
  };
};

const stockCodesForToken = (rawToken, stockName) => {
  const raw = normalizeString(rawToken).toUpperCase();
  const direct = COUNTRY_NAMES[raw] ? [raw] : [];
  const byName = STOCK_CODES_BY_NAME.get(normalizeIdentityText(stockName)) || [];
  return [...new Set([...direct, ...byName])];
};

export const isStockPolityName = (value) =>
  STOCK_COUNTRY_NAMES.has(
    normalizeIdentityText(toCountryName(value)),
  );

// Resolve one human-readable stock-country identity to its canonical GADM/ISO3
// code. This is deliberately asset/provenance resolution only: callers may use
// the result to find a standard flag or map reference, but it does NOT rename,
// merge, or replace the campaign polity's stable identity.
export const resolveStockCountryCode = (value) => {
  const raw = normalizeString(value);
  if (!raw) return null;

  const stockName = toCountryName(raw);
  const codes = stockCodesForToken(raw, stockName);
  return codes.length === 1 ? codes[0] : null;
};

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
        mapRefs: normalizeMapRefs(value?.mapRefs),
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
    identityIndex = null,
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

  // Hot-path callers that resolve many identities against the SAME immutable
  // world snapshot may build this once and reuse it. The default path remains
  // byte-for-byte semantic equivalent: one fresh authoritative index per call.
  const index =
    identityIndex && Array.isArray(identityIndex?.declared)
      ? identityIndex
      : buildPolityIdentityIndex(world);

  const stockCodes = stockCodesForToken(token, stockName);
  const mapRefMatches = stockCodes.length
    ? index.declared.filter((candidate) =>
        candidate.mapRefs.gadm0.some((code) => stockCodes.includes(code)) &&
        (!requireActive || candidate.active))
    : [];

  const declaredRelated = index.declared.filter(
    (candidate) =>
      candidate.normalizedNames.includes(normalizedInput) ||
      (coreInput && candidate.cores.includes(coreInput)) ||
      candidate.mapRefs.gadm0.some((code) => stockCodes.includes(code)),
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

  // 2. explicit map-reference bridge. A scenario can say that its current
  // political actor is the lineage associated with a stock GADM geography
  // without making that geography the actor's identity. This is how a save can
  // safely establish FRA -> French Republic or GBR -> British Empire without
  // hardcoding either country name or teaching the resolver linguistic guesses.
  //
  // mapRefs are provenance/asset hints, not territorial ownership: empires may
  // own many modern geographies, but only explicitly established refs count here.
  {
    const choice = chooseUnique(mapRefMatches);

    if (choice.candidate) {
      return {
        input: normalizeString(token),
        normalizedInput,
        resolved: choice.candidate.canonical,
        status: "map-ref",
        candidates: mapRefMatches.map((candidate) => candidate.canonical),
      };
    }

    if (choice.ambiguous) {
      return {
        input: normalizeString(token),
        normalizedInput,
        resolved: "",
        status: "ambiguous-map-ref",
        candidates: mapRefMatches.map((candidate) => candidate.canonical),
      };
    }
  }

  // 3. conservative regime-wrapper match:
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

  // 4. stock/base-map polity. this keeps an ordinary modern scenario working
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

  // 5. nothing in this save safely claims the name. unknown pass-through is for
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
