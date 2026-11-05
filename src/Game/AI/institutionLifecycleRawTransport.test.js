import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGameplayPayload, validateGameplayPayload } from "./gameplaySchemas.js";
import { parseInstitutionLifecycleResponsesJson } from "./institutionLifecycleChatActions.js";
import { applyInstitutionLifecycleChatBatchCore, applyInstitutionLifecycleCommandCore } from "../../runtime/institutionLifecycleCore.js";

const LITHUANIA_CASE = "baltic-union-founding-invitation-republic-of-lithuania-2014-08-19";
const ESTONIA_CASE = "baltic-union-founding-invitation-republic-of-estonia-2014-08-19";

test("raw lifecycle chat output from the live Gemini trace normalizes without a retry", () => {
  const raw = {
    dialogue: [
      {
        speaker: "Republic of Lithuania",
        recipient: "Republic of Latvia",
        text: "Vilnius formally confirms its acceptance of full membership in the Baltic Union.",
      },
      {
        speaker: "Republic of Estonia",
        recipient: "Republic of Latvia",
        text: "Tallinn officially accepts membership in the Baltic Union.",
      },
    ],
    lifecycleResponsesJson: [
      {
        actorName: "Republic of Lithuania",
        caseId: LITHUANIA_CASE,
        decision: "accept",
        reason: "The union aligns with Lithuania's Baltic security priorities.",
      },
      {
        actorName: "Republic of Estonia",
        caseId: ESTONIA_CASE,
        decision: "accept",
        reason: "The union reinforces Estonia's Baltic security priorities.",
      },
    ],
  };

  const normalized = normalizeGameplayPayload("chatActions", raw);
  assert.deepEqual(normalized.actions, [
    {
      type: "send_message",
      actorName: "Republic of Lithuania",
      content: "Vilnius formally confirms its acceptance of full membership in the Baltic Union.",
    },
    {
      type: "send_message",
      actorName: "Republic of Estonia",
      content: "Tallinn officially accepts membership in the Baltic Union.",
    },
  ]);
  assert.equal(typeof normalized.lifecycleResponsesJson, "string");
  assert.deepEqual(parseInstitutionLifecycleResponsesJson(normalized.lifecycleResponsesJson).map(({ actorName, caseId, decision }) => ({ actorName, caseId, decision })), [
    { actorName: "Republic of Lithuania", caseId: LITHUANIA_CASE, decision: "accept" },
    { actorName: "Republic of Estonia", caseId: ESTONIA_CASE, decision: "accept" },
  ]);
  assert.equal(validateGameplayPayload("chatActions", normalized).valid, true);
});

test("raw lifecycle transport accepts action aliases and always supplies the required actions array", () => {
  const normalized = normalizeGameplayPayload("chatActions", {
    actions: [{ speaker: "Republic of Estonia", text: "Tallinn accepts." }],
    lifecycleResponses: [{ actorName: "Republic of Estonia", caseId: ESTONIA_CASE, decision: "accept" }],
  });
  assert.deepEqual(normalized.actions, [{ type: "send_message", actorName: "Republic of Estonia", content: "Tallinn accepts." }]);
  assert.equal(JSON.parse(normalized.lifecycleResponsesJson)[0].caseId, ESTONIA_CASE);
  assert.equal(validateGameplayPayload("chatActions", normalized).valid, true);

  const silent = normalizeGameplayPayload("chatActions", { lifecycleResponsesJson: [] });
  assert.deepEqual(silent.actions, []);
  assert.equal(silent.lifecycleResponsesJson, "[]");
  assert.equal(validateGameplayPayload("chatActions", silent).valid, true);
});


test("the exact two-government raw lifecycle turn reaches native authority and resolves both founding cases", () => {
  const founded = applyInstitutionLifecycleCommandCore({
    world: {
      ownerCodes: ["Republic of Latvia", "Republic of Lithuania", "Republic of Estonia"],
      polityOverrides: {
        "Republic of Latvia": { name: "Republic of Latvia" },
        "Republic of Lithuania": { name: "Republic of Lithuania" },
        "Republic of Estonia": { name: "Republic of Estonia" },
      },
    },
    chats: [],
    events: [],
    playerCountry: "Republic of Latvia",
    date: "2014-08-19",
    command: {
      type: "found",
      name: "Baltic Union",
      shortName: "BU",
      kind: "defense_pact",
      minimumFoundingMembers: 3,
      invitees: ["Republic of Lithuania", "Republic of Estonia"],
    },
  });
  const caseByPolity = Object.fromEntries(Object.values(founded.institution.lifecycleCases).map((entry) => [entry.polity, entry.id]));
  const raw = {
    dialogue: [
      { speaker: "Republic of Lithuania", text: "Vilnius accepts." },
      { speaker: "Republic of Estonia", text: "Tallinn accepts." },
    ],
    lifecycleResponsesJson: [
      { actorName: "Republic of Lithuania", caseId: caseByPolity["Republic of Lithuania"], decision: "accept" },
      { actorName: "Republic of Estonia", caseId: caseByPolity["Republic of Estonia"], decision: "accept" },
    ],
  };
  const normalized = normalizeGameplayPayload("chatActions", raw);
  const lifecycleActions = parseInstitutionLifecycleResponsesJson(normalized.lifecycleResponsesJson);
  const committed = applyInstitutionLifecycleChatBatchCore({
    world: founded.world,
    chats: founded.chats,
    events: founded.events,
    playerCountry: "Republic of Latvia",
    date: "2014-08-19",
    institutionId: founded.institution.id,
    lifecycleActions,
  });
  const institution = committed.world.institutions.byId[founded.institution.id];
  assert.equal(committed.applied.length, 2);
  assert.equal(committed.rejected.length, 0);
  assert.equal(institution.status, "active");
  assert.deepEqual(new Set(institution.members.map((entry) => entry.polity)), new Set(["Republic of Latvia", "Republic of Lithuania", "Republic of Estonia"]));
  assert.equal(institution.lifecycleCases[caseByPolity["Republic of Lithuania"]].status, "accepted");
  assert.equal(institution.lifecycleCases[caseByPolity["Republic of Estonia"]].status, "accepted");
});
