/*! Open Historia Continuum - presentation helpers for live institution lifecycle conversations. */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const speakerSeed = (speaker = "", index = 0) => {
  let seed = (Number(index) || 0) * 7919;
  for (const char of clean(speaker)) seed = ((seed * 33) + char.codePointAt(0)) >>> 0;
  return seed >>> 0;
};

// The AI still answers the whole table in one request. This delay is presentation
// only: reveal the first reply immediately, then let later governments appear at
// human-readable intervals instead of dumping a multi-government answer at once.
export const lifecycleReplyRevealGapMs = (speaker = "", index = 0) => (
  1000 + (speakerSeed(speaker, index) % 2001)
);

export const buildLifecycleReplyRevealPlan = ({ messages = [], newMessageIds = [] } = {}) => {
  const ids = new Set((Array.isArray(newMessageIds) ? newMessageIds : []).map((id) => String(id ?? "").trim()).filter(Boolean));
  const replies = (Array.isArray(messages) ? messages : []).filter((message) => ids.has(String(message?.id ?? "").trim()));
  let elapsedMs = 0;
  return replies.map((message, index) => {
    const gapMs = index === 0 ? 0 : lifecycleReplyRevealGapMs(message?.speaker, index);
    elapsedMs += gapMs;
    return { message, gapMs, revealAtMs: elapsedMs };
  });
};
