/*! Open Historia — a finished skip kept for its campaign, across a restart © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A time skip that finishes after the player opened another campaign is not
// written there (campaignGuard.js) and not thrown away either: it is kept for
// its own campaign (gameplay.js finishTimelineJump), and the player applies or
// discards it from that campaign's Timeline. Kept in memory for the session and
// in the campaign's own store (GET/PUT/DELETE /api/games/:id/parked-turn), so
// closing the app does not lose it.
//
// This file turns the apply's arguments into plain data for the store and back.
// Everything the apply needs is in them: the state the turn was read from, the
// merged result, the turn review's answers, the skip's request budget and its
// replay (heldTurnReplay.js), which holds every answer the apply was given
// before it reached the write, so writing the turn later asks for none of them
// again. What cannot be stored is left out and made afresh: the Cancel signal
// (the Apply button's own), the phase tracker (it spoke to a panel long gone),
// and the bundle, which is the same state the base fields hold.
//
// Import-light, so node tests can drive it.

import { createJumpBudget } from "./requestBudget.js";
import { createTurnReplay } from "./heldTurnReplay.js";

export const PARKED_TURN_VERSION = 1;

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const campaignKey = (value) => String(value ?? "").trim();

// The skip's request budget (gameplay.js createJumpRequests), as data.
const savedRequests = (requests) => (requests?.budget
  ? {
    saving: requests.saving === true,
    used: Number(requests.used) || 0,
    refused: Number(requests.refused) || 0,
    budget: { cap: requests.budget.cap, unlimited: requests.budget.unlimited === true, ...requests.budget.state },
  }
  : null);

export const restoreJumpRequests = (saved) => {
  if (!isObject(saved) || !isObject(saved.budget)) return null;
  const { cap, unlimited, spends, reservations } = saved.budget;
  return {
    saving: saved.saving === true,
    budget: createJumpBudget({ cap, unlimited: unlimited === true, state: { spends, reservations } }),
    used: Math.max(0, Number(saved.used) || 0),
    refused: Math.max(0, Number(saved.refused) || 0),
  };
};

// What goes into the campaign's store. The base state is stored once: the
// board's bundle is the same objects (finishTimelineJump), rebuilt on restore.
export const parkedTurnRecord = ({ campaignId, applyArgs, parkedAt = new Date().toISOString() }) => {
  const {
    baseActions, baseChats, baseColors, baseEvents, baseGame, baseWorld, result, reveal, projects, replay,
  } = applyArgs;
  return {
    version: PARKED_TURN_VERSION,
    campaignId: campaignKey(campaignId),
    parkedAt,
    // What the turn was read on and where it lands, for the notice and the
    // round check (runtime/turnCommit.js heldTurnOutdated).
    round: Number(baseGame?.round) || 1,
    fromDate: String(baseGame?.gameDate ?? ""),
    toDate: String(result?.stopDate ?? ""),
    turn: { baseActions, baseChats, baseColors, baseEvents, baseGame, baseWorld, result, reveal: reveal ?? "staged" },
    board: Boolean(projects),
    review: projects?.review ?? null,
    requests: savedRequests(projects?.requests),
    replay: typeof replay?.saved === "function" ? replay.saved() : [],
  };
};

// The kept turn a stored record describes, ready for applySimulationResult, or
// null when it is not one this campaign can use (another campaign's, another
// version's, or damaged). Never throws: a record that cannot be read is simply
// not offered.
export const restoreParkedTurn = (record, { campaignId } = {}) => {
  if (!isObject(record) || record.version !== PARKED_TURN_VERSION) return null;
  const campaign = campaignKey(campaignId);
  if (!campaign || campaignKey(record.campaignId) !== campaign) return null;
  const turn = record.turn;
  if (!isObject(turn) || !isObject(turn.result) || !isObject(turn.baseGame) || !isObject(turn.baseWorld)) return null;
  const baseActions = Array.isArray(turn.baseActions) ? turn.baseActions : [];
  const baseChats = Array.isArray(turn.baseChats) ? turn.baseChats : [];
  const baseEvents = Array.isArray(turn.baseEvents) ? turn.baseEvents : [];
  const applyArgs = {
    baseActions,
    baseChats,
    baseColors: isObject(turn.baseColors) ? turn.baseColors : {},
    baseEvents,
    baseGame: turn.baseGame,
    baseWorld: turn.baseWorld,
    campaignId: campaign,
    result: turn.result,
    reveal: turn.reveal === "shown" ? "shown" : "staged",
    projects: record.board === false ? null : {
      bundle: { actions: baseActions, chats: baseChats, events: baseEvents, game: turn.baseGame, world: turn.baseWorld },
      review: isObject(record.review) ? record.review : null,
      requests: restoreJumpRequests(record.requests),
      signal: null,
    },
    phases: null,
    replay: createTurnReplay(record.replay),
  };
  return { campaignId: campaign, applyArgs, stored: true };
};
