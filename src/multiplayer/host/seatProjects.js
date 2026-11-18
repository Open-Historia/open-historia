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
//   update   its funding, who may know of it (secrecy), and the plan of one
//            still planning: what a government does to its own programmes
//            (gameState.js applyProjectOpsToWorld). Never what the story says
//            of one (lastUpdate, a verdict on intelligence): that is the
//            world's, in the round's request;
//   cancel   called off (fail and close are the story's).
//
// A plan is held to what a government decides for its own country: its own
// figures, its relations with others, its structures and unit types, and land
// it may CLAIM; what it does to another country's figures or land is the
// world's to say, in the round's one request (rule 10), which reads the
// board. A structure it builds stands on its own ground, held to the host's
// own map as a formation raised or a structure moved is (structurePlacement.js
// structureMoveRefusal, onOwnGround below): any point on Earth was taken, another player's
// capital included (the follow-ups of 2026-11-18). And it is priced by what it
// does, by the engine's own measures (runtime/projectEngine.js
// pricePlanForOwner), so the seat's own project budget bounds how much it
// does. A seat runs at most SEAT_OPEN_PROJECTS_MOST open projects at once:
// every one stands on the game's board through the round's skip
// (runtime/seatBoards.js), which is what that skip's prompt lists.
//
// Single player is untouched: its board's ops are the player's own device's,
// whose AI is the world there.
//
// Pure: the host hands in the seat's board and the world it reads the seat's
// means from, its own chart of the map (runtime/warRoomChart.js chartOf), and a
// maker of ids.

import { EFFECT_TYPES, normalizeProjectPlan, pricePlanForOwner, sheetOf } from "../../runtime/projectEngine.js";
import { isProjectOpen } from "../../runtime/projects.js";
// The sea off a country's own land, as a structure may be moved to it.
import { STRUCTURE_SEA_KM } from "../../runtime/structurePlacement.js";
import { sameName } from "../../../server/nameKey.js";

// How many open projects of its own one seat may run at once: every one is
// lent to each skip (runtime/seatBoards.js lendBoards), and its prompt lists it.
export const SEAT_OPEN_PROJECTS_MOST = 8;
// The longest note a page's "cancel" keeps.
const NOTE_MOST = 240;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const opOf = (raw) => clean(raw?.op || raw?.action).toLowerCase();
// The fields a government gives a new effort of its own.
const CREATE_FIELDS = Object.freeze(["name", "summary", "kind", "secrecy", "tags", "focus"]);
// Who may know of a programme (gameState.js normalizeProjectEntry).
const SECRECY_LEVELS = new Set(["public", "restricted", "covert"]);

// Why a page's op was not taken, in the host's words (rule 10).
export const PROJECT_REFUSALS = Object.freeze({
  theirs: "That is not one of your own programmes.",
  story: "In a shared game a project is funded, planned or called off; what becomes of it is the round's to tell.",
  ops: "That is nothing a government does to its own projects.",
  most: `You run ${SEAT_OPEN_PROJECTS_MOST} projects at once already: finish or call one off before you open another.`,
  chart: "The map could not be read to see whose ground that is: try again.",
});

// Where a structure stands: its own point, else the project's focus; null for
// neither (it then stands where the story later says, or nowhere).
const pointOf = (effect, focus) => {
  const lng = Number(effect?.lng);
  const lat = Number(effect?.lat);
  if (effect?.lng !== undefined && effect?.lat !== undefined && Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
  const at = { lng: Number(focus?.lng), lat: Number(focus?.lat) };
  return isRecord(focus) && Number.isFinite(at.lng) && Number.isFinite(at.lat) ? at : null;
};
// Whether `owner` holds the ground at a point, on the host's own map (`chart`):
// its land, its own or taken, or the sea within STRUCTURE_SEA_KM of it, as a
// formation is raised (forces.js deployPlaceRefusal) and a structure moved.
const onOwnGround = (owner, { lng, lat }, chart) => {
  const held = chart.holds(owner, lng, lat);
  if (held === true) return true;
  if (held === false) return false;
  return Boolean(typeof chart.sea === "function" && chart.sea(lng, lat)
    && typeof chart.landNear === "function" && chart.landNear(owner, lng, lat, STRUCTURE_SEA_KM));
};
const readable = (chart) => Boolean(chart) && typeof chart.holds === "function";
const typeOf = (effect) => clean(effect?.type || effect?.system) || (EFFECT_TYPES.includes(clean(effect?.kind)) ? clean(effect.kind) : "");
// Whether a plan builds a structure at a point (its own, or the focus), which
// is then held to the host's map.
const placesStructure = (plan, focus) => isRecord(plan)
  && [...list(plan.effects), ...list(plan.yields)].some((effect) => isRecord(effect) && typeOf(effect) === "structure" && pointOf(effect, focus));
// Whether a page's ops plan a structure: the host reads its chart of the map
// for such a request only (host/gameHost.js "projectOps").
export const opsPlaceStructures = (ops) => list(ops).some((raw) => {
  if (!isRecord(raw)) return false;
  const source = isRecord(raw.project) ? raw.project : isRecord(raw.patch) ? raw.patch : raw;
  return isRecord(source.plan) && [...list(source.plan.effects), ...list(source.plan.yields)].some((effect) => isRecord(effect) && typeOf(effect) === "structure");
});

// A plan as the seat's own government may make it: its effects and yields on
// its own country, its relations, and claims, priced by what they do, and the
// structures it builds on its own ground, at the point each stands (its own,
// or the project's `focus`). null for no plan. `owner`: the seat's country;
// `world`: the host's, for its means; `chart`: the host's map (a plan that
// builds at a point is refused when it could not be read: seatProjectOps).
export const seatPlanOf = (plan, { owner = "", world = {}, chart = null, focus = null } = {}) => {
  if (!isRecord(plan) || !normalizeProjectPlan(plan)) return null;
  const own = (effect) => {
    if (!isRecord(effect)) return [];
    // Its type as the engine reads one (projectEngine.js normalizeProjectEffect).
    const type = typeOf(effect);
    const named = clean(effect.country);
    if (!EFFECT_TYPES.includes(type)) return [];
    // A figure of its own country's, and nobody else's.
    if (type === "stat") return named && !sameName(named, owner) ? [] : [{ ...effect, country: "" }];
    // Land it may claim; a border moves by war or by treaty.
    if (type === "territory") return named && !sameName(named, owner) ? [] : [{ ...effect, country: owner, claim: true }];
    // A structure on its own ground, at the point it stands.
    if (type === "structure") {
      const at = pointOf(effect, focus);
      if (!at) return [effect];
      return readable(chart) && onOwnGround(owner, at, chart) ? [{ ...effect, lng: at.lng, lat: at.lat }] : [];
    }
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
// `mint()` makes a project's id; `chart` is the host's map, read when the ops
// build a structure at a point (opsPlaceStructures).
export const seatProjectOps = (ops, { board = [], world = {}, country = "", mint = () => "", chart = null } = {}) => {
  const out = [];
  let refusal = "";
  const refuse = (reason) => {
    if (!refusal) refusal = PROJECT_REFUSALS[reason];
  };
  const named = (raw) => clean((isRecord(raw?.project) ? raw.project.name || raw.project.title : "") || raw?.name || raw?.title);
  const onBoard = (name) => list(board).find((row) => sameName(row?.name, name)) ?? null;
  const ownRow = (row) => isRecord(row) && (!clean(row.ownerCode) || sameName(row.ownerCode, country));
  // Its own open work, and what this request opens.
  let open = list(board).filter((row) => ownRow(row) && isProjectOpen(row)).length;
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
      // A board keeps one entry of a name: one of that name another country's
      // (what the seat's services know of, or on the host's board the
      // countries the AI plays) is theirs, and a create was taken as its restatement.
      if (restated && !ownRow(restated)) {
        refuse("theirs");
        continue;
      }
      if (!restated && open >= SEAT_OPEN_PROJECTS_MOST) {
        refuse("most");
        continue;
      }
      if (placesStructure(source.plan, source.focus) && !readable(chart)) {
        refuse("chart");
        continue;
      }
      const project = Object.fromEntries(CREATE_FIELDS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
      const plan = seatPlanOf(source.plan, { owner: country, world, chart, focus: source.focus });
      out.push({ op: "create", project: { ...project, name, id: restated ? clean(restated.id) : mint(), ...(plan ? { plan } : {}) } });
      if (!restated) open += 1;
      continue;
    }
    const target = { projectId: clean(raw.projectId || raw.id), name: clean(raw.name || (typeof raw.project === "string" ? raw.project : "")) };
    if (!target.projectId && !target.name) continue;
    if (op === "update") {
      // Where the game's own door reads an update's fields (gameState.js normalizeProjectOp).
      const patch = isRecord(raw.patch) ? raw.patch : isRecord(raw.project) ? raw.project : raw;
      // A plan's structure with no point of its own stands at the entry's focus.
      const focus = (list(board).find((row) => (target.projectId && clean(row?.id) === target.projectId) || (target.name && sameName(row?.name, target.name))) ?? null)?.focus ?? null;
      if (isRecord(patch.plan) && placesStructure(patch.plan, focus) && !readable(chart)) {
        refuse("chart");
        continue;
      }
      const plan = isRecord(patch.plan) ? seatPlanOf(patch.plan, { owner: country, world, chart, focus }) : null;
      const funding = clean(patch.funding);
      const secrecy = SECRECY_LEVELS.has(clean(patch.secrecy).toLowerCase()) ? clean(patch.secrecy).toLowerCase() : "";
      if (!funding && !plan && !secrecy) {
        refuse("story");
        continue;
      }
      out.push({ op: "update", ...target, patch: { ...(funding ? { funding } : {}), ...(secrecy ? { secrecy } : {}), ...(plan ? { plan } : {}) } });
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
