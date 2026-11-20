/*! Open Historia — characters: the player's own person, held per polity © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A country is not a person. This ledger keeps one named individual per polity
// that a scenario asks for (skills, health, injuries, purse, inventory), so the
// MASTER REPORT can state the person the player plays.
//
//   world.characters = { schemaVersion: 1, byPolity: { [polity]: Character } }
//
// Only the narrator writes it, through operations the character task returns
// (applyCharacterOps). The player reads it; nothing here is player-editable.
//
// DELIBERATELY IMPORT-FREE, like reports.js and projects.js: rules on plain data,
// tested on their own. The caller canonicalises polity names.

export const CHARACTERS_SCHEMA_VERSION = 1;
export const CHARACTER_LIMITS = Object.freeze({
  traits: 4,
  injuries: 12,
  inventory: 40,
  purseLog: 40,
  textChars: 200,
});
export const CHARACTER_SKILLS = Object.freeze([
  "diplomacy",
  "martial",
  "stewardship",
  "intrigue",
  "learning",
  "prowess",
]);
export const SKILL_LEVELS = Object.freeze([
  "Poor",
  "Average",
  "Good",
  "Excellent",
  "Exceptional",
]);
export const INJURY_TYPES = Object.freeze(["Minor", "Moderate", "Severe", "Critical"]);
export const ITEM_RARITIES = Object.freeze(["Common", "Rare", "Epic", "Illustrious"]);
export const CHARACTER_OPS = Object.freeze([
  "create",
  "patch",
  "injure",
  "heal",
  "gain",
  "lose",
  "earn",
  "spend",
]);
// The fields an operation may patch. Health, purse and inventory have their own
// verbs, so a patch cannot quietly rewrite them.
const PATCHABLE_FIELDS = Object.freeze([
  "name",
  "birthdate",
  "sex",
  "culture",
  "faith",
  "titles",
  "location",
  "traits",
  "skills",
  "reputation",
]);

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const asCount = (value) => {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const asAmount = (value) => {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? number : 0;
};

const normalizeSkills = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(
    CHARACTER_SKILLS.map((skill) => {
      const level = asText(source[skill]);
      return [skill, SKILL_LEVELS.includes(level) ? level : "Average"];
    }),
  );
};

const normalizeReputation = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    piety: clip(asText(source.piety), CHARACTER_LIMITS.textChars),
    renown: clip(asText(source.renown), CHARACTER_LIMITS.textChars),
    honour: clip(asText(source.honour), CHARACTER_LIMITS.textChars),
  };
};

const normalizeInjury = (raw, index) => {
  const type = asText(raw?.type);
  return {
    id: asText(raw?.id) || `injury-${index + 1}`,
    type: INJURY_TYPES.includes(type) ? type : "Minor",
    location: clip(asText(raw?.location), CHARACTER_LIMITS.textChars),
    effects: clip(asText(raw?.effects), CHARACTER_LIMITS.textChars),
    recoveryRounds: asCount(raw?.recoveryRounds),
    date: asText(raw?.date),
  };
};

const normalizeItem = (raw, index) => {
  const rarity = asText(raw?.rarity);
  return {
    id: asText(raw?.id) || `item-${index + 1}`,
    name: clip(asText(raw?.name), CHARACTER_LIMITS.textChars),
    qty: Math.max(1, asCount(raw?.qty) || 1),
    rarity: ITEM_RARITIES.includes(rarity) ? rarity : "Common",
    note: clip(asText(raw?.note), CHARACTER_LIMITS.textChars),
  };
};

const normalizePurseEntry = (raw) => ({
  date: asText(raw?.date),
  delta: asAmount(raw?.delta),
  note: clip(asText(raw?.note), CHARACTER_LIMITS.textChars),
});

// One character, every field present and typed. A missing or malformed field
// falls back to an empty value rather than a crash; the loader never throws.
export const normalizeCharacter = (raw) => {
  const injuries = asArray(raw?.health?.injuries)
    .slice(0, CHARACTER_LIMITS.injuries)
    .map(normalizeInjury);
  const status = injuries.length === 0
    ? "Healthy"
    : injuries.reduce((worst, injury) => {
        const order = INJURY_TYPES.indexOf(injury.type);
        return order > INJURY_TYPES.indexOf(worst) ? injury.type : worst;
      }, "Minor");
  return {
    id: asText(raw?.id),
    name: clip(asText(raw?.name), CHARACTER_LIMITS.textChars),
    birthdate: asText(raw?.birthdate),
    sex: asText(raw?.sex),
    culture: clip(asText(raw?.culture), CHARACTER_LIMITS.textChars),
    faith: clip(asText(raw?.faith), CHARACTER_LIMITS.textChars),
    titles: asArray(raw?.titles).map(asText).filter(Boolean).slice(0, 8),
    location: clip(asText(raw?.location), CHARACTER_LIMITS.textChars),
    traits: asArray(raw?.traits)
      .map(asText)
      .filter(Boolean)
      .slice(0, CHARACTER_LIMITS.traits),
    skills: normalizeSkills(raw?.skills),
    reputation: normalizeReputation(raw?.reputation),
    health: { status, injuries },
    purse: {
      currency: clip(asText(raw?.purse?.currency), 40) || "gold",
      amount: asAmount(raw?.purse?.amount),
    },
    inventory: asArray(raw?.inventory)
      .slice(0, CHARACTER_LIMITS.inventory)
      .map(normalizeItem),
    purseLog: asArray(raw?.purseLog)
      .slice(-CHARACTER_LIMITS.purseLog)
      .map(normalizePurseEntry),
    // The purse at the last MASTER REPORT. The next report starts from here, so
    // its reconciliation is computed, not written by the model.
    lastReportAmount: asAmount(raw?.lastReportAmount),
    // The last MASTER REPORT, kept for the sheet to show. Its text is capped, not its meaning.
    lastReport: raw?.lastReport && typeof raw.lastReport === "object"
      ? { date: asText(raw.lastReport.date), text: clip(asText(raw.lastReport.text), 6000) }
      : null,
    updatedDate: asText(raw?.updatedDate),
  };
};

export const normalizeCharacters = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {};
  const byPolityRaw = source.byPolity && typeof source.byPolity === "object"
    ? source.byPolity
    : {};
  const byPolity = {};
  for (const [polity, character] of Object.entries(byPolityRaw)) {
    const name = asText(polity);
    if (name) byPolity[name] = normalizeCharacter(character);
  }
  return { schemaVersion: CHARACTERS_SCHEMA_VERSION, byPolity };
};

export const emptyCharacters = () => normalizeCharacters({});

// An operation as the model writes it. Unknown verbs are dropped here, so the
// apply step only ever sees a verb it can run.
export const normalizeCharacterOp = (raw) => {
  const op = asText(raw?.op);
  if (!CHARACTER_OPS.includes(op)) return null;
  return {
    op,
    polity: asText(raw?.polity),
    character: raw?.character && typeof raw.character === "object" ? raw.character : null,
    fields: raw?.fields && typeof raw.fields === "object" ? raw.fields : null,
    injury: raw?.injury && typeof raw.injury === "object" ? raw.injury : null,
    injuryId: asText(raw?.injuryId),
    item: raw?.item && typeof raw.item === "object" ? raw.item : null,
    itemId: asText(raw?.itemId),
    qty: asCount(raw?.qty),
    amount: asAmount(raw?.amount),
    note: clip(asText(raw?.note), CHARACTER_LIMITS.textChars),
  };
};

// Runs a batch of operations in order. Returns a new characters ledger and the
// operations refused, each with its reason. A refused operation changes nothing:
// the player cannot spend what the purse does not hold, and an unknown person
// cannot be patched.
export const applyCharacterOps = (characters, rawOps, { date = "" } = {}) => {
  const next = normalizeCharacters(characters);
  const rejected = [];
  for (const raw of asArray(rawOps)) {
    const op = normalizeCharacterOp(raw);
    if (!op) {
      rejected.push({ op: raw?.op ?? null, reason: "unknown operation" });
      continue;
    }
    const current = next.byPolity[op.polity];
    const refuse = (reason) => rejected.push({ op: op.op, polity: op.polity, reason });

    if (op.op === "create") {
      if (!op.polity || !op.character) {
        refuse("create needs a polity and a character");
        continue;
      }
      if (current) {
        refuse("this polity already has a character");
        continue;
      }
      // The opening purse is the first report's start, so the first reconciliation
      // is a real check rather than a comparison with zero.
      const opening = normalizeCharacter({ ...op.character, updatedDate: date });
      next.byPolity[op.polity] = { ...opening, lastReportAmount: opening.purse.amount };
      continue;
    }

    if (!current) {
      refuse("no character for this polity");
      continue;
    }
    const updated = { ...current, updatedDate: date || current.updatedDate };

    if (op.op === "patch") {
      const fields = op.fields ?? {};
      const blocked = Object.keys(fields).filter((key) => !PATCHABLE_FIELDS.includes(key));
      if (blocked.length > 0) {
        refuse(`fields cannot be patched: ${blocked.join(", ")}`);
        continue;
      }
      const merged = normalizeCharacter({ ...updated, ...fields, id: current.id });
      next.byPolity[op.polity] = {
        ...merged,
        health: current.health,
        purse: current.purse,
        inventory: current.inventory,
        purseLog: current.purseLog,
        lastReportAmount: current.lastReportAmount,
      };
      continue;
    }

    if (op.op === "injure") {
      if (!op.injury) {
        refuse("injure needs an injury");
        continue;
      }
      const injuries = [...current.health.injuries, normalizeInjury(
        { ...op.injury, date },
        current.health.injuries.length,
      )].slice(-CHARACTER_LIMITS.injuries);
      next.byPolity[op.polity] = normalizeCharacter({ ...updated, health: { injuries } });
      continue;
    }

    if (op.op === "heal") {
      const injuries = current.health.injuries.filter((injury) => injury.id !== op.injuryId);
      if (injuries.length === current.health.injuries.length) {
        refuse(`no injury ${op.injuryId || "(blank id)"}`);
        continue;
      }
      next.byPolity[op.polity] = normalizeCharacter({ ...updated, health: { injuries } });
      continue;
    }

    if (op.op === "gain") {
      if (!op.item) {
        refuse("gain needs an item");
        continue;
      }
      const item = normalizeItem({ ...op.item, qty: op.qty || op.item.qty }, current.inventory.length);
      const inventory = [...current.inventory, item].slice(-CHARACTER_LIMITS.inventory);
      next.byPolity[op.polity] = normalizeCharacter({ ...updated, inventory });
      continue;
    }

    if (op.op === "lose") {
      const index = current.inventory.findIndex((item) => item.id === op.itemId);
      if (index < 0) {
        refuse(`no item ${op.itemId || "(blank id)"}`);
        continue;
      }
      const item = current.inventory[index];
      const left = item.qty - (op.qty || item.qty);
      const inventory = left > 0
        ? current.inventory.map((entry, at) => (at === index ? { ...entry, qty: left } : entry))
        : current.inventory.filter((_, at) => at !== index);
      next.byPolity[op.polity] = normalizeCharacter({ ...updated, inventory });
      continue;
    }

    if (op.op === "earn" || op.op === "spend") {
      const amount = Math.abs(op.amount);
      if (amount === 0) {
        refuse("amount must be non-zero");
        continue;
      }
      const delta = op.op === "earn" ? amount : -amount;
      if (current.purse.amount + delta < 0) {
        refuse("the purse does not hold that much");
        continue;
      }
      const purseLog = [...current.purseLog, { date, delta, note: op.note }]
        .slice(-CHARACTER_LIMITS.purseLog);
      next.byPolity[op.polity] = normalizeCharacter({
        ...updated,
        purse: { ...current.purse, amount: current.purse.amount + delta },
        purseLog,
      });
    }
  }
  return { characters: next, rejected };
};

// The purse reconciliation, computed from the log rather than written: start
// (last report), plus income, minus expenses, must equal the purse now. A
// mismatch is reported, not silently patched, so the GM can see it.
export const purseReconciliation = (character) => {
  const income = character.purseLog
    .filter((entry) => entry.delta > 0)
    .reduce((sum, entry) => sum + entry.delta, 0);
  const expenses = character.purseLog
    .filter((entry) => entry.delta < 0)
    .reduce((sum, entry) => sum + -entry.delta, 0);
  const start = character.lastReportAmount;
  const end = character.purse.amount;
  return {
    start,
    income,
    expenses,
    end,
    balanced: start + income - expenses === end,
  };
};

// Clears the period's log after a report has used it. Returns a new character.
export const closePurseLog = (character) => ({
  ...character,
  lastReportAmount: character.purse.amount,
  purseLog: [],
});

// Whether this turn's events could have changed the person, so the character task
// is asked only then. Deliberately generous: a missed change is worse than an extra
// answer that comes back empty. No character yet means the task must run to create one.
const TOUCH_PATTERN = new RegExp([
  "wound", "injur", "sick", "fever", "ill", "heal", "recover", "die", "death", "dead",
  "captur", "prison", "gold", "silver", "coin", "purse", "money", "tax", "bought", "sold",
  "gift", "inherit", "marr", "wed", "title", "appoint", "rank", "knight", "duel", "fight",
  "item", "gained", "lost", "stolen", "travel", "journey",
].join("|"), "i");

export const eventsTouchCharacter = (events, character) => {
  if (!character) return true;
  const name = asText(character.name).toLowerCase();
  const surname = name.split(/\s+/).at(-1) ?? "";
  return asArray(events).some((event) => {
    if (event?.playerRelated) return true;
    const text = `${event?.title ?? ""} ${event?.description ?? ""}`;
    if (name && text.toLowerCase().includes(name)) return true;
    if (surname.length > 2 && text.toLowerCase().includes(surname)) return true;
    return TOUCH_PATTERN.test(text);
  });
};

// The age on a given game date, from the birthdate. The game calendar is ISO-like
// (YYYY-MM-DD). Returns null rather than a guess when either date does not parse.
export const ageOn = (birthdate, date) => {
  const from = /^(-?\d{1,4})-(\d{2})-(\d{2})/.exec(asText(birthdate));
  const on = /^(-?\d{1,4})-(\d{2})-(\d{2})/.exec(asText(date));
  if (!from || !on) return null;
  let years = Number(on[1]) - Number(from[1]);
  if (Number(on[2]) < Number(from[2]) || (Number(on[2]) === Number(from[2]) && Number(on[3]) < Number(from[3]))) years -= 1;
  return years >= 0 ? years : null;
};

const labelled = (label, value) => `- ${label}: ${value}`;

// The MASTER REPORT for one round, as the sheet and the timeline show it. Pure:
// the caller decides when it is written and what it does to the purse.
export const buildMasterReport = ({ polity, date, character, roundEvents = [] }) => {
  const reconciliation = purseReconciliation(character);
  const age = ageOn(character.birthdate, date);
  const skills = CHARACTER_SKILLS.map((skill) => `${skill} ${character.skills[skill]}`).join(", ");
  const injuries = character.health.injuries.length
    ? character.health.injuries.map((injury) => `${injury.type}: ${injury.location}${injury.effects ? ` (${injury.effects})` : ""}`).join("; ")
    : "None";
  const items = character.inventory.length
    ? character.inventory.map((item) => `${item.name}${item.qty > 1 ? ` x${item.qty}` : ""} (${item.rarity})`).join("; ")
    : "None";
  const money = reconciliation.balanced
    ? `${reconciliation.start} + ${reconciliation.income} - ${reconciliation.expenses} = ${reconciliation.end}`
    : `${reconciliation.start} + ${reconciliation.income} - ${reconciliation.expenses} = ${reconciliation.end} (DOES NOT RECONCILE)`;
  const events = roundEvents.length
    ? roundEvents.map((event) => `- ${event?.title ?? "Untitled"}`).join("\n")
    : "- None";
  const text = [
    "CHARACTER",
    labelled("Name", character.name),
    labelled("Age", age === null ? "unknown" : `${age} (born ${character.birthdate})`),
    labelled("Titles and offices", character.titles.join(", ") || "None"),
    labelled("Culture and faith", [character.culture, character.faith].filter(Boolean).join(", ") || "Unknown"),
    labelled("Health", character.health.status),
    labelled("Injury record", injuries),
    labelled("Skills", skills),
    labelled("Traits", character.traits.join(", ") || "None"),
    labelled("Reputation", `piety ${character.reputation.piety || "unknown"}, renown ${character.reputation.renown || "unknown"}, honour ${character.reputation.honour || "unknown"}`),
    "",
    "FINANCES",
    labelled("Personal money", `${character.purse.amount} ${character.purse.currency}`),
    labelled("Reconciliation", money),
    labelled("Property and assets", items),
    "",
    "THIS ROUND - EVENT RECORD",
    events,
  ].join("\n");
  return { title: `MASTER REPORT - ${polity} - ${date}`, text };
};

// The character after a report has been written: the period's purse log is closed,
// and the report is kept for the sheet. Returns a new character.
export const characterAfterReport = (character, { date, text }) => ({
  ...closePurseLog(character),
  lastReport: { date, text: clip(asText(text), 6000) },
});
