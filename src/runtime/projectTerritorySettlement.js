// This is the boundary between an already-completed project and the canonical
// map/sovereignty writer. It owns no map or fiscal state, and has no persistence.
// The entire turn must be held if a mandatory territorial effect cannot land;
// otherwise its project completion latch would persist while the land did not.
import { sameName } from "../../server/nameKey.js";

const asArray = (value) => (Array.isArray(value) ? value : []);
const label = (value) => String(value ?? "").trim();
const projectName = (entry) => label(entry?.projectId) || label(entry?.project) || "unknown project";

export const assertProjectTerritoryResolved = (entries, containers, unresolved) => {
  if (!Array.isArray(unresolved)) throw new Error("Project territory resolver returned no verification result.");
  if (unresolved.length) {
    const first = unresolved[0];
    throw new Error(
      `Project territory could not be resolved for ${label(first?.path) || "a completed project"}: ${label(first?.reason) || label(first?.label) || "unrecognized map region"}.`,
    );
  }
  const requested = asArray(entries);
  const resolved = asArray(containers);
  if (requested.length !== resolved.length) throw new Error("Project territory resolver omitted a completion.");
  for (let index = 0; index < requested.length; index += 1) {
    const source = requested[index];
    const result = resolved[index]?.impacts;
    if (!result) throw new Error(`Project territory resolution omitted ${projectName(source)}.`);
    // Whole-country requests may expand to many exact regions; what cannot
    // happen is a previously requested effect disappearing without a refusal.
    if (asArray(source?.regionTransfers).length && !asArray(result.regionTransfers).length) {
      throw new Error(`Project territory resolver discarded transfers for ${projectName(source)}.`);
    }
    if (asArray(source?.regionClaims).length && !asArray(result.regionClaims).length) {
      throw new Error(`Project territory resolver discarded claims for ${projectName(source)}.`);
    }
  }
};

export const assertProjectTerritoryApplied = (containers, settledWorld) => {
  if (!settledWorld || typeof settledWorld !== "object") {
    throw new Error("Project territory apply returned no canonical world.");
  }
  const sovereigns = settledWorld.regionSovereigntyOverrides || {};
  const controllers = settledWorld.regionOwnershipOverrides || {};
  const claimants = settledWorld.regionClaimants || {};
  for (const entry of asArray(containers)) {
    for (const transfer of asArray(entry?.impacts?.regionTransfers)) {
      const regionId = label(transfer?.regionId);
      const recipient = label(transfer?.toCode);
      // The territory path must not silently drop a transfer. The controller
      // may still be an occupier; the legal sovereign is the authoritative check.
      const actual = label(sovereigns[regionId]) || label(controllers[regionId]);
      if (!regionId || !recipient || !actual || !sameName(recipient, actual)) {
        throw new Error(`Project territory did not transfer sovereignty for ${regionId || "an unknown region"}.`);
      }
    }
    for (const claim of asArray(entry?.impacts?.regionClaims)) {
      if (claim?.drop) continue; // Deleting a claim has its own independent policy.
      const regionId = label(claim?.regionId);
      const actor = label(claim?.claimantCode);
      const present = asArray(claimants[regionId]).some((item) => sameName(label(item), actor));
      if (!regionId || !actor || !present) {
        throw new Error(`Project territory did not register the claim for ${regionId || "an unknown region"}.`);
      }
    }
  }
};

/**
 * Reuse the ordinary, authoritative map/event mutation pipeline as one
 * pre-persistence unit. Never publish the project completion latch separately
 * from its legal title, claims, and polity consequences.
 *
 * Dependencies are injected to keep this adapter map-agnostic and testable;
 * future canonical transaction/receipt infrastructure can replace this seam
 * without changing projectEngine's deterministic tick.
 */
export const settleProjectTerritoryWorld = async ({
  entries = [],
  world,
  colors,
  round = 0,
  resolveTransfers,
  readCatalog = null,
  applyWorldImpacts,
  renderedRegions = null,
  // async ({ entries, containers, world }) => void: may narrow each
  // container's regionTransfers and each entry's polityChanges by rule.
  keepTerritory = null,
} = {}) => {
  if (!asArray(entries).length) return { world, colors, renamedPolities: [] };
  if (typeof resolveTransfers !== "function" || typeof applyWorldImpacts !== "function") {
    throw new Error("Project territory settlement requires authoritative resolver and world writer.");
  }
  const containers = entries.map((entry, index) => ({
    event: { title: label(entry.project) },
    impacts: {
      regionTransfers: asArray(entry.regionTransfers).map((transfer) => ({ ...transfer })),
      regionClaims: asArray(entry.regionClaims).map((claim) => ({ ...claim })),
      groupOps: [],
    },
    path: `projects[${index}]`,
  }));
  const unresolved = await resolveTransfers(containers, world, { renderedRegions });
  assertProjectTerritoryResolved(entries, containers, unresolved);

  // What a rule (not a failure) leaves out — a region or polity a person plays
  // is theirs to give — is settled here, after the resolution was verified
  // whole and before the world is written; what it keeps is then checked as
  // applied like everything else.
  let plan = entries.map((entry) => ({ ...entry, polityChanges: asArray(entry.polityChanges) }));
  if (typeof keepTerritory === "function") {
    await keepTerritory({ entries: plan, containers, world });
    plan = plan.map((entry) => ({ ...entry, polityChanges: asArray(entry.polityChanges) }));
  }

  const events = plan.map((entry, index) => ({
    id: `project-done-${index}-${label(entry.date)}`,
    date: entry.date,
    title: entry.project,
    description: "",
    impacts: {
      polityChanges: asArray(entry.polityChanges),
      regionTransfers: containers[index].impacts.regionTransfers,
      regionClaims: containers[index].impacts.regionClaims,
    },
  }));
  const needsCatalog = events.some((event) => event.impacts.regionTransfers.length);
  const catalog = needsCatalog && readCatalog ? await readCatalog() : null;
  const settled = applyWorldImpacts({
    colors, events, world, motion: null, round,
    boardOnlyEventIds: events.map((event) => event.id),
    regionCatalog: catalog,
  });
  assertProjectTerritoryApplied(containers, settled?.world);
  return settled;
};
