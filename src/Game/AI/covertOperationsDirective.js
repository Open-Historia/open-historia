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

const NO_CULPRIT = "Nobody in the world knows who was behind it, the target included: name no culprit, and have no government, investigator or press establish one, in this event or in any later one.";

const lineFor = (operation) => {
  const target = clean(operation.target);
  const owner = clean(operation.owner);
  const aim = attempt(operation);
  const carriedOut = operation.outcome === "success";
  if (operation.outcome === "foiled") {
    return `- In ${target}, an attempt ${aim} never came off: the agent who was to carry it out had been turned by ${target}, which therefore knows that ${owner} ordered it. ${owner} does not know its agent was turned and must not learn it from this. Nothing visible happens unless ${target} chooses to act on what it knows.`;
  }
  if (!operation.caught) {
    if (!carriedOut) return "";
    if (operation.kind === "recruit") {
      return `- In ${target}, a foreign service secretly recruited ${`"${clean(operation.instructions)}"`}, who now works for it in secret. Nobody in ${target} knows. Make no public event of it, but let it be true from now on. ${NO_CULPRIT}`;
    }
    return `- In ${target}, an operation ${aim} SUCCEEDED and was never traced. Write it as the event it makes, with its consequences. ${NO_CULPRIT}`;
  }
  const how = carriedOut ? "after carrying it out" : "and the attempt failed";
  if (!operation.identified) {
    return `- In ${target}, a foreign agent was caught trying ${aim}, ${how}. The agent died under interrogation without revealing who sent them. Write the arrest and the death in custody. ${NO_CULPRIT}`;
  }
  return `- In ${target}, an agent of ${owner} was caught trying ${aim}, ${how}, and ${target} established that ${owner} sent them. Write the arrest, and what follows from it between ${target} and ${owner}.`;
};

export const covertOperationsBlock = (operations) => {
  const lines = (Array.isArray(operations) ? operations : []).map(lineFor).filter(Boolean);
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
