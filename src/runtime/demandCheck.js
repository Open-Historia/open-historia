/*! Open Historia — demand check © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Demands between the player and their own Overlord or Puppet, in the one-on-one
// thread between them: when a reply needs checking, what to ask, and what the
// answer — or the player's own button — becomes in the thread's log.
//
// WHY THIS EXISTS. A demand used to be recorded by an optional hidden line the
// model was asked to add to its reply. A live run showed a model understand a
// refusal ("Belarus's refusal is noted") and still not add it: two in three at
// best one-on-one, none in group chats. So a demand is no longer something a
// reply may or may not mark:
//
//   - the PLAYER's side is buttons on a demand card — explicit, free, and
//     impossible to misread;
//   - the AI's side is one small request (the demandCheck task) whose answer is
//     a REQUIRED choice from a fixed list, asked only here, in the one-on-one
//     thread between the player and their own Overlord or Puppet.
//
// The state itself is chatThreads.js's (demand_made / demand_answered events in
// the thread's log); the Loyalty cost of a refusal is gameState.js's
// chargeRefusals. This module decides only what to ask and what to append.
//
// DELIBERATELY IMPORT-FREE, like chatThreads.js and puppets.js: the rules on
// plain data, tested on their own.

const str = (value) => String(value ?? "").trim();
const norm = (value) => str(value).toLocaleLowerCase();
const same = (left, right) => Boolean(norm(left)) && norm(left) === norm(right);
const nameOf = (entry) => str(entry?.name ?? entry);

// What each side may conclude. Anything else the model answers is ignored.
const OVERLORD_OUTCOMES = ["none", "demand", "accepts_alternative"];
const PUPPET_OUTCOMES = ["none", "accepted", "refused", "alternative"];
export const DEMAND_CHECK_OUTCOMES = Object.freeze([...new Set([...OVERLORD_OUTCOMES, ...PUPPET_OUTCOMES])]);

// The demand still in play in a thread: the newest one open or countered. One
// at a time — a demand made again replaces the last, as an Overlord declining
// an alternative does.
export const openDemandOf = (chat) => [...(Array.isArray(chat?.demands) ? chat.demands : [])]
  .reverse()
  .find((demand) => demand?.status === "open" || demand?.status === "countered") ?? null;

// What the Puppet may still answer — the demand in play, or the last one it
// refused. A refusal is not the end of the conversation: thinking again and
// agreeing answers the same demand over rather than opening a second one.
const ANSWERABLE = new Set(["open", "refused"]);
export const answerableDemandOf = (chat) => [...(Array.isArray(chat?.demands) ? chat.demands : [])]
  .reverse()
  .find((demand) => ANSWERABLE.has(str(demand?.status))) ?? null;

// Is this "demand" only the Overlord repeating something the Puppet has already
// agreed to? A live game filled with cards that way: "Comply fully", "Ensure it
// is done", "Control your personnel" — each classified as a fresh demand for the
// obligation just accepted. One obligation, one card.
const AGREED = new Set(["accepted", "settled"]);
const shorn = (value) => norm(value).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const restatesAgreed = (summary, demands) => {
  const text = shorn(summary);
  if (!text) return false;
  return (Array.isArray(demands) ? demands : []).some((demand) => {
    if (!AGREED.has(str(demand?.status))) return false;
    const agreed = shorn(demand?.summary);
    if (!agreed) return false;
    // The same words, or one wholly inside the other ("Fulfil the Geneva
    // protocols" vs "Fulfil the Geneva protocols in full").
    return agreed === text || agreed.includes(text) || text.includes(agreed);
  });
};

// Whether a reply from `speaker` needs checking, and as which side. Only in the
// one-on-one thread between the player and their OWN Overlord or Puppet, and
// only while that arrangement stands. `participants` are the thread's non-player
// members, as names or { name } entries (a chat's countries).
export const demandCheckContext = ({ world, speaker, playerCountry, participants = [] } = {}) => {
  const others = (Array.isArray(participants) ? participants : []).map(nameOf).filter(Boolean);
  if (others.length !== 1 || !same(others[0], speaker)) return null;
  const rows = Array.isArray(world?.puppets) ? world.puppets : [];
  for (const row of rows) {
    if (norm(row?.status || "active") !== "active") continue;
    if (same(row.overlord, speaker) && same(row.puppet, playerCountry)) {
      return { role: "overlord", overlord: str(row.overlord), puppet: str(row.puppet) };
    }
    if (same(row.puppet, speaker) && same(row.overlord, playerCountry)) {
      return { role: "puppet", overlord: str(row.overlord), puppet: str(row.puppet) };
    }
  }
  return null;
};

// The request text. It names the two countries, what is already on the table,
// and the outcomes THIS speaker may give in THIS state — an Overlord is never
// offered "refused", nor "accepts_alternative" with no alternative to accept.
export const demandCheckPrompt = ({ context, reply, openDemand = null, answering = "", demands = [] } = {}) => {
  const { role, overlord, puppet } = context ?? {};
  const speaker = role === "overlord" ? overlord : puppet;
  const lines = [
    `${overlord} is the overlord of ${puppet}: ${puppet} is a separate country whose will ${overlord} directs.`,
    `A DEMAND is ${overlord} telling ${puppet} to do something, as its overlord — not a request, a suggestion, a threat about something else, or conversation.`,
    "",
  ];
  if (openDemand) {
    lines.push(`Already on the table: ${overlord} demanded "${str(openDemand.summary)}".`);
    if (openDemand.status === "countered") lines.push(`${puppet} offered this alternative instead: "${str(openDemand.alternative)}".`);
    // A refusal can be thought better of, so the outcomes below stay open to
    // the Puppet and the model is told where the conversation actually stands.
    if (openDemand.status === "refused") lines.push(`${puppet} refused it, and may still change its mind and agree.`);
    lines.push("");
  }
  // What is already agreed, so an overlord pressing the point ("see that it is
  // done") is read as that and not as a second demand for the same thing.
  const agreed = (Array.isArray(demands) ? demands : [])
    .filter((demand) => AGREED.has(str(demand?.status)) && str(demand?.summary))
    .slice(-3);
  if (agreed.length) {
    lines.push(`${puppet} has already agreed to: ${agreed.map((demand) => `"${str(demand.summary)}"`).join(", ")}.`);
    lines.push(`Insisting on, praising or checking up on something already agreed is NOT a new demand — that is "none". Only something ${puppet} is not already bound to is.`);
    lines.push("");
  }
  if (answering) lines.push(`The message being answered:`, str(answering), "");
  lines.push(`${speaker}'s reply, which you are classifying:`, str(reply), "");

  const choices = [];
  if (role === "overlord") {
    choices.push("none — the reply makes no demand, and settles nothing");
    choices.push(`demand — the reply demands something of ${puppet}${openDemand ? " (a new demand, or the one already on the table insisted on again)" : ""}. summary: what is demanded, in one line`);
    if (openDemand?.status === "countered") choices.push(`accepts_alternative — ${overlord} accepts ${puppet}'s alternative`);
  } else {
    choices.push("none — the reply does not answer the demand: it stalls, deflects, bargains without offering anything, or talks of something else");
    if (openDemand) {
      choices.push("accepted — the reply agrees to do what was demanded");
      choices.push("refused — the reply refuses what was demanded");
      choices.push("alternative — the reply offers something else instead. summary: the alternative, in one line");
    }
  }
  lines.push("Choose exactly one outcome:", ...choices.map((choice) => `- ${choice}`));
  lines.push("", "summary is \"\" for any outcome that does not ask for one. Judge only what the reply actually says.");
  return lines.join("\n");
};

// What a checked reply becomes in the thread's log: a demand_made, a
// demand_answered, or nothing. An outcome this speaker may not give in this
// state is dropped, never guessed into something else — a false refusal costs
// a Puppet Loyalty it never forfeited.
export const interpretDemandCheck = ({ payload, context, openDemand = null, messageId = "", time = "", idFor, demands = [] } = {}) => {
  const outcome = norm(payload?.outcome);
  const summary = str(payload?.summary);
  const role = context?.role;
  const allowed = role === "overlord" ? OVERLORD_OUTCOMES : role === "puppet" ? PUPPET_OUTCOMES : [];
  if (!allowed.includes(outcome) || outcome === "none") return [];
  const mint = typeof idFor === "function" ? idFor : (prefix) => `${prefix}-${Date.now().toString(36)}`;

  if (role === "overlord") {
    if (outcome === "demand") {
      if (!summary) return [];
      // Not a second card for an obligation the Puppet already took on.
      if (restatesAgreed(summary, demands)) return [];
      const demandId = mint("demand");
      return [{
        id: `${demandId}-made`, kind: "demand_made", time, by: context.overlord, demandId, target: context.puppet, summary,
        ...(messageId ? { messageId } : {}),
        ...(openDemand ? { supersedes: openDemand.id } : {}),
      }];
    }
    // accepts_alternative
    if (openDemand?.status !== "countered") return [];
    return [{ id: mint("demand-answer"), kind: "demand_answered", time, by: context.overlord, demandId: openDemand.id, answer: "alternative_accepted" }];
  }

  // The Puppet answers a demand in play, or one it refused and has thought
  // better of. What it has agreed to it may not take back.
  if (!openDemand || !ANSWERABLE.has(str(openDemand.status))) return [];
  if (outcome === "alternative" && !summary) return [];
  return [{
    id: mint("demand-answer"), kind: "demand_answered", time, by: context.puppet, demandId: openDemand.id, answer: outcome,
    ...(outcome === "alternative" ? { text: summary } : {}),
  }];
};

// The player's answer from a demand card. As the Puppet: accepted, refused, or
// an alternative in their own words. As the Overlord: accepting the Puppet's
// alternative. Null when the player is not the side that may give it.
export const playerAnswerEvent = ({ demand, player, answer, text = "", time = "", idFor } = {}) => {
  if (!demand) return null;
  const mint = typeof idFor === "function" ? idFor : (prefix) => `${prefix}-${Date.now().toString(36)}`;
  if (answer === "alternative_accepted") {
    if (!same(player, demand.by) || demand.status !== "countered") return null;
    return { id: mint("demand-answer"), kind: "demand_answered", time, by: str(player), demandId: demand.id, answer };
  }
  if (!["accepted", "refused", "alternative"].includes(answer)) return null;
  if (!same(player, demand.target) || !ANSWERABLE.has(str(demand.status))) return null;
  const alternative = str(text);
  if (answer === "alternative" && !alternative) return null;
  return {
    id: mint("demand-answer"), kind: "demand_answered", time, by: str(player), demandId: demand.id, answer,
    ...(answer === "alternative" ? { text: alternative } : {}),
  };
};

// The player, as an Overlord, making a demand of their own Puppet — the
// composer's "make this a demand", or rejecting an alternative, which is
// demanding again: revised if they wrote something, the original restated if
// not. It replaces whatever demand was still in play.
export const playerDemandEvent = ({ player, target, text = "", openDemand = null, messageId = "", time = "", idFor } = {}) => {
  const summary = str(text) || str(openDemand?.summary);
  if (!str(player) || !str(target) || !summary) return null;
  const mint = typeof idFor === "function" ? idFor : (prefix) => `${prefix}-${Date.now().toString(36)}`;
  const demandId = mint("demand");
  return {
    id: `${demandId}-made`, kind: "demand_made", time, by: str(player), demandId, target: str(target), summary,
    ...(messageId ? { messageId } : {}),
    ...(openDemand ? { supersedes: openDemand.id } : {}),
  };
};
