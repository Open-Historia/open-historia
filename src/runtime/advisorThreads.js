import { getPoliticalProfile } from "./politicalActors.js";

// A backwards-compatible extension of the existing advisor.json transcript.
// Legacy messages (no threadId) remain the chief advisor's; contact records
// and other conversations share this array so every save/export path retains them.
export const CHIEF_ADVISOR_THREAD = "chief";
export const ADVISOR_PERSONALITY_MAX_CHARS = 1200;
export const ADVISOR_CONTACT_ROLE = "advisor-contact";
export const CHIEF_ADVISOR_PROFILE_ROLE = "advisor-chief-profile";
const MESSAGE_ROLES = new Set(["user", "advisor", "error", "notice"]);
const OFFICE_ROLES = Object.freeze({
  headOfGovernment: "Head of government",
  headOfState: "Head of state",
});
const clean = (value, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const array = (value) => Array.isArray(value) ? value : [];
const validId = (id) => /^advisor-[a-z0-9][a-z0-9_-]{5,79}$/.test(String(id || ""));
const threadOf = (entry) => clean(entry?.threadId, 100) || CHIEF_ADVISOR_THREAD;

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

export const advisorMessagesFor = (entries, threadId = CHIEF_ADVISOR_THREAD) => array(entries)
  .filter((entry) => MESSAGE_ROLES.has(entry?.role)
    && threadOf(entry) === threadId
    && (entry.role !== "notice" || threadId === CHIEF_ADVISOR_THREAD));

export const createAdvisorContact = (entries, proposed) => {
  const id = clean(proposed?.id, 100);
  const name = clean(proposed?.name, 100);
  const title = clean(proposed?.title, 120);
  const personality = clean(proposed?.personality, ADVISOR_PERSONALITY_MAX_CHARS);
  if (!validId(id) || !name || !title) throw new Error("Advisor contacts require a unique ID, name and position.");
  if (advisorContacts(entries).some((contact) => contact.id === id)) throw new Error("This advisor contact already exists.");
  if (advisorContacts(entries).length >= 24) throw new Error("An Advisor inbox supports at most 24 additional contacts.");
  const binding = proposed?.binding;
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
    id, name, title, personality,
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
  if (current.binding && name.toLocaleLowerCase() !== String(current.binding.name).toLocaleLowerCase()) {
    throw new Error("A Political World contact's canonical name cannot be changed.");
  }
  return array(entries).map((entry) => (entry?.role === ADVISOR_CONTACT_ROLE && entry.id === contactId)
    ? { ...entry, name, title, personality: clean(changes?.personality, ADVISOR_PERSONALITY_MAX_CHARS) }
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
  if (threadId !== CHIEF_ADVISOR_THREAD && !advisorContacts(entries).some((entry) => entry.id === threadId)) {
    throw new Error("Cannot write an unknown Advisor conversation.");
  }
  const source = array(entries);
  if (!Array.isArray(messages) || messages.some((entry) => !MESSAGE_ROLES.has(entry?.role))) {
    throw new Error("Advisor conversation must contain valid message records.");
  }
  if (messages.some((entry) => entry.threadId && entry.threadId !== threadId)) {
    throw new Error("A message cannot be moved between Advisor recipients.");
  }
  const notices = new Set(source.filter((entry) => entry?.role === "notice").map((entry) => entry.id));
  const own = messages
    .filter((entry) => !entry.streaming && (entry.role !== "notice" || (threadId === CHIEF_ADVISOR_THREAD && !clearNotices && notices.has(entry.id))))
    .map((entry) => {
      const record = { ...entry };
      if (threadId === CHIEF_ADVISOR_THREAD) delete record.threadId;
      else record.threadId = threadId;
      return record;
    });
  // Replace existing message slots in order. A chief transcript may contain
  // native notices interleaved between messages: even a no-op save must preserve
  // their exact positions (verified against the 413-entry Russia campaign).
  const next = [];
  const replacements = own.filter((entry) => entry.role !== "notice");
  let used = 0;
  for (const entry of source) {
    if (MESSAGE_ROLES.has(entry?.role) && threadOf(entry) === threadId) {
      if (entry.role === "notice") {
        if (!clearNotices) next.push(entry);
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
  return { name: clean(value.name || value.id, 100), id: clean(value.id, 100) };
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
  if (!current.name) return "vacant";
  if (binding.personId && current.id) return binding.personId === current.id ? "current" : "changed";
  return current.name.toLocaleLowerCase() === String(binding.name).toLocaleLowerCase() ? "current" : "changed";
};
