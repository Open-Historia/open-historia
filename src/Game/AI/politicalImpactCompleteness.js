import { getPoliticalProfile } from "../../runtime/politicalActors.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const textOf = (event) => `${clean(event?.title)} ${clean(event?.description)}`.trim();
const opNames = (event) => new Set(list(event?.impacts?.politicalActorOps)
  .map((entry) => clean(entry?.op).toLowerCase())
  .filter(Boolean));

const politicalOps = (event) => list(event?.impacts?.politicalActorOps)
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

const ELECTION_EVENT_RE = /\b(?:general|parliamentary|presidential|legislative|national|constituent)?\s*elections?\b/i;
// An election counts as held only when the verb or the result is about the
// election itself, in the same clause: "holds parliamentary elections",
// "elections held in Poland", "election results", "the election gave the
// Liberals a majority". A promise to hold one, elections "to be held", a poll,
// an election law passed by a majority, or police who "hold protesters after
// an election rally" do not.
const ELECTION_WORD = "(?:(?:general|parliamentary|presidential|legislative|national|constituent|snap|early|local|regional)\\s+)?elections?";
const NOT_THE_VOTE = "(?!\\s+(?:law|laws|reform|code|commission|date|campaign|monitors?|observers?|fraud|rules?|bill|rally|rallies|debates?|posters?|manifesto))";
const NOT_A_PROMISE = "(?<!\\b(?:to|will|would|shall|must|should|may|might|could)\\s)";
// Up to three words between holding and the election ("holds first free
// federal elections"), never across a preposition or a clause: police "hold
// protesters after an election" hold no election.
const ELECTION_GAP = "(?:\\s+(?!(?:after|before|ahead|during|following|over|at|in|on|near|outside|against|amid|about|for|of|to|with|by|who|which|that|as|and|or)\\b)[\\w'-]+){0,3}?";
const ELECTION_COMPLETION_RE = new RegExp([
  `${NOT_A_PROMISE}\\b(?:holds?|held|conducts?|conducted|convenes?|convened)${ELECTION_GAP}\\s+${ELECTION_WORD}\\b${NOT_THE_VOTE}`,
  `${NOT_A_PROMISE}\\b(?:wins?|won)\\b[^.;!?]{0,50}\\b${ELECTION_WORD}\\b${NOT_THE_VOTE}`,
  `\\b${ELECTION_WORD}\\b${NOT_THE_VOTE}[^.;!?]{0,60}\\b(?:(?:(?:is|are|was|were)\\s+)?(?<!\\bbe\\s)held|results?|returns?|returned|won\\s+by|produces?|produced|delivers?|delivered|gives?|gave|hands?|handed|elects?|elected|seats?|majority|plurality|victory|landslide)\\b`,
].join("|"), "i");
const ELECTION_RESULT_RE = /\b(?:results?|returns?|returned|final tall(?:y|ies)|count(?:ed|ing)?|wins?|won|victory|majority|plurality|seat(?:s)?|governing coalition|coalition government|forms? (?:the )?government|elected (?:president|prime minister|premier|chancellor))\b/i;
const CONSTITUTIONAL_RE = /\b(?:constitution|constitutional charter|constitutional framework|fundamental law|new republic|new monarchy|parliamentary republic|presidential republic|constitutional monarchy)\b/i;
const CONSTITUTIONAL_COMPLETION_RE = /\b(?:adopts?|adopted|ratifies?|ratified|enacts?|enacted|promulgates?|promulgated|establishes?|established|proclaims?|proclaimed|enters? into force|takes? effect)\b/i;
// The offices whose holder is a Political Actor's leadership. A former or
// late holder is a private person: "Former President Carter Dies" changes no
// government.
const OFFICE = "(?:president|prime\\s+minister|chancellor|premier|head\\s+of\\s+state|head\\s+of\\s+government|monarch|king|queen|emperor|empress|tsar|czar|kaiser)";
const SITTING_OFFICE = `(?<!\\bformer\\s)(?<!\\bex-)(?<!\\blate\\s)\\b${OFFICE}\\b`;
// Up to three words between an office and its verb, for a name ("Prime
// Minister Jaan Poska resigns"), never across a clause ("who", "after").
const NAME_GAP = "(?:\\s+(?!(?:who|whom|whose|which|that|after|before|as|and|or|of|with|to|for|in|on|at|over|by)\\b)[\\w.'-]+){0,3}?";
// The appointee's name alone: no article, no "new" (a new ambassador is not a
// name), no sentence break. The title and description are read as one text.
const APPOINTEE_GAP = "(?:\\s+(?!(?:who|whom|whose|which|that|after|before|as|and|or|of|with|to|for|in|on|at|over|by|the|a|an|new|next)\\b)[\\w'-]+){1,3}?";
// A government is formed, installed or takes office. Taking office,
// swearing-in and inauguration need a government or an office holder: a rail
// link or an ambassador can be inaugurated or sworn in too.
const GOVERNMENT_RE = new RegExp([
  "\\bnew\\s+(?:government|cabinet)\\b(?!\\s+(?:program|programme|policy|policies|initiative|plan|scheme|regulations?|rules?|measures?|building|offices?|headquarters|spending|budget|bonds?|report|data|figures|statistics|website|portal|agency|department|ministry|subsid\\w*|contract|funding|grants?))",
  "\\b(?:provisional\\s+|interim\\s+|transitional\\s+|national\\s+|coalition\\s+)?(?:government|cabinet|administration)\\s+(?:is\\s+|was\\s+)?(?:formed|established|installed|proclaimed|sworn\\s+in)\\b",
  "\\b(?:forms?|formed|establishes?|established|installs?|installed)\\s+(?:a\\s+|the\\s+|its\\s+)?(?:(?:new|first|permanent|constitutional|elected|coalition|majority|minority|provisional|interim|transitional)\\s+)*(?:government|cabinet|administration)\\b",
  `(?:${SITTING_OFFICE}|\\b(?:government|cabinet|administration)\\b)${NAME_GAP}\\s+(?:takes?|took|assumes?|assumed)\\s+office\\b`,
  `(?:${SITTING_OFFICE}|\\b(?:government|cabinet|administration)\\b)${NAME_GAP}\\s+(?:(?:is|was)\\s+)?(?:sworn\\s+in|inaugurated)\\b`,
  `\\b(?:sworn\\s+in|inaugurated)\\s+as\\s+(?:the\\s+)?(?:new\\s+)?${OFFICE}\\b`,
].join("|"), "i");
const COALITION_RE = /\b(?:coalition|governing alliance|cabinet agreement)\b/i;
// A military coalition is not a government: "coalition forces enter Baghdad".
const MILITARY_COALITION_RE = /\b(?:coalition\s+(?:forces|troops|aircraft|air\s*strikes?|airstrikes?|warplanes|jets|navies|naval|ships|soldiers|operations?|military|partners\s+in\s+the\s+war)|(?:military|international|multinational|allied|western|arab|global|anti-[\w-]+|[\w-]+-led)\s+coalition)\b/gi;
// A coalition changes when the verb is about the coalition itself.
const COALITION_CHANGE_RE = /\bcoalition\b[^.;!?]{0,60}\b(?:is\s+formed|formed|forms|collapses?|collapsed|breaks?\s+up|broke\s+up|falls?\s+apart|fell\s+apart|splits?)\b|\b(?:forms?|formed|joins?|joined|enters?|entered|leaves?|left|quits?|exits?|exited|withdraws?\s+from|withdrew\s+from|abandons?|abandoned)\s+(?:a\s+|the\s+|its\s+)?(?:[\w-]+\s+){0,3}?coalition\b/i;
const COALITION_FORMATION_RE = /(?:\b(?:forms?|formed|establishes?|established)\s+(?:a |the )?(?:new )?(?:governing )?coalition\b|\b(?:coalition|governing alliance)\s+(?:is\s+)?(?:formed|established)\b|\b(?:successfully\s+)?concludes?\s+coalition negotiations?\b|\bcoalition negotiations?\s+(?:successfully\s+)?conclude(?:s|d)?\b|\breaches?\s+(?:a\s+)?coalition agreement\b|\bcoalition agreement\s+(?:is\s+)?(?:reached|concluded|signed)\b|\bcoalition government\s+(?:is\s+)?(?:formed|established)\b)/i;
const NONPARTY_GOVERNMENT_RE = /\b(?:provisional|interim|transitional|caretaker|technocratic|non[- ]partisan|partyless|military junta|royal cabinet|royal government|independent cabinet|emergency administration)\b/i;
const PARTY_CREATION_RE = /(?:\b(?:founds?|founded|forms?|formed|creates?|created|launches?|launched|establishes?|established|organizes?|organized|reorganizes?|reorganized|reconstitutes?|reconstituted)\s+(?:a |the )?(?:new )?(?:political )?(?:party|movement|bloc)\b|\b(?:party|movement|bloc)\s+(?:is\s+)?(?:founded|formed|created|launched|established|reorganized|reconstituted)\b|\b(?:party )?(?:split|merger|merge|merged|breakaway|secession from|renames?|renamed)\b)/i;
// The office itself changes hands, in one phrase: the holder resigns, dies or
// is ousted; someone is elected, named or sworn in AS the office; a new holder.
// "President Names New Ambassador" names no president.
const LEADERSHIP_CHANGE_RE = new RegExp([
  `${SITTING_OFFICE}${NAME_GAP}\\s+(?:resigns?|resigned|steps?\\s+down|stepped\\s+down|dies|died|abdicates?|abdicated|(?:is|was|has\\s+been)\\s+(?:ousted|deposed|removed|replaced|succeeded|assassinated|killed|overthrown)|takes?\\s+office|took\\s+office|assumes?\\s+office|(?:(?:is|was)\\s+)?sworn\\s+in)\\b`,
  `\\b(?:elects?|elected|appoints?|appointed|names?|named|installs?|installed|confirms?|confirmed|becomes?|became|proclaimed|crowned|sworn\\s+in)\\s+(?:(?:a|the|its|their|as)\\s+)*(?:new\\s+|next\\s+|interim\\s+|acting\\s+)?${OFFICE}\\b`,
  // "Sejm elects Andrzej Duda as president", "names Smith prime minister":
  // a name between the verb and the office, but not a candidacy.
  `\\b(?:elects?|elected|appoints?|appointed|names?|named|installs?|installed)${APPOINTEE_GAP}\\s+(?:as\\s+)?(?:the\\s+)?(?:new\\s+|next\\s+|interim\\s+|acting\\s+)?${OFFICE}\\b(?!\\s+(?:candidate|nominee|hopeful|contender|race|campaign))`,
  `\\b(?:replaces?|replaced|succeeds?|succeeded)\\s+[\\w\\s.'-]{1,40}?\\s+as\\s+(?:the\\s+)?${OFFICE}\\b`,
  `\\bnew\\s+${OFFICE}\\b`,
  `${SITTING_OFFICE}\\s+(?:(?:is|was|has\\s+been)\\s+)?(?:elected|ousted|deposed|overthrown)\\b`,
  `${SITTING_OFFICE}\\s+(?:is|was|has\\s+been)\\s+(?:named|appointed|installed)\\b`,
].join("|"), "i");
// A regime changes: a coup, an overthrow, power seized, a monarchy restored
// or abolished. A "digital revolution" or the "restoration" of a cathedral is
// not one, and neither is a coup that failed.
const REGIME_CHANGE_RE = new RegExp([
  "\\bcoup(?:\\s+d['’]\\s*[ée]tat)?\\b(?!\\s+(?:attempts?|plots?|plotters|rumou?rs?|fears?|threats?|allegations?))",
  "\\bregime\\s+change\\b",
  "\\boverthrows?\\b|\\boverthrew\\b|\\boverthrown\\b",
  "\\bseiz(?:es?|ed|ing)\\s+power\\b",
  "\\brevolution(?:aries|ary\\s+forces)?\\s+(?:topples?|toppled|overthrows?|overthrew|ousts?|ousted|seizes?|seized|triumphs?|triumphed)\\b",
  "\\b(?:topples?|toppled|ousts?|ousted)\\s+(?:the\\s+)?(?:government|regime|monarchy|dictatorship|junta)\\b",
  "\\brestor(?:es|ed|ation\\s+of)\\s+(?:the\\s+)?monarchy\\b|\\brestored\\s+monarchy\\b|\\bmonarchy\\s+(?:is\\s+|was\\s+)?restored\\b",
  "\\babolish(?:es|ed)?\\s+(?:the\\s+)?monarchy\\b",
  "\\bdissolves?\\s+parliament\\b",
  "\\bjunta\\s+(?:takes|took|seizes|seized|assumes|assumed)\\s+(?:power|control)\\b",
].join("|"), "i");
const FAILED_COUP_RE = /\b(?:fail(?:s|ed)?|foil(?:s|ed)?|thwart(?:s|ed)?|suppress(?:es|ed)?|crush(?:es|ed)?|defeat(?:s|ed)?|botched|abortive|attempted|alleged)\s+(?:(?:a|an|the)\s+)?(?:military\s+)?coup\b|\bcoup\b[^.;!?]{0,40}\b(?:fails?|failed|is\s+foiled|was\s+foiled|is\s+thwarted|was\s+thwarted|collapses?|collapsed)\b/gi;

const anyOp = (ops, names) => names.some((name) => ops.has(name));

export const politicalImpactCompletenessIssue = (event, { world = null } = {}) => {
  if (!event || typeof event !== "object") return null;
  const text = textOf(event);
  if (!text) return null;
  const ops = opNames(event);

  // Elections are allowed to be scheduled/campaigned for without changing canon.
  // Once an event says the election is actually held/convened/results are returned,
  // it must move at least one durable political field or explicitly stop short of
  // narrating a completed structural outcome.
  if (ELECTION_EVENT_RE.test(text) && ELECTION_COMPLETION_RE.test(text)) {
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

  if (CONSTITUTIONAL_RE.test(text) && CONSTITUTIONAL_COMPLETION_RE.test(text)) {
    const expected = ["set-political-system", "set-government"];
    if (!anyOp(ops, expected)) {
      return {
        kind: "constitutional",
        expected,
        message: `Political event "${clean(event.title) || "untitled"}" establishes or ratifies a constitutional/regime framework but carries no set-political-system or set-government politicalActorOps. The canonical Political Actor must change with the timeline event.`,
      };
    }
  }

  if (GOVERNMENT_RE.test(text)) {
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
  const coalitionText = text.replace(MILITARY_COALITION_RE, " ");
  if (COALITION_RE.test(coalitionText) && COALITION_FORMATION_RE.test(coalitionText) && !eventEstablishesGoverningForce(event)) {
    return {
      kind: "coalition-formation",
      expected: ["form-coalition"],
      message: `Political event "${clean(event.title) || "untitled"}" says a governing coalition was formed or coalition negotiations concluded, but no canonical governing-party membership is written. Add form-coalition with the ruling/coalition party ids, or rewrite the prose so coalition formation has not yet occurred.`,
    };
  }

  if (COALITION_RE.test(coalitionText) && COALITION_CHANGE_RE.test(coalitionText)) {
    const expected = ["form-coalition", "leave-coalition", "set-government"];
    if (!anyOp(ops, expected)) {
      return {
        kind: "coalition",
        expected,
        message: `Political event "${clean(event.title) || "untitled"}" changes a governing coalition but carries no form-coalition, leave-coalition or set-government politicalActorOps.`,
      };
    }
  }

  if (LEADERSHIP_CHANGE_RE.test(text)) {
    const expected = ["replace-leader", "set-government", "set-party-leader"];
    if (!anyOp(ops, expected)) {
      return {
        kind: "leadership",
        expected,
        message: `Political event "${clean(event.title) || "untitled"}" changes a head of state/government or party leader but carries no matching replace-leader, set-government or set-party-leader politicalActorOps.`,
      };
    }
  }

  if (REGIME_CHANGE_RE.test(text.replace(FAILED_COUP_RE, " "))) {
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

// Every event's issue, with its index: a strict attempt is told the first,
// and salvage keeps every offending event and notes each one in the receipt.
export const politicalImpactCompletenessIssues = (candidate, { world = null } = {}) => list(candidate?.events)
  .map((event, index) => {
    const issue = politicalImpactCompletenessIssue(event, { world });
    return issue ? { ...issue, index, id: clean(event?.id), title: clean(event?.title) } : null;
  })
  .filter(Boolean);

export const validatePoliticalImpactCompleteness = (candidate, { world = null } = {}) =>
  politicalImpactCompletenessIssues(candidate, { world })[0]?.message || "";
