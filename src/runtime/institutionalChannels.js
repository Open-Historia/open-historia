/*! Open Historia Continuum — institutional diplomatic channel adapter.
 * Institutions own identity + membership; chat owns conversation history only.
 */

import {
  chatThreadIdentityKey,
  mutateCanonicalTurnState,
  normalizeChatEntry,
  reconcileChatsForPlayer,
} from "./gameState.js";
import {
  canonicalInstitutionIdentity,
  institutionChannelParticipants,
  normalizeInstitutions,
  resolveInstitutionRecord,
} from "./institutions.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

export const institutionalChannelIdFor = (institutionInput) => {
  const identity = canonicalInstitutionIdentity(
    typeof institutionInput === "object" ? institutionInput : { id: institutionInput },
  );
  return identity.id ? `institution-channel-${identity.id}`.slice(0, 160) : "";
};

const institutionalSystemMessage = (text, date = "") => ({
  role: "system",
  speaker: "System",
  text: clean(text),
  time: clean(date),
});

export const materializeInstitutionalChannel = ({
  world: worldInput = {},
  chats: chatsInput = [],
  institutionId = "",
  playerCountry = "",
  date = "",
} = {}) => {
  let world = clone(worldInput || {});
  const institution = resolveInstitutionRecord(world, institutionId);
  if (!institution) throw new Error(`Unknown institution ${clean(institutionId) || "<blank>"}.`);

  const canonicalId = canonicalInstitutionIdentity(institution).id;
  const channelId = clean(institution.channelId) || institutionalChannelIdFor(canonicalId);
  if (!canonicalId || !channelId) throw new Error("Institution cannot resolve a stable channel identity.");

  const chats = reconcileChatsForPlayer(chatsInput, world, playerCountry);
  const existingByInstitution = chats.find((chat) => lower(chat?.institutionId) === lower(canonicalId));
  const conflictingId = chats.find((chat) => clean(chat?.id) === channelId && lower(chat?.institutionId) !== lower(canonicalId));
  if (conflictingId) {
    throw new Error(`Institutional channel id ${channelId} is already owned by another chat.`);
  }
  if (existingByInstitution && clean(institution.channelId) && clean(existingByInstitution.id) !== clean(institution.channelId)) {
    throw new Error(`Institution ${canonicalId} has conflicting persisted channel identities.`);
  }

  // The established institution-linked chat owns its conversation id. A legacy
  // institution may have gained the link before `institution.channelId` existed;
  // bind that existing id natively rather than replacing the historical thread.
  const resolvedChannelId = clean(existingByInstitution?.id) || channelId;
  const institutions = normalizeInstitutions(world.institutions, world);
  institutions.byId[canonicalId] = {
    ...institutions.byId[canonicalId],
    channelId: resolvedChannelId,
  };
  world = { ...world, institutions };

  const members = institutionChannelParticipants(world, canonicalId);
  const base = existingByInstitution || normalizeChatEntry({
    id: resolvedChannelId,
    institutionId: canonicalId,
    countries: members,
    messages: [institutionalSystemMessage(`${institution.name} institutional channel established.`, date)],
    source: "institution",
    status: institution.status === "dissolved" ? "closed" : "open",
    title: institution.name,
  });
  if (!base) throw new Error(`Could not materialize institutional channel for ${institution.name}.`);

  const channel = normalizeChatEntry({
    ...base,
    id: resolvedChannelId,
    institutionId: canonicalId,
    countries: members,
    source: "institution",
    status: institution.status === "dissolved" ? "closed" : "open",
    title: base.title || institution.name,
  });
  const nextChats = existingByInstitution
    ? chats.map((chat) => (clean(chat.id) === clean(existingByInstitution.id) ? channel : chat))
    : [channel, ...chats];
  const reconciled = reconcileChatsForPlayer(nextChats, world, playerCountry);
  const finalChannel = reconciled.find((chat) => chatThreadIdentityKey(chat, world) === `institution:${canonicalId}`);
  if (!finalChannel) throw new Error(`Institutional channel for ${institution.name} vanished during reconciliation.`);

  return { world, chats: reconciled, channel: finalChannel, institution: institutions.byId[canonicalId] };
};

export const ensureInstitutionalChannel = async ({
  institutionId = "",
  playerCountry = "",
  date = "",
  expectedGameId = "",
} = {}) => {
  let result = null;
  const committed = await mutateCanonicalTurnState(({ chats, game, world }) => {
    result = materializeInstitutionalChannel({
      world,
      chats,
      institutionId,
      playerCountry: playerCountry || game?.country || "",
      date: date || game?.gameDate || "",
    });
    return { world: result.world, chats: result.chats };
  }, {
    playerCountry,
    expectedGameId,
  });
  if (committed?.skipped || !result) throw new Error("Institutional channel was not committed.");
  const channel = reconcileChatsForPlayer(committed.chat || committed.chats || result.chats, committed.world, playerCountry || committed.game?.country || "")
    .find((chat) => lower(chat?.institutionId) === lower(result.channel.institutionId));
  return { ...result, world: committed.world, chats: committed.chat || result.chats, channel: channel || result.channel };
};
