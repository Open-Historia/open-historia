/*! Open Historia — what a player's screen may ask of its own Projects board © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A player's Projects board is changed in a shared game by the "projectOps"
// request (game/messages.js), which the host applies through the game's own
// door (gameState.js applyProjectOpsToWorld) to that seat's own board
// (host/gameHost.js). The ops come from the page: its panel's buttons, its
// advisor's entries, and a plan its own device's AI wrote (gameplay.js
// planProject) or anything else. The review of 2026-11-18 found the host took
// from them what only the host's game decides:
//
//   - a create was read with the reader of the board's saved entries, so its
//     id, its dates, that it was set up already and a completion of its own
//     that dissolved another player's country came from the page;
//   - its plan was taken as a fact of the world: the bounds on each effect
//     held, but not whom an effect hit, whether it was paid for, or how many
//     there were (twenty projects at no cost, each taking eight points off a
//     rival's army, in one round);
//   - `by: "advisor"` was the page's own word, and it lifted the panel's
//     limits (a verdict that took up work the engine had stalled).
//
// So every op a page sends is made again here, by the host, from what a
// government may decide for its own work and nothing else:
//
//   create   a new effort of the seat's own country: its name, summary, kind,
//            secrecy, tags, focus and plan. Its id is the host's; its dates
//            are the game's (applyProjectOps dates it as it is applied);
//            nothing of what the engine records of one under way comes with it;
//   update   its funding, and the plan of one still planning: what a
//            government does to its own programmes. Never what the story says
//            of one (lastUpdate, a verdict on intelligence): that is the
//            world's, in the round's request;
//   cancel   called off (fail and close are the story's).
//
// A plan is held to what a government decides for its own country: its own
// figures, its relations with others, its structures and unit types, and land
// it may CLAIM; what it does to another country's figures or land is the
// world's to say, in the round's one request (rule 10), which reads the
// board. And it is priced by what it does, by the engine's own measures
// (runtime/projectEngine.js pricePlanForOwner), so the seat's own project
// budget bounds how much it does. A seat runs at most SEAT_OPEN_PROJECTS_MOST
// open projects at once: every one stands on the game's board through the
// round's skip (host/seatBoards.js), which holds a fixed number.
//
// Single player is untouched: its board's ops are the player's own device's,
// whose AI is the world there.
//
// Pure: the host hands in the seat's board and the world it reads the seat's
// means from, and a maker of ids.

import { EFFECT_TYPES, normalizeProjectPlan, pricePlanForOwner, sheetOf } from "../../runtime/projectEngine.js";
import { isProjectOpen } from "../../runtime/projects.js";
import { sameName } from "../../../server/nameKey.js";

// How many open projects of its own one seat may run at once. Eight seats of
// eight, with the countries nobody plays at theirs, fit the game's board
// through a skip (host/seatBoards.js BOARD_LIMIT).
export const SEAT_OPEN_PROJECTS_MOST = 8;
// The longest note a page's "cancel" keeps.
const NOTE_MOST = 240;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const opOf = (raw) => clean(raw?.op || raw?.action).toLowerCase();
// The fields a government gives a new effort of its own.
const CREATE_FIELDS = Object.freeze(["name", "summary", "kind", "secrecy", "tags", "focus"]);

// Why a page's op was not taken, in the host's words (rule 10).
export const PROJECT_REFUSALS = Object.freeze({
  theirs: "That is not one of your own programmes.",
  story: "In a shared game a project is funded, planned or called off; what becomes of it is the round's to tell.",
  ops: "That is nothing a government does to its own projects.",
  most: `You run ${SEAT_OPEN_PROJECTS_MOST} projects at once already: finish or call one off before you open another.`,
});

// A plan as the seat's own government may make it: its effects and yields on
// its own country, its relations, and claims, priced by what they do. null for
// no plan. `owner`: the seat's country; `world`: the host's, for its means.
export const seatPlanOf = (plan, { owner = "", world = {} } = {}) => {
  if (!isRecord(plan) || !normalizeProjectPlan(plan)) return null;
  const own = (effect) => {
    if (!isRecord(effect)) return [];
    // Its type as the engine reads one (projectEngine.js normalizeProjectEffect).
    const type = clean(effect.type || effect.system) || (EFFECT_TYPES.includes(clean(effect.kind)) ? clean(effect.kind) : "");
    const named = clean(effect.country);
    if (!EFFECT_TYPES.includes(type)) return [];
    // A figure of its own country's, and nobody else's.
    if (type === "stat") return named && !sameName(named, owner) ? [] : [{ ...effect, country: "" }];
    // Land it may claim; a border moves by war or by treaty.
    if (type === "territory") return named && !sameName(named, owner) ? [] : [{ ...effect, country: owner, claim: true }];
    return [effect];
  };
  const shaped = {
    ...plan,
    effects: list(plan.effects).flatMap(own),
    ...(Array.isArray(plan.yields) ? { yields: plan.yields.flatMap(own) } : {}),
  };
  const sheet = sheetOf(world, owner);
  return pricePlanForOwner(shaped, sheet, { sheetFor: (country) => sheetOf(world, country) });
};

// The ops the host applies for a page's `ops`, on the seat's own `board`:
// { ops, refusal }, `refusal` the first reason one was left out ("" for none).
// `mint()` makes a project's id.
export const seatProjectOps = (ops, { board = [], world = {}, country = "", mint = () => "" } = {}) => {
  const out = [];
  let refusal = "";
  const refuse = (reason) => {
    if (!refusal) refusal = PROJECT_REFUSALS[reason];
  };
  const named = (raw) => clean((isRecord(raw?.project) ? raw.project.name || raw.project.title : "") || raw?.name || raw?.title);
  const onBoard = (name) => list(board).find((row) => sameName(row?.name, name)) ?? null;
  // Its own open work, and what this request opens.
  let open = list(board).filter((row) => isRecord(row) && isProjectOpen(row) && (!clean(row.ownerCode) || sameName(row.ownerCode, country))).length;
  for (const raw of list(ops)) {
    if (!isRecord(raw)) continue;
    const op = opOf(raw);
    const source = op === "create" && isRecord(raw.project) ? raw.project : raw;
    const owner = clean(source.ownerCode || source.owner || source.code || raw.ownerCode);
    if (owner && !sameName(owner, country)) {
      refuse("theirs");
      continue;
    }
    if (op === "create") {
      const name = named(raw);
      if (!name) continue;
      const restated = onBoard(name);
      if (!restated && open >= SEAT_OPEN_PROJECTS_MOST) {
        refuse("most");
        continue;
      }
      const project = Object.fromEntries(CREATE_FIELDS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
      const plan = seatPlanOf(source.plan, { owner: country, world });
      out.push({ op: "create", project: { ...project, name, id: restated ? clean(restated.id) : mint(), ...(plan ? { plan } : {}) } });
      if (!restated) open += 1;
      continue;
    }
    const target = { projectId: clean(raw.projectId || raw.id), name: clean(raw.name || (typeof raw.project === "string" ? raw.project : "")) };
    if (!target.projectId && !target.name) continue;
    if (op === "update") {
      // Where the game's own door reads an update's fields (gameState.js normalizeProjectOp).
      const patch = isRecord(raw.patch) ? raw.patch : isRecord(raw.project) ? raw.project : raw;
      const plan = isRecord(patch.plan) ? seatPlanOf(patch.plan, { owner: country, world }) : null;
      const funding = clean(patch.funding);
      if (!funding && !plan) {
        refuse("story");
        continue;
      }
      out.push({ op: "update", ...target, patch: { ...(funding ? { funding } : {}), ...(plan ? { plan } : {}) } });
      continue;
    }
    if (op === "cancel") {
      out.push({ op: "cancel", ...target, note: clean(raw.note).slice(0, NOTE_MOST) });
      continue;
    }
    refuse(op === "fail" || op === "close" || op === "setback" || op === "boost" ? "story" : "ops");
  }
  return { ops: out, refusal };
};
