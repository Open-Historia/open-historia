/*! Open Historia — each player's own advisor in a shared game: three orders to consider every week © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In a game a host shares (the Discord table, the desktop host), the week's
// own answer brings each player an advisor of their government and three
// orders that advisor would have them give. Nothing is asked for it: it rides
// in the time skip (gameplaySchemas.js JUMP_FORWARD_SCHEMA, sent only by
// withSeatAdvice), and is kept on the world per polity (world.seatAdvice),
// shown only to that polity's player (multiplayer/host/projection.js). The
// same advisor brings them their government's secrets (host/advisorDesk.js).
//
// The advisor is someone of the polity's own court or government, named once
// and kept: the model is shown the one it named and keeps them.

export const SEAT_ADVICE_FIELD = "seatAdvice";
export const SUGGESTIONS_PER_SEAT = 3;
const SUGGESTION_MAX_CHARS = 400;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const same = (a, b) => Boolean(clean(a)) && clean(a).toLocaleLowerCase() === clean(b).toLocaleLowerCase();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// The shape SENT (withSeatAdvice). The answer is READ against a loose one
// (SEAT_ADVICE_ANSWER_SCHEMA): a malformed piece of advice costs that advice,
// cleaned away by mergeSeatAdvice, and never the week.
export const SEAT_ADVICE_SCHEMA = {
  type: "array",
  description: "Each player's advisor and three orders to consider next, one entry per polity named under [Each Player's Advisor], only when that block is present.",
  items: {
    type: "object",
    properties: {
      polity: { type: "string", description: "The player's polity, exactly as named." },
      advisorName: { type: "string", description: "The advisor's name: the one given, or a new one of that polity's own people." },
      advisorTitle: { type: "string", description: "The advisor's office in that government." },
      suggestions: {
        type: "array",
        description: "Three orders, each written as the player would send it.",
        items: { type: "string" },
      },
    },
    required: ["polity", "advisorName", "advisorTitle", "suggestions"],
    additionalProperties: false,
  },
};
export const SEAT_ADVICE_ANSWER_SCHEMA = {
  type: "array",
  description: SEAT_ADVICE_SCHEMA.description,
  items: {},
};

// A time skip's tool with the players' advice in its contract, required in
// what is sent so a small model does not leave it out; the answer is read
// either way. Any other tool, or one that has the field already, as it was.
export const withSeatAdvice = (tool) => {
  const properties = tool?.schema?.properties;
  if (!properties?.events || !properties?.stopDate || properties[SEAT_ADVICE_FIELD]) return tool;
  return {
    ...tool,
    schema: {
      ...tool.schema,
      properties: { ...properties, [SEAT_ADVICE_FIELD]: SEAT_ADVICE_SCHEMA },
      required: [...new Set([...list(tool.schema.required), SEAT_ADVICE_FIELD])],
    },
  };
};

// The advisor a polity's player already has, if any.
export const advisorOf = (world, polity) => {
  const entry = Object.entries(isRecord(world?.seatAdvice) ? world.seatAdvice : {}).find(([key]) => same(key, polity))?.[1];
  const name = clean(entry?.advisor?.name);
  return name ? { name, title: clean(entry?.advisor?.title) } : null;
};

// What the simulator is told: who plays, the advisors they have, and what to
// write. "" with nobody to advise.
export const buildSeatAdviceDirective = (people, world) => {
  const polities = list(people).map(clean).filter(Boolean);
  if (!polities.length) return "";
  return [
    "[Each Player's Advisor]",
    `Answer ${SEAT_ADVICE_FIELD} with one entry for each polity a person plays: ${polities.join("; ")}.`,
    "- The advisor is one person of that polity's own court, council or government, who fits its people, its customs and its way of speaking. Where an advisor is named below, keep them, name and office as written. Otherwise name one, from this world, never a real person.",
    ...polities.map((polity) => {
      const advisor = advisorOf(world, polity);
      return `- ${polity}: ${advisor ? `${advisor.name}${advisor.title ? `, ${advisor.title}` : ""}` : "no advisor yet"}`;
    }),
    `- Write ${SUGGESTIONS_PER_SEAT} orders that advisor would have their government give next, as the player would send them: one or two plain sentences each, each a different course. Ground them in what this period did and left open, the polity's goals and character, and the orders that player gave before. Each can be carried out by that government alone.`,
    "- The advice is for that player alone: no other player sees it, and it decides nothing.",
  ].join("\n");
};

// The answer, kept: { [polity]: { advisor: { name, title }, suggestions, round } }
// for the polities people play. An advisor already named stays as named; an
// entry for a polity nobody plays, or with no suggestion, is not kept. The
// polities left out keep what they had.
export const mergeSeatAdvice = (previous, answer, { people = [], round = 0 } = {}) => {
  const kept = isRecord(previous) ? { ...previous } : {};
  for (const entry of list(answer)) {
    if (!isRecord(entry)) continue;
    const polity = list(people).map(clean).find((name) => same(name, entry.polity));
    if (!polity) continue;
    const suggestions = list(entry.suggestions)
      .filter((text) => typeof text === "string")
      .map((text) => clean(text).slice(0, SUGGESTION_MAX_CHARS))
      .filter(Boolean)
      .slice(0, SUGGESTIONS_PER_SEAT);
    if (!suggestions.length) continue;
    const had = advisorOf({ seatAdvice: kept }, polity);
    const name = clean(entry.advisorName).slice(0, 80);
    const advisor = had ?? (name ? { name, title: clean(entry.advisorTitle).slice(0, 120) } : null);
    for (const key of Object.keys(kept)) if (same(key, polity)) delete kept[key];
    kept[polity] = { ...(advisor ? { advisor } : {}), suggestions, round: Number(round) || 0 };
  }
  return kept;
};
