/*! Open Historia — spycraft: intelligence stat, spies both ways, discovery, double agents, redaction © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Espionage runs in both directions. The player plants spies in other polities
// and reads their private diplomacy; other polities plant spies in the player
// and read theirs. Every spy can be discovered by the target's service, and a
// discovered spy can be turned into a double agent that feeds its owner what
// the target wants believed. All of it is decided by two numbers — the owner's
// intelligence service and the target's — so the stat is the whole game here.
//
// Pure and dependency-free so all of it is unit-tested without a browser: no
// store reads, no React, no crypto (spySeal.js does that). Randomness is a
// seeded draw, so the same world on the same round always resolves the same way
// and a test can pin every branch.

export const DEFAULT_INTELLIGENCE = 40;
export const MAX_ACTIVE_SPIES = 3;   // per owner
export const MAX_FOREIGN_SPIES = 3;  // in the player at once

const clampPct = (value, fallback = DEFAULT_INTELLIGENCE) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
};
const clamp01 = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

// A polity's intelligence service, 0-100. Absent means "ordinary" rather than
// "none": every country runs one, whether or not the AI has ever rated it.
export const intelligenceOf = (world, polity) =>
  clampPct(world?.intelligence?.[String(polity ?? "").trim()], DEFAULT_INTELLIGENCE);

// FNV-1a over a string -> [0, 1). Stable, so a hidden word stays hidden between
// renders, and a round's discoveries come out the same on every replay.
export const draw = (key) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0) / 0x100000000;
};

// ---- spies ----------------------------------------------------------------
//
// { id, owner, target, deployedAt, status, turnedAt, exposedAt, coverStory, suspected }
//
//   active      in place, reporting to its owner
//   discovered  caught by the target, who has not yet decided what to do with it
//               (only ever the PLAYER's decision to make — an AI target decides
//               on the spot). Reports nothing while it waits.
//   turned      a double agent: still "reporting" to its owner, but what it
//               reports is whatever the target plants. The owner is not told.
//   exposed     caught and expelled. Finished.
//   recalled    withdrawn by its owner. Finished.

export const SPY_STATUSES = ["active", "discovered", "turned", "exposed", "recalled"];

const normalizeSpy = (entry, index) => {
  const target = String(entry?.target ?? entry?.polity ?? "").trim();
  if (!target) return null;
  const status = SPY_STATUSES.includes(entry?.status) ? entry.status : "active";
  return {
    id: String(entry?.id ?? "").trim() || `spy-${index + 1}`,
    owner: String(entry?.owner ?? "").trim(),
    target,
    deployedAt: String(entry?.deployedAt ?? "").trim(),
    status,
    turnedAt: String(entry?.turnedAt ?? "").trim(),
    exposedAt: String(entry?.exposedAt ?? "").trim(),
    coverStory: String(entry?.coverStory ?? "").trim(),
    suspected: entry?.suspected === true,
  };
};

export const normalizeSpies = (list) =>
  (Array.isArray(list) ? list : []).map(normalizeSpy).filter(Boolean);

const isLive = (spy) => spy.status === "active" || spy.status === "turned";

// The player's own spies that still appear to be working. A turned spy is
// included on purpose: from the owner's side it looks active until suspected.
export const activeSpies = (world, owner) =>
  normalizeSpies(world?.spies).filter((spy) => isLive(spy) && (!owner || spy.owner === owner));

// Every spy some other polity has in `target`, live or awaiting a decision.
export const foreignSpies = (world, target) =>
  normalizeSpies(world?.spies).filter((spy) => spy.target === target && (isLive(spy) || spy.status === "discovered"));

const mintId = (spies, owner, target) => {
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const serial = spies.filter((spy) => spy.owner === owner && spy.target === target).length + 1;
  return `spy-${slug(owner || "x")}-${slug(target)}-${serial}`;
};

// Returns the next spies list, or throws with a message the UI can show verbatim.
export const deploySpy = (world, target, { date = "", playerPolity = "", owner = playerPolity } = {}) => {
  const name = String(target ?? "").trim();
  const who = String(owner ?? "").trim();
  if (!name) throw new Error("Choose a country to deploy to.");
  if (who && name === who) throw new Error("You cannot spy on yourself.");
  const spies = normalizeSpies(world?.spies);
  const mine = spies.filter((spy) => spy.owner === who && isLive(spy));
  if (mine.some((spy) => spy.target === name)) throw new Error(`A spy is already deployed in ${name}.`);
  if (mine.length >= MAX_ACTIVE_SPIES) {
    throw new Error(`Your service can run at most ${MAX_ACTIVE_SPIES} spies at once. Recall one first.`);
  }
  return [...spies, {
    id: mintId(spies, who, name), owner: who, target: name, deployedAt: String(date ?? ""),
    status: "active", turnedAt: "", exposedAt: "", coverStory: "", suspected: false,
  }];
};

const setStatus = (world, id, patch) =>
  normalizeSpies(world?.spies).map((spy) => (spy.id === id ? { ...spy, ...patch } : spy));

export const recallSpy = (world, id) => setStatus(world, id, { status: "recalled" });

// The player's two answers to a discovered foreign spy.
export const expelSpy = (world, id, { date = "" } = {}) => setStatus(world, id, { status: "exposed", exposedAt: date });
export const turnSpy = (world, id, { date = "", coverStory = "" } = {}) =>
  setStatus(world, id, { status: "turned", turnedAt: date, coverStory: String(coverStory ?? "").trim() });
export const setCoverStory = (world, id, coverStory) => setStatus(world, id, { coverStory: String(coverStory ?? "").trim() });

// ---- the odds ---------------------------------------------------------------

// Per jump, the target's service catches a spy. Mostly the GAP between the two
// services, with a floor so a top service is never perfectly safe and a
// ceiling so a hopeless one is not caught on day one.
export const detectionChance = (targetIntelligence, ownerIntelligence) => {
  const t = clampPct(targetIntelligence) / 100;
  const o = clampPct(ownerIntelligence) / 100;
  return clamp01(0.04 + (t - o) * 0.25 + t * 0.10, 0.02, 0.6);
};

// A target that catches a spy either turns it or expels it. Turning takes
// skill; an ordinary service mostly just throws the spy out.
export const turnChance = (targetIntelligence) => clamp01(clampPct(targetIntelligence) / 100 * 0.6, 0.05, 0.6);

// Per jump, the OWNER's service notices that its agent has been turned.
export const suspicionChance = (ownerIntelligence, targetIntelligence) => {
  const o = clampPct(ownerIntelligence) / 100;
  const t = clampPct(targetIntelligence) / 100;
  return clamp01(0.05 + (o - t) * 0.3, 0.02, 0.5);
};

// Per jump, another polity plants a spy in the player. A capable service does
// it as a matter of course; a hostile one goes looking.
//
// `hostile` is a boolean today because the caller (gameplay.js, the
// espionageCandidates block) has no war state to read and guesses it. When
// real wars exist, the intended shape is a 0..1 `hostility` — at peace 0, cold
// rivalry ~0.4, open war 1 — replacing the flat +0.15 with `+ hostility * 0.2`
// so a full war roughly doubles a capable service's odds and a skirmish nudges
// them. Keep the 0.4 cap: three agents in one polity at once is already the
// limit (MAX_FOREIGN_SPIES), and higher per-roll odds just reach it sooner.
export const foreignDeployChance = (polityIntelligence, { hostile = false, hostility = null } = {}) => {
  // Accept the graded form already, so wiring it is a one-line change upstream.
  const h = Number.isFinite(Number(hostility)) ? clamp01(Number(hostility)) : (hostile ? 0.75 : 0);
  return clamp01(clampPct(polityIntelligence) / 100 * 0.12 + h * 0.2, 0, 0.4);
};

// ---- the per-jump resolution ------------------------------------------------
//
// Runs once per jump, after the AI's events have been applied and before the
// world is written. Deterministic: every roll is keyed on the round and the
// spy, so the same inputs always produce the same outcome.
//
// candidates: [{ polity, hostile, hostility? }] — polities that could plant a
// spy in the player this round. The caller knows who is in the world and how
// they stand with the player; this file does not, and must not start to: keep
// war state upstream in gameplay.js and pass its verdict in. `hostility` (0..1)
// is the graded form for when wars carry a scale; `hostile` is the boolean
// stand-in used until then. Both are read by foreignDeployChance.
export const resolveEspionage = (world, { round = 0, date = "", playerPolity = "", candidates = [] } = {}) => {
  const player = String(playerPolity ?? "").trim();
  let spies = normalizeSpies(world?.spies);
  const events = [];
  const notices = [];
  const roll = (key) => draw(`${round}:${key}`);
  const intel = (polity) => intelligenceOf(world, polity);

  spies = spies.map((spy) => {
    if (!isLive(spy)) return spy;
    const targetIntel = intel(spy.target);
    const ownerIntel = intel(spy.owner);

    if (spy.status === "active") {
      if (roll(`${spy.id}:detect`) < detectionChance(targetIntel, ownerIntel)) {
        if (spy.target === player) {
          // The player decides: expel or turn. It stops reporting meanwhile.
          notices.push({ kind: "discovered", spyId: spy.id, owner: spy.owner });
          events.push({
            date, kind: "world", source: "espionage",
            title: `Counter-intelligence uncovers a ${spy.owner} agent`,
            description: `${player}'s security service has identified an agent working for ${spy.owner}. The agent is in custody; how to use them is ${player}'s decision.`,
          });
          return { ...spy, status: "discovered" };
        }
        // An AI target decides on the spot.
        if (roll(`${spy.id}:turn`) < turnChance(targetIntel)) {
          return { ...spy, status: "turned", turnedAt: date }; // silent — the owner is not told
        }
        events.push({
          date, kind: "world", source: "espionage",
          title: `Spy ring rolled up in ${spy.target}`,
          description: `${spy.target} has expelled an agent working for ${spy.owner}, and made the arrest public. Relations with ${spy.owner} are strained.`,
        });
        notices.push({ kind: "exposed", spyId: spy.id, target: spy.target });
        return { ...spy, status: "exposed", exposedAt: date };
      }
      return spy;
    }

    // Turned, and the owner's own service may notice the reports are wrong.
    if (spy.status === "turned" && !spy.suspected && spy.owner === player) {
      if (roll(`${spy.id}:suspect`) < suspicionChance(ownerIntel, targetIntel)) {
        notices.push({ kind: "suspected", spyId: spy.id, target: spy.target });
        events.push({
          date, kind: "world", source: "espionage",
          title: `Doubts about the agent in ${spy.target}`,
          description: `${player}'s analysts suspect the reports coming out of ${spy.target} are being fed to them. The agent may have been turned.`,
        });
        return { ...spy, suspected: true };
      }
    }
    return spy;
  });

  // Other polities plant spies in the player.
  if (player) {
    const inPlayer = () => spies.filter((spy) => spy.target === player && (isLive(spy) || spy.status === "discovered"));
    for (const candidate of candidates) {
      const polity = String(candidate?.polity ?? "").trim();
      if (!polity || polity === player) continue;
      if (inPlayer().length >= MAX_FOREIGN_SPIES) break;
      if (inPlayer().some((spy) => spy.owner === polity)) continue;
      if (roll(`${polity}:deploy`) < foreignDeployChance(intel(polity), { hostile: candidate?.hostile === true, hostility: candidate?.hostility })) {
        spies = [...spies, {
          id: mintId(spies, polity, player), owner: polity, target: player, deployedAt: date,
          status: "active", turnedAt: "", exposedAt: "", coverStory: "", suspected: false,
        }];
      }
    }
  }

  return { spies, events, notices };
};

// ---- redaction ----------------------------------------------------------------

// How much of an intercept survives. The reader's service does the work; the
// target's service resists it, at half weight so that spying on a peer is worth
// doing and spying on a superior service is hard rather than useless. Never
// zero: even the worst intercept yields a word or two, or there is nothing on
// screen to make the reader want a better service.
export const signalClarity = (readerIntelligence, targetIntelligence) => {
  const mine = clampPct(readerIntelligence) / 100;
  const theirs = clampPct(targetIntelligence) / 100;
  const raw = 0.12 + mine * 0.88 - theirs * 0.35;
  return clamp01(Number(raw.toFixed(3)), 0.06, 1);
};

const BLOCK = "█";

// Redacts one message's text. Words are the unit; punctuation stays so the
// rhythm of the sentence survives even when its content does not. Because every
// word keeps the same draw, raising clarity only ever reveals more, never re-hides.
export const redactText = (text, clarity, seed = "") => {
  const c = clamp01(Number(clarity) || 0);
  if (c >= 1) return String(text ?? "");
  let index = 0;
  return String(text ?? "").replace(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu, (word) => {
    const shown = draw(`${seed}:${index}:${word.toLowerCase()}`) < c;
    index += 1;
    return shown ? word : BLOCK.repeat(Math.max(2, Math.min(word.length, 9)));
  });
};

// Applies redaction to a whole (decrypted) exchange. The counterpart and date
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

// ---- intercepts (what a spy produced) -------------------------------------------

// A stored message carries `cipher` (sealed, see spySeal.js); a decrypted one
// carries `text`. Both shapes pass through here so the renderer, the prompt and
// the store can share one normalizer.
const normalizeMessage = (message) => {
  const speaker = String(message?.speaker ?? "").trim() || "Unknown";
  const text = String(message?.text ?? "").trim();
  const cipher = String(message?.cipher ?? "").trim();
  if (!text && !cipher) return null;
  return text ? { speaker, text } : { speaker, cipher };
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

// { [target]: { gatheredAt, round, planted, exchanges } }. `planted` marks a
// report produced while the agent was turned: the file remembers, the player
// does not get told. Anything malformed is dropped rather than rendered.
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
      planted: entry?.planted === true,
      exchanges,
    };
  }
  return out;
};

// ---- what the AI is told ------------------------------------------------------------

// The simulator's view: everything, uncensored, both directions. Handed to the
// jump so espionage changes what happens — an exposed ring sours relations, a
// rival with a live agent acts on what it stole, a planted story is believed.
// `intercepts` here are already DECRYPTED by the caller (the simulator knows
// the truth; only the player is kept in the dark).
export const espionageBrief = (world, intercepts, { playerPolity = "" } = {}) => {
  const player = String(playerPolity ?? "").trim();
  const spies = normalizeSpies(world?.spies);
  const lines = [];
  const mine = spies.filter((spy) => spy.owner === player && isLive(spy));
  const theirs = spies.filter((spy) => spy.target === player && (isLive(spy) || spy.status === "discovered"));
  const finished = spies.filter((spy) => spy.status === "exposed").slice(-4);

  if (mine.length) {
    lines.push(`${player} has agents in: ${mine.map((s) => `${s.target}${s.status === "turned" ? " (TURNED by them — feeding false reports; the player does not know)" : ""}`).join("; ")}.`);
  }
  for (const spy of theirs) {
    if (spy.status === "turned") {
      lines.push(`${spy.owner}'s agent in ${player} has been turned by ${player}. ${spy.owner} believes the agent is loyal${spy.coverStory ? ` and has been told: "${spy.coverStory}"` : ""}. ${spy.owner} should act on that belief.`);
    } else if (spy.status === "discovered") {
      lines.push(`${player} has caught an agent of ${spy.owner} and has not yet decided what to do with them.`);
    } else {
      lines.push(`${spy.owner} has a live agent in ${player} and knows ${player}'s private diplomacy and plans. ${spy.owner} may act on what it knows.`);
    }
  }
  for (const spy of finished) lines.push(`${spy.target} publicly expelled a ${spy.owner} agent on ${spy.exposedAt || "an earlier date"}.`);

  for (const [target, entry] of Object.entries(intercepts || {})) {
    if (!mine.some((s) => s.target === target)) continue;
    for (const exchange of entry.exchanges.slice(0, 3)) {
      const gist = exchange.messages.map((m) => `${m.speaker}: ${m.text}`).join(" / ");
      lines.push(`${entry.planted ? "PLANTED (false, fed to the player's turned agent)" : "Intercepted"} ${target}↔${exchange.counterpart} on ${exchange.subject}: ${gist.slice(0, 400)}`);
    }
  }
  return lines.join("\n");
};

// One other polity's view when it speaks to the player. If it has a live agent
// in the player, it gets the player's private material, redacted by ITS clarity
// against the player's service; if its agent was turned, it gets the cover
// story instead and believes it.
export const foreignAgentBrief = (world, polity, { playerPolity = "", material = "" } = {}) => {
  const player = String(playerPolity ?? "").trim();
  const spy = normalizeSpies(world?.spies).find((s) => s.owner === polity && s.target === player && isLive(s));
  if (!spy) return "";
  if (spy.status === "turned") {
    return spy.coverStory
      ? `Your agent inside ${player} reports: "${spy.coverStory}". You believe this.`
      : `Your agent inside ${player} has sent nothing of substance lately.`;
  }
  if (!material) return `You have an agent inside ${player}, but they have reported nothing this period.`;
  const clarity = signalClarity(intelligenceOf(world, polity), intelligenceOf(world, player));
  return `Your agent inside ${player} has obtained the following (partial — some of it is illegible):\n${redactText(material, clarity, `${spy.id}:material`)}`;
};
