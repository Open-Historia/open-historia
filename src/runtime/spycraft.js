/*! Open Historia — spycraft: intelligence stat, spies, and intercept redaction © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The player can plant a spy in another polity and read that polity's diplomatic
// traffic with third parties. What comes back is partial: an intercept is
// redacted word by word, and how much survives is a contest between the player's
// intelligence service and the target's counter-intelligence, both 0-100 stats
// the AI moves like reputation.
//
// Pure and dependency-free so all of it is unit-tested without a browser: no
// store reads, no React. gameState.js owns persistence; chat.jsx owns display.

export const DEFAULT_INTELLIGENCE = 40;
export const MAX_ACTIVE_SPIES = 3;

const clampPct = (value, fallback = DEFAULT_INTELLIGENCE) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
};

// A polity's intelligence service, 0-100. Absent means "ordinary" rather than
// "none": every country runs one, whether or not the AI has ever rated it.
export const intelligenceOf = (world, polity) =>
  clampPct(world?.intelligence?.[String(polity ?? "").trim()], DEFAULT_INTELLIGENCE);

// ---- spies ----------------------------------------------------------------

const normalizeSpy = (entry, index) => {
  const target = String(entry?.target ?? entry?.polity ?? "").trim();
  if (!target) return null;
  return {
    id: String(entry?.id ?? "").trim() || `spy-${index + 1}`,
    target,
    deployedAt: String(entry?.deployedAt ?? "").trim(),
    status: entry?.status === "recalled" ? "recalled" : "active",
  };
};

export const normalizeSpies = (list) =>
  (Array.isArray(list) ? list : []).map(normalizeSpy).filter(Boolean);

export const activeSpies = (world) => normalizeSpies(world?.spies).filter((spy) => spy.status === "active");

// Returns the next spies list, or throws with a message the UI can show verbatim.
export const deploySpy = (world, target, { date = "", playerPolity = "" } = {}) => {
  const name = String(target ?? "").trim();
  if (!name) throw new Error("Choose a country to deploy to.");
  if (playerPolity && name === String(playerPolity).trim()) throw new Error("You cannot spy on yourself.");
  const spies = normalizeSpies(world?.spies);
  const active = spies.filter((spy) => spy.status === "active");
  if (active.some((spy) => spy.target === name)) throw new Error(`A spy is already deployed in ${name}.`);
  if (active.length >= MAX_ACTIVE_SPIES) {
    throw new Error(`Your service can run at most ${MAX_ACTIVE_SPIES} spies at once. Recall one first.`);
  }
  // Recalled entries are history the timeline may still reference; a redeploy to
  // the same target gets a fresh id rather than reviving the old record. A serial
  // per target, not a timestamp: two deployments in one millisecond collided.
  const serial = spies.filter((spy) => spy.target === name).length + 1;
  const id = `spy-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${serial}`;
  return [...spies, { id, target: name, deployedAt: String(date ?? ""), status: "active" }];
};

export const recallSpy = (world, id) =>
  normalizeSpies(world?.spies).map((spy) => (spy.id === id ? { ...spy, status: "recalled" } : spy));

// ---- redaction ------------------------------------------------------------

// How much of an intercept survives. The player's service does the work; the
// target's service resists it, at half weight so that spying on a peer is worth
// doing and spying on a superior service is hard rather than useless. Never
// zero: even the worst intercept yields a word or two, or there is nothing on
// screen to make the player want a better service.
export const signalClarity = (playerIntelligence, targetIntelligence) => {
  const mine = clampPct(playerIntelligence) / 100;
  const theirs = clampPct(targetIntelligence) / 100;
  const raw = 0.12 + mine * 0.88 - theirs * 0.35;
  return Math.max(0.06, Math.min(1, Number(raw.toFixed(3))));
};

// FNV-1a over a string -> [0, 1). Stable across renders and sessions, so a word
// that is hidden stays hidden until the CLARITY changes — and because every word
// keeps the same draw, raising clarity only ever reveals more, never re-hides.
const draw = (key) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0) / 0x100000000;
};

const BLOCK = "█"; // █

// Redacts one message's text. Words are the unit; punctuation stays so the
// rhythm of the sentence survives even when its content does not. `seed` keys
// the draws, so two intercepts with the same wording redact differently.
export const redactText = (text, clarity, seed = "") => {
  const c = Math.max(0, Math.min(1, Number(clarity) || 0));
  if (c >= 1) return String(text ?? "");
  let index = 0;
  return String(text ?? "").replace(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu, (word) => {
    const shown = draw(`${seed}:${index}:${word.toLowerCase()}`) < c;
    index += 1;
    return shown ? word : BLOCK.repeat(Math.max(2, Math.min(word.length, 9)));
  });
};

// Applies redaction to a whole intercepted exchange. The counterpart and date
// are always legible — knowing WHO the target talks to is the cheapest tier of
// intelligence and the hook that makes a better service worth buying.
export const redactExchange = (exchange, clarity) => ({
  ...exchange,
  messages: (exchange?.messages ?? []).map((message, i) => ({
    ...message,
    text: redactText(message?.text, clarity, `${exchange?.id ?? ""}:${i}`),
  })),
  clarity,
});

// ---- intercepts (what the AI produced, before redaction) -------------------

const normalizeMessage = (message) => {
  const text = String(message?.text ?? "").trim();
  if (!text) return null;
  return { speaker: String(message?.speaker ?? "").trim() || "Unknown", text };
};

const normalizeExchange = (exchange, index, target) => {
  const counterpart = String(exchange?.counterpart ?? "").trim();
  const messages = (Array.isArray(exchange?.messages) ? exchange.messages : []).map(normalizeMessage).filter(Boolean);
  if (!counterpart || messages.length === 0) return null;
  return {
    id: String(exchange?.id ?? "").trim() || `${target}:${index}:${counterpart}`.toLowerCase().replace(/\s+/g, "-"),
    counterpart,
    date: String(exchange?.date ?? "").trim(),
    subject: String(exchange?.subject ?? "").trim(),
    messages,
  };
};

// { [target]: { gatheredAt, round, exchanges } }. Anything malformed is dropped
// rather than rendered as an empty envelope.
export const normalizeIntercepts = (raw) => {
  const out = {};
  for (const [target, entry] of Object.entries(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {})) {
    const name = String(target ?? "").trim();
    const exchanges = (Array.isArray(entry?.exchanges) ? entry.exchanges : [])
      .map((exchange, i) => normalizeExchange(exchange, i, name))
      .filter(Boolean);
    if (!name || exchanges.length === 0) continue;
    out[name] = {
      gatheredAt: String(entry?.gatheredAt ?? "").trim(),
      round: Number.isFinite(Number(entry?.round)) ? Number(entry.round) : 0,
      exchanges,
    };
  }
  return out;
};
