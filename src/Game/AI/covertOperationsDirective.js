/*! Open Historia — what a time skip is told of the agents' operations © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

export const COVERT_OPERATIONS_HEADER = "[Covert Operations This Period]";

const clean = (value) => String(value ?? "").replace(/["“”]/g, "'").replace(/\s+/g, " ").trim();

const attempt = (operation) => {
  const what = `"${clean(operation.instructions)}"`;
  if (operation.kind === "sabotage") return `to sabotage ${what}`;
  if (operation.kind === "recruit") return `to recruit ${what}`;
  if (operation.kind === "assassinate") return `to assassinate ${what}`;
  return `to carry out this covert operation: ${what}`;
};

// A killing that came off: who it was is dead from this event on, and an office they held is filled in the same event,
// or the record keeps them in it alive (a player's report, 2026-11-06).
const KILLED = "The person targeted is dead from this event on. If they held an office, the same event carries the change: politicalActorOps replace-leader for their country (office headOfState or headOfGovernment) naming the successor its own rules make (a vice-president, a deputy, an interim leader), and set-party-leader for a party they led. Never write them alive or acting again.";
const killed = (operation) => (operation.kind === "assassinate" && operation.outcome === "success" ? ` ${KILLED}` : "");

const NO_CULPRIT = "Nobody in the world knows who was behind it, the target included: name no culprit, and have no government, investigator or press establish one, in this event or in any later one.";

// What a government that knows of an operation does about it. One the AI plays
// is the model's to decide; one a person plays decides by its player's own
// orders, and the period is told so: "unless Spain chooses to act" left a
// player's government's choice to the model. `isPerson` is false for every
// polity where one person plays (single player): its lines are as they were.
const PLAYERS_CHOICE = (polities) => (polities.length > 1
  ? `${polities.join(" and ")} are each played by a person: only each one's own player's orders decide whether it acts on this.`
  : `${polities[0]} is played by a person: only its player's own orders decide whether it acts on this.`);

const lineFor = (operation, isPerson = () => false) => {
  const target = clean(operation.target);
  const owner = clean(operation.owner);
  const aim = attempt(operation);
  const carriedOut = operation.outcome === "success";
  if (operation.outcome === "foiled") {
    return `- In ${target}, an attempt ${aim} never came off: the agent who was to carry it out had been turned by ${target}, which therefore knows that ${owner} ordered it. ${owner} does not know its agent was turned and must not learn it from this. ${isPerson(target) ? `Nothing visible happens unless ${target} acts on what it knows. ${PLAYERS_CHOICE([target])}` : `Nothing visible happens unless ${target} chooses to act on what it knows.`}`;
  }
  if (!operation.caught) {
    if (!carriedOut) return "";
    if (operation.kind === "recruit") {
      return `- In ${target}, a foreign service secretly recruited ${`"${clean(operation.instructions)}"`}, who now works for it in secret. Nobody in ${target} knows. Make no public event of it, but let it be true from now on. ${NO_CULPRIT}`;
    }
    return `- In ${target}, an operation ${aim} SUCCEEDED and was never traced. Write it as the event it makes, with its consequences.${killed(operation)} ${NO_CULPRIT}`;
  }
  const how = carriedOut ? "after carrying it out" : "and the attempt failed";
  if (!operation.identified) {
    return `- In ${target}, a foreign agent was caught trying ${aim}, ${how}. The agent died under interrogation without revealing who sent them. Write the arrest and the death in custody.${killed(operation)} ${NO_CULPRIT}`;
  }
  const persons = [target, owner].filter(isPerson);
  return `- In ${target}, an agent of ${owner} was caught trying ${aim}, ${how}, and ${target} established that ${owner} sent them. Write the arrest, and what follows from it between ${target} and ${owner}.${killed(operation)}${persons.length ? ` ${PLAYERS_CHOICE(persons)}` : ""}`;
};

// `people`: the polities people play. Their own choices are only said to be
// theirs where several people play; one person is told as before.
export const covertOperationsBlock = (operations, { people = [] } = {}) => {
  const persons = new Set((Array.isArray(people) ? people : []).map((name) => clean(name).toLowerCase()).filter(Boolean));
  const isPerson = (name) => persons.size > 1 && persons.has(clean(name).toLowerCase());
  const lines = (Array.isArray(operations) ? operations : []).map((operation) => lineFor(operation, isPerson)).filter(Boolean);
  if (!lines.length) return "";
  return [
    COVERT_OPERATIONS_HEADER,
    "These clandestine operations take place during this period, and the game has already decided how each one turned out. Write each one that makes an event as an event dated within the period, with the impacts that follow from it (units, structures, leaders, stats, relations), and keep exactly to what each says about who knows what. Give these events no actionIds.",
    ...lines,
  ].join("\n");
};

export const untracedTargets = (operations) => [...new Set((Array.isArray(operations) ? operations : [])
  .filter((operation) => operation.outcome !== "foiled" && !(operation.caught && operation.identified))
  .map((operation) => clean(operation.target))
  .filter(Boolean))];

const FOCUS_ORDERS = {
  military: "armed forces: their strength, readiness and deployments, weapons programmes and military research, and war plans",
  research: "science and technology: research programmes, laboratories, leading scientists and engineers, breakthroughs, and what it is buying or stealing abroad",
  economy: "economic policy: budgets, debts, trade, resources and industry, and the economic decisions its government is weighing",
  politics: "internal politics: the leadership, the factions and rivalries around it, dissent, and who really decides",
};

export const collectionOrders = (spy, targetName = "") => {
  const name = clean(targetName || spy?.target) || "the target";
  const lines = [];
  const focus = FOCUS_ORDERS[spy?.focus];
  if (focus) {
    lines.push(`COLLECTION PRIORITY — the service has tasked this agent to collect on ${name}'s ${focus}. Most of the report bears on it: the exchanges wherever it touches ${name}'s dealings with other polities, and the political assessment's findings, each with a topic naming what it covers. Never have anyone mention our interest in it.`);
  }
  const sources = (Array.isArray(spy?.assets) ? spy.assets : []).map((asset) => clean(asset?.who)).filter(Boolean);
  if (sources.length) {
    lines.push(`RECRUITED SOURCES — the agent runs ${sources.map((who) => `"${who}"`).join(", ")}, recruited in secret. At least one finding comes from them, its topic "From our source", and says what that source could know.`);
  }
  return lines.join("\n");
};
