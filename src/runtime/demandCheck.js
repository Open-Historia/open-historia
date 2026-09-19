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
export const demandCheckPrompt = ({ context, reply, openDemand = null, answering = "" } = {}) => {
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
export const interpretDemandCheck = ({ payload, context, openDemand = null, messageId = "", time = "", idFor } = {}) => {
  const outcome = norm(payload?.outcome);
  const summary = str(payload?.summary);
  const role = context?.role;
  const allowed = role === "overlord" ? OVERLORD_OUTCOMES : role === "puppet" ? PUPPET_OUTCOMES : [];
  if (!allowed.includes(outcome) || outcome === "none") return [];
  const mint = typeof idFor === "function" ? idFor : (prefix) => `${prefix}-${Date.now().toString(36)}`;

  if (role === "overlord") {
    if (outcome === "demand") {
      if (!summary) return [];
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

  // The Puppet answers only a demand still open: an answer is final.
  if (!openDemand || openDemand.status !== "open") return [];
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
  if (!same(player, demand.target) || demand.status !== "open") return null;
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
