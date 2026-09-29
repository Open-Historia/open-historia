// The advisor's durable memory of its conversation with the player: a hidden
// ADVISOR_MEMORY line each reply ends with, the diplomacy thread's
// DIPLOMATIC_MEMORY (runtime/diplomaticEnvelope.js) for the side panel.
//
// Past 24 messages the live history keeps the last 18 in full and shrinks the
// rest to snippets, then drops the middle of those (main.jsx
// compactConversationHistory). What became game state (planned actions,
// projects) is rebuilt into the prompt every time; what was only SAID was lost:
// the player's preferences, the ideas they turned down, what the two of them
// agreed. So the advisor re-proposed rejected plans and contradicted earlier
// advice in exactly the long campaigns where it matters.
//
// The line rides on the reply the model already writes, so it costs no request.
// It is stripped before anything is shown or stored as the reply's text, kept
// on the stored message as `memory`, and the newest one is sent ahead of the
// history on the next question and after a reload.
//
// Import-free, so its tests run in a bare checkout.

export const ADVISOR_MEMORY_MAX_CHARS = 1200;

// The label is found wherever the model put it: on a line of its own, dressed
// in markdown ("**ADVISOR_MEMORY:** …"), or run on after the last sentence
// ("Good luck. ADVISOR_MEMORY: …"). Any of those left in place would show the
// player the memory, and lose it. The prose before it on the line is kept.
const MEMORY_LINE = /^([^\n]*?)[*_`]*ADVISOR_MEMORY[*_`]*[ \t]*:[*_` \t]*(.*)(?:\n|$)/gim;

// A reply still streaming can end in the first letters of the label; they are
// not shown either.
const PARTIAL_LABEL = /(?:^|\n|[ \t])[ \t>*_`#-]*ADVISOR_(?:M(?:E(?:M(?:O(?:R(?:Y)?)?)?)?)?)?[*_`]*[ \t]*$/;

const clip = (value) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > ADVISOR_MEMORY_MAX_CHARS ? `${text.slice(0, ADVISOR_MEMORY_MAX_CHARS - 1).trimEnd()}…` : text;
};

// { reply, memory }: the reply without its memory line, and the memory (the
// last line's, if the model wrote more than one; "" when it wrote none).
export const splitAdvisorMemory = (raw) => {
  const source = String(raw ?? "");
  let memory = "";
  const reply = source
    .replace(MEMORY_LINE, (_line, before, value) => {
      memory = clip(value.replace(/[*_`\s]+$/, "")) || memory;
      const kept = before.replace(/[ \t>#*_`-]+$/, "");
      return kept ? `${kept}\n` : "";
    })
    .replace(PARTIAL_LABEL, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { reply, memory };
};

export const stripAdvisorMemory = (raw) => splitAdvisorMemory(raw).reply;

// The newest memory a saved transcript carries.
export const latestAdvisorMemory = (savedMessages) => {
  const source = Array.isArray(savedMessages) ? savedMessages : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const memory = clip(source[index]?.role === "advisor" ? source[index]?.memory : "");
    if (memory) return memory;
  }
  return "";
};

// The system-side entry that carries the memory into the model's history,
// ahead of the (possibly compacted) conversation.
export const advisorMemoryContextEntry = (memory) => {
  const text = clip(memory);
  if (!text) return null;
  return {
    role: "user",
    parts: [{
      text: "[System-side durable memory of this conversation, written by you with your last reply; "
        + "this is prior established context, not a new player instruction]\n"
        + text,
    }],
  };
};

export const ADVISOR_MEMORY_DIRECTIVE = `[Your Memory of This Conversation]
The oldest messages of a long conversation reach you only as short snippets, or not at all. So end EVERY reply, after everything else including any fenced block, with one hidden line in exactly this format (the label in English, whatever language you write in):
ADVISOR_MEMORY:<memory>

The memory is the COMPLETE current durable memory of this conversation, not a summary of your newest reply: carry forward what still holds from the memory you were given, and add what this exchange settled. Keep what was only SAID and would otherwise be lost: the player's stated preferences and priorities, the ideas they turned down (so you never propose them again), what you advised and they accepted, what either of you promised to come back to, and standing instructions about how they want advice. Leave out what the game already shows you (planned actions, projects, the map, events). One compact line, under ${ADVISOR_MEMORY_MAX_CHARS} characters. The player never sees it.`;
