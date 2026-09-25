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
import { validatePoliticalTraitPatch } from "./politicalTraitRegistry.js";

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

// Provider-facing examples are generated from this one registry instead of being
// re-invented independently in the GM and turn prompts. These are decoded
// argsJson objects - the provider still serializes each object into argsJson.
// Keep examples state-independent so every one can be shape-validated without a
// live world; state-dependent identity checks still happen during application.
export const POLITICAL_ACTOR_GENERATED_OP_EXAMPLES = Object.freeze({
  [POLITICAL_ACTOR_OPS.CREATE_PARTY]: Object.freeze({
    party: Object.freeze({ id: "stable-party-id", name: "Party Name", ideology: "Political ideology" }),
  }),
  [POLITICAL_ACTOR_OPS.UPDATE_PARTY]: Object.freeze({
    partyId: "stable-party-id",
    patch: Object.freeze({ ideology: "Updated ideology", publicDescription: "Public description" }),
  }),
  [POLITICAL_ACTOR_OPS.SET_PARTY_SUPPORT]: Object.freeze({ partyId: "stable-party-id", percent: 42 }),
  [POLITICAL_ACTOR_OPS.SET_PARTY_INFLUENCE]: Object.freeze({ partyId: "stable-party-id", percent: 42 }),
  [POLITICAL_ACTOR_OPS.SET_PARTY_LEADER]: Object.freeze({
    partyId: "stable-party-id", leader: Object.freeze({ name: "Party Leader" }),
  }),
  [POLITICAL_ACTOR_OPS.CREATE_POWER_BLOC]: Object.freeze({
    bloc: Object.freeze({ id: "stable-bloc-id", name: "Power Bloc", kind: "court", ideology: "Political outlook" }),
  }),
  [POLITICAL_ACTOR_OPS.UPDATE_POWER_BLOC]: Object.freeze({
    blocId: "stable-bloc-id",
    patch: Object.freeze({ ideology: "Updated outlook", publicDescription: "Public description" }),
  }),
  [POLITICAL_ACTOR_OPS.SET_POWER_BLOC_INFLUENCE]: Object.freeze({
    blocId: "stable-bloc-id", percent: 40, label: "strong",
  }),
  [POLITICAL_ACTOR_OPS.SET_POLITICAL_SYSTEM]: Object.freeze({
    patch: Object.freeze({
      type: "parliamentary_republic", representation: "electoral", regimeCharacter: "democratic", publicLabel: "Parliamentary Republic",
    }),
  }),
  [POLITICAL_ACTOR_OPS.SET_GOVERNMENT]: Object.freeze({
    patch: Object.freeze({ form: "Parliamentary Republic", ideology: "social liberalism" }),
  }),
  [POLITICAL_ACTOR_OPS.FORM_COALITION]: Object.freeze({
    rulingPartyIds: Object.freeze(["stable-party-id"]),
    coalitionPartyIds: Object.freeze(["coalition-party-id"]),
    coalitionName: "Governing Coalition",
  }),
  [POLITICAL_ACTOR_OPS.LEAVE_COALITION]: Object.freeze({ partyId: "stable-party-id" }),
  [POLITICAL_ACTOR_OPS.REPLACE_LEADER]: Object.freeze({
    office: "headOfGovernment", leader: Object.freeze({ name: "Officeholder" }),
  }),
  [POLITICAL_ACTOR_OPS.SET_STRATEGY]: Object.freeze({
    patch: Object.freeze({
      goals: Object.freeze(["Goal"]), fears: Object.freeze(["Fear"]), ambitions: Object.freeze(["Ambition"]), domesticPressures: Object.freeze(["Domestic pressure"]),
    }),
  }),
  [POLITICAL_ACTOR_OPS.SET_TRAITS]: Object.freeze({
    traits: Object.freeze({ pragmatism: 70, caution: 55 }),
  }),
  [POLITICAL_ACTOR_OPS.SET_PERCEPTIONS]: Object.freeze({
    perceptions: Object.freeze({
      "Other Polity": Object.freeze({ threat: 70, opportunity: 30, weakness: 40, cohesionEstimate: 65 }),
    }),
  }),
  [POLITICAL_ACTOR_OPS.REMOVE_PERCEPTION]: Object.freeze({ target: "Other Polity" }),
});

const GENERATED_OP_NOTES = Object.freeze({
  [POLITICAL_ACTOR_OPS.CREATE_PARTY]: "party fields MUST be nested under party; do not put name/id/ideology at argsJson root",
  [POLITICAL_ACTOR_OPS.CREATE_POWER_BLOC]: "power-bloc fields MUST be nested under bloc (or powerBloc)",
  [POLITICAL_ACTOR_OPS.SET_PARTY_SUPPORT]: "use for electoral/popular support; percent is 0-100",
  [POLITICAL_ACTOR_OPS.SET_PARTY_INFLUENCE]: "use for non-electoral or party-state influence; percent is 0-100",
  [POLITICAL_ACTOR_OPS.SET_POWER_BLOC_INFLUENCE]: "percent is 0-100; label is optional",
  [POLITICAL_ACTOR_OPS.SET_GOVERNMENT]: "government fields belong inside patch; this does NOT establish governing party membership - use form-coalition for that",
  [POLITICAL_ACTOR_OPS.FORM_COALITION]: "use to establish governing party membership even for a single-party or minority government; REUSE exact existing canonical party ids when parties already exist; rulingPartyIds may contain one party and coalitionPartyIds may be empty",
  [POLITICAL_ACTOR_OPS.SET_TRAITS]: "trait keys must come from the canonical trait registry and values are 0-100",
  [POLITICAL_ACTOR_OPS.SET_PERCEPTIONS]: "perceptions are subjective beliefs keyed by target polity; common bounded metrics include threat, opportunity, weakness and cohesionEstimate",
});

export const POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE = [
  "Inside argsJson, encode EXACTLY one JSON object using the native shape for the chosen op:",
  ...Object.entries(POLITICAL_ACTOR_GENERATED_OP_EXAMPLES).map(([op, args]) => {
    const note = GENERATED_OP_NOTES[op] ? ` - ${GENERATED_OP_NOTES[op]}` : "";
    return `- ${op} argsJson=${JSON.stringify(args)}${note}`;
  }),
  "Dependency order inside one event: create-party/create-power-bloc first; then update/support/influence/party-leader; then form-coalition/set-government/replace-leader; then strategy/traits/perceptions. When a later op references an entity created earlier in the same event, use that create op's exact stable id.",
  "Government formation in a parliamentary party system must identify the governing force canonically. Use form-coalition to set rulingPartyIds/coalitionPartyIds; set-government plus replace-leader alone does not say which party or parties govern.",
  "When a polity already has canonical parties, government formation MUST reuse their exact existing ids. Do not create replacement/near-duplicate parties merely to populate form-coalition. create-party is only for an event that actually establishes a genuinely new party, split, merger or reorganization.",
].join("\n");

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

const objectPatch = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

// Provider-facing politicalActorOps deliberately use a compact argsJson envelope.
// Validate the decoded native operation BEFORE it reaches canonical state so a GM
// preview or generated event can never claim to be valid while carrying a native
// no-op such as {government:"Parliamentary Democracy"} instead of
// {patch:{form:"Parliamentary Democracy"}}. State-dependent references (party ids,
// power-bloc ids) are still checked by applyPoliticalActorOperation itself.
export const validatePoliticalActorOperationShape = (operation, { allowNativeDerived = true } = {}) => {
  const op = clean(operation?.op);
  const polityKey = clean(operation?.polityKey || operation?.polity || operation?.country);
  if (!op) return "Political Actor operation is missing op.";
  if (!polityKey) return "Political Actor operation is missing polityKey.";

  const knownOps = new Set(Object.values(POLITICAL_ACTOR_OPS));
  if (!knownOps.has(op)) return `Unsupported Political Actor operation: ${op}.`;
  if (!allowNativeDerived && [
    POLITICAL_ACTOR_OPS.SET_POLITICAL_PRESSURES,
    POLITICAL_ACTOR_OPS.SET_BEHAVIORAL_DISPOSITION,
  ].includes(op)) {
    return `${op} is native-derived and may not be written by generated events or Game Master output.`;
  }

  if (op === POLITICAL_ACTOR_OPS.CREATE_PARTY) {
    if (!normalizePoliticalParty(operation.party)) return "create-party requires a party with a name or id.";
  } else if (op === POLITICAL_ACTOR_OPS.UPDATE_PARTY) {
    if (!clean(operation.partyId || operation.party)) return "update-party requires partyId/party.";
    const patch = objectPatch(operation.patch);
    if (!patch || !Object.keys(patch).length) return "update-party requires a non-empty patch object.";
  } else if (op === POLITICAL_ACTOR_OPS.SET_PARTY_SUPPORT || op === POLITICAL_ACTOR_OPS.SET_PARTY_INFLUENCE) {
    if (!clean(operation.partyId || operation.party)) return `${op} requires partyId/party.`;
    if (clampPercent(operation.percent) == null) return `${op} requires a numeric percent.`;
  } else if (op === POLITICAL_ACTOR_OPS.SET_PARTY_LEADER) {
    if (!clean(operation.partyId || operation.party)) return "set-party-leader requires partyId/party.";
    const leader = operation.leader;
    if (!(typeof leader === "string" || objectPatch(leader))) return "set-party-leader requires a leader name/object.";
  } else if (op === POLITICAL_ACTOR_OPS.CREATE_POWER_BLOC) {
    if (!normalizePoliticalPowerBloc(operation.bloc || operation.powerBloc)) return "create-power-bloc requires a power bloc with a name or id.";
  } else if (op === POLITICAL_ACTOR_OPS.UPDATE_POWER_BLOC) {
    if (!clean(operation.blocId || operation.powerBlocId || operation.bloc || operation.powerBloc)) return "update-power-bloc requires a bloc id/name.";
    const patch = objectPatch(operation.patch);
    if (!patch || !Object.keys(patch).length) return "update-power-bloc requires a non-empty patch object.";
  } else if (op === POLITICAL_ACTOR_OPS.SET_POWER_BLOC_INFLUENCE) {
    if (!clean(operation.blocId || operation.powerBlocId || operation.bloc || operation.powerBloc)) return "set-power-bloc-influence requires a bloc id/name.";
    if (!hasOwn(operation, "percent") && !hasOwn(operation, "label")) return "set-power-bloc-influence requires percent and/or label.";
    if (hasOwn(operation, "percent") && clampPercent(operation.percent) == null) return "set-power-bloc-influence percent must be numeric.";
  } else if (op === POLITICAL_ACTOR_OPS.SET_POLITICAL_PRESSURES) {
    if (!objectPatch(operation.state || operation.pressures)) return "set-political-pressures requires a state/pressures object.";
  } else if (op === POLITICAL_ACTOR_OPS.SET_BEHAVIORAL_DISPOSITION) {
    if (!objectPatch(operation.state || operation.disposition)) return "set-behavioral-disposition requires a state/disposition object.";
  } else if (op === POLITICAL_ACTOR_OPS.SET_POLITICAL_SYSTEM) {
    const patch = objectPatch(operation.patch) || objectPatch(operation.system);
    if (!patch || !Object.keys(patch).length) return "set-political-system requires a non-empty patch/system object.";
  } else if (op === POLITICAL_ACTOR_OPS.SET_GOVERNMENT) {
    const patch = objectPatch(operation.patch);
    if (!patch || !Object.keys(patch).length) return "set-government requires a non-empty patch object.";
  } else if (op === POLITICAL_ACTOR_OPS.FORM_COALITION) {
    const ruling = asArray(operation.rulingPartyIds || operation.rulingParties);
    const coalition = asArray(operation.coalitionPartyIds || operation.coalitionParties);
    if (!ruling.length && !coalition.length) return "form-coalition requires at least one governing party.";
  } else if (op === POLITICAL_ACTOR_OPS.LEAVE_COALITION) {
    if (!clean(operation.partyId || operation.party)) return "leave-coalition requires partyId/party.";
  } else if (op === POLITICAL_ACTOR_OPS.REPLACE_LEADER) {
    const office = clean(operation.office);
    if (office !== "headOfState" && office !== "headOfGovernment") return "replace-leader office must be headOfState or headOfGovernment.";
    const leader = operation.leader;
    if (!(typeof leader === "string" || objectPatch(leader))) return "replace-leader requires a leader name/object.";
  } else if (op === POLITICAL_ACTOR_OPS.SET_STRATEGY) {
    const patch = objectPatch(operation.patch);
    const allowed = ["goals", "fears", "ambitions", "domesticPressures"];
    if (!patch || !allowed.some((field) => hasOwn(patch, field))) return "set-strategy requires a patch containing goals, fears, ambitions and/or domesticPressures.";
    for (const field of allowed) {
      if (hasOwn(patch, field) && !Array.isArray(patch[field])) return `set-strategy patch.${field} must be an array.`;
    }
  } else if (op === POLITICAL_ACTOR_OPS.SET_TRAITS) {
    const validated = validatePoliticalTraitPatch(operation.traits);
    if (validated.error) return `set-traits ${validated.error}`;
    if (!validated.traits || !Object.keys(validated.traits).length) return "set-traits requires at least one canonical trait value.";
  } else if (op === POLITICAL_ACTOR_OPS.SET_PERCEPTIONS) {
    const perceptions = objectPatch(operation.perceptions);
    if (!perceptions || !Object.keys(perceptions).length) return "set-perceptions requires a non-empty perceptions object.";
  } else if (op === POLITICAL_ACTOR_OPS.REMOVE_PERCEPTION) {
    if (!clean(operation.target || operation.perceptionTarget)) return "remove-perception requires target.";
  }

  return "";
};

export const applyPoliticalActorOperation = (world, operation) => {
  const op = clean(operation?.op);
  const polityKey = clean(operation?.polityKey || operation?.polity || operation?.country);
  if (!op) return result({ error: "Political Actor operation is missing op." });
  if (!polityKey) return result({ op, error: "Political Actor operation is missing polityKey." });
  const shapeError = validatePoliticalActorOperationShape({ ...operation, op, polityKey });
  if (shapeError) return result({ op, error: shapeError });

  const context = actorContext(world, polityKey, {
    create: [
      POLITICAL_ACTOR_OPS.CREATE_PARTY,
      POLITICAL_ACTOR_OPS.CREATE_POWER_BLOC,
      POLITICAL_ACTOR_OPS.SET_POLITICAL_SYSTEM,
      POLITICAL_ACTOR_OPS.SET_GOVERNMENT,
      POLITICAL_ACTOR_OPS.REPLACE_LEADER,
      POLITICAL_ACTOR_OPS.SET_STRATEGY,
      POLITICAL_ACTOR_OPS.SET_TRAITS,
      POLITICAL_ACTOR_OPS.SET_PERCEPTIONS,
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
    const validated = validatePoliticalTraitPatch(operation.traits);
    if (validated.error) {
      return result({ op, error: `set-traits ${validated.error}` });
    }
    if (!validated.traits || !Object.keys(validated.traits).length) {
      return result({ op, error: "set-traits requires at least one canonical trait value." });
    }
    actor.traits = {
      ...(actor.traits && typeof actor.traits === "object" ? actor.traits : {}),
      ...cloneValue(validated.traits),
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
