import { OPTIONAL_GROUP_SPEECH_STANDARD } from "./advisorGroupMeetings.js";

// A provider call may produce one or several separately attributed responses.
// Validate the ENTIRE result before any speaker's native Project operation runs.
// A malformed, duplicated, omitted or uninvited speaker rejects that batch.
export const groupSpeakerBatches = (ids, batchSize) => {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !id)) {
    throw new Error("Group speakers must be distinct stable IDs.");
  }
  const size = Math.max(1, Math.min(10, Number.isFinite(Number(batchSize)) ? Math.floor(Number(batchSize)) : 1));
  const groups = [];
  for (let index = 0; index < ids.length; index += size) groups.push(ids.slice(index, index + size));
  return groups;
};

export const parseAdvisorGroupBatch = (raw, expectedIds) => {
  if (!Array.isArray(expectedIds) || expectedIds.length < 2 || expectedIds.length > 10
      || new Set(expectedIds).size !== expectedIds.length) {
    throw new Error("A shared group request needs 2 to 10 distinct invited speakers.");
  }
  if (typeof raw !== "string" || raw.length > 240_000) throw new Error("Group batch response is missing or oversized.");
  const trimmed = raw.trim();
  const json = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
    : trimmed;
  let data;
  try { data = JSON.parse(json); } catch { throw new Error("Group batch did not return valid JSON."); }
  const replies = data && typeof data === "object" && !Array.isArray(data) ? data.replies : null;
  if (!Array.isArray(replies) || replies.length !== expectedIds.length) {
    throw new Error(`Group batch must return exactly ${expectedIds.length} speaker responses.`);
  }
  return replies.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || entry.speakerId !== expectedIds[index]
      || (entry.memory != null && typeof entry.memory !== "string")) {
      throw new Error(`Group batch speaker ${index + 1} has an invalid identity or reply.`);
    }
    if (entry.pass === true) {
      if ((entry.text != null && entry.text !== "") || (entry.memory != null && entry.memory !== "")) {
        throw new Error(`Group batch speaker ${index + 1} has an invalid silent response.`);
      }
      return { role: "advisor", speakerId: entry.speakerId, silent: true, text: "" };
    }
    if ((entry.pass != null && entry.pass !== false)
      || typeof entry.text !== "string" || !entry.text.trim() || entry.text.length > 30000) {
      throw new Error(`Group batch speaker ${index + 1} has an invalid identity or reply.`);
    }
    // Shared-mode memory belongs only in the validated JSON memory field.
    // Do not expose a hidden-memory suffix to the player as visible prose.
    if (/ADVISOR_MEMORY[*_`\s]*:/iu.test(entry.text)) {
      throw new Error(`Group batch speaker ${index + 1} must use the JSON memory field.`);
    }
    return { role: "advisor", speakerId: expectedIds[index], text: entry.text.trim(),
      ...(entry.memory ? { memory: entry.memory.slice(0, 5000) } : {}) };
  });
};


// Shared generations deliberately do NOT receive any member's private
// one-to-one conversation. They receive each participant's explicit profile,
// the shared discussion, and the common canonical world context.
export const buildAdvisorSharedBatchPrompt = ({
  groupName, memberIds, contacts = [], chiefName = "Chief advisor", chiefTitle = "Chief advisor",
  chiefPersonality = "", transcript = "", question = "",
} = {}) => {
  const biographies = memberIds.map((id, index) => {
    const person = id === "chief"
      ? { name: chiefName, title: chiefTitle, personality: chiefPersonality }
      : contacts.find((item) => item.id === id);
    if (!person?.name || !person?.title) throw new Error("A group participant's profile is missing.");
    return (index + 1) + '. speakerId="' + id + '", name="' + person.name
      + '", office="' + person.title + '", principles="' + String(person.personality || "").slice(0, 2300) + '"';
  }).join("\n");
  const example = JSON.stringify(advisorBatchOutputContract(memberIds));
  // The caller supplies a chronological transcript that already includes
  // the complete newest instruction. Do not duplicate a long prompt or,
  // worse, silently cut off its final authorization and limitations.
  const latestMessage = String(question);
  const latestForPrompt = transcript.includes("[Player]: " + latestMessage)
    ? "(Included verbatim in the chronological transcript above.)" : latestMessage;
  return [
    "[Group Chat: " + groupName + "]",
    "Decide whether each of the next " + memberIds.length + " DISTINCT people speaks or deliberately passes, in EXACTLY this order.",
    biographies,
    "Preserve EACH person's office, personality, priorities, dissent and independent reasoning. If a member speaks, they can address earlier contributors in the shared transcript and previous speakers within this request. Do not force all members to speak or fabricate agreement, dissent or authorization.",
    "Every member must return one explicit result: substantive speech or a deliberate pass, including members addressed by name.",
    OPTIONAL_GROUP_SPEECH_STANDARD,
    'For each member who does not clear that threshold, use {speakerId, pass: true, text: ""}. A factual correction or well-founded objection is a reason to speak even without direct invitation. Do not treat closing pleasantries or routine agreement as needing a reply.',
    "Only shared history and public member profiles are supplied. Do not invent or disclose private one-to-one correspondence.",
    "Native authority: an Advisor / Minister may propose fenced actions for the player's explicit Proceed review, and fenced projects only when the player has clearly authorized the work. No deployment or direct institution execution. The WHOLE response is validated before any Projects are committed.",
    "[Shared group transcript, chronological]",
    transcript,
    "[Latest player message]",
    latestForPrompt,
    "Return ONLY one JSON object, no outer Markdown fence, with replies: EXACTLY " + memberIds.length + " records in order. Each must have its exact speakerId and either pass:true with empty text and no memory, or pass:false with a substantive text string and optional memory string. A missing/empty/truncated response is an ERROR, never a silent choice. Keep fenced Actions/Projects only INSIDE that speaker's text as JSON-escaped strings. Never claim pending Actions were executed.",
    "Example output SHAPE ONLY. All participants are shown passing by default. Any member with a substantive answer or material objection should replace pass:true with pass:false and supply substantive text:",
    example,
  ].join("\n\n");
};

// User text is JSON data, never trusted prompt instructions. The model is asked
// to use identities provided by native state, not to invent participants.
export const advisorBatchOutputContract = (ids) => ({
  replies: ids.map((speakerId) => ({ speakerId, pass: true, text: "" })),
});
