// Pure, bounded group-meeting context. Identity and response authority are
// validated in advisorThreads.js before a model is addressed.
export const GROUP_MEETING_CONTEXT_MAX_CHARS = 16000;

// Shared policy for both independent requests and multi-speaker batches.
// Optional participation is not a roll call: silence is preferable to
// repeating, acknowledging or merely decorating an already useful answer.
// An important factual challenge or independent objection still merits speech.
export const OPTIONAL_GROUP_SPEECH_STANDARD = [
  "For any member not directly asked to answer, silence is the default.",
  "Speak only when you can materially change the discussion: correct an important factual error, challenge an unsound claim with a reason, introduce distinct evidence or expertise, raise a substantive risk, or offer a decision-relevant alternative.",
  "You may disagree with another member even when the player addressed someone else. A well-founded objection takes priority over silence.",
  "Do not speak merely to acknowledge the player, exchange pleasantries, repeat agreement, rephrase another speaker, make a joke, endorse an already established conclusion, or announce that a meeting should end.",
  "Do not interpret being invited to this group as an obligation to make a statement. If the useful point has already been made, remain silent.",
].join(" ");

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
export const advisorGroupSpeakerName = (id, contacts, chiefName = "Chief advisor") =>
  id === "chief" ? clean(chiefName) || "Chief advisor"
    : clean((Array.isArray(contacts) ? contacts : []).find((row) => row.id === id)?.name) || "Former member";

// A person may be addressed by their full name or a unique first/last name.
// Name matching is a prioritization/mandatory-reply rule, never an exclusion
// of other members: the others still have the opportunity to challenge them.
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentionedName = (question, name) => {
  const pattern = escaped(clean(name)).replace(/\s+/g, "\\s+");
  return pattern.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}(?=$|[^\\p{L}\\p{N}])`, "iu").test(question);
};

export const directlyAddressedAdvisorIds = (memberIds, question, contacts, chiefName) => {
  const ids = Array.isArray(memberIds) ? memberIds : [];
  const text = String(question || "");
  const names = ids.map((id) => advisorGroupSpeakerName(id, contacts, chiefName));
  const aliases = names.map((name) => {
    const parts = clean(name).split(/\s+/);
    return [parts[0], parts.length > 1 ? parts[parts.length - 1] : ""].filter((part) => part.length >= 3);
  });
  const counts = new Map();
  for (const parts of aliases) for (const part of new Set(parts.map((v) => v.toLocaleLowerCase()))) {
    counts.set(part, (counts.get(part) || 0) + 1);
  }
  return ids.filter((id, index) => mentionedName(text, names[index]) || aliases[index].some((part) =>
    counts.get(part.toLocaleLowerCase()) === 1 && mentionedName(text, part)));
};

export const selectAdvisorGroupSpeakers = (memberIds, messages, question, contacts, chiefName) => {
  const ids = Array.isArray(memberIds) ? memberIds : [];
  const turns = (Array.isArray(messages) ? messages : []).filter((row) => row?.role === "user").length;
  const offset = ids.length ? Math.max(0, turns - 1) % ids.length : 0;
  const rotated = [...ids.slice(offset), ...ids.slice(0, offset)];
  const namedIds = new Set(directlyAddressedAdvisorIds(ids, question, contacts, chiefName));
  const named = rotated.filter((id) => namedIds.has(id));
  const speakers = [...named, ...rotated.filter((id) => !named.includes(id))];
  const lastUser = (Array.isArray(messages) ? messages : []).findLastIndex((row) => row?.role === "user");
  const answered = new Set((Array.isArray(messages) ? messages : []).slice(lastUser + 1)
    .filter((row) => row.role === "advisor" && ids.includes(row.speakerId)).map((row) => row.speakerId));
  return speakers.filter((id) => !answered.has(id));
};

// Requirements are turn-scoped and remain stable after a partial turn retry.
// If the addressed member already answered, remaining members stay optional.
export const requiredAdvisorGroupSpeakers = (memberIds, messages, question, contacts, chiefName) => {
  const available = selectAdvisorGroupSpeakers(memberIds, messages, question, contacts, chiefName);
  const addressed = new Set(directlyAddressedAdvisorIds(memberIds, question, contacts, chiefName));
  const rows = Array.isArray(messages) ? messages : [];
  const lastUser = rows.findLastIndex((row) => row?.role === "user");
  const alreadySpoken = rows.slice(lastUser + 1).some((row) => row?.role === "advisor" && !row.silent);
  return available.filter((id, index) => addressed.has(id)
    || (!alreadySpoken && addressed.size === 0 && index === 0));
};

export const renderAdvisorGroupHistory = (messages, contacts, chiefName, maxChars = GROUP_MEETING_CONTEXT_MAX_CHARS) => {
  const lines = (Array.isArray(messages) ? messages : [])
    .filter((row) => row?.role === "user" || (row?.role === "advisor" && !row.silent))
    .map((row) => {
      const speaker = row.role === "user" ? "Player" : advisorGroupSpeakerName(row.speakerId, contacts, chiefName);
      // The next minister should see the substantive argument, not machine
      // fences intended for native validation. Explicitly distinguish proposed
      // (not yet approved) Actions from Projects the board already accepted.
      const prose = String(row.text || "")
        .replace(/```(?:actions|projects|deploy|institutiondraft|senddraft)\b[\s\S]*?```/gi, "[structured proposal recorded separately]")
        .slice(0, 3500);
      const proposed = Array.isArray(row.actionProposals) ? row.actionProposals.length : 0;
      const receipts = Object.values(row.actionReceipts || {});
      const pending = Math.max(0, proposed - receipts.length);
      const projects = Array.isArray(row.projectsSummary) ? row.projectsSummary
        .slice(0, 5).map((item) => `${item.change}: ${item.title}`).join("; ") : "";
      return `[${speaker}]: ${prose}${pending ? ` [${pending} Action proposal(s) awaiting the player's Proceed]` : ""}${receipts.length ? ` [${receipts.length} Action decision(s) already recorded]` : ""}${projects ? ` [Recorded Project board changes: ${projects}]` : ""}`;
    });
  const limit = Math.max(1000, Math.min(GROUP_MEETING_CONTEXT_MAX_CHARS, Number(maxChars) || 16000));
  const chosen = [];
  let used = 0;
  for (const row of lines.slice().reverse()) {
    if (used + row.length + 1 > limit) break;
    chosen.unshift(row);
    used += row.length + 1;
  }
  return `${lines.length > chosen.length ? `[${lines.length - chosen.length} older meeting messages omitted; they remain in the saved transcript.]\n` : ""}${chosen.join("\n")}`;
};
