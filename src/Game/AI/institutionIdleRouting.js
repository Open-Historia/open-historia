/*! Open Historia Continuum — institution-aware idle diplomacy routing. */
import { institutionsForPolity, resolveInstitutionRecord } from "../../runtime/institutions.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const list = (value) => Array.isArray(value) ? value : [];

const activeMembership = (institution, polity) => list(institution?.members).some((member) => (
  lower(member?.polity) === lower(polity)
  && lower(member?.status || "member") !== "suspended"
));

export const sharedInstitutionRoutesForPlayer = (world = {}, playerCountry = "", { limit = 10 } = {}) => (
  institutionsForPolity(world, playerCountry, { includeSuspended: false, includeDissolved: false })
    .map((entry) => entry?.institution || entry)
    .filter((institution) => lower(institution?.status || "active") === "active")
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((institution) => ({
      id: clean(institution.id),
      name: clean(institution.name || institution.id),
      members: list(institution.members)
        .filter((member) => lower(member?.status || "member") !== "suspended")
        .map((member) => clean(member?.polity))
        .filter(Boolean),
      purpose: list(institution?.charter?.lifecycle?.purpose).map(clean).filter(Boolean).slice(0, 3),
    }))
    .filter((entry) => entry.id && entry.name)
);

export const buildIdleInstitutionRoutingContext = (world = {}, playerCountry = "") => {
  const routes = sharedInstitutionRoutesForPlayer(world, playerCountry);
  if (!routes.length) return "";
  return [
    "[SHARED INSTITUTION COUNCILS]",
    "If the diplomatic note is substantively about business of a shared institution, prefer speaking in that institution's Council instead of sending the player a repetitive bilateral/group DM. Use ordinary Contacts for private/bilateral matters. Do not force unrelated diplomacy into an institution.",
    "To route a note into Council, set top-level chatInstitutionId to the exact institution id below. The speaker must itself be an active member. This only routes conversation; it creates NO proposal, ballot, membership change, or legal outcome.",
    ...routes.map((entry) => `- ${entry.name} [${entry.id}] | members: ${entry.members.join(", ")}${entry.purpose.length ? ` | purpose: ${entry.purpose.join("; ")}` : ""}`),
  ].join("\n");
};

export const resolveIdleInstitutionRoute = (world = {}, {
  institutionId = "",
  playerCountry = "",
  speaker = "",
} = {}) => {
  const id = clean(institutionId);
  if (!id || !clean(playerCountry) || !clean(speaker)) return null;
  const institution = resolveInstitutionRecord(world, id);
  if (!institution || lower(institution.status || "active") !== "active") return null;
  if (!activeMembership(institution, playerCountry) || !activeMembership(institution, speaker)) return null;
  return institution;
};
