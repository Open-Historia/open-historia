/*! Open Historia Continuum — canonical authority projection for passed institutional resolutions.
 *
 * Institutions own the legal resolution. This module exposes only specific,
 * still-unfulfilled OPERATIONAL authorization consequences as process authority
 * sources for later delegated execution. Declaratory/policy state and malformed
 * blocked consequences never become reusable authority. It never executes the
 * underlying consequence itself.
 */

import { normalizeInstitutions } from "./institutions.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const list = (value) => Array.isArray(value) ? value : [];
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const slugPart = (value) => clean(value)
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 96);

// Only consequences whose legal effect is an authorization for later execution
// remain borrowable as canonical-process authority. Other consequence kinds have
// their own owner (agreement/project/membership/charter), are fully represented
// by the resolution itself (declaration/policy), or are intentionally unresolved.
export const INSTITUTION_EXECUTION_AUTHORITY_KINDS = Object.freeze([
  "deployment-authorization",
  "sanctions-authorization",
  "funding-authorization",
]);
const EXECUTION_AUTHORITY_KIND_SET = new Set(INSTITUTION_EXECUTION_AUTHORITY_KINDS);

const normalizeKind = (value) => lower(value).replace(/[\s_]+/g, "-");

export const institutionResolutionAuthorityRef = (institutionId = "", proposalId = "", consequenceId = "") => {
  const institution = slugPart(institutionId);
  const proposal = slugPart(proposalId);
  const consequence = slugPart(consequenceId);
  return institution && proposal && consequence
    ? `institution-resolution:${institution}:${proposal}:${consequence}`
    : "";
};

const proposalPassed = (proposal = {}) => {
  const outcome = lower(proposal?.voting?.outcome?.status);
  const status = lower(proposal?.status);
  return outcome === "passed" || status === "passed" || (status === "implementation" && outcome === "passed");
};

const implementationStillOpen = (proposal = {}) => {
  if (!proposalPassed(proposal)) return false;
  const status = lower(proposal?.implementation?.status);
  return !status || status === "pending" || status === "partial" || status === "blocked";
};

const flattenSemanticValue = (value, out, depth = 0) => {
  if (depth > 3 || value == null) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = clean(value);
    if (text) out.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 16)) flattenSemanticValue(entry, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value).slice(0, 20)) {
      if (["id", "sourceEventIds", "sourceProposalIds", "authorityRef"].includes(key)) continue;
      flattenSemanticValue(entry, out, depth + 1);
    }
  }
};

const consequenceSemanticText = (institution = {}, proposal = {}, consequence = {}) => {
  const parts = [
    clean(institution.name),
    clean(proposal.title),
    clean(proposal.summary),
    clean(proposal.note),
    clean(consequence.note),
  ];
  for (const amendment of list(proposal.amendments)) {
    if (lower(amendment?.status) === "accepted") parts.push(clean(amendment?.text));
  }
  flattenSemanticValue(consequence?.payload, parts);
  return parts.filter(Boolean).join("\n").slice(0, 12000);
};

const proposalPendingConsequences = (proposal = {}) => {
  if (!implementationStillOpen(proposal)) return [];
  const appliedIds = new Set(list(proposal?.implementation?.applied).map((entry) => clean(entry?.id)).filter(Boolean));
  const explicitPending = list(proposal?.implementation?.pending);
  const source = explicitPending.length
    ? explicitPending
    : list(proposal?.consequences).filter((entry) => !appliedIds.has(clean(entry?.id)));
  return source.filter((consequence) => {
    if (!consequence || typeof consequence !== "object") return false;
    if (!EXECUTION_AUTHORITY_KIND_SET.has(normalizeKind(consequence.kind || consequence.type))) return false;
    // An explicit owner/amendment failure is not permission to execute around the
    // failure. Ordinary unsupported operational authorizations have no reason and
    // remain valid mandates for a later canonical executor.
    return !clean(consequence.blockedReason);
  });
};

export const listInstitutionResolutionAuthorities = (world = {}, { institutionId = "" } = {}) => {
  const institutions = normalizeInstitutions(world?.institutions, world);
  const wanted = slugPart(institutionId);
  const out = [];
  for (const institution of Object.values(institutions.byId || {})) {
    if (!institution || lower(institution.status || "active") !== "active") continue;
    if (wanted && slugPart(institution.id) !== wanted) continue;
    for (const proposal of Object.values(institution.proposals || {})) {
      if (!proposal || !implementationStillOpen(proposal)) continue;
      for (const consequence of proposalPendingConsequences(proposal)) {
        const consequenceId = clean(consequence.id);
        const id = institutionResolutionAuthorityRef(institution.id, proposal.id, consequenceId);
        if (!id) continue;
        out.push({
          id,
          institutionId: clean(institution.id),
          institutionName: clean(institution.name || institution.id),
          proposalId: clean(proposal.id),
          proposalTitle: clean(proposal.title || proposal.id),
          consequenceId,
          consequenceKind: normalizeKind(consequence.kind || consequence.type),
          consequenceNote: clean(consequence.note),
          text: consequenceSemanticText(institution, proposal, consequence),
        });
      }
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
};

export const institutionResolutionAuthorityIds = (world = {}) => new Set(
  listInstitutionResolutionAuthorities(world).map((entry) => entry.id),
);

// Consume one exact, previously native-bound institutional mandate after the
// canonical execution event has been accepted into the world. This records the
// provenance on the institution ledger and removes only that consequence from
// the set of reusable authority sources. Other pending consequences remain open.
export const consumeInstitutionResolutionAuthority = (worldInput = {}, {
  authorityRef = "",
  eventId = "",
  date = "",
} = {}) => {
  const ref = clean(authorityRef);
  if (!ref) return { world: worldInput, consumed: false, reason: "missing-authority-ref" };
  const authority = listInstitutionResolutionAuthorities(worldInput).find((entry) => entry.id === ref);
  if (!authority) return { world: worldInput, consumed: false, reason: "unknown-or-completed-authority" };

  const world = { ...(worldInput || {}) };
  const institutions = normalizeInstitutions(world?.institutions, world);
  const institution = institutions.byId?.[authority.institutionId];
  const proposal = institution?.proposals?.[authority.proposalId]
    ? clone(institution.proposals[authority.proposalId])
    : null;
  if (!institution || !proposal) return { world: worldInput, consumed: false, reason: "missing-proposal" };

  const applied = list(proposal?.implementation?.applied).map(clone);
  const appliedIds = new Set(applied.map((entry) => clean(entry?.id)).filter(Boolean));
  const pendingSource = list(proposal?.implementation?.pending).length
    ? list(proposal.implementation.pending).map(clone)
    : list(proposal.consequences)
      .filter((entry) => !appliedIds.has(clean(entry?.id)))
      .map(clone);
  const index = pendingSource.findIndex((entry) => (
    clean(entry?.id) === authority.consequenceId
    && EXECUTION_AUTHORITY_KIND_SET.has(normalizeKind(entry?.kind || entry?.type))
    && !clean(entry?.blockedReason)
  ));
  if (index < 0) return { world: worldInput, consumed: false, reason: "mandate-no-longer-pending" };

  const [executed] = pendingSource.splice(index, 1);
  applied.push({
    id: authority.consequenceId,
    kind: authority.consequenceKind,
    date: clean(date),
    sourceEventIds: clean(eventId) ? [clean(eventId)] : [],
    authorityRef: ref,
    note: clean(executed?.note || authority.consequenceNote),
  });
  proposal.status = "implementation";
  proposal.implementation = {
    status: pendingSource.length ? "partial" : "complete",
    applied,
    pending: pendingSource,
    lastUpdatedDate: clean(date),
    note: pendingSource.length
      ? "Canonical implementation remains open for one or more consequences."
      : "All proposal consequences have been canonically materialized or executed.",
  };
  proposal.lastUpdatedDate = clean(date) || proposal.lastUpdatedDate || "";
  if (clean(eventId)) {
    proposal.sourceEventIds = [...new Set([...list(proposal.sourceEventIds), clean(eventId)])].slice(-24);
  }
  institution.proposals = { ...(institution.proposals || {}), [proposal.id]: proposal };
  institution.lastUpdatedDate = clean(date) || institution.lastUpdatedDate || "";
  institutions.byId[institution.id] = institution;
  world.institutions = institutions;
  return { world, consumed: true, authority, proposal };
};

export const buildInstitutionResolutionAuthorityContext = (world = {}, focusPolities = [], { maxMandates = 8 } = {}) => {
  const institutions = normalizeInstitutions(world?.institutions, world);
  const focus = new Set(list(focusPolities).map((value) => lower(value)).filter(Boolean));
  const rows = listInstitutionResolutionAuthorities(world)
    .filter((row) => {
      if (!focus.size) return true;
      const institution = institutions.byId?.[row.institutionId];
      return list(institution?.members).some((member) => focus.has(lower(member?.polity)));
    })
    .slice(0, Math.max(1, Number(maxMandates) || 8));
  if (!rows.length) return "";
  return rows.map((row) => {
    const note = clean(row.consequenceNote || row.proposalTitle).slice(0, 320);
    return `- ${row.institutionName}: ${row.proposalTitle} [${row.consequenceKind}]${note ? ` — ${note}` : ""}`;
  }).join("\n");
};
