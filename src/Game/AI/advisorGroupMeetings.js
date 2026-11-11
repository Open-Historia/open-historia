import { splitAdvisorMemory } from "./advisorMemory.js";

// Pure, bounded group-meeting context. Identity and response authority are
// validated in advisorThreads.js before a model is addressed.
export const GROUP_MEETING_CONTEXT_MAX_CHARS = 16000;

// Shared policy for both independent requests and multi-speaker batches.
// Addressing or mentioning a member is not a native speech obligation.
// The model judges conversational value; validated native state controls work.
export const OPTIONAL_GROUP_SPEECH_STANDARD = [
  "Every invited member independently decides whether to speak or pass, including a member directly addressed by name. Silence is the default when no material contribution is needed.",
  "A genuine request for your assessment or an unresolved substantive question is normally a reason to respond. Address the actual question, acknowledge material uncertainty, and do not pass merely because the answer would be difficult.",
  "An instruction, acknowledgment, or thanks alone does not require a courtesy reply. Silence does NOT mean an Action or Project was executed or approved; only the native board and receipts establish that.",
  "Speak when you can materially change the discussion: correct an important factual error, challenge an unsound claim with a reason, introduce distinct evidence or expertise, raise a substantive risk, or offer a decision-relevant alternative.",
  "You may disagree with the player or another member even when the player addressed someone else. A well-founded objection takes priority over silence. Never treat consensus as mandatory.",
  "Do not speak merely to acknowledge the player, exchange pleasantries, repeat agreement, rephrase another speaker, make a joke, endorse an already established conclusion, or announce that a meeting should end.",
  "Do not interpret being invited to this group as an obligation to make a statement. If the useful point has already been made, remain silent.",
].join(" ");

// One-speaker output contract used by the production group response path.
// A literal pass is exclusive: any hidden memory or malformed reply fails
// BEFORE completion, native operations, or persistence.
export const parseAdvisorGroupIndividualReply = (raw, speakerId, name) => {
  const { reply, memory } = splitAdvisorMemory(raw);
  if (!reply?.trim()) throw new Error(`Group member ${name} returned an empty reply.`);
  const pass = reply.trim() === "[[PASS]]";
  if (pass && memory) throw new Error(`Silent group member ${name} cannot write private memory.`);
  // Even an empty hidden-memory suffix violates the exclusive PASS contract.
  if (pass && String(raw ?? "").trim() !== "[[PASS]]") throw new Error(`Group member ${name} returned an invalid partial pass.`);
  if (reply.includes("[[PASS]]") && !pass) throw new Error(`Group member ${name} returned an invalid partial pass.`);
  return pass
    ? { role: "advisor", speakerId, silent: true, text: "" }
    : { role: "advisor", speakerId, text: reply.trim(), ...(memory ? { memory } : {}) };
};

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
export const advisorGroupSpeakerName = (id, contacts, chiefName = "Chief advisor") =>
  id === "chief" ? clean(chiefName) || "Chief advisor"
    : clean((Array.isArray(contacts) ? contacts : []).find((row) => row.id === id)?.name) || "Former member";

// Address recognition is a best-effort ordering hint, never a speech
// requirement or authorization. Third-person references and possessives
// must not force or promote unrelated participants. Unique first/last
// names resolve to stable member IDs; ambiguous aliases do not.
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const addressOpeners = /^(?:(?:hey|hi|hello|dear|please|thanks|thank you|good morning|good afternoon|good evening)\b[\s,!:.-]+)*/iu;
const addressDelimiter = /^\s*(?:[,;:!?]|[-\u2013\u2014]|$)/u;
const addressJoiner = /^\s*(?:,\s*(?:and\s+)?|and\s+|&\s*|\/\s*)/iu;

export const directlyAddressedAdvisorIds = (memberIds, question, contacts, chiefName) => {
  const ids = Array.isArray(memberIds) ? memberIds : [];
  const names = ids.map((id) => advisorGroupSpeakerName(id, contacts, chiefName));
  const aliases = names.map((name) => {
    const parts = clean(name).split(/\s+/);
    return [parts[0], parts.length > 1 ? parts[parts.length - 1] : ""].filter((part) => part.length >= 3);
  });
  const counts = new Map();
  for (const parts of aliases) for (const part of new Set(parts.map((v) => v.toLocaleLowerCase()))) {
    counts.set(part, (counts.get(part) || 0) + 1);
  }
  const candidates = ids.flatMap((id, index) => [
    names[index],
    ...aliases[index].filter((part) => counts.get(part.toLocaleLowerCase()) === 1),
  ].filter(Boolean).map((name) => {
    const patternText = escaped(name).replace(/\s+/g, "\\s+");
    return {
      id,
      length: name.length,
      patternText,
      pattern: new RegExp(`^${patternText}(?=$|[^\\p{L}\\p{N}])`, "iu"),
    };
  })).sort((a, b) => b.length - a.length);
  const matchName = (part) => {
    for (const candidate of candidates) {
      const matched = candidate.pattern.exec(part);
      if (matched && !/^['\u2019]s\b/iu.test(part.slice(matched[0].length))) {
        return { id: candidate.id, length: matched[0].length };
      }
    }
    return null;
  };

  const addressed = new Set();
  const sentences = String(question || "").split(/(?:[.!?]\s+|\r?\n+)/u);
  // Address lists must be complete: "Boris and Marina are working" is a
  // third-person statement, not a request for either to speak.
  for (const sentence of sentences) {
    let part = sentence.trimStart().replace(addressOpeners, "").trimStart();
    const pending = [];
    for (let index = 0; index < ids.length; index++) {
      const candidate = matchName(part);
      if (!candidate) break;
      pending.push(candidate.id);
      const after = part.slice(candidate.length);
      const join = addressJoiner.exec(after);
      if (join) {
        const next = after.slice(join[0].length).trimStart();
        const nextName = matchName(next);
        // "Marina, Boris is working" addresses Marina, not Boris.
        if (nextName && (addressDelimiter.test(next.slice(nextName.length))
            || addressJoiner.test(next.slice(nextName.length)))) {
          part = next;
          continue;
        }
      }
      if (addressDelimiter.test(after)) for (const id of pending) addressed.add(id);
      break;
    }
    // A trailing vocative is also direct: "What do you think, Boris?"
    for (const candidate of candidates) {
      if (new RegExp(`,\\s*${candidate.patternText}\\s*[.!?]*$`, "iu").test(sentence.trim())) addressed.add(candidate.id);
    }
  }
  return ids.filter((id) => addressed.has(id));
};

// Only persisted group proposals and the canonical Actions inventory can
// establish an unqueued draft. An old updated/cancelled receipt is historical,
// not permission to resurrect work, and an existing Action ID is never a draft.
export const unqueuedGroupActionDrafts = (messages, currentActions) => {
  if (!Array.isArray(messages) || !Array.isArray(currentActions)) return [];
  const actionIds = new Set(currentActions.map((action) => action?.id).filter(Boolean));
  const drafts = [];
  const seen = new Set();
  for (const row of messages) {
    if (row?.role !== "advisor" || !row.speakerId || !Array.isArray(row.actionProposals)) continue;
    for (const proposal of row.actionProposals) {
      if (proposal?.operation !== "create" || !proposal.id || !proposal.actionId
          || row.actionReceipts?.[proposal.id] || actionIds.has(proposal.actionId)
          || seen.has(proposal.actionId) || !String(proposal.title || proposal.text || "").trim()) continue;
      drafts.push({
        speakerId: row.speakerId,
        proposalId: proposal.id,
        actionId: proposal.actionId,
        title: clean(proposal.title || proposal.text),
        text: clean(proposal.text || proposal.title),
      });
      seen.add(proposal.actionId);
    }
  }
  return drafts;
};

const draftMessageHistory = (messages, persisted) => Array.isArray(persisted)
  ? [...persisted, ...(Array.isArray(messages) ? messages : [])]
  : messages;

const unqueuedDraftContext = (drafts, contacts, chiefName, maxChars) => {
  if (!drafts.length || maxChars < 300) return "";
  const header = "[Unqueued Action proposals in this group - NOT on the Actions board]\n"
    + "These are saved drafts, not queued orders. To revise one, propose a NEW create without an existing Action ID; never edit a different queued Action just because its title is similar.\n";
  let result = header;
  let shown = 0;
  for (const draft of drafts.slice().reverse()) {
    const line = "- " + advisorGroupSpeakerName(draft.speakerId, contacts, chiefName)
      + " (speakerId: " + draft.speakerId + ", original draft ID: " + draft.actionId
      + "): " + draft.title.slice(0, 240)
      + " | Proposed scope: " + draft.text.slice(0, 1500) + "\n";
    if (result.length + line.length > maxChars) break;
    result += line;
    shown++;
    if (shown >= 5) break;
  }
  if (!shown) return "";
  return result.trimEnd().slice(0, maxChars);
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

// Presentation only: all invited members must explicitly pass the same turn.
// Partial retries, missing/duplicate IDs, substantive replies and errors are
// never misreported as completed silence. This never writes canonical state.
export const completedSilentGroupTurnIndices = (messages, memberIds) => {
  const rows = Array.isArray(messages) ? messages : [];
  const ids = Array.isArray(memberIds) ? memberIds : [];
  if (ids.length < 2 || new Set(ids).size !== ids.length) return [];
  const invited = new Set(ids);
  const indices = [];
  for (let start = 0; start < rows.length; start++) {
    if (rows[start]?.role !== "user") continue;
    let end = start + 1;
    while (end < rows.length && rows[end]?.role !== "user") end++;
    const turn = rows.slice(start + 1, end);
    const replies = turn.filter((row) => row?.role === "advisor");
    const speakers = new Set(replies.map((row) => row.speakerId));
    if (replies.length === ids.length && speakers.size === ids.length
        && replies.every((row) => invited.has(row.speakerId) && row.silent === true
          && row.text === "" && !row.streaming)
        && !turn.some((row) => row?.role === "error")) {
      indices.push(start + 1 + turn.lastIndexOf(replies.at(-1)));
    }
  }
  return indices;
};

export const renderAdvisorGroupHistory = (messages, contacts, chiefName,
  maxChars = GROUP_MEETING_CONTEXT_MAX_CHARS, { currentActions, draftMessages } = {}) => {
  const visible = (Array.isArray(messages) ? messages : [])
    .filter((row) => row?.role === "user" || (row?.role === "advisor" && !row.silent));
  const latestUserIndex = visible.findLastIndex((row) => row.role === "user");
  const lines = visible.map((row, index) => {
      const speaker = row.role === "user" ? "Player" : advisorGroupSpeakerName(row.speakerId, contacts, chiefName);
      // The next minister should see the substantive argument, not machine
      // fences intended for native validation. Explicitly distinguish proposed
      // (not yet approved) Actions from Projects the board already accepted.
      // The latest player instruction is authoritative input for this turn.
      // Never truncate its tail, where authorizations and constraints often live.
      const prose = row.role === "user" && index === latestUserIndex
        ? String(row.text || "")
        : String(row.text || "")
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
  const latestLine = latestUserIndex >= 0 ? lines[latestUserIndex] : "";
  // A truncated player instruction could lose its authorization or safeguards.
  // Fail explicitly instead of cutting off the latest turn or its ending.
  if (latestLine.length > limit - 256) {
    throw new Error("Latest group message is too long for the Advisor transcript. Please shorten the instruction.");
  }
  const drafts = unqueuedGroupActionDrafts(draftMessageHistory(messages, draftMessages), currentActions);
  const draftBudget = Math.min(4400, Math.floor(limit * 0.48), Math.max(0, limit - latestLine.length - 256));
  const pending = unqueuedDraftContext(drafts, contacts, chiefName, draftBudget);
  const historyLimit = limit - pending.length - (pending ? 2 : 0);
  // The latest player instruction wins context budget over historical turns.
  // Preserve completed participants after it on partial retries when possible.
  const after = [];
  let used = latestLine.length;
  for (const line of lines.slice(latestUserIndex + 1).reverse()) {
    if (used + line.length + 1 > historyLimit) break;
    after.unshift(line);
    used += line.length + 1;
  }
  const before = [];
  for (const line of lines.slice(0, Math.max(0, latestUserIndex)).reverse()) {
    if (used + line.length + 1 > historyLimit) break;
    before.unshift(line);
    used += line.length + 1;
  }
  const chosen = [...before, ...(latestLine ? [latestLine] : []), ...after];
  const omittedCount = lines.length - chosen.length;
  const omitted = omittedCount > 0
    ? `[${omittedCount} meeting messages omitted from model context; still saved.]\n` : "";
  const main = chosen.join("\n");
  const history = omitted.length + main.length <= historyLimit ? omitted + main : main;
  return `${history}${pending ? `\n\n${pending}` : ""}`;
};
