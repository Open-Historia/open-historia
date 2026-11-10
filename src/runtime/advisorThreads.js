import { getPoliticalProfile } from "./politicalActors.js";

// A backwards-compatible extension of the existing advisor.json transcript.
// Legacy messages (no threadId) remain the chief advisor's; contact records
// and other conversations share this array so every save/export path retains them.
export const CHIEF_ADVISOR_THREAD = "chief";
export const ADVISOR_PERSONALITY_MAX_CHARS = 1200;
export const ADVISOR_CONTACT_ROLE = "advisor-contact";
export const ADVISOR_GROUP_ROLE = "advisor-group";
export const ADVISOR_GROUP_MAX_MEMBERS = 10;
// This classifies the conversation, not a canonical person, office or authority.
// Older advisor-contact records have no recipientType and remain ministers.
export const ADVISOR_RECIPIENT_TYPES = Object.freeze({
  MINISTER: "advisor-minister",
  CIVILIAN: "citizen-civilian",
  FOREIGN_OFFICIAL: "foreign-official",
  OTHER_CHARACTER: "other-character",
});
export const ADVISOR_RECIPIENT_TYPE_LABELS = Object.freeze({
  [ADVISOR_RECIPIENT_TYPES.MINISTER]: "Advisor / Minister",
  [ADVISOR_RECIPIENT_TYPES.CIVILIAN]: "Citizen / Civilian",
  [ADVISOR_RECIPIENT_TYPES.FOREIGN_OFFICIAL]: "Foreign Official",
  [ADVISOR_RECIPIENT_TYPES.OTHER_CHARACTER]: "Other Character",
});
const RECIPIENT_TYPE_SET = new Set(Object.values(ADVISOR_RECIPIENT_TYPES));
export const CHIEF_ADVISOR_PROFILE_ROLE = "advisor-chief-profile";
const MESSAGE_ROLES = new Set(["user", "advisor", "error", "notice"]);
const OFFICE_ROLES = Object.freeze({
  headOfGovernment: "Head of government",
  headOfState: "Head of state",
});
const clean = (value, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// A personality as it was typed: its line breaks kept (at most one blank line in a row), the spaces in each line folded.
const cleanParagraphs = (value, max) => String(value ?? "").replace(/\r\n?/g, "\n").split("\n")
  .map((line) => line.replace(/\s+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const array = (value) => Array.isArray(value) ? value : [];
const validId = (id) => /^advisor-[a-z0-9][a-z0-9_-]{5,79}$/.test(String(id || ""));
const validGroupId = (id) => /^advisor-group-[a-z0-9][a-z0-9_-]{5,79}$/.test(String(id || ""));
const threadOf = (entry) => clean(entry?.threadId, 100) || CHIEF_ADVISOR_THREAD;

// Never infer a foreign character's government access from a typed label.
// An absent field is the one legacy compatibility case; an explicit invalid
// field is unsupported and MUST NOT silently upgrade to minister.
export const advisorRecipientType = (contact) => {
  if (!contact || typeof contact !== "object" || Array.isArray(contact)) return null;
  if (!Object.hasOwn(contact, "recipientType")) return ADVISOR_RECIPIENT_TYPES.MINISTER;
  return RECIPIENT_TYPE_SET.has(contact.recipientType) ? contact.recipientType : null;
};

// A caller must never use a caller-selected profile to elevate a civilian or
// foreign persona into the privileged government Advisor prompt.
export const assertAdvisorRecipientCanReply = (threadId, recipient) => {
  if (threadId === CHIEF_ADVISOR_THREAD) {
    if (recipient != null) throw new Error("The chief advisor cannot impersonate another recipient.");
    return;
  }
  if (!recipient || recipient.id !== threadId) {
    throw new Error("Advisor recipient not available: conversation identity mismatch or missing contact.");
  }
  const type = advisorRecipientType(recipient);
  if (!type) throw new Error("Unknown or unsupported Advisor recipient type.");
  if (recipient.archived) throw new Error("This contact is retired. Restore it before replying.");
  if (recipient.binding && type !== ADVISOR_RECIPIENT_TYPES.MINISTER) {
    throw new Error("Non-minister character profiles cannot carry privileged Political World office bindings.");
  }
};

// Persisted contact identity, not an arbitrary UI-supplied object, decides
// which prompt branch may run. Recheck at the model boundary: a stale or
// fabricated profile must not gain minister-level knowledge.
export const advisorRecipientForReply = (entries, threadId, supplied) => {
  if (threadId === CHIEF_ADVISOR_THREAD) {
    assertAdvisorRecipientCanReply(threadId, supplied);
    return null;
  }
  const stored = advisorContacts(entries).find((contact) => contact.id === threadId);
  if (!stored || supplied?.id !== threadId
      || advisorRecipientType(stored) !== advisorRecipientType(supplied)
      || stored.name !== supplied.name
      || stored.title !== supplied.title) {
    throw new Error("Advisor recipient changed or unavailable. Reopen this conversation.");
  }
  assertAdvisorRecipientCanReply(threadId, stored);
  return stored;
};

// A chief-advisor identity is an optional override, not another contact or
// a replacement for the scenario's original Advisor prompt. Old campaigns keep
// their chief conversation and instructions unless the player edits this.
export const chiefAdvisorProfile = (entries) => {
  const profiles = array(entries).filter((entry) => entry?.role === CHIEF_ADVISOR_PROFILE_ROLE);
  if (profiles.length !== 1) return null;
  const profile = profiles[0];
  if (!clean(profile.name, 100) || !clean(profile.title, 120)) return null;
  return {
    role: CHIEF_ADVISOR_PROFILE_ROLE,
    name: clean(profile.name, 100),
    title: clean(profile.title, 120),
    personality: clean(profile.personality, ADVISOR_PERSONALITY_MAX_CHARS),
  };
};

export const saveChiefAdvisorProfile = (entries, changes) => {
  const source = array(entries);
  if (source.filter((entry) => entry?.role === CHIEF_ADVISOR_PROFILE_ROLE).length > 1) {
    throw new Error("Duplicate chief advisor profiles are not allowed.");
  }
  const name = clean(changes?.name, 100);
  const title = clean(changes?.title, 120);
  if (!name || !title) throw new Error("Chief advisor needs a name and position.");
  if (String(changes?.personality ?? "").length > ADVISOR_PERSONALITY_MAX_CHARS) {
    throw new Error(`Chief advisor personality cannot exceed ${ADVISOR_PERSONALITY_MAX_CHARS} characters.`);
  }
  const profile = {
    role: CHIEF_ADVISOR_PROFILE_ROLE, name, title,
    personality: clean(changes?.personality, ADVISOR_PERSONALITY_MAX_CHARS),
  };
  const existing = source.findIndex((entry) => entry?.role === CHIEF_ADVISOR_PROFILE_ROLE);
  if (existing < 0) return [...source, profile];
  return source.map((entry, index) => index === existing ? profile : entry);
};

export const resetChiefAdvisorProfile = (entries) => array(entries)
  .filter((entry) => entry?.role !== CHIEF_ADVISOR_PROFILE_ROLE);

export const advisorContacts = (entries) => array(entries)
  .filter((entry) => entry?.role === ADVISOR_CONTACT_ROLE && validId(entry.id))
  .filter((entry, index, records) => records.findIndex((other) => other.id === entry.id) === index);

// Move only contact records within their existing slots. Messages, chief profile,
 // native notices and proposal receipts retain their exact positions and identities.
// Group chats are first-class conversations, never synthetic Advisor
// recipients. Only verified government advisors may attend: foreign/civilian
// characters cannot inherit a minister's private government briefing.
export const advisorGroups = (entries) => array(entries)
  .filter((entry) => entry?.role === ADVISOR_GROUP_ROLE && validGroupId(entry.id))
  .filter((entry, index, records) => records.findIndex((other) => other.id === entry.id) === index);

const validatedGroupMembers = (entries, members) => {
  const ids = array(members);
  if (ids.length < 2 || ids.length > ADVISOR_GROUP_MAX_MEMBERS || new Set(ids).size !== ids.length) {
    throw new Error("Advisor groups require 2 to 10 distinct members.");
  }
  const contacts = advisorContacts(entries);
  for (const id of ids) {
    if (id === CHIEF_ADVISOR_THREAD) continue;
    const contact = contacts.find((row) => row.id === id);
    if (!contact || contact.archived || advisorRecipientType(contact) !== ADVISOR_RECIPIENT_TYPES.MINISTER) {
      throw new Error("Advisor groups may include only active government advisors or the chief advisor.");
    }
  }
  return ids.slice();
};

export const createAdvisorGroup = (entries, proposed) => {
  const id = clean(proposed?.id, 100);
  const name = clean(proposed?.name, 100);
  if (!validGroupId(id) || !name) throw new Error("Advisor groups require a valid ID and name.");
  if (advisorGroups(entries).some((group) => group.id === id) || advisorContacts(entries).some((contact) => contact.id === id)) {
    throw new Error("This Advisor group already exists.");
  }
  if (advisorGroups(entries).length >= 8) throw new Error("An Advisor inbox supports at most eight groups.");
  return [...array(entries), { role: ADVISOR_GROUP_ROLE, id, name,
    memberIds: validatedGroupMembers(entries, proposed?.memberIds), archived: false }];
};

export const reviseAdvisorGroup = (entries, groupId, changes) => {
  const current = advisorGroups(entries).find((group) => group.id === groupId);
  if (!current) throw new Error("Unknown Advisor group.");
  const name = clean(changes?.name, 100);
  if (!name) throw new Error("Advisor groups require a name.");
  const members = validatedGroupMembers(entries, changes?.memberIds ?? current.memberIds);
  if (advisorMessagesFor(entries, groupId).length
      && JSON.stringify(members) !== JSON.stringify(current.memberIds)) {
    throw new Error("Established group membership is fixed to preserve speaker identity. Create another group.");
  }
  return array(entries).map((entry) => entry?.role === ADVISOR_GROUP_ROLE && entry.id === groupId
    ? { ...entry, name, memberIds: members } : entry);
};

export const archiveAdvisorGroup = (entries, groupId, archived = true) => {
  if (!advisorGroups(entries).some((group) => group.id === groupId)) throw new Error("Unknown Advisor group.");
  return array(entries).map((entry) => entry?.role === ADVISOR_GROUP_ROLE && entry.id === groupId
    ? { ...entry, archived: Boolean(archived) } : entry);
};

export const advisorGroupForReply = (entries, threadId) => {
  const group = advisorGroups(entries).find((entry) => entry.id === threadId);
  if (!group || group.archived) throw new Error("Advisor group is unavailable or retired.");
  validatedGroupMembers(entries, group.memberIds);
  return group;
};

export const reorderAdvisorContact = (entries, sourceId, targetId) => {
  const source = array(entries);
  const contacts = advisorContacts(source);
  const from = contacts.findIndex((contact) => contact.id === sourceId);
  const to = contacts.findIndex((contact) => contact.id === targetId);
  if (from < 0 || to < 0 || contacts.length !== source.filter((entry) => entry?.role === ADVISOR_CONTACT_ROLE).length) {
    throw new Error("Cannot reorder unknown or duplicate Advisor contacts.");
  }
  if (from === to) return source;
  const ordered = contacts.slice();
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  let index = 0;
  return source.map((entry) => entry?.role === ADVISOR_CONTACT_ROLE ? ordered[index++] : entry);
};

export const advisorMessagesFor = (entries, threadId = CHIEF_ADVISOR_THREAD) => array(entries)
  .filter((entry) => MESSAGE_ROLES.has(entry?.role)
    && threadOf(entry) === threadId
    && (entry.role !== "notice" || threadId === CHIEF_ADVISOR_THREAD));

export const createAdvisorContact = (entries, proposed) => {
  const id = clean(proposed?.id, 100);
  const name = clean(proposed?.name, 100);
  const title = clean(proposed?.title, 120);
  const personality = cleanParagraphs(proposed?.personality, ADVISOR_PERSONALITY_MAX_CHARS);
  const recipientType = advisorRecipientType(proposed);
  if (!recipientType) throw new Error("Unsupported Advisor recipient type.");
  if (!validId(id) || !name || !title) throw new Error("Advisor contacts require a unique ID, name and position.");
  if (advisorContacts(entries).some((contact) => contact.id === id)) throw new Error("This advisor contact already exists.");
  if (advisorContacts(entries).length >= 24) throw new Error("An Advisor inbox supports at most 24 additional contacts.");
  const binding = proposed?.binding;
  if (binding != null && recipientType !== ADVISOR_RECIPIENT_TYPES.MINISTER) {
    throw new Error("Political World office bindings are currently supported only for Advisor / Minister contacts.");
  }
  let validatedBinding;
  if (binding != null) {
    if (!Object.hasOwn(OFFICE_ROLES, binding.office) || !clean(binding.polity, 100) || !clean(binding.name, 100)) {
      throw new Error("Advisor contacts may only link to an identified Political World officeholder.");
    }
    if (name.toLocaleLowerCase() !== clean(binding.name, 100).toLocaleLowerCase()) {
      throw new Error("A Political World contact must use the officeholder's canonical name.");
    }
    validatedBinding = {
      polity: clean(binding.polity, 100),
      office: binding.office,
      name: clean(binding.name, 100),
      ...(clean(binding.personId, 100) ? { personId: clean(binding.personId, 100) } : {}),
    };
  }
  return [...array(entries), {
    role: ADVISOR_CONTACT_ROLE,
    id, name, title, personality, recipientType,
    archived: false,
    ...(validatedBinding ? { binding: validatedBinding } : {}),
  }];
};

export const reviseAdvisorContact = (entries, contactId, changes) => {
  const current = advisorContacts(entries).find((entry) => entry.id === contactId);
  if (!current) throw new Error("Unknown Advisor contact.");
  const name = clean(changes?.name, 100);
  const title = clean(changes?.title, 120);
  if (!name || !title) throw new Error("Advisor contacts require a name and position.");
  const recipientType = Object.hasOwn(changes ?? {}, "recipientType")
    ? advisorRecipientType(changes)
    : advisorRecipientType(current);
  if (!recipientType) throw new Error("Unsupported Advisor recipient type.");
  // A later character audience must never inherit an earlier minister's
  // private prompt history. Type changes are safe only before the first
  // saved conversation entry; editing personality/title remains unrestricted.
  if (recipientType !== advisorRecipientType(current) && advisorMessagesFor(entries, contactId).length) {
    throw new Error("Cannot change a recipient type with existing conversation history. Create a separate contact.");
  }
  if (current.binding && recipientType !== ADVISOR_RECIPIENT_TYPES.MINISTER) {
    throw new Error("Political World office bindings are currently supported only for Advisor / Minister contacts.");
  }
  if (current.binding && name.toLocaleLowerCase() !== String(current.binding.name).toLocaleLowerCase()) {
    throw new Error("A Political World contact's canonical name cannot be changed.");
  }
  return array(entries).map((entry) => (entry?.role === ADVISOR_CONTACT_ROLE && entry.id === contactId)
    ? { ...entry, name, title, recipientType, personality: cleanParagraphs(changes?.personality, ADVISOR_PERSONALITY_MAX_CHARS) }
    : entry);
};

export const archiveAdvisorContact = (entries, contactId, archived = true) => {
  if (!advisorContacts(entries).some((contact) => contact.id === contactId)) {
    throw new Error("Unknown Advisor contact.");
  }
  return array(entries).map((entry) => (entry?.role === ADVISOR_CONTACT_ROLE && entry.id === contactId)
    ? { ...entry, archived: Boolean(archived) }
    : entry);
};

// Writers always merge only their own thread into the *latest* advisor.json
// within the canonical document queue. Preserve unrelated contacts, conversations
// and native document notices (which undo/rollback may have removed).
export const replaceAdvisorThread = (entries, threadId, messages, { clearNotices = false } = {}) => {
  const group = advisorGroups(entries).find((entry) => entry.id === threadId);
  if (threadId !== CHIEF_ADVISOR_THREAD && !group && !advisorContacts(entries).some((entry) => entry.id === threadId)) {
    throw new Error("Cannot write an unknown Advisor conversation.");
  }
  const source = array(entries);
  if (!Array.isArray(messages) || messages.some((entry) => !MESSAGE_ROLES.has(entry?.role))) {
    throw new Error("Advisor conversation must contain valid message records.");
  }
  if (messages.some((entry) => entry.threadId && entry.threadId !== threadId)) {
    throw new Error("A message cannot be moved between Advisor recipients.");
  }
  if (group && messages.some((entry) => entry.role === "advisor"
    && (!group.memberIds.includes(entry.speakerId)
      || (entry.speakerId !== CHIEF_ADVISOR_THREAD && !advisorContacts(entries).some((contact) =>
        contact.id === entry.speakerId && !contact.archived
        && advisorRecipientType(contact) === ADVISOR_RECIPIENT_TYPES.MINISTER))))) {
    throw new Error("Group replies must identify an active, invited government advisor.");
  }
  if (group && messages.some((entry) => entry.role === "advisor" && entry.silent === true
    && (entry.text !== "" || entry.memory || entry.actionProposals || entry.actionReceipts
      || entry.projectsSummary || entry.projectsProblem || entry.deployments))) {
    throw new Error("A silent group participant cannot write prose or canonical operations.");
  }
  // Structured Action proposals are review-only in BOTH group and individual
  // conversations. The receipt integrity check below forbids UI-origin writes
  // to the canonical Actions ledger, even when an advisor proposes an order.
  // Action approvals are written by recordAdvisorActionReceipt in the
  // canonical document queue. A UI conversation snapshot is never authority
  // to create, cancel or overwrite one of those receipts.
  const savedReplies = new Map();
  for (const entry of source) {
    if (entry?.role !== "advisor" || threadOf(entry) !== threadId || !entry.id) continue;
    const prior = savedReplies.get(entry.id);
    if (prior && (prior.actionReceipts || entry.actionReceipts)) {
      throw new Error("Duplicate Advisor message IDs prevent safe receipt preservation.");
    }
    savedReplies.set(entry.id, entry);
  }
  const incomingReplyIds = new Set();
  const notices = new Set(source.filter((entry) => entry?.role === "notice").map((entry) => entry.id));
  const own = messages
    .filter((entry) => !entry.streaming && (entry.role !== "notice" || (threadId === CHIEF_ADVISOR_THREAD && !clearNotices && notices.has(entry.id))))
    .map((entry) => {
      const record = { ...entry };
      if (record.role === "advisor" && record.id) {
        if (incomingReplyIds.has(record.id)) {
          throw new Error("Duplicate Advisor message IDs prevent safe receipt preservation.");
        }
        incomingReplyIds.add(record.id);
        const saved = savedReplies.get(record.id);
        const receipts = saved?.actionReceipts;
        const incoming = record.actionReceipts;
        if (incoming != null && (typeof incoming !== "object" || Array.isArray(incoming))) {
          throw new Error("Malformed Advisor Action receipts in conversation snapshot.");
        }
        if (receipts != null && (typeof receipts !== "object" || Array.isArray(receipts))) {
          throw new Error("Malformed canonical Advisor Action receipts.");
        }
        const confirmed = Object.keys(receipts || {});
        if (confirmed.length) {
          // A receipt belongs to its original reply AND proposal. Matching by
          // list index would attach it to an unrelated message after a stale
          // UI snapshot or an interleaved native notice.
          for (const proposalId of confirmed) {
            const previous = saved.actionProposals?.filter((item) => item?.id === proposalId) || [];
            const current = record.actionProposals?.filter((item) => item?.id === proposalId) || [];
            const identity = ["id", "actionId", "operation", "targetId", "title", "text", "kind"];
            if (previous.length !== 1 || current.length !== 1
                || identity.some((key) => previous[0][key] !== current[0][key])) {
              throw new Error("Advisor Action proposal identity changed since the receipt was saved.");
            }
          }
          if (Object.keys(incoming || {}).some((id) => !Object.hasOwn(receipts, id))) {
            throw new Error("Action receipts cannot be created by an Advisor conversation save.");
          }
          record.actionReceipts = { ...receipts };
        } else if (incoming && Object.keys(incoming).length) {
          throw new Error("Action receipts cannot be created by an Advisor conversation save.");
        } else {
          delete record.actionReceipts;
        }
      }
      if (threadId === CHIEF_ADVISOR_THREAD) delete record.threadId;
      else record.threadId = threadId;
      return record;
    });
  // Replace existing message slots in order. A chief transcript may contain
  // native notices interleaved between messages: even a no-op save must preserve
  // their exact positions (verified against the 413-entry Russia campaign).
  const next = [];
  const replacements = own.filter((entry) => entry.role !== "notice");
  const retainedReplyIds = new Set(replacements.filter((entry) => entry.role === "advisor" && entry.id).map((entry) => entry.id));
  let used = 0;
  for (const entry of source) {
    if (MESSAGE_ROLES.has(entry?.role) && threadOf(entry) === threadId) {
      if (entry.role === "notice") {
        if (!clearNotices) next.push(entry);
      } else if (!clearNotices && entry.role === "advisor" && entry.id
          && Object.keys(entry.actionReceipts || {}).length && !retainedReplyIds.has(entry.id)) {
        // The UI omitted this reply entirely. Preserve an acknowledged native
        // decision instead of replacing it with an unrelated older message.
        // Explicit conversation clearing still removes the full thread.
        next.push(entry);
      } else if (used < replacements.length) {
        next.push(replacements[used++]);
      }
    } else {
      next.push(entry);
    }
  }
  // New messages follow the last persisted record, never preceding a paper
  // that was already delivered or another recipient's earlier correspondence.
  if (used < replacements.length) next.push(...replacements.slice(used));
  // Native notices come from the canonical source above, not from a possibly
  // stale panel copy. Do not resurrect notices that Undo already removed.
  return next;
};

const officeholder = (value) => {
  if (typeof value === "string") return { name: clean(value, 100), id: "" };
  if (!value || typeof value !== "object") return { name: "", id: "" };
  // An id is never shown as a name: an officeholder with no name is offered to nobody (names, never ids).
  return { name: clean(value.name, 100), id: clean(value.id, 100) };
};

export const politicalAdvisorOffices = (world, polity) => {
  const government = getPoliticalProfile(world, polity)?.government;
  if (!government) return [];
  return Object.entries(OFFICE_ROLES).flatMap(([office, title]) => {
    const holder = officeholder(government[office]);
    return holder.name ? [{
      name: holder.name, title,
      binding: { polity, office, name: holder.name, ...(holder.id ? { personId: holder.id } : {}) },
    }] : [];
  });
};

// A link is to an office *and its occupant at creation*, not a floating role.
// Never reassign a previous minister's private conversation to their successor.
export const advisorOfficeStatus = (contact, world) => {
  if (!contact?.binding) return "unbound";
  const binding = contact.binding;
  const government = getPoliticalProfile(world, binding.polity)?.government;
  if (!government) return "unavailable";
  const current = officeholder(government[binding.office]);
  if (binding.personId && current.id) return binding.personId === current.id ? "current" : "changed";
  if (!current.name) return current.id ? "changed" : "vacant";
  return current.name.toLocaleLowerCase() === String(binding.name).toLocaleLowerCase() ? "current" : "changed";
};
