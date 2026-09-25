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

// Permanent Council channels and temporary invitation/accession hearings may both
// carry `institutionId`. The lifecycle thread also carries lifecycleInstitutionId
// + lifecycleCaseIds, and gameState.chatThreadIdentityKey deliberately gives that
// combination a DIFFERENT identity. Never select a Council by the loose foreign
// key alone: doing so can route a formal Council turn into an accession hearing
// and make the visible Council transcript appear to reset to the invitation.
export const findInstitutionalChannel = (chatsInput = [], world = {}, institutionInput = "") => {
  const canonicalId = canonicalInstitutionIdentity(
    typeof institutionInput === "object" ? institutionInput : { id: institutionInput },
  ).id;
  if (!canonicalId) return null;
  const institutionThreadKey = `institution:${canonicalId}`;
  return (Array.isArray(chatsInput) ? chatsInput : [])
    .find((chat) => chatThreadIdentityKey(chat, world) === institutionThreadKey) || null;
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
  // A lifecycle/accession hearing can legitimately carry institutionId as well as
  // lifecycleInstitutionId. Identity, not that loose foreign key, decides which
  // chat is the permanent Council. Otherwise an accepted invitation thread can
  // be adopted as the Council and then "vanish" when reconciliation correctly
  // restores its lifecycle identity.
  const existingByInstitution = findInstitutionalChannel(chats, world, canonicalId);
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
  const finalChannel = findInstitutionalChannel(reconciled, world, canonicalId);
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
  const committedChats = committed.chat || committed.chats || result.chats;
  const reconciled = reconcileChatsForPlayer(
    committedChats,
    committed.world,
    playerCountry || committed.game?.country || "",
  );
  const channel = findInstitutionalChannel(reconciled, committed.world, result.channel.institutionId);
  return { ...result, world: committed.world, chats: committedChats, channel: channel || result.channel };
};
