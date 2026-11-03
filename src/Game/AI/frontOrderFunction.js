/*! Open Historia — the function a time skip calls to give a player's troops their orders © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A time skip is asked for with its period's land war already fought
// (frontApply.js forecastTurnFronts): the battles as they go IF NOBODY A PERSON
// PLAYS ORDERS ANYTHING NEW. A player may have typed just such an order as an
// action of the turn ("I withdraw my troops"; "the north digs trenches, the
// south pushes for the city"). The model reads the action, so the model is who
// knows: it calls this function with the order, the period is fought AGAIN
// with it, from the day it is given, and the account of that is what the
// function answers. The events are then written from the war as it really
// went. Nothing here guesses from the action's words what it means.
//
// The orders the function was given are kept with the turn (`given`), and the
// run that applies the turn is that second run again, order for order.
//
// It is a function call, so it is a request more, out of the skip's own budget
// of function rounds; a skip in which no action commands troops never calls it
// and stays one request.
//
// Pure but for what it is handed. Loads in plain Node.

import { diffGameDays, formatGameDate, parseGameDate } from "../../runtime/gameDates.js";
import { FRONT_ORDER_SEPARATOR, decodeFrontOrders, isStrikeOrder } from "./nativeFrontLedger.js";

export const FRONT_ORDER_FUNCTION = "order_troops";
// The most orders one skip's actions are read as, and the most times the period is fought again.
export const GIVEN_ORDERS_MOST = 12;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);
const TRANSPORT_WORDS = new Set(["ship", "rail", "airlift"]);

export const FRONT_ORDER_TOOL = Object.freeze({
  name: FRONT_ORDER_FUNCTION,
  description:
    "Gives the troops of a country a person plays the orders that person's actions of this turn give them, and fights the period again with them. "
    + "The battlefields you were shown are the period as it goes if no such order is given. Call this BEFORE you write any event, once, with every "
    + "such order; it answers with the battlefields as the period leaves them now and what happened on them by date, and that is the war your events tell. "
    + "Call it only for what a player's action orders their own troops to do; never for a country nobody plays, whose orders go in frontOrders.",
  schema: {
    type: "object",
    description: "The orders.",
    properties: {
      orders: {
        type: "string",
        description:
          `One order a line, fields separated by ${FRONT_ORDER_SEPARATOR}: battlefield, side, order, sector, date, objective. `
          + "battlefield and sector as the battlefields list gives them; side is the player's country by its exact name; order is one of the order words of the rules; "
          + "date is the day the order is given as YYYY-MM-DD with the year exactly as the period's dates write it, leading zeros and all (0354-02-13, never 2354-02-13 or 354-02-13), or blank for the period's first day; objective is a place, where the order has one. "
          + "A draft or reinforcements sent to a front is the order reinforce, with how many formations (1 to 60) as its objective. "
          + "An action that orders different stretches of the line differently is a line for each.",
      },
    },
    required: ["orders"],
    additionalProperties: false,
  },
});

// The lines of a call read into orders the engine is given.
//   players    the countries people play: an order for anybody else is refused
//   fromDate   the period's first day
//   days       how many days it runs
// Returns { given, refused }: `given` are front-order records marked
// `now: true` with the `date` they are given on; `refused` say why not, in words.
// The day an order is given on: its date, when it is one of the period's. A
// model writing an early year sometimes gets the millennium wrong - 2354-02-13
// for 0354-02-13 (a Discord test game, 2026-10-27) - so a date outside the
// period whose month and day are one of the period's days is read as that day
// (in the period's own year, or the next where the period runs past New Year).
// Anything else is the period's first day, as a blank date is.
export const dayOfPeriod = (said, { fromDate = "", days = 0 } = {}) => {
  const first = { date: clean(fromDate), day: 0 };
  const within = (date) => {
    const day = diffGameDays(fromDate, date);
    return day !== null && day >= 0 && day < days ? { date, day } : null;
  };
  const parts = /^\d{1,6}-\d{1,2}-\d{1,2}$|^-\d+-\d{1,2}-\d{1,2}$/.test(clean(said)) ? parseGameDate(said) : null;
  if (!parts) return first;
  const exact = within(formatGameDate(parts));
  if (exact) return exact;
  const start = parseGameDate(fromDate);
  if (!start) return first;
  for (const year of [start.year, start.year + 1]) {
    const moved = within(formatGameDate({ ...parts, year }));
    if (moved) return moved;
  }
  return first;
};

export const readGivenOrders = (value, { players = [], fromDate = "", days = 0 } = {}) => {
  const played = new Set(asArray(players).map(fold).filter(Boolean));
  const given = [];
  const refused = [];
  const lines = String(value ?? "").split(/\r?\n/).map(clean).filter(Boolean);
  lines.forEach((line, index) => {
    const fields = line.split(FRONT_ORDER_SEPARATOR).map(clean);
    const said = fields[4] ?? "";
    // (The fifth field is the events an order rests on, in an answer's own lines: here it is the day.)
    fields[4] = "";
    const [record] = decodeFrontOrders([fields.join(FRONT_ORDER_SEPARATOR)]);
    if (!record) return;
    const refuse = (why) => refused.push(`${line}: ${why}`);
    if (record.problem) return refuse(record.problem);
    if (isStrikeOrder(record.order) || TRANSPORT_WORDS.has(record.order)) return refuse("only an order for troops on a battlefield is given here; a strike or a transporter goes in frontOrders");
    if (!played.has(fold(record.side))) return refuse(`${record.side || "nobody"} is not a country a person plays; its orders go in frontOrders`);
    if (given.length >= GIVEN_ORDERS_MOST) return refuse("too many orders for one period");
    const { date, day } = dayOfPeriod(said, { fromDate, days });
    given.push({ ...record, id: `given-${index}`, eventIds: [], eventIndexes: [], now: true, date, day });
  });
  return { given, refused };
};

// A task's function calls with this one among them.
//   lookups   what the task already offers ({ tools, execute, maxRounds? }), or null
//   refight   async (given) => text: fights the period again and words it
//   context   what readGivenOrders needs
// The function is answered once a skip: a second call is told to write.
export const withFrontOrderFunction = (lookups, { refight, players = [], fromDate = "", days = 0 } = {}) => {
  if (typeof refight !== "function") return lookups ?? null;
  let answered = false;
  return {
    ...(lookups ?? {}),
    tools: [FRONT_ORDER_TOOL, ...asArray(lookups?.tools)],
    execute: async (name, args) => {
      if (name !== FRONT_ORDER_FUNCTION) return typeof lookups?.execute === "function" ? lookups.execute(name, args) : `There is no function called ${name}.`;
      if (answered) return "The period has been fought again once already with the orders you gave. Write the events from that account now.";
      const { given, refused } = readGivenOrders(args?.orders, { players, fromDate, days });
      const said = refused.length ? `\nNot taken: ${refused.join("; ")}.` : "";
      if (given.length === 0) return `No order was taken, so the period stands as you were shown it.${said}`;
      answered = true;
      const account = await refight(given);
      if (!account) return `The period could not be fought again; it stands as you were shown it. Write the player's order as a line of frontOrders instead, resting on the event that carries the action.${said}`;
      return `The period fought again with ${given.length === 1 ? "that order" : `those ${given.length} orders`}, each from the day it was given. This replaces the battlefields you were shown: write the events from it, and do not write these orders again in frontOrders.${said}\n${account}`;
    },
  };
};
