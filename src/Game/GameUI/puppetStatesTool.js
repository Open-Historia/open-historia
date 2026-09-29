/*! Open Historia — the GM tools' Puppet States editor © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A hand edit of world.puppets from the cheats panel, at no AI request. Every
// change is one of the ledger's own verbs (install, reclassify, loyalty,
// reveal, release, annex) run through applyPuppetUpdates, exactly as a GM
// Console transaction's puppetUpdates are, so a hand-made row obeys the same
// rules as an AI-made one: exact polity names, one overlord, no chains, land to
// stand on, MAX_PUPPETS, reveal one-way, the reputation an annexation costs.
// Only the causal event is waived (allowUnboundBaseline), as for a scenario's
// starting rows: the hand edit is the cause, and the next time skip is told of
// it (noteGmChange("puppets", …)).
//
// Annex ends the arrangement here and nothing more: the land moves through the
// Annex Country tool's own transfer, called by the panel after this succeeds.

import { applyPuppetUpdates } from "../AI/nativeDiplomaticDirector.js";
import { PUPPET_KINDS, puppetKindLabel } from "../../runtime/puppets.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const loyaltyOf = (value, fallback = 50) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
};

export const GM_PUPPET_OPS = Object.freeze(["install", "edit", "reveal", "release", "annex"]);

// The standing arrangements first, then the ended ones, each in ledger order.
export const gmPuppetRows = (world) => {
  const rows = list(world?.puppets).filter((row) => row && typeof row === "object" && clean(row.overlord) && clean(row.puppet));
  const live = (row) => (clean(row.status) || "active") === "active";
  return { live: rows.filter(live), ended: rows.filter((row) => !live(row)) };
};

const liveRowFor = (world, overlord, puppet) => gmPuppetRows(world).live
  .find((row) => clean(row.overlord) === clean(overlord) && clean(row.puppet) === clean(puppet)) || null;

// The ledger lines one hand edit becomes. An edit sends only what changed.
export const gmPuppetUpdates = (world, change = {}) => {
  const op = clean(change.op);
  const overlord = clean(change.overlord);
  const puppet = clean(change.puppet);
  const base = { overlord, puppet, eventIds: [] };
  if (op === "install") {
    return [{
      ...base,
      op: "install",
      kind: PUPPET_KINDS.includes(change.kind) ? change.kind : "satellite",
      loyalty: loyaltyOf(change.loyalty),
      secrecy: change.secrecy === "covert" ? "covert" : "open",
    }];
  }
  if (op === "edit") {
    const row = liveRowFor(world, overlord, puppet);
    if (!row) return [];
    const updates = [];
    if (PUPPET_KINDS.includes(change.kind) && change.kind !== row.kind) updates.push({ ...base, op: "reclassify", kind: change.kind });
    if (change.loyalty !== undefined && loyaltyOf(change.loyalty, null) !== null && loyaltyOf(change.loyalty) !== loyaltyOf(row.loyalty)) {
      updates.push({ ...base, op: "loyalty", loyalty: loyaltyOf(change.loyalty) });
    }
    return updates;
  }
  if (["reveal", "release", "annex"].includes(op)) return [{ ...base, op }];
  return [];
};

// The line the next time skip is told, from the row as it stood before.
export const describeGmPuppetChange = (change = {}, before = null) => {
  const overlord = clean(change.overlord);
  const puppet = clean(change.puppet);
  const kind = puppetKindLabel(change.op === "install" ? (PUPPET_KINDS.includes(change.kind) ? change.kind : "satellite") : before?.kind);
  if (change.op === "install") {
    return `Made ${puppet} ${overlord}'s ${kind} by hand (${change.secrecy === "covert" ? "covert" : "openly known"}, loyalty ${loyaltyOf(change.loyalty)}).`;
  }
  if (change.op === "edit") {
    const parts = [];
    if (PUPPET_KINDS.includes(change.kind) && change.kind !== before?.kind) parts.push(`now a ${puppetKindLabel(change.kind)}`);
    if (change.loyalty !== undefined && loyaltyOf(change.loyalty) !== loyaltyOf(before?.loyalty)) parts.push(`loyalty ${loyaltyOf(before?.loyalty)} → ${loyaltyOf(change.loyalty)}`);
    return `Changed ${overlord}'s hold on ${puppet} by hand: ${parts.join("; ") || "no change"}.`;
  }
  if (change.op === "reveal") return `Made it public by hand that ${puppet} is ${overlord}'s ${kind}.`;
  if (change.op === "release") return `Released ${puppet} from being ${overlord}'s ${kind} by hand.`;
  if (change.op === "annex") return `Ended ${puppet}'s standing as ${overlord}'s ${kind} by hand: ${overlord} annexed it.`;
  return "";
};

// Applies one hand edit to the world. Returns { world, error, summary }; on a
// refusal the world comes back unchanged with the ledger's own reason.
export const applyGmPuppetChange = (world, change = {}, { regionCatalog = [], date = "", round = 0 } = {}) => {
  if (!GM_PUPPET_OPS.includes(clean(change.op))) return { world, error: "That is not a change the ledger makes.", summary: "" };
  if (!clean(change.overlord) || !clean(change.puppet)) return { world, error: "Pick both the overlord and the puppet.", summary: "" };
  const before = liveRowFor(world, change.overlord, change.puppet);
  if (change.op !== "install" && !before) {
    return { world, error: `${clean(change.overlord)} does not direct ${clean(change.puppet)} now.`, summary: "" };
  }
  const updates = gmPuppetUpdates(world, change);
  if (!updates.length) return { world, error: "", summary: "" };
  const merge = applyPuppetUpdates({
    world,
    updates,
    events: [],
    stopDate: clean(date),
    round: Number(round) || 0,
    allowUnboundBaseline: true,
    regionCatalog,
  });
  const [refused] = list(merge.dropped);
  if (refused) return { world, error: refused.reason, summary: "" };
  return { world: merge.world, error: "", summary: describeGmPuppetChange(change, before) };
};
