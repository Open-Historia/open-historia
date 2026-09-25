/*! Open Historia Continuum — institutional channel materialization regressions */
import assert from "node:assert/strict";
import test from "node:test";
import {
  findInstitutionalChannel,
  institutionalChannelIdFor,
  materializeInstitutionalChannel,
} from "./institutionalChannels.js";

const makeWorld = () => ({
  polityOverrides: {
    A: { code: "A", name: "Player Republic", status: "active", aliases: [] },
    B: { code: "B", name: "B Republic", status: "active", aliases: [] },
    C: { code: "C", name: "C Republic", status: "active", aliases: [] },
    D: { code: "D", name: "D Republic", status: "active", aliases: [] },
  },
  politicalActors: { schemaVersion: 1, byPolity: {} },
  countryStats: {},
  powerStatus: { schemaVersion: 1, byPolity: {} },
  institutions: {
    schemaVersion: 1,
    ledgerVersion: 1,
    byId: {
      council: {
        id: "council",
        name: "Continental Council",
        status: "active",
        members: [
          { polity: "A", status: "member", role: "member" },
          { polity: "B", status: "member", role: "member" },
          { polity: "C", status: "observer", role: "member" },
          { polity: "D", status: "suspended", role: "member" },
        ],
      },
    },
  },
});

const history = (text = "Existing institutional history.") => [{
  role: "system",
  speaker: "System",
  text,
  time: "2000-01-01",
}];

test("institutional channel id is stable and institution-derived", () => {
  assert.equal(institutionalChannelIdFor("council"), "institution-channel-council");
  assert.equal(institutionalChannelIdFor({ id: "Council" }), "institution-channel-council");
});

test("first materialization binds institution.channelId and creates one persistent channel", () => {
  const result = materializeInstitutionalChannel({
    world: makeWorld(),
    chats: [],
    institutionId: "council",
    playerCountry: "A",
    date: "2000-01-02",
  });
  assert.equal(result.institution.channelId, "institution-channel-council");
  assert.equal(result.channel.id, result.institution.channelId);
  assert.equal(result.channel.institutionId, "council");
  assert.deepEqual(result.channel.countries.map((row) => row.polityKey), ["B", "C"]);
  assert.equal(result.chats.length, 1);
  assert.match(result.channel.messages[0].text, /institutional channel established/i);
});

test("repeated materialization is idempotent and preserves history", () => {
  const first = materializeInstitutionalChannel({
    world: makeWorld(), chats: [], institutionId: "council", playerCountry: "A",
  });
  first.chats[0].messages.push({ role: "leader", speaker: "B Republic", polityKey: "B", text: "A durable message." });
  const second = materializeInstitutionalChannel({
    world: first.world, chats: first.chats, institutionId: "council", playerCountry: "A",
  });
  assert.equal(second.channel.id, first.channel.id);
  assert.equal(second.chats.length, 1);
  assert.ok(second.channel.messages.some((row) => row.text === "A durable message."));
  assert.equal(second.channel.messages.filter((row) => /institutional channel established/i.test(row.text)).length, 1);
});

test("membership changes preserve channel identity and history", () => {
  const first = materializeInstitutionalChannel({
    world: makeWorld(), chats: [], institutionId: "council", playerCountry: "A",
  });
  first.chats[0].messages.push({ role: "system", speaker: "System", text: "Resolution 1 passed." });
  first.world.institutions.byId.council.members = [
    { polity: "A", status: "member", role: "member" },
    { polity: "C", status: "member", role: "member" },
  ];
  const second = materializeInstitutionalChannel({
    world: first.world, chats: first.chats, institutionId: "council", playerCountry: "A",
  });
  assert.equal(second.channel.id, first.channel.id);
  assert.deepEqual(second.channel.countries.map((row) => row.polityKey), ["C"]);
  assert.ok(second.channel.messages.some((row) => row.text === "Resolution 1 passed."));
});

test("ad-hoc chat with the same members remains distinct", () => {
  const chats = [{
    id: "adhoc-bc",
    countries: [
      { polityKey: "B", code: "B", name: "B Republic" },
      { polityKey: "C", code: "C", name: "C Republic" },
    ],
    messages: [{ role: "leader", speaker: "B Republic", polityKey: "B", text: "Ad hoc discussion." }],
  }];
  const result = materializeInstitutionalChannel({
    world: makeWorld(), chats, institutionId: "council", playerCountry: "A",
  });
  assert.equal(result.chats.length, 2);
  assert.ok(result.chats.some((row) => row.id === "adhoc-bc" && !row.institutionId));
  assert.ok(result.chats.some((row) => row.institutionId === "council"));
});

test("existing legacy institution-linked channel is adopted without replacing its id/history", () => {
  const chats = [{
    id: "legacy-council-room",
    institutionId: "council",
    countries: [{ polityKey: "B", code: "B", name: "B Republic" }],
    messages: history(),
  }];
  const result = materializeInstitutionalChannel({
    world: makeWorld(), chats, institutionId: "council", playerCountry: "A",
  });
  assert.equal(result.institution.channelId, "legacy-council-room");
  assert.equal(result.channel.id, "legacy-council-room");
  assert.equal(result.chats.length, 1);
  assert.equal(result.channel.messages[0].text, "Existing institutional history.");
});

test("conflicting persisted institution channel identity fails closed", () => {
  const world = makeWorld();
  world.institutions.byId.council.channelId = "persisted-council-room";
  const chats = [{
    id: "different-council-room",
    institutionId: "council",
    countries: [{ polityKey: "B", code: "B", name: "B Republic" }],
    messages: history(),
  }];
  assert.throws(
    () => materializeInstitutionalChannel({ world, chats, institutionId: "council", playerCountry: "A" }),
    /conflicting persisted channel identities/i,
  );
});

test("channel-id collision with another chat fails closed", () => {
  const world = makeWorld();
  const channelId = institutionalChannelIdFor("council");
  const chats = [{
    id: channelId,
    countries: [{ polityKey: "B", code: "B", name: "B Republic" }],
    messages: history("Unrelated ad-hoc history."),
  }];
  assert.throws(
    () => materializeInstitutionalChannel({ world, chats, institutionId: "council", playerCountry: "A" }),
    /already owned by another chat/i,
  );
});

test("dissolved institution keeps historical channel but closes it", () => {
  const world = makeWorld();
  world.institutions.byId.council.status = "dissolved";
  const result = materializeInstitutionalChannel({
    world, chats: [], institutionId: "council", playerCountry: "A",
  });
  assert.equal(result.channel.status, "closed");
  assert.equal(result.institution.channelId, result.channel.id);
  assert.equal(result.chats.length, 1);
});


test("canonical Council lookup ignores a lifecycle hearing that shares institutionId", () => {
  const world = makeWorld();
  const chats = [{
    id: "institution-invite-council-b-2000-01-02",
    institutionId: "council",
    lifecycleInstitutionId: "council",
    lifecycleCaseIds: ["council-invitation-b-2000-01-02"],
    countries: [{ polityKey: "B", code: "B", name: "B Republic" }],
    messages: history("Invitation negotiation history."),
  }, {
    id: "institution-channel-council",
    institutionId: "council",
    countries: [
      { polityKey: "B", code: "B", name: "B Republic" },
      { polityKey: "C", code: "C", name: "C Republic" },
    ],
    messages: history("Persistent Council history."),
    source: "institution",
  }];

  const found = findInstitutionalChannel(chats, world, "council");
  assert.equal(found?.id, "institution-channel-council");
  assert.equal(found?.messages?.[0]?.text, "Persistent Council history.");
});

test("lifecycle hearing with institutionId is never adopted as the permanent Council channel", () => {
  const world = makeWorld();
  const chats = [{
    id: "institution-invite-council-b-2000-01-02",
    institutionId: "council",
    lifecycleInstitutionId: "council",
    lifecycleCaseIds: ["council-invitation-b-2000-01-02"],
    countries: [{ polityKey: "B", code: "B", name: "B Republic" }],
    messages: history("Invitation negotiation history."),
  }];
  const result = materializeInstitutionalChannel({
    world, chats, institutionId: "council", playerCountry: "A", date: "2000-01-02",
  });
  assert.equal(result.channel.id, "institution-channel-council");
  assert.equal(result.institution.channelId, "institution-channel-council");
  assert.equal(result.chats.length, 2);
  assert.ok(result.chats.some((row) => row.id === "institution-invite-council-b-2000-01-02"));
  assert.ok(result.chats.some((row) => row.id === "institution-channel-council"));
});
