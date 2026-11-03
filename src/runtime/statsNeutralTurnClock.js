/*! Open Historia - separate live Statistics settlement for safely non-belligerent polities.
 * A changing war/occupation can invalidate whole-turn naval evidence for the
 * belligerents. It must not also suppress civil-time accrual for unrelated
 * sovereign ledgers. The actual war path remains authoritative for every
 * excluded polity; it is never reconstructed from missing naval evidence.
 */
import { planNativeStatsLiveTurn, unresolvedCityAirStrikeTargets } from './statsLiveTurnClock.js';
import { collectActiveScenarioPolityKeys, createScenarioPolityResolver } from './scenarioPolities.js';
import { validateNativeMigrationPlans } from './statsMigrationClock.js';
import { displayNameMigrations, renamePolityInWorld, samePolityName } from '../../server/polityRename.js';
import { isRealCountryName } from './ownerNames.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const text = (value) => typeof value === 'string' ? value.trim() : '';
const names = (value) => Array.isArray(value) && value.length && value.every((item) => text(item)) ? value : null;
const rows = (value) => Array.isArray(value) ? value : null;
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);

const safeScope = ({ baseWorld, turnFronts, warUpdates, events }, onReject = null) => {
  const reject = (code) => {
    if (typeof onReject === 'function') onReject(code);
    return null;
  };
  if (!plain(baseWorld) || !plain(baseWorld.countryStats) || !Array.isArray(events)
    || !Array.isArray(warUpdates) || (baseWorld.wars != null && !Array.isArray(baseWorld.wars))
    || (baseWorld.blockades != null && !Array.isArray(baseWorld.blockades))
    || (baseWorld.battlefields != null && !Array.isArray(baseWorld.battlefields))) return reject('malformed-canonical-war-or-stats-state');
  // A war record is itself untrusted identity evidence. The general political
  // roster may include names found ONLY in wars, so using that roster here
  // would let an invented belligerent authenticate itself and falsely enable
  // neutral-only GDP accrual. Require independent canonical polity membership.
  const active = new Set(collectActiveScenarioPolityKeys({ ...baseWorld, wars: [] }));
  const byName = new Map([...active].map((name) => [name.toLowerCase(), name]));
  const resolve = createScenarioPolityResolver(baseWorld);
  const excluded = new Set();
  const block = (name) => {
    const value = text(name);
    if (!value) return false;
    const canonical = byName.get(resolve(value).toLowerCase());
    // Unknown participant names are not safe to infer as an unrelated state.
    if (!canonical) return false;
    excluded.add(canonical);
    return true;
  };
  const blockMany = (set) => !names(set) ? false : set.every(block);
  // Existing war IDs are canonical evidence for belligerents even when an
  // event has no redundant combatants array (e.g. a diplomatic war update).
  // Unknown/ambiguous war IDs remain a fail-closed refusal, not a guessed side.
  const blockEstablishedWar = (id) => {
    const matches = (rows(baseWorld.wars) || []).filter((war) => text(war?.id) === text(id));
    return matches.length === 1 && blockMany(matches[0].sideA) && blockMany(matches[0].sideB);
  };
  for (const war of rows(baseWorld.wars) ?? []) {
    if (!plain(war)) return reject('malformed-established-war');
    if (war.status === 'ended') continue;
    if (!blockMany(war.sideA) || !blockMany(war.sideB)) return reject('unknown-established-belligerent');
  }
  for (const field of rows(baseWorld.battlefields) ?? []) {
    if (!plain(field)) return null;
    if (field.status === 'ended') continue;
    if (!Array.isArray(field.sides) || field.sides.length !== 2
      || !blockMany(field.sides[0]) || !blockMany(field.sides[1])) return reject('unknown-battlefield-belligerent');
  }
  for (const war of warUpdates) {
    if (!plain(war) || (war.op !== 'end' && !blockMany(war.actors))
      || (war.op === 'start' && !blockMany(war.opponents))) return reject('unknown-war-update-belligerent');
    if (war.opponents != null && (!Array.isArray(war.opponents) || war.opponents.some((name) => !block(name)))) return reject('unknown-war-update-opponent');
  }
  for (const blockade of rows(baseWorld.blockades) ?? []) {
    if (!plain(blockade) || !block(blockade.country)) return reject('unknown-blockade-target');
  }
  for (const event of events) {
    if (!plain(event)) return reject('malformed-turn-event');
    if (event.warId && !(names(event.combatants) ? blockMany(event.combatants) : blockEstablishedWar(event.warId))) return reject('unknown-event-war-belligerent');
    if (Array.isArray(event.combatants) && event.combatants.length && !blockMany(event.combatants)) return reject('unknown-event-combatant');
    const impacts = event.impacts || {};
    for (const op of [...(rows(impacts.regionTransfers) ?? []), ...(rows(impacts.regionControlOps) ?? [])]) {
      if (!plain(op) || !block(op.fromCode) || !block(op.toCode)) return reject('unknown-territorial-participant');
    }
    for (const op of rows(impacts.polityChanges) ?? []) {
      if (!plain(op)) return reject('malformed-polity-change');
      // Ordinary event changes are applied between native clock steps. Only
      // lifecycle identity transitions make the safe-key set unstable.
      const currentName = resolve(text(op.code));
      // An ordinary update may still carry a new display name. The native
      // event applier re-keys all country ledgers for that update, so it must
      // remain on the legacy side of this turn's fixed-identity clock.
      const renamesIdentity = text(op.name) && !samePolityName(currentName, op.name);
      if ((op.operation !== 'update' || renamesIdentity) && !block(op.code)) return reject('unknown-polity-lifecycle-participant');
    }
  }
  for (const row of rows(turnFronts?.starts) ?? []) {
    if (!plain(row) || !block(row.attacker) || !block(row.defender)) return reject('unknown-front-start-participant');
  }
  for (const row of rows(turnFronts?.joins) ?? []) {
    if (!plain(row) || !block(row.name) || !block(row.by)) return reject('unknown-front-join-participant');
  }
  for (const row of rows(turnFronts?.flips) ?? []) {
    if (!plain(row) || !block(row.from) || !block(row.to)) return reject('unknown-front-flip-participant');
  }
  const sea = turnFronts?.sea;
  for (const record of [...(rows(sea?.blockades) ?? []), ...(rows(sea?.blockadeDays) ?? [])]) {
    if (!plain(record) || !block(record.country)) return reject('unknown-sea-target');
  }
  // The separate legacy city-bombing writer may still act on a neutral
  // country's GDP and residents. Exclude that exact polity, not every other
  // unrelated neutral clock; unknown identity fails closed.
  for (const country of unresolvedCityAirStrikeTargets(turnFronts)) {
    if (!block(country)) return reject('unknown-city-strike-target');
  }
  // Migrations must remain two-account transactions. If either endpoint is
  // excluded, the other endpoint stays on the same legacy writer.
  const flows = validateNativeMigrationPlans(baseWorld);
  // Multiple flows may form a chain, and their list order cannot determine
  // whether an endpoint is wrongly advanced on a different writer.
  for (let pass = 0; pass < flows.length; pass++) {
    for (const flow of flows) {
      if (excluded.has(flow.fromPolity) || excluded.has(flow.toPolity)) {
        excluded.add(flow.fromPolity);
        excluded.add(flow.toPolity);
      }
    }
  }
  const safe = Object.keys(baseWorld.countryStats).filter((key) => active.has(key) && !excluded.has(key));
  return excluded.size > 0 && safe.length ? safe : reject('no-verified-unaffected-scope');
};

// The event reducer normalizes and re-keys preexisting polity display names
// BEFORE its first chronological boundary. Plan against that same identity
// projection, or the boundary will retain a key the reducer has already moved.
// This is a detached projection: the actual reducer still performs the rename
// itself, preserving its rename receipts, colors, and non-Stats follow-up work.
const canonicalStatsStartWorld = (baseWorld, onReject) => {
  let projected = baseWorld;
  for (const { from, to } of displayNameMigrations(baseWorld, { isReserved: isRealCountryName })) {
    try {
      projected = renamePolityInWorld(projected, from, to).world;
    } catch {
      if (typeof onReject === 'function') onReject('unresolved-initial-polity-identity');
      return null;
    }
  }
  return projected;
};

// The safe subset intentionally has no naval targets, not an invented report
// that "no wartime blockade occurred". Its settlement reads real canonical
// event/territory state on each step, but can only write this bounded subset.
export const planNeutralStatsLiveTurn = (args = {}) => {
  const canonicalBase = canonicalStatsStartWorld(args.baseWorld, args.onReject);
  if (!canonicalBase) return null;
  const allowed = safeScope({ ...args, baseWorld: canonicalBase }, args.onReject);
  if (!allowed) return null;
  const selected = new Set(allowed);
  const subset = (world) => ({
    ...world,
    countryStats: Object.fromEntries(Object.entries(world.countryStats || {}).filter(([key]) => selected.has(key))),
    countryStatsHistory: Object.fromEntries(Object.entries(world.countryStatsHistory || {}).filter(([key]) => selected.has(key))),
    migrationFlows: (world.migrationFlows || []).filter((flow) => selected.has(flow.fromPolity) && selected.has(flow.toPolity)),
  });
  const zeroWar = { ...subset(canonicalBase), wars: [], blockades: [], battlefields: [] };
  const boundary = planNativeStatsLiveTurn({ ...args, baseWorld: zeroWar, turnFronts: null, warUpdates: [] });
  if (!boundary) {
    if (typeof args.onReject === 'function') args.onReject('native-scope-calendar-or-ledger-refusal');
    return null;
  }
  const merge = (current, changed) => {
    // A missing selected account is never silently omitted, even after the
    // initial display-name re-key has been accounted for. Include bounded key
    // evidence so a later lifecycle regression can be diagnosed from a log.
    const absentCurrent = [...selected].filter((key) => !own(current.countryStats, key));
    const absentSettled = [...selected].filter((key) => !own(changed.countryStats, key));
    if (absentCurrent.length || absentSettled.length) {
      throw new Error('Native neutral Statistics scope changed during the turn'
        + ` (current missing: ${absentCurrent.slice(0, 3).join(', ') || 'none'}`
        + `; settled missing: ${absentSettled.slice(0, 3).join(', ') || 'none'})`);
    }
    const updatedFlows = new Map((changed.migrationFlows || []).map((entry) => [entry.id, entry]));
    return {
      ...current,
      countryStats: { ...current.countryStats, ...changed.countryStats },
      countryStatsHistory: { ...current.countryStatsHistory, ...changed.countryStatsHistory },
      ...(updatedFlows.size ? { migrationFlows: (current.migrationFlows || []).map((flow) => updatedFlows.get(flow.id) || flow) } : {}),
    };
  };
  const act = (method, world, ...rest) => merge(world, boundary[method](subset(world), ...rest));
  return {
    partial: true,
    scopedCountries: allowed,
    beforeEvent: (world, index, event) => act('beforeEvent', world, index, event),
    afterEvents: (world, count) => act('afterEvents', world, count),
  };
};
