export const EVENT_AGENCY_SCHEMA_VERSION = 3;

export const EVENT_AGENCY_PRINCIPAL_KINDS = Object.freeze([
  "polity",
  "institution",
  "domestic-actor",
  "domestic-process",
  "collective-process",
  "organization",
  "person",
  "exogenous-process",
]);

export const EVENT_AGENCY_AUTHORITIES = Object.freeze([
  "autonomous",
  "player-order",
  "player-commitment",
  "canonical-process",
  "delegated-routine",
  "endogenous-domestic",
  "independent",
  "external-consequence",
]);

// These are the only classes that represent fresh sovereign state discretion.
// delegated-routine/endogenous-domestic deliberately never appear here.
export const EVENT_AGENCY_SOVEREIGN_AUTHORITIES = Object.freeze([
  "autonomous",
  "player-order",
  "player-commitment",
]);

export const EVENT_AGENCY_MAX_SOVEREIGN_ACTORS = 8;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Check submitted provenance BEFORE normalization/binding mirrors the first
// sovereign row. Otherwise a process/non-sovereign claim, or a player authority
// hidden in a contradictory singular mirror, can silently turn into autonomy.
export const eventAgencyStructureReason = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const rows = value.sovereignActors;
  if (rows !== undefined && !Array.isArray(rows)) return "event.agency.sovereignActors must be an array";
  if (Array.isArray(rows) && rows.length > EVENT_AGENCY_MAX_SOVEREIGN_ACTORS) {
    return `event.agency.sovereignActors exceeds the native limit of ${EVENT_AGENCY_MAX_SOVEREIGN_ACTORS}`;
  }
  for (const row of rows || []) {
    if (!clean(row?.polity || row?.sovereignPolity)) return "each event.agency.sovereignActors row requires a polity";
    if (!EVENT_AGENCY_SOVEREIGN_AUTHORITIES.includes(clean(row?.authority).toLowerCase())) {
      return `sovereign actor ${clean(row?.polity || row?.sovereignPolity)} uses invalid authority ${clean(row?.authority) || "(blank)"}`;
    }
  }
  const authority = clean(value.authority).toLowerCase();
  if ((rows?.length || clean(value.sovereignPolity)) && !EVENT_AGENCY_SOVEREIGN_AUTHORITIES.includes(authority)) {
    return `${authority || "(blank)"} authority cannot exercise sovereignPolity or sovereignActors; it cannot grant fresh sovereign discretion`;
  }
  const mirror = (rows || []).find((row) =>
    clean(row.polity || row.sovereignPolity).toLowerCase() === clean(value.sovereignPolity).toLowerCase());
  if (rows?.length && clean(value.sovereignPolity) && !mirror) {
    return "event.agency singular sovereign mirror is missing from sovereignActors";
  }
  if (mirror && (clean(mirror.authority).toLowerCase() !== authority ||
      clean(mirror.authorityRef) !== clean(value.authorityRef))) {
    return "event.agency singular sovereign mirror conflicts with its sovereignActors row";
  }
  if (["delegated-routine", "endogenous-domestic"].includes(authority)) {
    if (!clean(value.jurisdictionPolity)) {
      return `${authority} authority requires jurisdictionPolity so native code can distinguish activity inside a polity from sovereign discretion by that polity`;
    }
    if (clean(value.authorityRef)) return `${authority} authority must leave authorityRef blank`;
    if (authority === "delegated-routine" && !clean(value.mandateBasis)) {
      return "delegated-routine authority requires mandateBasis describing the already-existing operational/legal mandate; it is evidence only, not sovereign permission";
    }
  }
  return "";
};

const normalizeSovereignActor = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const polity = clean(value.polity || value.sovereignPolity);
  const authority = clean(value.authority).toLowerCase();
  const authorityRef = clean(value.authorityRef);
  if (!polity || !EVENT_AGENCY_SOVEREIGN_AUTHORITIES.includes(authority)) return null;
  return { polity, authority, authorityRef };
};

export const normalizeEventAgency = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const principal = clean(value.principal);
  const principalKind = clean(value.principalKind).toLowerCase();
  const sovereignPolity = clean(value.sovereignPolity);
  const authority = clean(value.authority).toLowerCase();
  const authorityRef = clean(value.authorityRef);
  const jurisdictionPolity = clean(value.jurisdictionPolity);
  const mandateBasis = clean(value.mandateBasis);

  if (!principal) return null;
  if (!EVENT_AGENCY_PRINCIPAL_KINDS.includes(principalKind)) return null;
  if (!EVENT_AGENCY_AUTHORITIES.includes(authority)) return null;

  const sovereignActors = (Array.isArray(value.sovereignActors) ? value.sovereignActors : [])
    .map(normalizeSovereignActor)
    .filter(Boolean)
    .slice(0, EVENT_AGENCY_MAX_SOVEREIGN_ACTORS + 1);

  if (sovereignPolity && EVENT_AGENCY_SOVEREIGN_AUTHORITIES.includes(authority)) {
    const hasPrimary = sovereignActors.some((entry) =>
      clean(entry.polity).toLocaleLowerCase() === sovereignPolity.toLocaleLowerCase(),
    );
    if (!hasPrimary) sovereignActors.unshift({ polity: sovereignPolity, authority, authorityRef });
  }

  const primary = sovereignActors[0] || null;

  return {
    schemaVersion: EVENT_AGENCY_SCHEMA_VERSION,
    principal,
    principalKind,
    sovereignPolity: primary?.polity || sovereignPolity,
    authority: primary?.authority || authority,
    authorityRef: primary?.authorityRef || authorityRef,
    sovereignActors,
    ...(jurisdictionPolity ? { jurisdictionPolity } : {}),
    ...(mandateBasis ? { mandateBasis } : {}),
  };
};
