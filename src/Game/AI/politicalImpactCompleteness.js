import { getPoliticalProfile } from "../../runtime/politicalActors.js";
import { applyPoliticalActorOperation } from "../../runtime/politicalActorOps.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const textOf = (event) => {
  const title = clean(event?.title);
  const description = clean(event?.description);
  return [title, description].filter(Boolean).join(". ");
};
const opNames = (event) => new Set(list(event?.impacts?.politicalActorOps)
  .map((entry) => clean(entry?.op).toLowerCase())
  .filter(Boolean));

const politicalOps = (event) => list(event?.impacts?.politicalActorOps)
  .filter((entry) => entry && typeof entry === "object");
const polityChanges = (event) => list(event?.impacts?.polityChanges)
  .filter((entry) => entry && typeof entry === "object");

const parsedArgs = (entry) => {
  if (!entry || typeof entry !== "object") return {};
  if (entry.args && typeof entry.args === "object" && !Array.isArray(entry.args)) return entry.args;
  const raw = String(entry.argsJson ?? "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const politicalOpsForPolity = (event, polityKey) => politicalOps(event).filter((entry) => (
  clean(entry?.polityKey || entry?.polity || entry?.country).toLocaleLowerCase() === clean(polityKey).toLocaleLowerCase()
));

const opPolityKeys = (event) => [...new Set(politicalOps(event)
  .map((entry) => clean(entry?.polityKey || entry?.polity || entry?.country))
  .filter(Boolean))];

const nonEmptyArray = (value) => Array.isArray(value) && value.some((entry) => clean(entry));
const meaningfulObject = (value) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
const meaningfulSystem = (actor) => {
  const system = actor?.politicalSystem;
  if (!meaningfulObject(system)) return false;
  const type = clean(system.type).toLowerCase();
  const representation = clean(system.representation).toLowerCase();
  const regime = clean(system.regimeCharacter).toLowerCase();
  return Boolean(
    (type && type !== "unspecified")
    || (representation && representation !== "none" && representation !== "unspecified")
    || (regime && regime !== "unspecified")
    || clean(system.publicLabel),
  );
};
const meaningfulGovernment = (actor) => {
  const government = actor?.government;
  if (!meaningfulObject(government)) return false;
  return Boolean(
    clean(government.form)
    || clean(government.ideology)
    || clean(government.coalitionName)
    || nonEmptyArray(government.rulingPartyIds)
    || nonEmptyArray(government.coalitionPartyIds)
    || government.headOfState
    || government.headOfGovernment,
  );
};

const governmentHasGoverningForce = (actor) => {
  const government = actor?.government;
  if (!meaningfulObject(government)) return false;
  // Stable ids are the canonical membership authority. A presentation-only
  // coalitionName or an unresolved legacy display-name array must not let a
  // government masquerade as having a canonical governing force.
  return Boolean(
    nonEmptyArray(government.rulingPartyIds)
    || nonEmptyArray(government.coalitionPartyIds)
  );
};

const actorHasParliamentaryPartySystem = (actor) => {
  if (!actor || !list(actor.parties).length) return false;
  const systemText = [
    actor?.politicalSystem?.type,
    actor?.politicalSystem?.publicLabel,
    actor?.government?.form,
  ].map(clean).join(" ").toLowerCase();
  return /\bparliament/.test(systemText);
};

const operationEstablishesGoverningForce = (entry) => {
  const op = clean(entry?.op).toLowerCase();
  const args = parsedArgs(entry);
  if (op === "form-coalition") {
    return nonEmptyArray(args?.rulingPartyIds || args?.rulingParties)
      || nonEmptyArray(args?.coalitionPartyIds || args?.coalitionParties);
  }
  if (op === "set-government") {
    const patch = args?.patch;
    return nonEmptyArray(patch?.rulingPartyIds || patch?.rulingParties)
      || nonEmptyArray(patch?.coalitionPartyIds || patch?.coalitionParties)
      || Boolean(clean(patch?.rulingParty));
  }
  return false;
};

const eventEstablishesGoverningForce = (event, polityKey = "") => {
  const entries = polityKey ? politicalOpsForPolity(event, polityKey) : politicalOps(event);
  return entries.some(operationEstablishesGoverningForce);
};
const politicalActorMaturityGaps = (actor) => {
  if (!actor) return ["political system", "government", "representation entities", "strategy", "traits"];
  const gaps = [];
  if (!meaningfulSystem(actor)) gaps.push("political system");
  if (!meaningfulGovernment(actor)) gaps.push("government");
  if (!list(actor.parties).length && !list(actor.powerBlocs).length) gaps.push("representation entities");
  if (!nonEmptyArray(actor.goals) || !nonEmptyArray(actor.fears) || !nonEmptyArray(actor.ambitions)) gaps.push("strategy");
  if (!meaningfulObject(actor.traits)) gaps.push("traits");
  return gaps;
};

export const isSparsePoliticalActor = (actor) => politicalActorMaturityGaps(actor).length >= 3;

export const POLITICAL_CLAIM_EFFECTS = Object.freeze([
  "election",
  "government",
  "coalition",
  "leadership",
  "system",
  "parties",
]);

const POLITICAL_CLAIM_EFFECT_SET = new Set(POLITICAL_CLAIM_EFFECTS);
const POLITICAL_CLAIM_ROWS = Symbol("openhistoria.politicalClaimRows");
const hasOwn = (value, key) => Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));

const canonicalClaimPolityKey = (event, polityKey) => {
  const key = clean(polityKey);
  const lower = key.toLocaleLowerCase();
  const sameEventRename = polityChanges(event).find((change) => {
    const operation = clean(change?.operation).toLowerCase();
    const from = clean(change?.code);
    const to = clean(change?.name);
    return ["rename", "update", "restore"].includes(operation)
      && from
      && to
      && from.toLocaleLowerCase() === lower
      && from.toLocaleLowerCase() !== to.toLocaleLowerCase();
  });
  return sameEventRename ? clean(sameEventRename.name) : key;
};

// politicalClaims is transient generation metadata, not canonical state. It is
// intentionally top-level and compact so normal jumps do not repeat another
// nested semantic schema on every event. Event numbers are bound to the actual
// event objects BEFORE chronological sorting; the Map therefore remains correct
// after sorting without persisting claim metadata into timeline events.
export const preparePoliticalClaimContext = (candidate) => {
  const byEvent = new Map();
  if (!hasOwn(candidate, "politicalClaims")) {
    return { mode: "legacy", byEvent, legacyEvents: new Set(), error: "", discarded: false };
  }

  const events = list(candidate?.events);
  const raw = String(candidate?.politicalClaims ?? "");
  if (!raw.trim()) return { mode: "structured", byEvent, legacyEvents: new Set(), error: "", discarded: false };

  // Transient claim metadata must never cost a successful time skip another AI
  // request. If the provider mangles this compact ledger, discard it and use the
  // pre-existing legacy completeness path for this answer. Canonical operations
  // are still validated independently below.
  const fail = (message) => ({
    mode: "legacy",
    byEvent: new Map(),
    legacyEvents: new Set(),
    error: "",
    discarded: true,
    discardedReason: `politicalClaims ${message}`,
  });

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > Math.max(64, events.length * 4)) return fail("contains too many records.");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const fields = lines[lineIndex].split("~");
    if (fields.length !== 3) {
      return fail(`line ${lineIndex + 1} must use eventNumber~polity~effectsCSV.`);
    }
    const eventNumberToken = fields[0].trim();
    const eventNumber = /^\d+$/.test(eventNumberToken) ? Number(eventNumberToken) : NaN;
    if (!Number.isSafeInteger(eventNumber) || eventNumber < 1 || eventNumber > events.length) {
      return fail(`line ${lineIndex + 1} references event ${eventNumberToken || "(blank)"}, outside this answer's 1-${events.length} event range.`);
    }
    const rawPolityKey = clean(fields[1]);
    if (!rawPolityKey) return fail(`line ${lineIndex + 1} has no polity.`);
    const event = events[eventNumber - 1];
    // Same-event rename is already explicit canonical evidence. Mirror the same
    // old->new identity handoff used by politicalActorOps so a claim written
    // with the pre-rename key still validates against ops addressed to the new key.
    const polityKey = canonicalClaimPolityKey(event, rawPolityKey);

    const effects = [...new Set(fields[2]
      .split(",")
      .map((entry) => clean(entry).toLowerCase())
      .filter(Boolean))];
    if (!effects.length) return fail(`line ${lineIndex + 1} has no effect.`);
    const unknown = effects.find((effect) => !POLITICAL_CLAIM_EFFECT_SET.has(effect));
    if (unknown) {
      return fail(`line ${lineIndex + 1} uses unknown effect "${unknown}". Allowed: ${POLITICAL_CLAIM_EFFECTS.join(", ")}.`);
    }

    const rows = byEvent.get(event) || [];
    const samePolity = rows.find((row) => row.polityKey.toLocaleLowerCase() === polityKey.toLocaleLowerCase());
    if (samePolity) {
      samePolity.effects = [...new Set([...samePolity.effects, ...effects])];
    } else {
      rows.push({ polityKey, effects });
    }
    byEvent.set(event, rows);
  }

  // Keep a transient symbol binding on the event as well as the Map. Event
  // objects can be shallow-cloned later by native tempo/scripted-event passes;
  // object spread preserves enumerable symbol properties while JSON/save paths
  // ignore them. This keeps the model's pre-sort event number attached to the
  // same logical event without introducing a persistent field.
  for (const [event, rows] of byEvent.entries()) event[POLITICAL_CLAIM_ROWS] = rows;

  return { mode: "structured", byEvent, legacyEvents: new Set(), error: "", discarded: false };
};

export const clearPoliticalClaimBindings = (candidate) => {
  for (const event of list(candidate?.events)) {
    if (event && typeof event === "object") delete event[POLITICAL_CLAIM_ROWS];
  }
};

const declaredPoliticalClaimRows = (claimContext, event) => (
  claimContext?.byEvent?.get?.(event)
  || (event && typeof event === "object" ? event[POLITICAL_CLAIM_ROWS] : null)
  || []
);

const ELECTION_EVENT_RE = /\b(?:general|parliamentary|presidential|legislative|national|constituent)?\s*elections?\b/i;
const ELECTION_COMPLETION_CLAIM_RE = /(?:\belections?\b[^.!?;]{0,100}\b(?:is|are|was|were|has been|have been)?\s*(?:held|conducted|concluded|completed|finished|counted)\b|\b(?:holds?|held|conducts?|conducted|convenes?|convened)\b[^.!?;]{0,80}\belections?\b|\belections?\b[^.!?;]{0,90}\b(?:results?|returns?|majority|plurality|seats?|tall(?:y|ies)|count)\b|\b(?:results?|returns?|final tall(?:y|ies)|vote count)\b[^.!?;]{0,90}\b(?:elections?|parliament|presidency|assembly|legislature)\b|\b(?:elected|elects?)\b[^.!?;]{0,70}\b(?:president|prime minister|premier|chancellor|parliament|assembly|legislature)\b)/i;
const ELECTION_RESULT_RE = /\b(?:results?|returns?|returned|final tall(?:y|ies)|count(?:ed|ing)?|wins?|won|victory|majority|plurality|seat(?:s)?|governing coalition|coalition government|forms? (?:the )?government|elected (?:president|prime minister|premier|chancellor))\b/i;
// Political World is polity-level canon. Explicitly subnational/local elections
// may be important history, but a governor/mayor/provincial result does not by
// itself rewrite the national government or party landscape. National scope
// wins if the same event explicitly contains both levels.
const SUBNATIONAL_ELECTION_RE = /\b(?:regional|gubernatorial|governor(?:ship)?|provincial|municipal|local|mayoral|county|district|prefectural|state[- ]level)\b/i;
const NATIONAL_ELECTION_SCOPE_RE = /\b(?:general elections?|parliamentary elections?|presidential elections?|legislative elections?|federal elections?|constituent assembly elections?|national assembly elections?|elected (?:president|prime minister|premier|chancellor))\b/i;
const electionNeedsPolityMutation = (text) => (
  (ELECTION_EVENT_RE.test(text) || /\b(?:elected|elects?)\b/i.test(text))
  && ELECTION_COMPLETION_CLAIM_RE.test(text)
  && (!SUBNATIONAL_ELECTION_RE.test(text) || NATIONAL_ELECTION_SCOPE_RE.test(text))
);

const CONSTITUTIONAL_TERM = String.raw`(?:constitution|constitutional charter|constitutional framework|fundamental law|new republic|new monarchy|parliamentary republic|presidential republic|constitutional monarchy)`;
const CONSTITUTIONAL_COMPLETION = String.raw`(?:adopts?|adopted|ratifies?|ratified|enacts?|enacted|promulgates?|promulgated|establishes?|established|proclaims?|proclaimed|enters? into force|takes? effect)`;
const CONSTITUTIONAL_COMPLETION_CLAIM_RE = new RegExp(
  String.raw`(?:\b${CONSTITUTIONAL_TERM}\b[^.!?;]{0,100}\b${CONSTITUTIONAL_COMPLETION}\b|\b${CONSTITUTIONAL_COMPLETION}\b[^.!?;]{0,100}\b${CONSTITUTIONAL_TERM}\b)`,
  "i",
);
// Government nouns are not structural changes by themselves. Phrases such as
// "under the new cabinet mandate" or "the new government reviews..." describe
// an already-established government and must not demand duplicate mutations. A
// government completeness requirement begins only when the clause itself says
// the government/cabinet/administration is being formed, installed or taking office.
const GOVERNMENT_ENTITY = String.raw`(?:coalition government|governing coalition|government|cabinet|administration)`;
const GOVERNMENT_ENTITY_NOT_SUBUNIT = String.raw`${GOVERNMENT_ENTITY}\b(?!\s+(?:committee|office|secretariat|meeting|agenda|post|position|minister|member|official|review|working group|task force))`;
const GOVERNMENT_TRANSITION_AFTER_ENTITY_RE = new RegExp(
  String.raw`\b${GOVERNMENT_ENTITY_NOT_SUBUNIT}[^.!?;]{0,80}\b(?:(?:is|was|has been|had been)\s+)?(?:formed|established|installed|proclaimed|sworn in|inaugurated|takes? office|took office|assumes? office|assumed office)\b`,
  "i",
);
const GOVERNMENT_TRANSITION_BEFORE_ENTITY_RE = new RegExp(
  String.raw`\b(?:forms?|formed|forming|establishes?|established|establishing|installs?|installed|installing|swears? in|swore in|swearing in(?: of)?|inaugurates?|inaugurated|inaugurating|inauguration of)\b[^.!?;]{0,80}\b(?:new\s+|interim\s+|provisional\s+|caretaker\s+|transitional\s+|coalition\s+)?${GOVERNMENT_ENTITY_NOT_SUBUNIT}`,
  "i",
);
const governmentTransitionClaim = (text) => (
  GOVERNMENT_TRANSITION_AFTER_ENTITY_RE.test(text)
  || GOVERNMENT_TRANSITION_BEFORE_ENTITY_RE.test(text)
);

const COALITION_RE = /\b(?:coalition|governing alliance|cabinet agreement)\b/i;
const COALITION_FORMATION_RE = /(?:\b(?:forms?|formed|establishes?|established)\s+(?:a |the )?(?:new )?(?:governing )?coalition\b|\b(?:coalition|governing alliance)\s+(?:is\s+)?(?:formed|established)\b|\b(?:successfully\s+)?concludes?\s+coalition negotiations?\b|\bcoalition negotiations?\s+(?:successfully\s+)?conclude(?:s|d)?\b|\breaches?\s+(?:a\s+)?coalition agreement\b|\bcoalition agreement\s+(?:is\s+)?(?:reached|concluded|signed)\b|\bcoalition government\s+(?:is\s+)?(?:formed|established)\b)/i;
// Membership/terminal changes must be stated as changes TO the governing
// coalition itself. A distant verb elsewhere in an event must not combine with
// a reference such as "coalition naval escorts" to fabricate a cabinet change.
const COALITION_MEMBERSHIP_CHANGE_RE = /(?:\b(?:joins?|joined|leaves?|left|withdraws?|withdrew)\s+(?:from\s+|the\s+)?(?:governing\s+)?coalition\b|\b(?:governing\s+)?coalition\b[^.!?;]{0,80}\b(?:collapses?|collapsed|dissolves?|dissolved|breaks? up|broke up|falls? apart|fell apart)\b)/i;
const NONPARTY_GOVERNMENT_RE = /\b(?:provisional|interim|transitional|caretaker|technocratic|non[- ]partisan|partyless|military junta|royal cabinet|royal government|independent cabinet|emergency administration)\b/i;
const PARTY_CREATION_RE = /(?:\b(?:founds?|founded|forms?|formed|creates?|created|launches?|launched|establishes?|established|organizes?|organized|reorganizes?|reorganized|reconstitutes?|reconstituted)\s+(?:a |the )?(?:new )?(?:political )?(?:party|movement|bloc)\b|\b(?:party|movement|bloc)\s+(?:is\s+)?(?:founded|formed|created|launched|established|reorganized|reconstituted)\b|\b(?:party )?(?:split|merger|merge|merged|breakaway|secession from|renames?|renamed)\b)/i;

const LEADERSHIP_TRANSITION_AFTER_OFFICE_RE = /\b(?:president|prime minister|chancellor|premier|head of state|head of government|monarch|king|queen|emperor|empress)\b[^.!?;]{0,100}\b(?:is\s+|was\s+|has been\s+|had been\s+)?(?:elected|appointed|named|sworn in|takes? office|took office|assumes? office|assumed office|resigns?|resigned|steps? down|stepped down|succeeds?|succeeded|replaces?|replaced|ousts?|ousted|deposed|abdicates?|abdicated|announces?(?: (?:his|her|their))? resignation|submits?(?: (?:his|her|their))? resignation)\b/i;
// Fatal leadership transitions need tighter grammar than ordinary appointment
// verbs. Otherwise "the president condemned the mayor who was assassinated"
// turns the presidency into a phantom vacancy merely because both words occur
// in the same sentence.
const LEADERSHIP_FATAL_TRANSITION_AFTER_OFFICE_RE = /\b(?:president|prime minister|chancellor|premier|head of state|head of government|monarch|king|queen|emperor|empress)\b[^.!?;]{0,45}\b(?:dies?|died|passes? away|(?:is|was|has been|had been)\s+(?:assassinated|killed|murdered))\b/i;
const LEADERSHIP_TRANSITION_BEFORE_OFFICE_RE = /\b(?:elected|appointed|named|sworn in|takes? office|took office|assumes? office|assumed office|resigns?|resigned|steps? down|stepped down|succeeds?|succeeded|replaces?|replaced|ousts?|ousted|deposed|abdicates?|abdicated|announces?(?: (?:his|her|their))? resignation|submits?(?: (?:his|her|their))? resignation|assassination of|murder of|death of)\b[^.!?;]{0,100}\b(?:as\s+|the\s+|of\s+)?(?:president|prime minister|chancellor|premier|head of state|head of government|monarch|king|queen|emperor|empress)\b/i;
const leadershipTransitionClaim = (text) => (
  LEADERSHIP_TRANSITION_AFTER_OFFICE_RE.test(text)
  || LEADERSHIP_FATAL_TRANSITION_AFTER_OFFICE_RE.test(text)
  || LEADERSHIP_TRANSITION_BEFORE_OFFICE_RE.test(text)
);


// A regime noun is not a regime transition. In particular, "junta positions"
// and "under the junta" describe an existing actor. Require direct transfer
// semantics in the same clause before canonical regime/government mutation is
// mandatory.
const REGIME_TRANSFER_RE = /(?:\b(?:regime change|overthrows?|overthrown|topples?|toppled|seizes? power|seized power|takes? power|took power|assumes? power|assumed power|restores? (?:the )?monarchy|restored monarchy|abolishes? (?:the )?monarchy|dissolves? parliament)\b|\bcoup\b[^.!?;]{0,100}\b(?:succeeds?|successful|overthrows?|topples?|seizes? power|takes? power|installs?|establishes?)\b|\b(?:revolution|uprising)\b[^.!?;]{0,120}\b(?:overthrows?|topples?|seizes? power|takes? power|installs?|establishes? (?:a |the )?(?:new )?(?:government|regime))\b|\bjunta\b[^.!?;]{0,100}\b(?:seizes? power|takes? power|assumes? power|is installed|forms? (?:a |the )?government)\b|\b(?:installs?|installed|establishes?|established)\b[^.!?;]{0,80}\b(?:military )?junta\b)/i;

const POLITY_RENAME_CLAIM_RE = /(?:\b(?:formally|officially|legally|constitutionally)?\s*(?:adopts?|adopted|assumes?|assumed)\s+(?:the\s+)?(?:new\s+)?name\b|\b(?:renames?|renamed)\s+(?:itself|the country|the nation|the state)\b|\b(?:changes?|changed)\s+(?:its|the country'?s|the nation'?s|the state'?s)\s+name\b|\b(?:is|was)\s+renamed\s+(?:as|to)\b)/i;
const POLITY_RENAME_CONTEXT_RE = /\b(?:country|nation|state|states|republic|kingdom|empire|federation|federal government|central government|constitutional identity|national identity|sovereign identity)\b/i;
const NON_POLITY_RENAME_SUBJECT_RE = /\b(?:bank|party|movement|company|corporation|ministry|agency|committee|commission|university|school|newspaper|broadcaster|railway|airline|trade union|labou?r union|sports? club|team)\b/i;
const EXPLICIT_POLITY_RENAME_SUBJECT_RE = /\b(?:country|nation|state|republic|kingdom|empire|federation)\b[^.!?;]{0,100}\b(?:adopts?|adopted|assumes?|assumed|renames?|renamed|changes?|changed)\b[^.!?;]{0,60}\bname\b/i;
const eventClaimsPolityRename = (event) => {
  const text = textOf(event);
  const title = clean(event?.title);
  // Keep this narrower than an ordinary "renamed X" detector. Brands, parties,
  // institutions and officeholders change names too; only explicit polity
  // identity context may force the canonical country-key mutation. A title whose
  // subject is plainly an institution is excluded unless it explicitly says the
  // country/state itself is the thing changing name.
  if (!POLITY_RENAME_CLAIM_RE.test(text) || !POLITY_RENAME_CONTEXT_RE.test(text)) return false;
  if (NON_POLITY_RENAME_SUBJECT_RE.test(title) && !EXPLICIT_POLITY_RENAME_SUBJECT_RE.test(title)) return false;
  return true;
};
const eventCarriesPolityRename = (event) => polityChanges(event).some((change) => {
  const operation = clean(change?.operation).toLowerCase();
  const from = clean(change?.code);
  const to = clean(change?.name);
  if (operation === "rename") return Boolean(from && to && from.toLocaleLowerCase() !== to.toLocaleLowerCase());
  return ["update", "restore"].includes(operation)
    && Boolean(from && to && from.toLocaleLowerCase() !== to.toLocaleLowerCase());
});

const anyOp = (ops, names) => names.some((name) => ops.has(name));

const opNamesForPolity = (event, polityKey) => new Set(
  politicalOpsForPolity(event, polityKey)
    .map((entry) => clean(entry?.op).toLowerCase())
    .filter(Boolean),
);

const partyLandscapeOpNames = [
  "create-party", "update-party", "set-party-support", "set-party-influence", "set-party-leader",
  "create-power-bloc", "update-power-bloc", "set-power-bloc-influence",
];

const operationEstablishesNonpartyGovernment = (entry) => {
  if (clean(entry?.op).toLowerCase() !== "set-government") return false;
  const patch = parsedArgs(entry)?.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  const canonicalGovernmentText = [patch.form, patch.ideology, patch.coalitionName]
    .map(clean)
    .filter(Boolean)
    .join(" ");
  return NONPARTY_GOVERNMENT_RE.test(canonicalGovernmentText);
};

const eventEstablishesNonpartyGovernment = (event, polityKey) => (
  politicalOpsForPolity(event, polityKey).some(operationEstablishesNonpartyGovernment)
);

// Canonical operations are already authoritative state mutations. In structured
// mode, derive their broad effect families so an omitted claim cannot make an
// actual mutation bypass the domain invariants that used to be activated from
// prose. This is deliberately one-way: operations can prove that state changed;
// they cannot prove that prose-only history changed when both claims and ops are
// missing. The explicit claim ledger exists for that second case.
const operationDerivedClaimRows = (event) => opPolityKeys(event).map((polityKey) => {
  const ops = opNamesForPolity(event, polityKey);
  const effects = new Set();
  if (ops.has("set-political-system")) effects.add("system");
  if (ops.has("set-government")) effects.add("government");
  if (ops.has("form-coalition") || ops.has("leave-coalition")) effects.add("coalition");
  if (ops.has("replace-leader") || ops.has("set-party-leader")) effects.add("leadership");
  if (ops.has("create-party") || ops.has("update-party") || ops.has("create-power-bloc") || ops.has("update-power-bloc")) effects.add("parties");
  return { polityKey, effects: [...effects] };
}).filter((row) => row.effects.length);

const mergeClaimRows = (...rowGroups) => {
  const merged = [];
  for (const row of rowGroups.flatMap((rows) => list(rows))) {
    const polityKey = clean(row?.polityKey);
    if (!polityKey) continue;
    const effects = list(row?.effects).map((effect) => clean(effect).toLowerCase()).filter(Boolean);
    if (!effects.length) continue;
    const existing = merged.find((entry) => entry.polityKey.toLocaleLowerCase() === polityKey.toLocaleLowerCase());
    if (existing) existing.effects = [...new Set([...existing.effects, ...effects])];
    else merged.push({ polityKey, effects: [...new Set(effects)] });
  }
  return merged;
};

const structuredPoliticalImpactCompletenessIssue = (event, { world = null, claimRows = [] } = {}) => {
  for (const claim of list(claimRows)) {
    const polityKey = clean(claim?.polityKey);
    const effects = new Set(list(claim?.effects).map((effect) => clean(effect).toLowerCase()).filter(Boolean));
    if (!polityKey || !effects.size) continue;

    const polityEntries = politicalOpsForPolity(event, polityKey);
    const polityOps = opNamesForPolity(event, polityKey);

    if (effects.has("election")) {
      const hasLandscape = anyOp(polityOps, partyLandscapeOpNames);
      const hasGovernmentOutcome = anyOp(polityOps, [
        "set-government", "form-coalition", "leave-coalition", "replace-leader", "set-party-leader",
      ]);
      if (!hasLandscape || !hasGovernmentOutcome) {
        return {
          kind: "election-result",
          expected: ["party/power landscape", "government/coalition/leadership outcome"],
          message: `Political claim for event "${clean(event.title) || "untitled"}" says ${polityKey} completed a national election result, but politicalActorOps for that polity do not canonically establish both the resulting political landscape and who governs. Add party/power support or influence operations AND the matching government/coalition/leadership operations, or remove the election claim if final national results are not established.`,
        };
      }

      const actor = world ? getPoliticalProfile(world, polityKey) : null;
      if (world && isSparsePoliticalActor(actor)) {
        const existingGaps = politicalActorMaturityGaps(actor);
        const missing = [];
        if (existingGaps.includes("political system") && !polityOps.has("set-political-system")) missing.push("set-political-system");
        if (existingGaps.includes("government") && !hasGovernmentOutcome) missing.push("government/coalition/leadership outcome");
        if (existingGaps.includes("representation entities")) {
          const entityCreationCount = polityEntries.filter((entry) => ["create-party", "create-power-bloc"].includes(clean(entry?.op).toLowerCase())).length;
          if (entityCreationCount < 2) missing.push("at least two represented political entities for the new landscape");
          if (!anyOp(polityOps, ["set-party-support", "set-party-influence", "set-power-bloc-influence"])) missing.push("quantitative support/influence");
        }
        if (existingGaps.includes("strategy")) {
          const strategyOps = polityEntries.filter((entry) => clean(entry?.op).toLowerCase() === "set-strategy");
          const completeStrategy = strategyOps.some((entry) => {
            const patch = parsedArgs(entry)?.patch;
            return nonEmptyArray(patch?.goals) && nonEmptyArray(patch?.fears) && nonEmptyArray(patch?.ambitions);
          });
          if (!completeStrategy) missing.push("set-strategy with goals, fears and ambitions");
        }
        if (existingGaps.includes("traits")) {
          const traitOps = polityEntries.filter((entry) => clean(entry?.op).toLowerCase() === "set-traits");
          const establishedTraits = traitOps.reduce((count, entry) => {
            const traits = parsedArgs(entry)?.traits;
            return count + (meaningfulObject(traits) ? Object.keys(traits).length : 0);
          }, 0);
          if (establishedTraits < 2) missing.push("set-traits with at least two justified canonical dimensions");
        }
        if (missing.length) {
          return {
            kind: "emergent-political-hydration",
            expected: missing,
            message: `Foundational election result "${clean(event.title) || "untitled"}" concerns sparse/emergent Political Actor ${polityKey}. Do not leave it structurally second-class after the result. Its current missing families are ${existingGaps.join(", ")}; this event still needs ${missing.join(", ")}. Populate only facts this result and surrounding campaign canon actually establish; if the result is not yet known, remove the election claim and narrate polling/counting instead.`,
          };
        }
      }
    }

    if (effects.has("system") && !anyOp(polityOps, ["set-political-system", "set-government"])) {
      return {
        kind: "constitutional",
        expected: ["set-political-system", "set-government"],
        message: `Political claim for event "${clean(event.title) || "untitled"}" says ${polityKey}'s constitutional/political system changed, but that polity has no matching set-political-system or set-government politicalActorOps.`,
      };
    }

    if (effects.has("government")) {
      const expected = ["set-government", "form-coalition", "leave-coalition", "replace-leader"];
      if (!anyOp(polityOps, expected)) {
        return {
          kind: "government",
          expected,
          message: `Political claim for event "${clean(event.title) || "untitled"}" says ${polityKey} formed or replaced a government, but that polity carries no matching government, coalition or leader politicalActorOps.`,
        };
      }

      if (world && !eventEstablishesNonpartyGovernment(event, polityKey)) {
        const actor = getPoliticalProfile(world, polityKey);
        const createPartyEntries = polityEntries.filter((entry) => clean(entry?.op).toLowerCase() === "create-party");
        if (list(actor?.parties).length >= 2 && createPartyEntries.length && !effects.has("parties")) {
          const existing = list(actor.parties)
            .slice(0, 12)
            .map((party) => `${clean(party?.id) || "(no-id)"}${clean(party?.name) ? ` (${clean(party.name)})` : ""}`)
            .join(", ");
          return {
            kind: "government-party-reuse",
            expected: ["reuse existing canonical party ids"],
            message: `Political claim for event "${clean(event.title) || "untitled"}" forms a government for ${polityKey}, which already has a canonical party landscape, but the proposed operations create replacement parties without a parties claim for a real founding/split/merger/reorganization. Reuse the existing party ids in form-coalition instead of minting duplicates. Existing canonical parties: ${existing || "none listed"}.`,
          };
        }

        if (actorHasParliamentaryPartySystem(actor)
          && !governmentHasGoverningForce(actor)
          && !eventEstablishesGoverningForce(event, polityKey)) {
          return {
            kind: "government-governing-force",
            expected: ["form-coalition or another canonical governing-party membership write"],
            message: `Political claim for event "${clean(event.title) || "untitled"}" forms a durable government for parliamentary party system ${polityKey}, but canonical government membership is empty before and after the proposed operations. Use form-coalition to establish rulingPartyIds/coalitionPartyIds, or encode a legitimate non-party/caretaker/technocratic cabinet in the canonical set-government patch.`,
          };
        }
      }
    }

    if (effects.has("coalition")) {
      const hasCoalitionWrite = polityEntries.some((entry) => {
        const op = clean(entry?.op).toLowerCase();
        return op === "form-coalition" || op === "leave-coalition" || operationEstablishesGoverningForce(entry);
      });
      if (!hasCoalitionWrite) {
        return {
          kind: "coalition",
          expected: ["form-coalition", "leave-coalition", "canonical governing-membership write"],
          message: `Political claim for event "${clean(event.title) || "untitled"}" says ${polityKey}'s governing coalition membership changed, but no canonical governing-party membership write is present for that polity.`,
        };
      }
    }

    if (effects.has("leadership") && !anyOp(polityOps, ["replace-leader", "set-government", "set-party-leader"])) {
      return {
        kind: "leadership",
        expected: ["replace-leader", "set-government", "set-party-leader"],
        message: `Political claim for event "${clean(event.title) || "untitled"}" says ${polityKey}'s head of state/government or party leadership changed, but that polity carries no matching replace-leader, set-government or set-party-leader politicalActorOps.`,
      };
    }

    if (effects.has("parties") && !anyOp(polityOps, partyLandscapeOpNames)) {
      return {
        kind: "party-landscape",
        expected: partyLandscapeOpNames,
        message: `Political claim for event "${clean(event.title) || "untitled"}" says ${polityKey}'s party/power-bloc landscape changed, but that polity carries no matching party or power-bloc politicalActorOps.`,
      };
    }
  }
  return null;
};

export const politicalImpactCompletenessIssue = (event, { world = null, structuredClaims = false, claimRows = [] } = {}) => {
  if (!event || typeof event !== "object") return null;
  if (structuredClaims) return structuredPoliticalImpactCompletenessIssue(event, { world, claimRows });
  const text = textOf(event);
  if (!text) return null;
  const ops = opNames(event);

  // Elections are allowed to be scheduled/campaigned for without changing canon.
  // Once an event says the election is actually held/convened/results are returned,
  // it must move at least one durable political field or explicitly stop short of
  // narrating a completed structural outcome.
  if (electionNeedsPolityMutation(text)) {
    const expected = [
      "set-party-support", "set-party-influence", "set-government", "form-coalition",
      "leave-coalition", "replace-leader", "set-political-system",
    ];
    if (!anyOp(ops, expected)) {
      return {
        kind: "election",
        expected,
        message: `Political event "${clean(event.title) || "untitled"}" says an election was held/convened or produced a result but carries no election/government politicalActorOps. Add the matching party support/influence, government/coalition, leader or political-system operations for the affected polity, or rewrite the event as merely scheduled/campaigning with no completed structural result.`,
      };
    }

    // A result-bearing foundational election is the moment an emergent polity
    // stops being a PWv2 shell. Requiring merely *some* operation still permits
    // a timeline that says a new parliament was elected while the canonical
    // actor remains unspecified with zero parties and no strategic organism.
    // Mature actors are not forced to rewrite stable strategy/traits each cycle;
    // this stricter bundle applies only while the affected actor is sparse.
    if (ELECTION_RESULT_RE.test(text)) {
      const hasLandscape = anyOp(ops, [
        "create-party", "update-party", "set-party-support", "set-party-influence",
        "create-power-bloc", "update-power-bloc", "set-power-bloc-influence",
      ]);
      const hasGovernmentOutcome = anyOp(ops, [
        "set-government", "form-coalition", "leave-coalition", "replace-leader", "set-party-leader",
      ]);
      if (!hasLandscape || !hasGovernmentOutcome) {
        return {
          kind: "election-result",
          expected: ["party/power landscape", "government/coalition/leadership outcome"],
          message: `Political event "${clean(event.title) || "untitled"}" reports an election result but does not canonically establish both the resulting political landscape and who governs. Add party/power support or influence operations AND the matching government/coalition/leadership operations, or rewrite the event so final results are not yet known.`,
        };
      }

      for (const polityKey of opPolityKeys(event)) {
        const actor = world ? getPoliticalProfile(world, polityKey) : null;
        if (!world || !isSparsePoliticalActor(actor)) continue;
        const existingGaps = politicalActorMaturityGaps(actor);
        const polityEntries = politicalOpsForPolity(event, polityKey);
        const polityOpNames = new Set(polityEntries.map((entry) => clean(entry?.op).toLowerCase()).filter(Boolean));
        const polityHasGovernmentOutcome = anyOp(polityOpNames, [
          "set-government", "form-coalition", "leave-coalition", "replace-leader", "set-party-leader",
        ]);
        const missing = [];
        if (existingGaps.includes("political system") && !polityOpNames.has("set-political-system")) missing.push("set-political-system");
        if (existingGaps.includes("government") && !polityHasGovernmentOutcome) missing.push("government/coalition/leadership outcome");
        if (existingGaps.includes("representation entities")) {
          const entityCreationCount = polityEntries.filter((entry) => ["create-party", "create-power-bloc"].includes(clean(entry?.op).toLowerCase())).length;
          if (entityCreationCount < 2) missing.push("at least two represented political entities for the new landscape");
          if (!anyOp(polityOpNames, ["set-party-support", "set-party-influence", "set-power-bloc-influence"])) missing.push("quantitative support/influence");
        }
        if (existingGaps.includes("strategy")) {
          const strategyOps = polityEntries.filter((entry) => clean(entry?.op).toLowerCase() === "set-strategy");
          const completeStrategy = strategyOps.some((entry) => {
            const patch = parsedArgs(entry)?.patch;
            return nonEmptyArray(patch?.goals) && nonEmptyArray(patch?.fears) && nonEmptyArray(patch?.ambitions);
          });
          if (!completeStrategy) missing.push("set-strategy with goals, fears and ambitions");
        }
        if (existingGaps.includes("traits")) {
          const traitOps = polityEntries.filter((entry) => clean(entry?.op).toLowerCase() === "set-traits");
          const establishedTraits = traitOps.reduce((count, entry) => {
            const traits = parsedArgs(entry)?.traits;
            return count + (meaningfulObject(traits) ? Object.keys(traits).length : 0);
          }, 0);
          if (establishedTraits < 2) missing.push("set-traits with at least two justified canonical dimensions");
        }
        if (missing.length) {
          return {
            kind: "emergent-political-hydration",
            expected: missing,
            message: `Foundational election result "${clean(event.title) || "untitled"}" concerns sparse/emergent Political Actor ${polityKey}. Do not leave it structurally second-class after the result. Its current missing families are ${existingGaps.join(", ")}; this event still needs ${missing.join(", ")}. Populate only facts this result and surrounding campaign canon actually establish; if the result is not yet known, rewrite the event as polling/counting rather than a completed result.`,
          };
        }
      }
    }
  }

  if (CONSTITUTIONAL_COMPLETION_CLAIM_RE.test(text)) {
    const expected = ["set-political-system", "set-government"];
    if (!anyOp(ops, expected)) {
      return {
        kind: "constitutional",
        expected,
        message: `Political event "${clean(event.title) || "untitled"}" establishes or ratifies a constitutional/regime framework but carries no set-political-system or set-government politicalActorOps. The canonical Political Actor must change with the timeline event.`,
      };
    }
  }

  if (governmentTransitionClaim(text)) {
    const expected = ["set-government", "form-coalition", "leave-coalition", "replace-leader"];
    if (!anyOp(ops, expected)) {
      return {
        kind: "government",
        expected,
        message: `Political event "${clean(event.title) || "untitled"}" forms or installs a government/cabinet but carries no government, coalition or leader politicalActorOps.`,
      };
    }

    // A parliamentary party system cannot acquire its first durable government
    // while canonical governing membership remains empty. Head-of-government and
    // administration metadata answer who leads/how it is styled, not which party
    // or parties actually govern. Temporary/non-party cabinets are legitimate
    // exceptions and must be described as such rather than silently inferred.
    if (world && !NONPARTY_GOVERNMENT_RE.test(text)) {
      const polityKeys = opPolityKeys(event);
      if (polityKeys.length === 1) {
        const polityKey = polityKeys[0];
        const actor = getPoliticalProfile(world, polityKey);
        const polityEntries = politicalOpsForPolity(event, polityKey);
        const createPartyEntries = polityEntries.filter((entry) => clean(entry?.op).toLowerCase() === "create-party");

        // Government formation should consume the election landscape that already
        // exists. Without this guard the model can satisfy the governing-force
        // requirement by minting near-duplicate liberal/conservative parties and
        // then governing through those synthetic replacements. A government event
        // may still create a party when the event itself explicitly establishes a
        // real party founding, split, merger or reorganization.
        if (list(actor?.parties).length >= 2 && createPartyEntries.length && !PARTY_CREATION_RE.test(text)) {
          const existing = list(actor.parties)
            .slice(0, 12)
            .map((party) => `${clean(party?.id) || "(no-id)"}${clean(party?.name) ? ` (${clean(party.name)})` : ""}`)
            .join(", ");
          return {
            kind: "government-party-reuse",
            expected: ["reuse existing canonical party ids"],
            message: `Political event "${clean(event.title) || "untitled"}" forms a government for ${polityKey}, which already has a canonical party landscape, but the proposed operations create replacement parties even though the event does not establish a party founding/split/merger/reorganization. Reuse the existing party ids in form-coalition instead of minting duplicates. Existing canonical parties: ${existing || "none listed"}.`,
          };
        }

        if (actorHasParliamentaryPartySystem(actor)
          && !governmentHasGoverningForce(actor)
          && !eventEstablishesGoverningForce(event, polityKey)) {
          return {
            kind: "government-governing-force",
            expected: ["form-coalition or another canonical governing-party membership write"],
            message: `Political event "${clean(event.title) || "untitled"}" forms a durable government for parliamentary party system ${polityKey}, but canonical government membership is empty before and after the proposed operations. Use form-coalition to establish rulingPartyIds/coalitionPartyIds (it also represents a single-party or minority government), or explicitly describe a legitimate non-party/caretaker/technocratic cabinet instead. set-government plus replace-leader alone is not a governing force.`,
          };
        }
      }
    }
  }

  // If the prose says coalition formation actually completed, require a canonical
  // governing-membership write. A plain set-government patch may describe form or
  // ideology, but it must not satisfy a claim that coalition negotiations concluded.
  if (COALITION_RE.test(text) && COALITION_FORMATION_RE.test(text) && !eventEstablishesGoverningForce(event)) {
    return {
      kind: "coalition-formation",
      expected: ["form-coalition"],
      message: `Political event "${clean(event.title) || "untitled"}" says a governing coalition was formed or coalition negotiations concluded, but no canonical governing-party membership is written. Add form-coalition with the ruling/coalition party ids, or rewrite the prose so coalition formation has not yet occurred.`,
    };
  }

  if (COALITION_RE.test(text) && COALITION_MEMBERSHIP_CHANGE_RE.test(text)) {
    const expected = ["form-coalition", "leave-coalition", "set-government"];
    if (!anyOp(ops, expected)) {
      return {
        kind: "coalition",
        expected,
        message: `Political event "${clean(event.title) || "untitled"}" explicitly changes membership or continuity of a governing coalition but carries no form-coalition, leave-coalition or set-government politicalActorOps.`,
      };
    }
  }

  if (leadershipTransitionClaim(text)) {
    const expected = ["replace-leader", "set-government", "set-party-leader"];
    if (!anyOp(ops, expected)) {
      return {
        kind: "leadership",
        expected,
        message: `Political event "${clean(event.title) || "untitled"}" changes a head of state/government or party leader but carries no matching replace-leader, set-government or set-party-leader politicalActorOps.`,
      };
    }
  }

  if (REGIME_TRANSFER_RE.test(text)) {
    const expected = ["set-political-system", "set-government", "replace-leader"];
    if (!anyOp(ops, expected)) {
      return {
        kind: "regime",
        expected,
        message: `Political event "${clean(event.title) || "untitled"}" narrates a coup/revolution/regime transfer but carries no set-political-system, set-government or replace-leader politicalActorOps.`,
      };
    }
  }

  return null;
};


export const polityImpactCompletenessIssue = (event) => {
  if (!event || typeof event !== "object" || !eventClaimsPolityRename(event)) return null;
  if (eventCarriesPolityRename(event)) return null;
  return {
    kind: "polity-rename",
    expected: ["polityChanges rename"],
    message: `World event "${clean(event.title) || "untitled"}" formally renames a country/state in prose but carries no matching polityChanges rename/update. Add a canonical polity rename with code = the current identity and name = the new identity, or rewrite the event so the rename has not yet taken effect.`,
  };
};

export const validatePolityImpactCompleteness = (candidate) => {
  for (const event of list(candidate?.events)) {
    const issue = polityImpactCompletenessIssue(event);
    if (issue) return issue.message;
  }
  return "";
};


export const scriptedPoliticalImpactRequirements = (beats, { world = null } = {}) => list(beats)
  .map((beat) => {
    const title = clean(beat?.title) || clean(beat?.text).slice(0, 140) || "untitled scripted event";
    const event = { title, description: clean(beat?.text), impacts: { politicalActorOps: [] } };
    const issue = politicalImpactCompletenessIssue(event, { world });
    return issue ? { beat, issue } : null;
  })
  .filter(Boolean);

const officeholderName = (value) => {
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return clean(value.name || value.id);
};

const beatPoliticalText = (beat) => `${clean(beat?.title)} ${clean(beat?.text)}`.trim().toLocaleLowerCase();

const actorReferenceTokens = (polityKey, actor) => {
  const government = actor?.government && typeof actor.government === "object" ? actor.government : {};
  const weighted = [
    [polityKey, 100],
    [clean(polityKey).replace(/^the\s+/i, ""), 95],
    [actor?.name, 90],
    [officeholderName(actor?.leader), 85],
    [officeholderName(government.headOfState), 85],
    [officeholderName(government.headOfGovernment), 85],
    ...list(actor?.parties).flatMap((party) => [
      [officeholderName(party?.leader), 75],
      [party?.name, 45],
      [party?.shortName, 35],
    ]),
    ...list(actor?.powerBlocs).flatMap((bloc) => [[bloc?.name, 30], [bloc?.shortName, 25]]),
  ];
  return weighted
    .map(([token, weight]) => [clean(token), weight])
    .filter(([token]) => token.length >= 3);
};

const relevantScriptedPoliticalActors = (requirements, world) => {
  const byPolity = world?.politicalActors?.byPolity && typeof world.politicalActors.byPolity === "object"
    ? world.politicalActors.byPolity
    : {};
  const texts = list(requirements).map(({ beat }) => beatPoliticalText(beat)).filter(Boolean);
  if (!texts.length) return [];
  return Object.entries(byPolity)
    .map(([polityKey, actor]) => {
      const score = actorReferenceTokens(polityKey, actor).reduce((best, [token, weight]) => (
        texts.some((text) => text.includes(token.toLocaleLowerCase())) ? Math.max(best, weight) : best
      ), 0);
      return { polityKey, actor, score };
    })
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.polityKey.localeCompare(right.polityKey))
    .slice(0, 6)
    .map(({ polityKey, actor }) => [polityKey, actor]);
};

const scriptedPoliticalActorContext = (requirements, world) => {
  const selected = relevantScriptedPoliticalActors(requirements, world);
  if (!selected.length) {
    return "No exact Political Actor was matched from the scripted-beat text. Use the live canonical context/lookups; do not guess stable party/bloc ids or historical officeholders.";
  }

  const lines = [
    "Current canonical Political World references matched to these scripted beats:",
    "These are the state to simulate FROM. A scripted shock does not freeze the historical downstream settlement. Reuse exact ids and current officeholders where referenced.",
  ];
  for (const [polityKey, actor] of selected) {
    const government = actor?.government && typeof actor.government === "object" ? actor.government : {};
    const system = actor?.politicalSystem && typeof actor.politicalSystem === "object" ? actor.politicalSystem : {};
    lines.push(`POLITY: ${polityKey}`);
    lines.push(`Political system: ${JSON.stringify({ type: system.type || "", representation: system.representation || "", regimeCharacter: system.regimeCharacter || "", publicLabel: system.publicLabel || "" })}`);
    lines.push(`Current offices: leader=${JSON.stringify(officeholderName(actor?.leader))}; headOfState=${JSON.stringify(officeholderName(government.headOfState))}; headOfGovernment=${JSON.stringify(officeholderName(government.headOfGovernment))}`);
    lines.push(`Government party ids: ruling=${JSON.stringify(list(government.rulingPartyIds))}; coalition=${JSON.stringify(list(government.coalitionPartyIds))}; coalitionName=${JSON.stringify(clean(government.coalitionName))}`);
    const parties = list(actor?.parties).slice(0, 12);
    if (parties.length) {
      lines.push("Canonical parties:");
      for (const party of parties) {
        lines.push(`- id=${JSON.stringify(clean(party?.id))} name=${JSON.stringify(clean(party?.name))} leader=${JSON.stringify(officeholderName(party?.leader))}`);
      }
    }
    const blocs = list(actor?.powerBlocs).slice(0, 8);
    if (blocs.length) {
      lines.push("Canonical power blocs:");
      for (const bloc of blocs) lines.push(`- id=${JSON.stringify(clean(bloc?.id))} name=${JSON.stringify(clean(bloc?.name))}`);
    }
  }
  return lines.join("\n").slice(0, 6000);
};

export const buildScriptedPoliticalImpactInstruction = (requirements, { world = null } = {}) => {
  const rows = list(requirements);
  if (!rows.length) return "";
  return "[Canonical political requirements for scripted events]\n"
    + "The scenario-authored beat fixes the shock/outcome explicitly written by the author. Political World still owns the resulting government, leader, party, coalition and political-system state. "
    + "SIMULATE the immediate political consequences from the CURRENT campaign canon and return the matching politicalActorOps on THAT event. This includes constitutional succession, acting leadership, government/coalition consequences or other structural follow-through when the beat logically establishes them. "
    + "Do not hardcode the real-history successor or settlement when campaign canon has diverged, and do not rewrite the beat to avoid its authored structural change.\n"
    + rows.map(({ beat, issue }) => `- ${clean(beat?.date) || "(due date)"} — ${clean(beat?.title) || clean(beat?.text) || "scripted event"}: ${issue.message}`).join("\n")
    + `\n${scriptedPoliticalActorContext(rows, world)}`
    + "\nUse the normal politicalActorOps contract and exact native argsJson shapes. If the current canon supports a successor or settlement, encode it rather than merely narrating it. If canon genuinely leaves the consequence unresolved, represent only what is established; never invent a silent state change. A completed structural claim without valid matching operations must remain invalid for the normal corrective path.";
};

const cloneWorld = (world) => {
  if (!world || typeof world !== "object") return null;
  if (typeof structuredClone === "function") return structuredClone(world);
  return JSON.parse(JSON.stringify(world));
};

const officeholderText = (value) => {
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return clean(value.name || value.id);
};

const sameOfficeholderText = (left, right) => {
  const a = officeholderText(left).toLocaleLowerCase();
  const b = officeholderText(right).toLocaleLowerCase();
  return Boolean(a && b && a === b);
};

const HEAD_OF_GOVERNMENT_DEPARTURE_AFTER_NAME_RE = /^[^.!?;]{0,80}\b(?:resigns?|resigned|steps? down|stepped down|dies?|died|is (?:assassinated|killed|murdered|ousted|deposed)|was (?:assassinated|killed|murdered|ousted|deposed)|abdicates?|abdicated|announces?(?: (?:his|her|their))? resignation|submits?(?: (?:his|her|their))? resignation)\b/i;
const SUCCESSOR_INSTALLATION_RE = /\b(?:appoints?|appointed|names?|named|sworn in|takes? office|took office|assumes? office|assumed office|succeeds?|succeeded|replaces?|replaced|installed|inaugurated)\b/i;

const explicitlyDepartsAfterName = (text, name) => {
  const haystack = clean(text).toLocaleLowerCase();
  const needle = clean(name).toLocaleLowerCase();
  if (!haystack || !needle) return false;
  let offset = haystack.indexOf(needle);
  while (offset >= 0) {
    const after = haystack.slice(offset + needle.length, offset + needle.length + 120);
    if (HEAD_OF_GOVERNMENT_DEPARTURE_AFTER_NAME_RE.test(after)) return true;
    offset = haystack.indexOf(needle, offset + needle.length);
  }
  return false;
};

// Final native backstop for the narrow case where the prose establishes ONLY
// that the current head of government has left office. We can canonically record
// a vacancy without inventing a successor. If the event claims any succession or
// appointment, ambiguity wins and the normal completeness error remains fail-closed.
const repairUnambiguousHeadOfGovernmentDeparture = (event, world) => {
  if (!event || typeof event !== "object" || !world) return false;
  const text = textOf(event);
  if (!text || SUCCESSOR_INSTALLATION_RE.test(text)) return false;
  const existing = opNames(event);
  if (anyOp(existing, ["replace-leader", "set-government", "set-party-leader"])) return false;

  const byPolity = world?.politicalActors?.byPolity;
  if (!byPolity || typeof byPolity !== "object" || Array.isArray(byPolity)) return false;
  const matches = Object.entries(byPolity).filter(([, actor]) => {
    const headOfGovernment = actor?.government?.headOfGovernment;
    const name = officeholderText(headOfGovernment);
    if (!name || !explicitlyDepartsAfterName(text, name)) return false;
    // set-government can clear the formal HoG office, but it cannot clear the
    // actor-level leader field. Do not synthesize a half-transition for legacy
    // actors where that field is the same person; those cases stay fail-closed.
    return !sameOfficeholderText(actor?.leader, headOfGovernment);
  });
  if (matches.length !== 1) return false;

  const [polityKey] = matches[0];
  const packed = {
    op: "set-government",
    polityKey,
    argsJson: JSON.stringify({ patch: { headOfGovernment: "" } }),
  };
  // Validate the exact native mutation on a disposable world before attaching it.
  // The normal apply path will execute the same operation after the turn is accepted.
  const probe = cloneWorld(world);
  const outcome = applyPoliticalActorOperation(probe, {
    ...parsedArgs(packed),
    op: packed.op,
    polityKey: packed.polityKey,
  });
  if (!outcome?.applied) return false;

  const impacts = event.impacts && typeof event.impacts === "object" && !Array.isArray(event.impacts)
    ? event.impacts
    : {};
  event.impacts = {
    ...impacts,
    politicalActorOps: [...list(impacts.politicalActorOps), packed],
  };
  return true;
};

const worldAfterPoliticalOps = (world, event) => {
  if (!world) return null;
  const next = cloneWorld(world);
  for (const entry of politicalOps(event)) {
    const outcome = applyPoliticalActorOperation(next, {
      ...parsedArgs(entry),
      op: clean(entry?.op),
      polityKey: clean(entry?.polityKey || entry?.polity || entry?.country),
    });
    // Shape/reference validity belongs to the caller's native op validator. For
    // completeness-only callers, an invalid op must not advance the scratch world
    // and accidentally excuse a later event.
    if (!outcome?.applied) return world;
  }
  return next;
};

export const validatePoliticalImpactCompleteness = (candidate, { world = null, claimContext = null } = {}) => {
  const claims = claimContext || preparePoliticalClaimContext(candidate);
  if (claims?.error) return claims.error;
  const structuredClaims = claims?.mode === "structured";

  let validationWorld = cloneWorld(world);
  for (const event of list(candidate?.events)) {
    const eventUsesStructuredClaims = structuredClaims && !claims?.legacyEvents?.has?.(event);
    const claimRows = eventUsesStructuredClaims
      ? mergeClaimRows(declaredPoliticalClaimRows(claims, event), operationDerivedClaimRows(event))
      : [];
    const claimsLeadershipChange = claimRows.some((row) => list(row?.effects).includes("leadership"));
    // The vacancy repair may read prose to identify WHICH known officeholder left,
    // but structured mode decides WHETHER a leadership transition exists. CSE
    // structural beats are explicitly marked legacy so authored prose still
    // protects deterministic fallback until CSE gains its own structured metadata.
    if (!eventUsesStructuredClaims || claimsLeadershipChange) {
      repairUnambiguousHeadOfGovernmentDeparture(event, validationWorld);
    }
    const issue = politicalImpactCompletenessIssue(event, {
      world: validationWorld,
      structuredClaims: eventUsesStructuredClaims,
      claimRows,
    });
    if (issue) return issue.message;
    validationWorld = worldAfterPoliticalOps(validationWorld, event);
  }
  return "";
};
