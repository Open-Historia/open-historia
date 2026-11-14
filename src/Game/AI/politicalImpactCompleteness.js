import { getPoliticalProfile, isParliamentarySystem } from "../../runtime/politicalActors.js";
import { applyPoliticalActorOperation } from "../../runtime/politicalActorOps.js";
import { scriptedImpactsOf } from "./scriptedEventImpacts.js";

// Whether a timeline event that changes a polity's government, leader, parties,
// coalition or system carries the Political World ops that make the change.
// What an event changes is read from structure only: the answer's
// politicalClaims ledger, the event's own politicalActorOps, and a scripted
// beat's authored impacts. The event's words are never read. They were, by
// English regexes for elections, cabinets, coups and renames, which misfired on
// ordinary English ("a new rail link inaugurated") and never fired in any other
// language, so the same world played differently by language.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);

const politicalOps = (event) => list(event?.impacts?.politicalActorOps)
  .filter((entry) => entry && typeof entry === "object");
const polityChanges = (event) => list(event?.impacts?.polityChanges)
  .filter((entry) => entry && typeof entry === "object");

const parsedArgs = (entry) => {
  if (!entry || typeof entry !== "object") return {};
  if (entry.args && typeof entry.args === "object" && !Array.isArray(entry.args)) return entry.args;
  const raw = String(entry.argsJson ?? "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const politicalOpsForPolity = (event, polityKey) => politicalOps(event).filter((entry) => (
  clean(entry?.polityKey || entry?.polity || entry?.country).toLocaleLowerCase() === clean(polityKey).toLocaleLowerCase()
));

const opPolityKeys = (event) => [...new Set(politicalOps(event)
  .map((entry) => clean(entry?.polityKey || entry?.polity || entry?.country))
  .filter(Boolean))];

const nonEmptyArray = (value) => Array.isArray(value) && value.some((entry) => clean(entry));
const meaningfulObject = (value) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
const meaningfulSystem = (actor) => {
  const system = actor?.politicalSystem;
  if (!meaningfulObject(system)) return false;
  const type = clean(system.type).toLowerCase();
  const representation = clean(system.representation).toLowerCase();
  const regime = clean(system.regimeCharacter).toLowerCase();
  return Boolean(
    (type && type !== "unspecified")
    || (representation && representation !== "none" && representation !== "unspecified")
    || (regime && regime !== "unspecified")
    || clean(system.publicLabel),
  );
};
const meaningfulGovernment = (actor) => {
  const government = actor?.government;
  if (!meaningfulObject(government)) return false;
  return Boolean(
    clean(government.form)
    || clean(government.ideology)
    || clean(government.coalitionName)
    || nonEmptyArray(government.rulingPartyIds)
    || nonEmptyArray(government.coalitionPartyIds)
    || government.headOfState
    || government.headOfGovernment,
  );
};

const governmentHasGoverningForce = (actor) => {
  const government = actor?.government;
  if (!meaningfulObject(government)) return false;
  // Stable ids are the canonical membership authority. A presentation-only
  // coalitionName or an unresolved legacy display-name array must not let a
  // government masquerade as having a canonical governing force.
  return Boolean(
    nonEmptyArray(government.rulingPartyIds)
    || nonEmptyArray(government.coalitionPartyIds)
  );
};

// A party system whose government answers to a parliament: parties, and a
// parliamentary system type (politicalActors.js isParliamentarySystem, an enum).
// It was the word "parliament" in the type, the label or government.form.
const actorHasParliamentaryPartySystem = (actor) => Boolean(
  actor && list(actor.parties).length && isParliamentarySystem(actor.politicalSystem),
);

const operationEstablishesGoverningForce = (entry) => {
  const op = clean(entry?.op).toLowerCase();
  const args = parsedArgs(entry);
  if (op === "form-coalition") {
    return nonEmptyArray(args?.rulingPartyIds || args?.rulingParties)
      || nonEmptyArray(args?.coalitionPartyIds || args?.coalitionParties);
  }
  if (op === "set-government") {
    const patch = args?.patch;
    return nonEmptyArray(patch?.rulingPartyIds || patch?.rulingParties)
      || nonEmptyArray(patch?.coalitionPartyIds || patch?.coalitionParties)
      || Boolean(clean(patch?.rulingParty));
  }
  return false;
};

const eventEstablishesGoverningForce = (event, polityKey = "") => {
  const entries = polityKey ? politicalOpsForPolity(event, polityKey) : politicalOps(event);
  return entries.some(operationEstablishesGoverningForce);
};
const politicalActorMaturityGaps = (actor) => {
  if (!actor) return ["political system", "government", "representation entities", "strategy", "traits"];
  const gaps = [];
  if (!meaningfulSystem(actor)) gaps.push("political system");
  if (!meaningfulGovernment(actor)) gaps.push("government");
  if (!list(actor.parties).length && !list(actor.powerBlocs).length) gaps.push("representation entities");
  if (!nonEmptyArray(actor.goals) || !nonEmptyArray(actor.fears) || !nonEmptyArray(actor.ambitions)) gaps.push("strategy");
  if (!meaningfulObject(actor.traits)) gaps.push("traits");
  return gaps;
};

export const isSparsePoliticalActor = (actor) => politicalActorMaturityGaps(actor).length >= 3;

export const POLITICAL_CLAIM_EFFECTS = Object.freeze([
  "election",
  "government",
  "coalition",
  "leadership",
  "system",
  "parties",
]);

const POLITICAL_CLAIM_EFFECT_SET = new Set(POLITICAL_CLAIM_EFFECTS);
const POLITICAL_CLAIM_ROWS = Symbol("openhistoria.politicalClaimRows");
const SCRIPTED_CLAIM_ROWS = Symbol("openhistoria.scriptedPoliticalClaimRows");
const hasOwn = (value, key) => Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));

const canonicalClaimPolityKey = (event, polityKey) => {
  const key = clean(polityKey);
  const lower = key.toLocaleLowerCase();
  const sameEventRename = polityChanges(event).find((change) => {
    const operation = clean(change?.operation).toLowerCase();
    const from = clean(change?.code);
    const to = clean(change?.name);
    return ["rename", "update", "restore"].includes(operation)
      && from
      && to
      && from.toLocaleLowerCase() === lower
      && from.toLocaleLowerCase() !== to.toLocaleLowerCase();
  });
  return sameEventRename ? clean(sameEventRename.name) : key;
};

// politicalClaims is transient generation metadata, not canonical state. It is
// intentionally top-level and compact so normal jumps do not repeat another
// nested semantic schema on every event. Event numbers are bound to the actual
// event objects BEFORE chronological sorting; the Map therefore remains correct
// after sorting without persisting claim metadata into timeline events.
//
// mode "structured": the answer gave a ledger (an empty one is a ledger saying
// no event completes a change). mode "unclaimed": it gave none, or one too
// mangled to read; its events are then held to what their own ops and a
// scripted beat's impacts say they change, as every event is.
const readPoliticalClaimContext = (candidate) => {
  const byEvent = new Map();
  if (!hasOwn(candidate, "politicalClaims")) {
    return { mode: "unclaimed", byEvent, error: "", discarded: false };
  }

  const events = list(candidate?.events);
  const raw = String(candidate?.politicalClaims ?? "");
  if (!raw.trim()) return { mode: "structured", byEvent, error: "", discarded: false };

  // Transient claim metadata must never cost a successful time skip another AI
  // request. If the provider mangles this compact ledger, discard it: the
  // answer's canonical operations are still validated on their own below.
  const fail = (message) => ({
    mode: "unclaimed",
    byEvent: new Map(),
    error: "",
    discarded: true,
    discardedReason: `politicalClaims ${message}`,
  });

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > Math.max(64, events.length * 4)) return fail("contains too many records.");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const fields = lines[lineIndex].split("~");
    if (fields.length !== 3) {
      return fail(`line ${lineIndex + 1} must use eventNumber~polity~effectsCSV.`);
    }
    const eventNumberToken = fields[0].trim();
    const eventNumber = /^\d+$/.test(eventNumberToken) ? Number(eventNumberToken) : NaN;
    if (!Number.isSafeInteger(eventNumber) || eventNumber < 1 || eventNumber > events.length) {
      return fail(`line ${lineIndex + 1} references event ${eventNumberToken || "(blank)"}, outside this answer's 1-${events.length} event range.`);
    }
    const rawPolityKey = clean(fields[1]);
    if (!rawPolityKey) return fail(`line ${lineIndex + 1} has no polity.`);
    const event = events[eventNumber - 1];
    // Same-event rename is already explicit canonical evidence. Mirror the same
    // old->new identity handoff used by politicalActorOps so a claim written
    // with the pre-rename key still validates against ops addressed to the new key.
    const polityKey = canonicalClaimPolityKey(event, rawPolityKey);

    const effects = [...new Set(fields[2]
      .split(",")
      .map((entry) => clean(entry).toLowerCase())
      .filter(Boolean))];
    if (!effects.length) return fail(`line ${lineIndex + 1} has no effect.`);
    const unknown = effects.find((effect) => !POLITICAL_CLAIM_EFFECT_SET.has(effect));
    if (unknown) {
      return fail(`line ${lineIndex + 1} uses unknown effect "${unknown}". Allowed: ${POLITICAL_CLAIM_EFFECTS.join(", ")}.`);
    }

    const rows = byEvent.get(event) || [];
    const samePolity = rows.find((row) => row.polityKey.toLocaleLowerCase() === polityKey.toLocaleLowerCase());
    if (samePolity) {
      samePolity.effects = [...new Set([...samePolity.effects, ...effects])];
    } else {
      rows.push({ polityKey, effects });
    }
    byEvent.set(event, rows);
  }

  // Keep a transient symbol binding on the event as well as the Map. Event
  // objects can be shallow-cloned later by native tempo/scripted-event passes;
  // object spread preserves enumerable symbol properties while JSON/save paths
  // ignore them. This keeps the model's pre-sort event number attached to the
  // same logical event without introducing a persistent field.
  for (const [event, rows] of byEvent.entries()) event[POLITICAL_CLAIM_ROWS] = rows;

  return { mode: "structured", byEvent, error: "", discarded: false };
};

// The context each candidate was last prepared with. A check that is handed
// only the candidate (politicalImpactCompletenessIssues on salvage) reads the
// same binding instead of numbering the events again after they were sorted.
// Weak: an entry goes with its candidate.
const PREPARED_CLAIM_CONTEXTS = new WeakMap();

export const preparePoliticalClaimContext = (candidate) => {
  const context = readPoliticalClaimContext(candidate);
  if (candidate && typeof candidate === "object") PREPARED_CLAIM_CONTEXTS.set(candidate, context);
  return context;
};

export const clearPoliticalClaimBindings = (candidate) => {
  if (candidate && typeof candidate === "object") PREPARED_CLAIM_CONTEXTS.delete(candidate);
  for (const event of list(candidate?.events)) {
    if (event && typeof event === "object") {
      delete event[POLITICAL_CLAIM_ROWS];
      delete event[SCRIPTED_CLAIM_ROWS];
    }
  }
};

const declaredPoliticalClaimRows = (claimContext, event) => (
  claimContext?.mode === "structured"
    ? claimContext?.byEvent?.get?.(event)
      || (event && typeof event === "object" ? event[POLITICAL_CLAIM_ROWS] : null)
      || []
    : []
);

const anyOp = (ops, names) => names.some((name) => ops.has(name));

const opNamesForPolity = (event, polityKey) => new Set(
  politicalOpsForPolity(event, polityKey)
    .map((entry) => clean(entry?.op).toLowerCase())
    .filter(Boolean),
);

const partyLandscapeOpNames = [
  "create-party", "update-party", "set-party-support", "set-party-influence", "set-party-leader",
  "create-power-bloc", "update-power-bloc", "set-power-bloc-influence",
];

// A government formed with no party in it (a caretaker, technocratic or
// provisional cabinet) says so in its own op: set-government with
// rulingPartyIds: [] (politicalActorOps.js notes). It was read from the words of
// the patch's form ("caretaker", "technocratic", "interim"), in English only.
const operationEstablishesNonpartyGovernment = (entry) => {
  if (clean(entry?.op).toLowerCase() !== "set-government") return false;
  const patch = parsedArgs(entry)?.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  return Array.isArray(patch.rulingPartyIds) && patch.rulingPartyIds.length === 0;
};

const eventEstablishesNonpartyGovernment = (event, polityKey) => (
  politicalOpsForPolity(event, polityKey).some(operationEstablishesNonpartyGovernment)
);

// Canonical operations are already authoritative state mutations: their broad
// effect families are derived so an omitted claim cannot make an actual mutation
// bypass the domain invariants. This is deliberately one-way: operations can
// prove that state changed; they cannot prove that history changed when both
// claims and ops are missing. The explicit claim ledger exists for that case.
const operationDerivedClaimRows = (event) => opPolityKeys(event).map((polityKey) => {
  const ops = opNamesForPolity(event, polityKey);
  const effects = new Set();
  if (ops.has("set-political-system")) effects.add("system");
  if (ops.has("set-government")) effects.add("government");
  if (ops.has("form-coalition") || ops.has("leave-coalition")) effects.add("coalition");
  if (ops.has("replace-leader") || ops.has("set-party-leader")) effects.add("leadership");
  if (ops.has("create-party") || ops.has("update-party") || ops.has("create-power-bloc") || ops.has("update-power-bloc")) effects.add("parties");
  return { polityKey, effects: [...effects] };
}).filter((row) => row.effects.length);

const mergeClaimRows = (...rowGroups) => {
  const merged = [];
  for (const row of rowGroups.flatMap((rows) => list(rows))) {
    const polityKey = clean(row?.polityKey);
    if (!polityKey) continue;
    const effects = list(row?.effects).map((effect) => clean(effect).toLowerCase()).filter(Boolean);
    if (!effects.length) continue;
    const existing = merged.find((entry) => entry.polityKey.toLocaleLowerCase() === polityKey.toLocaleLowerCase());
    if (existing) existing.effects = [...new Set([...existing.effects, ...effects])];
    else merged.push({ polityKey, effects: [...new Set(effects)] });
  }
  return merged;
};

// What a set of impacts in the shape a scripted beat's author writes them
// (server/scriptedImpacts.js "leader" rows: a polityChanges update) says of a
// polity's politics: a new leader is a change of leadership, a new government a
// change of government.
const authoredPoliticalRows = (impacts) => mergeClaimRows(list(impacts?.polityChanges)
  .filter((change) => change && typeof change === "object" && clean(change.operation).toLowerCase() === "update")
  .map((change) => ({
    polityKey: clean(change.code),
    effects: [
      ...(clean(change?.stats?.leader) ? ["leadership"] : []),
      ...(clean(change?.stats?.government) ? ["government"] : []),
    ],
  })));

// The rows that actually drive completeness for one event: the answer's claims
// for it (when it gave a ledger), the families its own ops belong to, and the
// changes a scripted beat's authored impacts make through it. Exported for the
// bounded Political World repair pass, so it uses the validator's exact scope
// instead of reparsing error prose or inventing a second effect classifier.
export const politicalCompletenessRowsForEvent = (claimContext, event) => mergeClaimRows(
  declaredPoliticalClaimRows(claimContext, event),
  operationDerivedClaimRows(event),
  event && typeof event === "object" ? event[SCRIPTED_CLAIM_ROWS] : null,
);

const structuredPoliticalImpactCompletenessIssue = (event, { world = null, claimRows = [] } = {}) => {
  for (const claim of list(claimRows)) {
    const polityKey = clean(claim?.polityKey);
    const effects = new Set(list(claim?.effects).map((effect) => clean(effect).toLowerCase()).filter(Boolean));
    if (!polityKey || !effects.size) continue;

    const polityEntries = politicalOpsForPolity(event, polityKey);
    const polityOps = opNamesForPolity(event, polityKey);

    if (effects.has("election")) {
      const hasLandscape = anyOp(polityOps, partyLandscapeOpNames);
      const hasGovernmentOutcome = anyOp(polityOps, [
        "set-government", "form-coalition", "leave-coalition", "replace-leader", "set-party-leader",
      ]);
      if (!hasLandscape || !hasGovernmentOutcome) {
        return {
          kind: "election-result",
          expected: ["party/power landscape", "government/coalition/leadership outcome"],
          message: `Political claim for event "${clean(event.title) || "untitled"}" says ${polityKey} completed a national election result, but politicalActorOps for that polity do not canonically establish both the resulting political landscape and who governs. Add party/power support or influence operations AND the matching government/coalition/leadership operations, or remove the election claim if final national results are not established.`,
        };
      }

      const actor = world ? getPoliticalProfile(world, polityKey) : null;
      if (world && isSparsePoliticalActor(actor)) {
        const existingGaps = politicalActorMaturityGaps(actor);
        const missing = [];
        if (existingGaps.includes("political system") && !polityOps.has("set-political-system")) missing.push("set-political-system");
        if (existingGaps.includes("government") && !hasGovernmentOutcome) missing.push("government/coalition/leadership outcome");
        if (existingGaps.includes("representation entities")) {
          const entityCreationCount = polityEntries.filter((entry) => ["create-party", "create-power-bloc"].includes(clean(entry?.op).toLowerCase())).length;
          if (entityCreationCount < 2) missing.push("at least two represented political entities for the new landscape");
          if (!anyOp(polityOps, ["set-party-support", "set-party-influence", "set-power-bloc-influence"])) missing.push("quantitative support/influence");
        }
        if (existingGaps.includes("strategy")) {
          const strategyOps = polityEntries.filter((entry) => clean(entry?.op).toLowerCase() === "set-strategy");
          const completeStrategy = strategyOps.some((entry) => {
            const patch = parsedArgs(entry)?.patch;
            return nonEmptyArray(patch?.goals) && nonEmptyArray(patch?.fears) && nonEmptyArray(patch?.ambitions);
          });
          if (!completeStrategy) missing.push("set-strategy with goals, fears and ambitions");
        }
        if (existingGaps.includes("traits")) {
          const traitOps = polityEntries.filter((entry) => clean(entry?.op).toLowerCase() === "set-traits");
          const establishedTraits = traitOps.reduce((count, entry) => {
            const traits = parsedArgs(entry)?.traits;
            return count + (meaningfulObject(traits) ? Object.keys(traits).length : 0);
          }, 0);
          if (establishedTraits < 2) missing.push("set-traits with at least two justified canonical dimensions");
        }
        if (missing.length) {
          return {
            kind: "emergent-political-hydration",
            expected: missing,
            message: `Foundational election result "${clean(event.title) || "untitled"}" concerns sparse/emergent Political Actor ${polityKey}. Do not leave it structurally second-class after the result. Its current missing families are ${existingGaps.join(", ")}; this event still needs ${missing.join(", ")}. Populate only facts this result and surrounding campaign canon actually establish; if the result is not yet known, remove the election claim and narrate polling/counting instead.`,
          };
        }
      }
    }

    if (effects.has("system") && !anyOp(polityOps, ["set-political-system", "set-government"])) {
      return {
        kind: "constitutional",
        expected: ["set-political-system", "set-government"],
        message: `Political claim for event "${clean(event.title) || "untitled"}" says ${polityKey}'s constitutional/political system changed, but that polity has no matching set-political-system or set-government politicalActorOps.`,
      };
    }

    if (effects.has("government")) {
      const expected = ["set-government", "form-coalition", "leave-coalition", "replace-leader"];
      if (!anyOp(polityOps, expected)) {
        return {
          kind: "government",
          expected,
          message: `Political claim for event "${clean(event.title) || "untitled"}" says ${polityKey} formed or replaced a government, but that polity carries no matching government, coalition or leader politicalActorOps.`,
        };
      }

      // (Whether a government formed with new parties minted duplicates of the
      // record's was judged by English words saying no party was founded; a
      // create-party op is itself the claim that one was, so the check could
      // only ever read prose. Reusing the record's party ids is the prompt's
      // rule, politicalActorOps.js POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE.)
      if (world && !eventEstablishesNonpartyGovernment(event, polityKey)) {
        const actor = getPoliticalProfile(world, polityKey);
        if (actorHasParliamentaryPartySystem(actor)
          && !governmentHasGoverningForce(actor)
          && !eventEstablishesGoverningForce(event, polityKey)) {
          return {
            kind: "government-governing-force",
            expected: ["form-coalition or another canonical governing-party membership write"],
            message: `Political claim for event "${clean(event.title) || "untitled"}" forms a durable government for parliamentary party system ${polityKey}, but canonical government membership is empty before and after the proposed operations. Use form-coalition to establish rulingPartyIds/coalitionPartyIds (it also represents a single-party or minority government); set-government plus replace-leader alone is not a governing force. A legitimate non-party, caretaker or technocratic cabinet gives set-government rulingPartyIds: [] in its patch.`,
          };
        }
      }
    }

    if (effects.has("coalition")) {
      const hasCoalitionWrite = polityEntries.some((entry) => {
        const op = clean(entry?.op).toLowerCase();
        return op === "form-coalition" || op === "leave-coalition" || operationEstablishesGoverningForce(entry);
      });
      if (!hasCoalitionWrite) {
        return {
          kind: "coalition",
          expected: ["form-coalition", "leave-coalition", "canonical governing-membership write"],
          message: `Political claim for event "${clean(event.title) || "untitled"}" says ${polityKey}'s governing coalition membership changed, but no canonical governing-party membership write is present for that polity.`,
        };
      }
    }

    if (effects.has("leadership") && !anyOp(polityOps, ["replace-leader", "set-government", "set-party-leader"])) {
      return {
        kind: "leadership",
        expected: ["replace-leader", "set-government", "set-party-leader"],
        message: `Political claim for event "${clean(event.title) || "untitled"}" says ${polityKey}'s head of state/government or party leadership changed, but that polity carries no matching replace-leader, set-government or set-party-leader politicalActorOps.`,
      };
    }

    if (effects.has("parties") && !anyOp(polityOps, partyLandscapeOpNames)) {
      return {
        kind: "party-landscape",
        expected: partyLandscapeOpNames,
        message: `Political claim for event "${clean(event.title) || "untitled"}" says ${polityKey}'s party/power-bloc landscape changed, but that polity carries no matching party or power-bloc politicalActorOps.`,
      };
    }
  }
  return null;
};

// One event's issue against the rows that drive it (politicalCompletenessRowsForEvent).
export const politicalImpactCompletenessIssue = (event, { world = null, claimRows = [] } = {}) => {
  if (!event || typeof event !== "object") return null;
  return structuredPoliticalImpactCompletenessIssue(event, { world, claimRows });
};

// --- Scripted beats ---------------------------------------------------------
//
// A scenario author's beat changes a polity's politics when its authored
// impacts say so (server/scriptedImpacts.js "leader" rows: a new leader or a new
// government). Those beats are named to the model with what they establish, and
// the event that tells each must carry the matching Political World ops. A beat
// was read for English words ("resigns", "assassinated", "sworn in") instead,
// and one written in another language asked for nothing.

// The beats whose authored impacts change a polity's politics, each with the
// rows its impacts claim.
export const scriptedPoliticalImpactRequirements = (beats) => list(beats)
  .map((beat) => ({ beat, rows: authoredPoliticalRows(scriptedImpactsOf(beat)) }))
  .filter((requirement) => requirement.rows.length);

const EFFECT_OPS = Object.freeze({
  leadership: "replace-leader",
  government: "set-government",
});

const describeAuthoredChange = (beat, row) => {
  const impacts = scriptedImpactsOf(beat);
  const change = list(impacts?.polityChanges).find((entry) => clean(entry?.operation).toLowerCase() === "update" && clean(entry?.code) === row.polityKey);
  const parts = [];
  if (row.effects.includes("leadership")) parts.push(`a new leader (${clean(change?.stats?.leader)})`);
  if (row.effects.includes("government")) parts.push(`a new government (${clean(change?.stats?.government)})`);
  return `the author gives ${row.polityKey} ${parts.join(" and ")}: write the matching ${row.effects.map((effect) => EFFECT_OPS[effect]).filter(Boolean).join(" and ")} politicalActorOps for ${row.polityKey} on that event`;
};

const officeholderName = (value) => {
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return clean(value.name || value.id);
};

// The current Political World of each polity the beats' impacts name, found by
// that exact polity key.
const scriptedPoliticalActorContext = (requirements, world) => {
  const polities = [...new Set(list(requirements).flatMap(({ rows }) => list(rows).map((row) => row.polityKey)))];
  const selected = polities
    .map((polityKey) => [polityKey, world ? getPoliticalProfile(world, polityKey) : null])
    .filter(([, actor]) => actor)
    .slice(0, 6);
  if (!selected.length) {
    return "No Political Actor is recorded yet for these polities. Use the live canonical context/lookups; do not guess stable party/bloc ids or historical officeholders.";
  }

  const lines = [
    "Current canonical Political World of the polities these scripted beats change:",
    "These are the state to simulate FROM. A scripted shock does not freeze the historical downstream settlement. Reuse exact ids and current officeholders where referenced.",
  ];
  for (const [polityKey, actor] of selected) {
    const government = actor?.government && typeof actor.government === "object" ? actor.government : {};
    const system = actor?.politicalSystem && typeof actor.politicalSystem === "object" ? actor.politicalSystem : {};
    lines.push(`POLITY: ${polityKey}`);
    lines.push(`Political system: ${JSON.stringify({ type: system.type || "", representation: system.representation || "", regimeCharacter: system.regimeCharacter || "", publicLabel: system.publicLabel || "" })}`);
    lines.push(`Current offices: leader=${JSON.stringify(officeholderName(actor?.leader))}; headOfState=${JSON.stringify(officeholderName(government.headOfState))}; headOfGovernment=${JSON.stringify(officeholderName(government.headOfGovernment))}`);
    lines.push(`Government party ids: ruling=${JSON.stringify(list(government.rulingPartyIds))}; coalition=${JSON.stringify(list(government.coalitionPartyIds))}; coalitionName=${JSON.stringify(clean(government.coalitionName))}`);
    const parties = list(actor?.parties).slice(0, 12);
    if (parties.length) {
      lines.push("Canonical parties:");
      for (const party of parties) {
        lines.push(`- id=${JSON.stringify(clean(party?.id))} name=${JSON.stringify(clean(party?.name))} leader=${JSON.stringify(officeholderName(party?.leader))}`);
      }
    }
    const blocs = list(actor?.powerBlocs).slice(0, 8);
    if (blocs.length) {
      lines.push("Canonical power blocs:");
      for (const bloc of blocs) lines.push(`- id=${JSON.stringify(clean(bloc?.id))} name=${JSON.stringify(clean(bloc?.name))}`);
    }
  }
  return lines.join("\n").slice(0, 6000);
};

export const buildScriptedPoliticalImpactInstruction = (requirements, { world = null } = {}) => {
  const rows = list(requirements);
  if (!rows.length) return "";
  return "[Canonical political requirements for scripted events]\n"
    + "The scenario-authored beat fixes the shock/outcome explicitly written by the author. Political World still owns the resulting government, leader, party, coalition and political-system state. "
    + "SIMULATE the immediate political consequences from the CURRENT campaign canon and return the matching politicalActorOps on THAT event. This includes constitutional succession, acting leadership, government/coalition consequences or other structural follow-through when the beat logically establishes them. "
    + "Do not hardcode the real-history successor or settlement when campaign canon has diverged, and do not rewrite the beat to avoid its authored structural change.\n"
    + rows.map(({ beat, rows: claims }) => `- ${clean(beat?.date) || "(due date)"} — ${clean(beat?.title) || clean(beat?.text) || "scripted event"}: ${claims.map((row) => describeAuthoredChange(beat, row)).join("; ")}.`).join("\n")
    + `\n${scriptedPoliticalActorContext(rows, world)}`
    + "\nUse the normal politicalActorOps contract and exact native argsJson shapes. If the current canon supports a successor or settlement, encode it rather than merely narrating it. If canon genuinely leaves the consequence unresolved, represent only what is established; never invent a silent state change. A completed structural claim without valid matching operations must remain invalid for the normal corrective path.";
};

// Binds to each event that tells a fired beat (scriptedEventImpacts.js
// scriptedEventsCarryingImpacts) the claims its authored impacts make: the
// beats' authored changes the event's impacts carry. Bound as a transient symbol,
// like the answer's own claims, so it rides the shallow copies the engine makes
// and never reaches a save.
export const bindScriptedPoliticalClaims = (events, requirements) => {
  const authored = mergeClaimRows(...list(requirements).map((requirement) => requirement?.rows));
  if (!authored.length) return 0;
  let bound = 0;
  for (const event of list(events)) {
    if (!event || typeof event !== "object") continue;
    const rows = authoredPoliticalRows(event.impacts)
      .map((row) => {
        const claim = authored.find((entry) => entry.polityKey === row.polityKey);
        return claim ? { polityKey: row.polityKey, effects: row.effects.filter((effect) => claim.effects.includes(effect)) } : null;
      })
      .filter((row) => row && row.effects.length);
    if (!rows.length) continue;
    event[SCRIPTED_CLAIM_ROWS] = rows;
    bound += 1;
  }
  return bound;
};

const cloneWorld = (world) => {
  if (!world || typeof world !== "object") return null;
  if (typeof structuredClone === "function") return structuredClone(world);
  return JSON.parse(JSON.stringify(world));
};

const worldAfterPoliticalOps = (world, event) => {
  if (!world) return null;
  // Nothing to apply: a scratch world is never written in place, so it is its
  // own successor and the whole-world copy is saved for the events that need it.
  if (!politicalOps(event).length) return world;
  const next = cloneWorld(world);
  for (const entry of politicalOps(event)) {
    const outcome = applyPoliticalActorOperation(next, {
      ...parsedArgs(entry),
      op: clean(entry?.op),
      polityKey: clean(entry?.polityKey || entry?.polity || entry?.country),
    });
    // Shape/reference validity belongs to the caller's native op validator. For
    // completeness-only callers, an invalid op must not advance the scratch world
    // and accidentally excuse a later event.
    if (!outcome?.applied) return world;
  }
  return next;
};

// One walk over a candidate's events, in order, behind every entry point
// below: the claim ledger read once, and the scratch world carried forward from
// event to event. A caller that bound the candidate's claims itself hands that
// context in. Without one, the context the candidate was last prepared with is
// used (its event numbers stop meaning anything once the events are sorted),
// and only a candidate never prepared is read here.
const politicalImpactCompletenessFailures = (candidate, { world = null, claimContext = null } = {}, { firstOnly = false } = {}) => {
  const claims = claimContext || PREPARED_CLAIM_CONTEXTS.get(candidate) || preparePoliticalClaimContext(candidate);
  if (claims?.error) {
    return [{
      event: null,
      eventIndex: -1,
      claimRows: [],
      issue: { kind: "claim-ledger", expected: [], message: claims.error },
    }];
  }

  const failures = [];
  let validationWorld = cloneWorld(world);
  const events = list(candidate?.events);
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    const claimRows = politicalCompletenessRowsForEvent(claims, event);
    const issue = politicalImpactCompletenessIssue(event, { world: validationWorld, claimRows });
    if (issue) {
      failures.push({ event, eventIndex, claimRows, issue });
      if (firstOnly) break;
    }
    // An offending event is kept as written on salvage, so the operations it
    // does carry still reach the world the later events are checked against.
    validationWorld = worldAfterPoliticalOps(validationWorld, event);
  }
  return failures;
};

// The first offending event, with the claim rows it was checked against: what
// a strict attempt is told and what the bounded claim repair works from.
export const politicalImpactCompletenessFailure = (candidate, options = {}) => (
  politicalImpactCompletenessFailures(candidate, options, { firstOnly: true })[0] || null
);

// Every event's issue, with its index: a strict attempt is told the first,
// and salvage keeps every offending event and notes each one in the receipt.
export const politicalImpactCompletenessIssues = (candidate, options = {}) => (
  politicalImpactCompletenessFailures(candidate, options)
    .map(({ event, eventIndex, issue }) => ({ ...issue, index: eventIndex, id: clean(event?.id), title: clean(event?.title) }))
);

export const validatePoliticalImpactCompleteness = (candidate, options = {}) => (
  politicalImpactCompletenessFailure(candidate, options)?.issue?.message || ""
);
