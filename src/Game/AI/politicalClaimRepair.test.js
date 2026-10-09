import test from "node:test";
import assert from "node:assert/strict";

import { getPoliticalProfile, normalizePoliticalActors } from "../../runtime/politicalActors.js";
import { politicalImpactCompletenessFailure, preparePoliticalClaimContext, validatePoliticalImpactCompleteness } from "./politicalImpactCompleteness.js";
import {
  applyPoliticalClaimRepairResponse,
  buildPoliticalClaimRepairRequest,
  collectPoliticalClaimRepairTargets,
  politicalClaimRepairHoldError,
  shouldPreventDeterministicFallback,
} from "./politicalClaimRepair.js";

const packed = (op, polityKey, args) => ({ op, polityKey, argsJson: JSON.stringify(args) });
const event = (title, description) => ({
  date: "2026-07-06",
  title,
  description,
  impacts: { politicalActorOps: [] },
});

const latviaWorld = () => ({
  politicalActors: normalizePoliticalActors({
    byPolity: {
      Latvia: {
        polityKey: "Latvia",
        politicalSystem: { type: "parliamentary_republic", representation: "electoral", regimeCharacter: "democratic" },
        government: {
          form: "Parliamentary Republic",
          status: "caretaker",
          headOfState: { name: "Edgars Rinkēvičs" },
          rulingPartyIds: [],
          coalitionPartyIds: [],
        },
        parties: [
          { id: "new-unity", name: "New Unity", ideology: "centre-right", support: { percent: 28 } },
          { id: "union-greens-farmers", name: "Union of Greens and Farmers", ideology: "agrarian", support: { percent: 17 } },
          { id: "progressives", name: "The Progressives", ideology: "social democratic", support: { percent: 15 } },
          { id: "national-alliance", name: "National Alliance", ideology: "national conservative", support: { percent: 12 } },
        ],
        goals: ["Maintain democratic stability"],
        fears: ["Coalition collapse"],
        ambitions: ["Strengthen Baltic security"],
        traits: { pragmatism: 74, consensusDriven: 68 },
      },
    },
  }),
});

const repair = ({ candidate, world, payload }) => {
  const claimContext = preparePoliticalClaimContext(candidate);
  const targets = collectPoliticalClaimRepairTargets(candidate, claimContext);
  return {
    claimContext,
    targets,
    outcome: applyPoliticalClaimRepairResponse({ candidate, world, claimContext, targets, payload }),
  };
};

test("bounded repair can canonically complete a democratic coalition/government transition using stable existing party ids", () => {
  const world = latviaWorld();
  const transition = event(
    "Latvia Concludes Caretaker Period with Formal Swearing-In of Permanent Cabinet",
    "Following coalition negotiations, the president swears in a permanent government led by Prime Minister Arvils Ašeradens. The cabinet comprises New Unity, the Union of Greens and Farmers, and The Progressives.",
  );
  const candidate = {
    events: [transition],
    politicalClaims: "1~Latvia~government,coalition,leadership",
  };
  const before = preparePoliticalClaimContext(candidate);
  assert.match(validatePoliticalImpactCompleteness(candidate, { world, claimContext: before }), /no matching government/i);

  const { outcome, claimContext } = repair({
    candidate,
    world,
    payload: {
      eventRepairs: [{
        eventNumber: 1,
        reason: "Complete the permanent coalition already established by the event.",
        politicalActorOps: [
          packed("set-government", "Latvia", { patch: { status: "permanent", form: "Parliamentary Republic" } }),
          // Deliberately use names here. The native repair canonicalizes existing
          // entities to stable ids before attaching the operation to the event.
          packed("form-coalition", "Latvia", {
            rulingPartyIds: ["New Unity"],
            coalitionPartyIds: ["Union of Greens and Farmers", "The Progressives"],
            coalitionName: "Ašeradens Cabinet",
          }),
          packed("replace-leader", "Latvia", { office: "headOfGovernment", leader: { name: "Arvils Ašeradens" } }),
        ],
      }],
      summary: "Permanent Latvian coalition encoded canonically.",
    },
  });

  assert.equal(outcome.applied, true);
  assert.equal(outcome.added, 3);
  assert.equal(validatePoliticalImpactCompleteness(candidate, { world, claimContext }), "");

  const coalition = candidate.events[0].impacts.politicalActorOps.find((entry) => entry.op === "form-coalition");
  assert.deepEqual(JSON.parse(coalition.argsJson), {
    rulingPartyIds: ["new-unity"],
    coalitionPartyIds: ["union-greens-farmers", "progressives"],
    coalitionName: "Ašeradens Cabinet",
  });
});

test("repair AI may choose a plausible democratic coalition from canonical parties when the fixed event leaves composition open", () => {
  const world = latviaWorld();
  const transition = event(
    "Latvia Concludes Caretaker Period with a Permanent Coalition Government",
    "Coalition talks conclude and a permanent parliamentary government is sworn in, ending the caretaker period.",
  );
  const candidate = { events: [transition], politicalClaims: "1~Latvia~government,coalition,leadership" };
  const { outcome, claimContext } = repair({
    candidate,
    world,
    payload: {
      eventRepairs: [{
        eventNumber: 1,
        reason: "Choose a viable coalition from the supplied live Political World and establish its prime minister.",
        politicalActorOps: [
          packed("set-government", "Latvia", { patch: { status: "permanent", form: "Parliamentary Republic" } }),
          packed("form-coalition", "Latvia", {
            rulingPartyIds: ["new-unity"],
            coalitionPartyIds: ["union-greens-farmers", "progressives"],
          }),
          packed("replace-leader", "Latvia", { office: "headOfGovernment", leader: { name: "Arvils Ašeradens" } }),
        ],
      }],
      summary: "The repair AI completed the under-specified governing outcome from canonical actors.",
    },
  });

  assert.equal(outcome.applied, true);
  assert.equal(validatePoliticalImpactCompleteness(candidate, { world, claimContext }), "");
});

test("repair may introduce a newly simulated authoritarian successor when the event establishes that named successor", () => {
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        Russia: {
          polityKey: "Russia",
          politicalSystem: { type: "presidential_republic", representation: "managed", regimeCharacter: "authoritarian" },
          government: {
            form: "Presidential Administration",
            status: "stable",
            headOfState: { name: "Incumbent President" },
          },
          parties: [{ id: "ruling-party", name: "Ruling Party", influence: { percent: 78 } }],
          powerBlocs: [{ id: "security-elite", name: "Security Elite", kind: "security", influence: { percent: 82 } }],
        },
      },
    }),
  };
  const transition = event(
    "Sergei Volkov Takes Office as President After Kremlin Succession",
    "After an elite succession struggle, Sergei Volkov is sworn in as president and a new administration takes office.",
  );
  const candidate = { events: [transition], politicalClaims: "1~Russia~government,leadership" };
  const { outcome, claimContext } = repair({
    candidate,
    world,
    payload: {
      eventRepairs: [{
        eventNumber: 1,
        reason: "The fixed event explicitly establishes the new officeholder.",
        politicalActorOps: [
          packed("set-government", "Russia", { patch: { status: "new administration" } }),
          packed("replace-leader", "Russia", { office: "headOfState", leader: { name: "Sergei Volkov" } }),
        ],
      }],
      summary: "Named successor encoded.",
    },
  });

  assert.equal(outcome.applied, true);
  assert.equal(validatePoliticalImpactCompleteness(candidate, { world, claimContext }), "");
  const replacement = candidate.events[0].impacts.politicalActorOps.find((entry) => entry.op === "replace-leader");
  assert.equal(JSON.parse(replacement.argsJson).leader.name, "Sergei Volkov");
  assert.equal(getPoliticalProfile(world, "Russia")?.government?.headOfState?.name, "Incumbent President", "repair validation never mutates the live world");
});

test("repair AI may choose a previously unnamed authoritarian successor when the fixed event establishes succession but leaves identity open", () => {
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        Russia: {
          polityKey: "Russia",
          politicalSystem: { type: "presidential_republic", representation: "managed", regimeCharacter: "authoritarian" },
          government: { form: "Presidential Administration", headOfState: { name: "Incumbent President" } },
          parties: [{ id: "ruling-party", name: "Ruling Party", influence: { percent: 78 } }],
          powerBlocs: [{ id: "security-elite", name: "Security Elite", kind: "security", influence: { percent: 82 } }],
        },
      },
    }),
  };
  const transition = event(
    "Kremlin Succession Concludes with a New President",
    "An elite succession struggle concludes and a new president is sworn in, beginning a new administration.",
  );
  const candidate = { events: [transition], politicalClaims: "1~Russia~government,leadership" };
  const { outcome, claimContext } = repair({
    candidate,
    world,
    payload: {
      eventRepairs: [{
        eventNumber: 1,
        reason: "The repair AI selects the successor from the supplied regime context; native code only validates and records the choice.",
        politicalActorOps: [
          packed("set-government", "Russia", { patch: { status: "new administration" } }),
          packed("replace-leader", "Russia", { office: "headOfState", leader: { name: "Sergei Volkov" } }),
        ],
      }],
      summary: "Under-specified succession completed by the bounded AI repair.",
    },
  });

  assert.equal(outcome.applied, true);
  assert.equal(validatePoliticalImpactCompleteness(candidate, { world, claimContext }), "");
  const replacement = candidate.events[0].impacts.politicalActorOps.find((entry) => entry.op === "replace-leader");
  assert.equal(JSON.parse(replacement.argsJson).leader.name, "Sergei Volkov");
});

test("ambiguous structural claim with no repair decision remains fail-closed and native code invents no successor", () => {
  const world = latviaWorld();
  const transition = event(
    "Latvia Forms a New Government",
    "Coalition talks conclude and a new permanent government takes office, but the announcement does not identify its composition or prime minister.",
  );
  const candidate = { events: [transition], politicalClaims: "1~Latvia~government,coalition,leadership" };
  const claimContext = preparePoliticalClaimContext(candidate);
  const original = structuredClone(candidate);
  const targets = collectPoliticalClaimRepairTargets(candidate, claimContext);
  const outcome = applyPoliticalClaimRepairResponse({
    candidate,
    world,
    claimContext,
    targets,
    payload: { eventRepairs: [{ eventNumber: 1, politicalActorOps: [], reason: "Insufficient evidence." }], summary: "" },
  });

  assert.equal(outcome.applied, false);
  assert.match(outcome.error, /no new canonical operations|remained incomplete/i);
  assert.deepEqual(candidate.events[0].impacts.politicalActorOps, original.events[0].impacts.politicalActorOps);
  assert.match(validatePoliticalImpactCompleteness(candidate, { world, claimContext }), /no matching government/i);
});

test("repair rejects invented party references instead of minting a government around them", () => {
  const world = latviaWorld();
  const transition = event(
    "Latvia Swears In Permanent Coalition Cabinet",
    "A permanent coalition cabinet takes office after negotiations.",
  );
  const candidate = { events: [transition], politicalClaims: "1~Latvia~government,coalition" };
  const { outcome } = repair({
    candidate,
    world,
    payload: {
      eventRepairs: [{
        eventNumber: 1,
        reason: "Bad repair",
        politicalActorOps: [packed("form-coalition", "Latvia", {
          rulingPartyIds: ["totally-invented-party"],
          coalitionPartyIds: [],
        })],
      }],
      summary: "",
    },
  });

  assert.equal(outcome.applied, false);
  assert.match(outcome.error, /Unknown canonical party reference/i);
  assert.deepEqual(candidate.events[0].impacts.politicalActorOps, []);
});

test("repair cannot mutate an unrelated polity or use operation families outside the declared effects", () => {
  const world = latviaWorld();
  const transition = event("Latvia Swears In Cabinet", "A permanent Latvian cabinet takes office.");
  const candidate = { events: [transition], politicalClaims: "1~Latvia~government" };
  const claimContext = preparePoliticalClaimContext(candidate);
  const targets = collectPoliticalClaimRepairTargets(candidate, claimContext);

  const unrelated = applyPoliticalClaimRepairResponse({
    candidate,
    world,
    claimContext,
    targets,
    payload: {
      eventRepairs: [{ eventNumber: 1, reason: "", politicalActorOps: [packed("set-government", "Estonia", { patch: { status: "new" } })] }],
      summary: "",
    },
  });
  assert.equal(unrelated.applied, false);
  assert.match(unrelated.error, /outside that event's Political World claim/i);

  const strategy = applyPoliticalClaimRepairResponse({
    candidate,
    world,
    claimContext,
    targets,
    payload: {
      eventRepairs: [{ eventNumber: 1, reason: "", politicalActorOps: [packed("set-strategy", "Latvia", { patch: { goals: ["Unrelated"] } })] }],
      summary: "",
    },
  });
  assert.equal(strategy.applied, false);
  assert.match(strategy.error, /outside the event's declared Political World effects/i);
});

test("repair request targets only the event that actually failed Political World completeness", () => {
  const world = latviaWorld();
  const alreadyCanonical = event(
    "Latvia Extends Caretaker Administration",
    "The existing caretaker administration continues under the same governing arrangement.",
  );
  alreadyCanonical.impacts.politicalActorOps = [packed("set-government", "Latvia", { patch: { status: "caretaker", form: "Caretaker Government" } })];
  const missing = event(
    "Latvia Swears In Permanent Cabinet",
    "A permanent coalition cabinet takes office under Prime Minister Arvils Ašeradens.",
  );
  const candidate = {
    events: [alreadyCanonical, missing],
    politicalClaims: "1~Latvia~government\n2~Latvia~government,coalition,leadership",
  };
  const claimContext = preparePoliticalClaimContext(candidate);
  const failure = politicalImpactCompletenessFailure(candidate, { world, claimContext });
  assert.equal(failure?.eventIndex, 1);

  const request = buildPoliticalClaimRepairRequest({
    candidate,
    world,
    claimContext,
    validationError: failure?.issue?.message,
    validationFailure: failure,
  });
  assert.deepEqual(request.targets.map((target) => target.eventNumber), [2]);
  assert.doesNotMatch(request.userMessage, /EVENT 1\n/);
  assert.match(request.userMessage, /EVENT 2\n/);
});

test("repair request carries bounded current Political World evidence and exact stable entity registry", () => {
  const world = latviaWorld();
  const transition = event("Latvia Forms Permanent Cabinet", "A coalition government takes office under a new prime minister.");
  const candidate = { events: [transition], politicalClaims: "1~Latvia~government,coalition,leadership" };
  const claimContext = preparePoliticalClaimContext(candidate);
  const request = buildPoliticalClaimRepairRequest({
    candidate,
    world,
    claimContext,
    validationError: "missing politicalActorOps",
  });

  assert.equal(request.targets.length, 1);
  assert.match(request.systemPrompt, /AI simulation/i);
  assert.match(request.systemPrompt, /stable ids/i);
  assert.match(request.userMessage, /new-unity/);
  assert.match(request.userMessage, /The Progressives/);
  assert.match(request.userMessage, /missing politicalActorOps/);
});

test("unresolved political repair emits a tagged no-canned-fallback error", () => {
  const error = politicalClaimRepairHoldError("claim is still inconsistent");
  assert.equal(error.preventDeterministicFallback, true);
  assert.equal(error.canonicalIntegrity, "political-world");
  assert.equal(shouldPreventDeterministicFallback(error), true);
  assert.equal(shouldPreventDeterministicFallback(new Error("ordinary failure")), false);
  assert.match(error.message, /held instead of advancing on a canned fallback/i);
});

test("one bounded repair request can reconcile multiple remaining structured political events", () => {
  const world = latviaWorld();
  world.politicalActors.byPolity.Russia = normalizePoliticalActors({
    byPolity: {
      Russia: {
        polityKey: "Russia",
        politicalSystem: { type: "presidential_republic", representation: "managed", regimeCharacter: "authoritarian" },
        government: { form: "Presidential Administration", headOfState: { name: "Incumbent President" } },
        parties: [{ id: "ruling-party", name: "Ruling Party", influence: { percent: 78 } }],
        powerBlocs: [{ id: "security-elite", name: "Security Elite", kind: "security", influence: { percent: 82 } }],
      },
    },
  }).byPolity.Russia;

  const latvia = event(
    "Latvia Swears In Permanent Coalition Cabinet",
    "A permanent coalition cabinet takes office under Prime Minister Arvils Ašeradens.",
  );
  const russia = event(
    "Sergei Volkov Takes Office as President",
    "Sergei Volkov is sworn in as president and a new administration takes office.",
  );
  const candidate = {
    events: [latvia, russia],
    politicalClaims: "1~Latvia~government,coalition,leadership\n2~Russia~government,leadership",
  };
  const claimContext = preparePoliticalClaimContext(candidate);
  const failure = politicalImpactCompletenessFailure(candidate, { world, claimContext });
  assert.equal(failure?.eventIndex, 0);

  const request = buildPoliticalClaimRepairRequest({
    candidate,
    world,
    claimContext,
    validationError: failure?.issue?.message,
    validationFailure: failure,
  });
  assert.deepEqual(request.targets.map((target) => target.eventNumber), [1, 2]);

  const outcome = applyPoliticalClaimRepairResponse({
    candidate,
    world,
    claimContext,
    targets: request.targets,
    payload: {
      eventRepairs: [
        {
          eventNumber: 1,
          reason: "Complete the fixed Latvian cabinet outcome.",
          politicalActorOps: [
            packed("set-government", "Latvia", { patch: { status: "permanent", form: "Parliamentary Republic" } }),
            packed("form-coalition", "Latvia", {
              rulingPartyIds: ["New Unity"],
              coalitionPartyIds: ["Union of Greens and Farmers", "The Progressives"],
            }),
            packed("replace-leader", "Latvia", { office: "headOfGovernment", leader: { name: "Arvils Ašeradens" } }),
          ],
        },
        {
          eventNumber: 2,
          reason: "Encode the named successor already established by the fixed event.",
          politicalActorOps: [
            packed("set-government", "Russia", { patch: { status: "new administration" } }),
            packed("replace-leader", "Russia", { office: "headOfState", leader: { name: "Sergei Volkov" } }),
          ],
        },
      ],
      summary: "Both fixed political outcomes reconciled.",
    },
  });

  assert.equal(outcome.applied, true);
  assert.equal(validatePoliticalImpactCompleteness(candidate, { world, claimContext }), "");
});

test("repair transaction preserves legacy/CSE fail-closed completeness on staged event clones", () => {
  const world = latviaWorld();
  const structured = event(
    "Latvia Swears In Permanent Cabinet",
    "A permanent cabinet takes office under Prime Minister Arvils Ašeradens.",
  );
  const authoredLegacy = event(
    "President Swears In Another New Cabinet",
    "The president swears in a new cabinet which assumes office immediately.",
  );
  const candidate = {
    events: [structured, authoredLegacy],
    politicalClaims: "1~Latvia~government,leadership",
  };
  const claimContext = preparePoliticalClaimContext(candidate);
  claimContext.legacyEvents.add(authoredLegacy);
  const targets = collectPoliticalClaimRepairTargets(candidate, claimContext);

  const outcome = applyPoliticalClaimRepairResponse({
    candidate,
    world,
    claimContext,
    targets,
    payload: {
      eventRepairs: [{
        eventNumber: 1,
        reason: "Repair only the structured event.",
        politicalActorOps: [
          packed("set-government", "Latvia", { patch: { status: "permanent" } }),
          packed("form-coalition", "Latvia", { rulingPartyIds: ["New Unity"], coalitionPartyIds: ["The Progressives"] }),
          packed("replace-leader", "Latvia", { office: "headOfGovernment", leader: { name: "Arvils Ašeradens" } }),
        ],
      }],
      summary: "",
    },
  });

  assert.equal(outcome.applied, false);
  assert.match(outcome.error, /remained incomplete.*another new cabinet/i);
  assert.deepEqual(structured.impacts.politicalActorOps, [], "failed staged validation must not partially commit the earlier repair");
});

test("repair cannot overwrite a structural political decision already encoded by the main simulator", () => {
  const world = latviaWorld();
  const transition = event(
    "Latvia Confirms Prime Minister",
    "The permanent government takes office and Prime Minister Arvils Ašeradens is sworn in.",
  );
  transition.impacts.politicalActorOps = [
    packed("set-government", "Latvia", { patch: { status: "permanent", form: "Parliamentary Republic" } }),
  ];
  const candidate = { events: [transition], politicalClaims: "1~Latvia~government,leadership" };
  const claimContext = preparePoliticalClaimContext(candidate);
  const targets = collectPoliticalClaimRepairTargets(candidate, claimContext);
  const original = structuredClone(transition.impacts.politicalActorOps);

  const outcome = applyPoliticalClaimRepairResponse({
    candidate,
    world,
    claimContext,
    targets,
    payload: {
      eventRepairs: [{
        eventNumber: 1,
        reason: "Bad repair attempts to replace an existing government decision.",
        politicalActorOps: [
          packed("set-government", "Latvia", { patch: { status: "different government" } }),
          packed("replace-leader", "Latvia", { office: "headOfGovernment", leader: { name: "Arvils Ašeradens" } }),
        ],
      }],
      summary: "",
    },
  });

  assert.equal(outcome.applied, false);
  assert.match(outcome.error, /overwrite an already-valid set-government decision/i);
  assert.deepEqual(transition.impacts.politicalActorOps, original);
});
