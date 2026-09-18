/*! Open Historia — canonical Political Actor mutation operations */

import {
  ensurePoliticalProfile,
  getPoliticalProfile,
  getPoliticalProfileKey,
  normalizePoliticalActorRecord,
  normalizePoliticalBehavioralDisposition,
  normalizePoliticalActors,
  normalizePoliticalParty,
  normalizePoliticalPowerBloc,
  POLITICAL_ACTORS_SCHEMA_VERSION,
  resolvePoliticalParty,
  resolvePoliticalPowerBloc,
} from "./politicalActors.js";
import { normalizePoliticalPressureState } from "./politicalPressure.js";

export const POLITICAL_ACTOR_OPS = Object.freeze({
  CREATE_PARTY: "create-party",
  UPDATE_PARTY: "update-party",
  SET_PARTY_SUPPORT: "set-party-support",
  SET_PARTY_INFLUENCE: "set-party-influence",
  SET_PARTY_LEADER: "set-party-leader",
  CREATE_POWER_BLOC: "create-power-bloc",
  UPDATE_POWER_BLOC: "update-power-bloc",
  SET_POWER_BLOC_INFLUENCE: "set-power-bloc-influence",
  SET_POLITICAL_PRESSURES: "set-political-pressures",
  SET_BEHAVIORAL_DISPOSITION: "set-behavioral-disposition",
  SET_POLITICAL_SYSTEM: "set-political-system",
  SET_GOVERNMENT: "set-government",
  FORM_COALITION: "form-coalition",
  LEAVE_COALITION: "leave-coalition",
  REPLACE_LEADER: "replace-leader",
  SET_STRATEGY: "set-strategy",
  SET_TRAITS: "set-traits",
  SET_PERCEPTIONS: "set-perceptions",
  REMOVE_PERCEPTION: "remove-perception",
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const cloneValue = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const asArray = (value) => Array.isArray(value) ? value : [];

const clampPercent = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number * 10) / 10));
};

const actorContext = (world, polityKey, { create = false } = {}) => {
  if (!world || typeof world !== "object") return null;
  if (!world.politicalActors || typeof world.politicalActors !== "object") {
    world.politicalActors = normalizePoliticalActors({});
  } else if (Number(world.politicalActors.schemaVersion) !== POLITICAL_ACTORS_SCHEMA_VERSION || !world.politicalActors.byPolity) {
    world.politicalActors = normalizePoliticalActors(world.politicalActors);
  }

  let actor = getPoliticalProfile(world, polityKey);
  if (!actor && create) actor = ensurePoliticalProfile(world, polityKey);
  if (!actor) return null;
  return {
    actor,
    key: getPoliticalProfileKey(world, polityKey) || clean(polityKey),
  };
};

const commitActor = (world, key, actor) => {
  const normalized = normalizePoliticalActorRecord(actor, key);
  world.politicalActors.byPolity[key] = normalized;
  return normalized;
};

const requireParty = (actor, partyToken) => {
  const party = resolvePoliticalParty(actor, partyToken);
  if (!party) return { error: `Unknown party: ${clean(partyToken) || "(blank)"}` };
  return { party };
};

const requirePowerBloc = (actor, blocToken) => {
  const bloc = resolvePoliticalPowerBloc(actor, blocToken);
  if (!bloc) return { error: `Unknown power bloc: ${clean(blocToken) || "(blank)"}` };
  return { bloc };
};

const normalizePartyIdList = (actor, input) => {
  const out = [];
  const seen = new Set();
  for (const token of asArray(input)) {
    const party = resolvePoliticalParty(actor, token);
    if (!party) return { error: `Unknown party: ${clean(token) || "(blank)"}`, ids: [] };
    if (seen.has(party.id)) continue;
    seen.add(party.id);
    out.push(party.id);
  }
  return { ids: out, error: "" };
};

const updateGovernmentMembership = (actor, rulingIds, coalitionIds, { coalitionName } = {}) => {
  const government = {
    ...(actor.government && typeof actor.government === "object" ? actor.government : {}),
    rulingPartyIds: [...rulingIds],
    coalitionPartyIds: [...coalitionIds],
  };
  // Stable ids are the mutation authority. Display-name arrays are re-derived by
  // normalization so an old government name cannot silently keep a departed party.
  delete government.rulingParties;
  delete government.coalition;
  delete government.rulingParty;
  actor.government = government;
  if (coalitionName !== undefined) {
    const text = clean(coalitionName);
    if (text) actor.government.coalitionName = text;
    else delete actor.government.coalitionName;
  }
  return actor;
};

const result = ({ applied = false, op = "", actor = null, error = "", detail = "" } = {}) => ({
  applied,
  op,
  ...(actor ? { actor } : {}),
  ...(error ? { error } : {}),
  ...(detail ? { detail } : {}),
});

export const applyPoliticalActorOperation = (world, operation) => {
  const op = clean(operation?.op);
  const polityKey = clean(operation?.polityKey || operation?.polity || operation?.country);
  if (!op) return result({ error: "Political Actor operation is missing op." });
  if (!polityKey) return result({ op, error: "Political Actor operation is missing polityKey." });

  const context = actorContext(world, polityKey, {
    create: [
      POLITICAL_ACTOR_OPS.CREATE_PARTY,
      POLITICAL_ACTOR_OPS.CREATE_POWER_BLOC,
      POLITICAL_ACTOR_OPS.SET_POLITICAL_SYSTEM,
      POLITICAL_ACTOR_OPS.SET_GOVERNMENT,
    ].includes(op),
  });
  if (!context) return result({ op, error: `No Political Actor exists for ${polityKey}.` });

  const { key } = context;
  const actor = cloneValue(context.actor);

  if (op === POLITICAL_ACTOR_OPS.CREATE_PARTY) {
    const party = normalizePoliticalParty(operation.party);
    if (!party) return result({ op, error: "create-party requires a party with a name or id." });
    if (resolvePoliticalParty(actor, party.id) || resolvePoliticalParty(actor, party.name)) {
      return result({ op, error: `Party already exists: ${party.name}.` });
    }
    actor.parties = [...asArray(actor.parties), party];
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.UPDATE_PARTY) {
    const found = requireParty(actor, operation.partyId || operation.party);
    if (found.error) return result({ op, error: found.error });
    const existing = found.party;
    const patch = operation.patch && typeof operation.patch === "object" && !Array.isArray(operation.patch)
      ? cloneValue(operation.patch)
      : {};
    delete patch.id;

    if (clean(patch.name) && clean(patch.name) !== clean(existing.name)) {
      patch.aliases = [
        ...asArray(existing.aliases),
        existing.name,
        ...asArray(patch.aliases),
      ];
    } else if (Array.isArray(patch.aliases)) {
      patch.aliases = [...asArray(existing.aliases), ...patch.aliases];
    }

    const nextParty = normalizePoliticalParty({ ...existing, ...patch, id: existing.id });
    actor.parties = asArray(actor.parties).map((party) => party.id === existing.id ? nextParty : party);
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.SET_PARTY_SUPPORT) {
    const found = requireParty(actor, operation.partyId || operation.party);
    if (found.error) return result({ op, error: found.error });
    const percent = clampPercent(operation.percent);
    if (percent == null) return result({ op, error: "set-party-support requires a numeric percent." });
    found.party.support = { percent, basis: "campaign-derived" };
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.SET_PARTY_INFLUENCE) {
    const found = requireParty(actor, operation.partyId || operation.party);
    if (found.error) return result({ op, error: found.error });
    const percent = clampPercent(operation.percent);
    if (percent == null) return result({ op, error: "set-party-influence requires a numeric percent." });
    found.party.influence = {
      ...(found.party.influence && typeof found.party.influence === "object" ? found.party.influence : {}),
      percent,
      basis: "campaign-derived",
    };
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.SET_PARTY_LEADER) {
    const found = requireParty(actor, operation.partyId || operation.party);
    if (found.error) return result({ op, error: found.error });
    const leader = operation.leader;
    if (!(typeof leader === "string" || (leader && typeof leader === "object" && !Array.isArray(leader)))) {
      return result({ op, error: "set-party-leader requires a leader name/object." });
    }
    found.party.leader = cloneValue(leader);
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.CREATE_POWER_BLOC) {
    const bloc = normalizePoliticalPowerBloc(operation.bloc || operation.powerBloc);
    if (!bloc) return result({ op, error: "create-power-bloc requires a power bloc with a name or id." });
    if (resolvePoliticalPowerBloc(actor, bloc.id) || resolvePoliticalPowerBloc(actor, bloc.name)) {
      return result({ op, error: `Power bloc already exists: ${bloc.name}.` });
    }
    actor.powerBlocs = [...asArray(actor.powerBlocs), bloc];
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.UPDATE_POWER_BLOC) {
    const found = requirePowerBloc(actor, operation.blocId || operation.powerBlocId || operation.bloc || operation.powerBloc);
    if (found.error) return result({ op, error: found.error });
    const existing = found.bloc;
    const patch = operation.patch && typeof operation.patch === "object" && !Array.isArray(operation.patch)
      ? cloneValue(operation.patch)
      : {};
    delete patch.id;

    if (clean(patch.name) && clean(patch.name) !== clean(existing.name)) {
      patch.aliases = [
        ...asArray(existing.aliases),
        existing.name,
        ...asArray(patch.aliases),
      ];
    } else if (Array.isArray(patch.aliases)) {
      patch.aliases = [...asArray(existing.aliases), ...patch.aliases];
    }

    const nextBloc = normalizePoliticalPowerBloc({ ...existing, ...patch, id: existing.id });
    actor.powerBlocs = asArray(actor.powerBlocs).map((bloc) => bloc.id === existing.id ? nextBloc : bloc);
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.SET_POWER_BLOC_INFLUENCE) {
    const found = requirePowerBloc(actor, operation.blocId || operation.powerBlocId || operation.bloc || operation.powerBloc);
    if (found.error) return result({ op, error: found.error });

    const hasPercent = Object.prototype.hasOwnProperty.call(operation, "percent");
    const hasLabel = Object.prototype.hasOwnProperty.call(operation, "label");
    if (!hasPercent && !hasLabel) {
      return result({ op, error: "set-power-bloc-influence requires percent and/or label." });
    }

    const influence = {
      ...(found.bloc.influence && typeof found.bloc.influence === "object" ? found.bloc.influence : {}),
    };
    if (hasPercent) {
      const percent = clampPercent(operation.percent);
      if (percent == null) return result({ op, error: "set-power-bloc-influence percent must be numeric." });
      influence.percent = percent;
      influence.basis = "campaign-derived";
    }
    if (hasLabel) {
      const label = clean(operation.label);
      if (label) influence.label = label;
      else delete influence.label;
    }
    found.bloc.influence = influence;
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.SET_POLITICAL_PRESSURES) {
    const state = normalizePoliticalPressureState(operation.state || operation.pressures);
    if (Object.keys(state.issues).length || state.updatedAt) actor.politicalPressures = state;
    else delete actor.politicalPressures;
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.SET_BEHAVIORAL_DISPOSITION) {
    const state = normalizePoliticalBehavioralDisposition(operation.state ?? operation.disposition);
    if (state) actor.behavioralDisposition = state;
    else delete actor.behavioralDisposition;
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.SET_POLITICAL_SYSTEM) {
    const patch = operation.patch && typeof operation.patch === "object" && !Array.isArray(operation.patch)
      ? cloneValue(operation.patch)
      : (operation.system && typeof operation.system === "object" && !Array.isArray(operation.system)
        ? cloneValue(operation.system)
        : {});
    if (!Object.keys(patch).length) return result({ op, error: "set-political-system requires a patch/system object." });
    actor.politicalSystem = {
      ...(actor.politicalSystem && typeof actor.politicalSystem === "object" ? actor.politicalSystem : {}),
      ...patch,
    };
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.FORM_COALITION) {
    const ruling = normalizePartyIdList(actor, operation.rulingPartyIds || operation.rulingParties || []);
    if (ruling.error) return result({ op, error: ruling.error });
    const coalition = normalizePartyIdList(actor, operation.coalitionPartyIds || operation.coalitionParties || []);
    if (coalition.error) return result({ op, error: coalition.error });
    if (!ruling.ids.length && !coalition.ids.length) {
      return result({ op, error: "form-coalition requires at least one governing party." });
    }
    const coalitionIds = coalition.ids.filter((id) => !ruling.ids.includes(id));
    updateGovernmentMembership(actor, ruling.ids, coalitionIds, {
      coalitionName: operation.coalitionName,
    });
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.LEAVE_COALITION) {
    const found = requireParty(actor, operation.partyId || operation.party);
    if (found.error) return result({ op, error: found.error });
    const id = found.party.id;
    const government = actor.government && typeof actor.government === "object" ? actor.government : {};
    const rulingIds = asArray(government.rulingPartyIds).filter((partyId) => partyId !== id);
    const coalitionIds = asArray(government.coalitionPartyIds).filter((partyId) => partyId !== id);
    updateGovernmentMembership(actor, rulingIds, coalitionIds);
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.SET_GOVERNMENT) {
    const patch = operation.patch && typeof operation.patch === "object" && !Array.isArray(operation.patch)
      ? cloneValue(operation.patch)
      : {};
    actor.government = {
      ...(actor.government && typeof actor.government === "object" ? actor.government : {}),
      ...patch,
    };

    const hasPartyRefs = [
      "rulingPartyIds",
      "rulingParties",
      "coalitionPartyIds",
      "coalition",
    ].some((field) => field in patch);

    if (hasPartyRefs) {
      const ruling = normalizePartyIdList(actor, patch.rulingPartyIds || patch.rulingParties || []);
      if (ruling.error) return result({ op, error: ruling.error });
      const coalition = normalizePartyIdList(actor, patch.coalitionPartyIds || patch.coalition || []);
      if (coalition.error) return result({ op, error: coalition.error });
      updateGovernmentMembership(
        actor,
        ruling.ids,
        coalition.ids.filter((id) => !ruling.ids.includes(id)),
        { coalitionName: patch.coalitionName },
      );
    }

    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.REPLACE_LEADER) {
    const office = clean(operation.office);
    if (office !== "headOfState" && office !== "headOfGovernment") {
      return result({ op, error: "replace-leader office must be headOfState or headOfGovernment." });
    }
    const leader = operation.leader;
    if (!(typeof leader === "string" || (leader && typeof leader === "object" && !Array.isArray(leader)))) {
      return result({ op, error: "replace-leader requires a leader name/object." });
    }
    actor.government = {
      ...(actor.government && typeof actor.government === "object" ? actor.government : {}),
      [office]: cloneValue(leader),
    };
    if (office === "headOfState") actor.leader = cloneValue(leader);
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.SET_STRATEGY) {
    const patch = operation.patch && typeof operation.patch === "object" && !Array.isArray(operation.patch)
      ? operation.patch
      : {};
    for (const field of ["goals", "fears", "ambitions", "domesticPressures"]) {
      if (field in patch) actor[field] = cloneValue(patch[field]);
    }
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.SET_TRAITS) {
    if (!operation.traits || typeof operation.traits !== "object" || Array.isArray(operation.traits)) {
      return result({ op, error: "set-traits requires a traits object." });
    }
    actor.traits = {
      ...(actor.traits && typeof actor.traits === "object" ? actor.traits : {}),
      ...cloneValue(operation.traits),
    };
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.SET_PERCEPTIONS) {
    if (!operation.perceptions || typeof operation.perceptions !== "object" || Array.isArray(operation.perceptions)) {
      return result({ op, error: "set-perceptions requires a perceptions object." });
    }
    actor.perceptions = {
      ...(actor.perceptions && typeof actor.perceptions === "object" ? actor.perceptions : {}),
      ...cloneValue(operation.perceptions),
    };
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  if (op === POLITICAL_ACTOR_OPS.REMOVE_PERCEPTION) {
    const target = clean(operation.target || operation.perceptionTarget);
    if (!target) return result({ op, error: "remove-perception requires target." });
    const perceptions = {
      ...(actor.perceptions && typeof actor.perceptions === "object" ? actor.perceptions : {}),
    };
    const actualKey = Object.keys(perceptions).find((candidate) => clean(candidate).toLocaleLowerCase() === target.toLocaleLowerCase());
    if (!actualKey) return result({ op, error: `Unknown perception target: ${target}.` });
    delete perceptions[actualKey];
    actor.perceptions = perceptions;
    return result({ applied: true, op, actor: commitActor(world, key, actor) });
  }

  return result({ op, error: `Unsupported Political Actor operation: ${op}.` });
};

export const applyPoliticalActorOperations = (world, operations, { stopOnError = true } = {}) => {
  const results = [];
  for (const operation of asArray(operations)) {
    const entry = applyPoliticalActorOperation(world, operation);
    results.push(entry);
    if (entry.error && stopOnError) break;
  }
  return {
    applied: results.filter((entry) => entry.applied).length,
    failed: results.filter((entry) => entry.error).length,
    results,
  };
};
