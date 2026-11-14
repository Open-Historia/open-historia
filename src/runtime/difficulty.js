/*! Open Historia — difficulty levels & AI directives © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// What difficulty is for.
//
// It decides how things tend to go for the player. On Very Easy almost
// everything goes well for them; on Medium things happen realistically; on
// Impossible almost everything goes poorly. The four levels between are the
// steps of that ladder.
//
// This reverses what the levels used to mean. They only changed how much
// benefit of the doubt a plan got and how able the opposition was, and said
// in as many words that the world never leaned for or against the human. A
// player who chose Impossible got a strict referee, and one who chose Very
// Easy a lenient one, and the game played much the same at both. The outcome
// is now tilted, strongly at the two ends.
//
// What difficulty still never does:
// - it never rewrites established canon, deterministic accounting, geography,
//   territorial semantics or an explicit GM/editor instruction;
// - it never produces an outcome with no cause: a reverse is bad luck, an
//   able opponent, a flaw in the plan, a friend who wavered, and the text
//   says which;
// - it never ignores or forbids what the player orders: the attempt is
//   always made and always gets an outcome;
// - it is never named to the player.
//
// ON THE BATTLEFIELDS the level is also in the engine itself, and not only in
// what a model is told (runtime/fronts/). Medium is the fight as it is, the
// same for both sides. Above it the armies fighting a country a person plays
// fight harder, advance faster and are reinforced more, hugely so on
// Impossible; below it they are the ones held back. The figures are
// runtime/fronts/constants.js DIFFICULTY_EDGES, who they apply to is
// runtime/fronts/handicap.js, and each level's `effects` says them to the
// player, so that handicap is a stated one.
//
// Every level says it three ways, which must agree:
//   priority    two or three sentences that open every system prompt the game
//               sends about the player's world (difficultyPriorityBlock);
//   directives  the longer reading for a task's scope: the simulation, a
//               leader bargaining, an interactive event;
//   blurb, description, effects, profile
//               what the player reads where the level is chosen.
const makeLevel = ({ id, label, emoji, blurb, description, profile, effects, priority, directives }) => ({
  id,
  label,
  emoji,
  blurb,
  description,
  profile,
  effects,
  priority,
  directives,
  // Backwards-compatible field for any older UI/importer that still reads .directive.
  directive: directives.simulation,
});

export const DIFFICULTY_LEVELS = [
  makeLevel({
    id: "very-easy",
    label: "Very Easy",
    emoji: "😴",
    blurb: "Almost everything goes your way",
    description: "Your orders succeed, usually in full. Luck and other governments break your way, and a setback is rare, small and soon mended.",
    profile: {
      playerLeniency: "Very high",
      npcCompetence: "Relaxed",
      consequencePressure: "Low",
      diplomaticFirmness: "Soft",
    },
    effects: [
      "Luck, timing and other governments' choices almost always break your way.",
      "Ambiguous but reasonable player intent is interpreted generously.",
      "NPCs still pursue their interests, but react less quickly to marginal openings.",
      "When several outcomes are equally plausible, the less punishing one is preferred.",
      "Technology advances at a realistic pace: what the era's science cannot yet build takes years of research, or is not built at all.",
      "On battlefields, armies fighting you fight at 85% of their strength and advance at 90% of their pace, with 70% of the usual reserves.",
    ],
    priority:
      "Almost everything goes well for the player. Their orders succeed, usually in full; luck, timing and other governments' choices break their way; and a setback is rare, small and soon mended.",
    directives: {
      simulation:
        "Tilt strongly toward the player. Their orders succeed, usually in full, wherever the supplied world state leaves any plausible way for them to; where a plan is thin, let circumstances supply what it lacked: a rival distracted, a timely defection, fair weather, a willing partner. Other governments remain themselves, but are slow to oppose the player, miss openings against them and choose the response that costs the player least. A setback to the player is rare, small and soon mended, and never cascades. Do not grant what the world state makes impossible, and do not falsify a figure.",
      diplomacy:
        "Counterparts are ready to agree with the player. They read the player's proposals generously, ask little in return, overlook a slight, and say yes to whatever does not cost them a core interest; where they must refuse, they refuse courteously and offer another way. They still speak as themselves, and never give up their own survival or an explicit commitment.",
      interactive:
        "Offer clear choices, most of which turn out well, and resolve what the player chooses in their favour: the plan works, the other side yields or blunders, and a poor choice costs little and can be put right. No hidden catch.",
    },
  }),
  makeLevel({
    id: "easy",
    label: "Easy",
    emoji: "🙂",
    blurb: "Things usually go your way",
    description: "Sound orders succeed and doubtful ones mostly come off. Setbacks happen, but stay modest and recoverable.",
    profile: {
      playerLeniency: "High",
      npcCompetence: "Moderate",
      consequencePressure: "Low–medium",
      diplomaticFirmness: "Flexible",
    },
    effects: [
      "Luck and other governments' choices lean your way.",
      "Reasonable player plans receive some benefit of the doubt.",
      "NPCs protect obvious interests but are less aggressive about marginal advantages.",
      "Setbacks matter, but uncertain failures tend not to cascade immediately.",
      "Technology advances at a realistic pace: what the era's science cannot yet build takes years of research, or is not built at all.",
      "On battlefields, armies fighting you fight at 93% of their strength and advance at 95% of their pace, with 85% of the usual reserves.",
    ],
    priority:
      "Things usually go well for the player. Sound orders succeed and doubtful ones mostly come off; luck and other governments' choices lean their way; setbacks happen, stay modest and can be recovered from.",
    directives: {
      simulation:
        "Tilt toward the player. Sound orders succeed, and doubtful ones mostly come off, at least in good part; where several outcomes are plausible, choose one of the better ones for the player. Other governments protect their clear interests, but are slow to exploit the player's mistakes and seldom combine against them. Setbacks happen, stay modest and do not compound.",
      diplomacy:
        "Counterparts are well disposed to the player: flexible, constructive, content with a workable bargain rather than the last concession, and willing to save the player's face. Red lines, alliances and wars still count.",
      interactive:
        "Offer real trade-offs with more good routes than bad, and resolve the player's choice a little better than a neutral reading would. A mistake stays recoverable unless canon already makes it grave.",
    },
  }),
  makeLevel({
    id: "medium",
    label: "Medium",
    emoji: "⚖️",
    blurb: "Neutral, realistic baseline",
    description: "The simulator neither helps nor targets the player; outcomes follow capability, leverage, information, and causality.",
    profile: {
      playerLeniency: "Neutral",
      npcCompetence: "Normal",
      consequencePressure: "Normal",
      diplomaticFirmness: "Interest-based",
    },
    effects: [
      "Player plans succeed or fail on their merits.",
      "NPCs act with normal competence and pursue their own interests.",
      "Consequences persist when causally warranted, with no hidden difficulty bias.",
      "Technology advances at a realistic pace: what the era's science cannot yet build takes years of research, or is not built at all.",
      "On battlefields, both sides fight on equal terms: numbers, ground, supply and orders decide it.",
    ],
    priority:
      "Things happen realistically. The player is neither helped nor hindered: each order succeeds or fails on its means, its timing and the opposition it meets, and luck favours nobody.",
    directives: {
      simulation:
        "Use a neutral causal standard. Judge player plans by the supplied resources, timing, institutions, logistics, opposition, and prior commitments. NPC governments act with normal competence and pursue their own interests using information they could plausibly possess. Do not favor or punish the player when several outcomes are possible; choose the branch best supported by the campaign state.",
      diplomacy:
        "Negotiate from the counterpart's actual interests, leverage, relationships, commitments, and information. Offer concessions when they are rational, resist when they are not, and seek realistic compromise where interests overlap. Do not favor or target the player because they are human-controlled.",
      interactive:
        "Present realistic strategic trade-offs. Resolve choices by capability, timing, leverage, and consequences already present in the world, with no difficulty-side favoritism or hostility.",
    },
  }),
  makeLevel({
    id: "hard",
    label: "Hard",
    emoji: "😰",
    blurb: "Things often go against you",
    description: "Your orders meet friction, delay and extra cost. Rivals are firm and quick to use an opening.",
    profile: {
      playerLeniency: "Low",
      npcCompetence: "High",
      consequencePressure: "High",
      diplomaticFirmness: "Firm",
    },
    effects: [
      "Luck and other governments' choices lean against you.",
      "Vague or under-resourced plans receive little benefit of the doubt.",
      "NPCs react promptly to threats and exploit clear opportunities they can actually perceive.",
      "Political, military, diplomatic, and economic mistakes have durable consequences.",
      "Technology advances at a realistic pace: what the era's science cannot yet build takes years of research, or is not built at all.",
      "On battlefields, armies fighting you fight at 115% of their strength and advance at 110% of their pace, with 130% of the usual reserves.",
    ],
    priority:
      "Things often go poorly for the player. Their orders meet friction, delay and extra cost; rivals are firm and quick to use an opening; a full success takes a well-founded order, and a weak one fails.",
    directives: {
      simulation:
        "Tilt against the player. Their orders meet friction: delay, extra cost, resistance, a part of the aim missed. Only a well-founded order, with the means, the timing and the support it needs, succeeds in full; a vague or under-supplied one fails. Where several outcomes are plausible, choose one of the worse ones for the player. Other governments notice and use an opening promptly, hold firm, and work together against the player where their interests allow. Mistakes leave lasting marks. Every reverse has a cause the narration states.",
      diplomacy:
        "Counterparts are firm with the player: they notice a weak offer, ask a real price for cooperation, hold their red lines, remember a breach, and often say no or not yet. A genuinely good bargain can still be struck.",
      interactive:
        "Offer hard trade-offs with no safe option, and resolve the player's choice somewhat worse than a neutral reading would: what could go wrong partly does. Preparation and leverage still earn a better result.",
    },
  }),
  makeLevel({
    id: "very-hard",
    label: "Very Hard",
    emoji: "🔥",
    blurb: "Things usually go against you",
    description: "Most orders fall short, stall or cost much more than planned. Rivals act ably and friends are cautious.",
    profile: {
      playerLeniency: "Very low",
      npcCompetence: "Very high",
      consequencePressure: "Very high",
      diplomaticFirmness: "Very firm",
    },
    effects: [
      "Luck, timing and other governments' choices usually break against you.",
      "Plans need clear means, sequencing, and political or diplomatic support.",
      "NPCs use available intelligence and existing relationships efficiently.",
      "Serious mistakes can trigger second-order consequences when the causal chain supports them.",
      "Technology advances at a realistic pace: what the era's science cannot yet build takes years of research, or is not built at all.",
      "On battlefields, armies fighting you fight at 135% of their strength and advance at 120% of their pace, with 175% of the usual reserves.",
    ],
    priority:
      "Things usually go poorly for the player. Most of their orders fall short, stall or cost much more than planned; luck and other governments' choices lean against them; rivals act ably and friends are cautious; a success is partial more often than whole.",
    directives: {
      simulation:
        "Tilt hard against the player. Most of their orders fall short, stall or cost much more than planned; a success is usually partial and paid for. Luck, timing and third parties' choices lean against them. Other governments act ably, exploit every exposed weakness quickly and combine against the player when it serves them; the player's friends are cautious and slow to help. Mistakes compound. Only an order with strong means and little that can go wrong succeeds cleanly. Every reverse has a cause the narration states, and nothing is granted or denied against the supplied facts.",
      diplomacy:
        "Counterparts are hard on the player: sceptical, demanding, quick to raise their price, slow to trust and ready to walk away. They usually refuse, delay or attach conditions; agreement comes only for clear and convincing value, and friends hedge.",
      interactive:
        "Make every choice costly, and resolve the player's choice clearly worse than a neutral reading would: shortcuts fail, complications arrive, and a serious mistake cascades. A well-prepared choice limits the damage rather than escaping it.",
    },
  }),
  makeLevel({
    id: "impossible",
    label: "Impossible",
    emoji: "💀",
    blurb: "Almost everything goes against you",
    description: "Your orders fail, stall or succeed only in part and at a price. Luck and other governments break against you, and a clean success is rare.",
    profile: {
      playerLeniency: "None",
      npcCompetence: "Elite",
      consequencePressure: "Maximum",
      diplomaticFirmness: "Maximum",
    },
    effects: [
      "Luck, timing and other governments' choices almost always break against you.",
      "Ambiguity is resolved conservatively; success needs explicit capability and leverage.",
      "NPCs act near the top of plausible competence without omniscience.",
      "Failures can cascade fully when each step is causally supported.",
      "Technology advances at a realistic pace: what the era's science cannot yet build takes years of research, or is not built at all.",
      "On battlefields, armies fighting you have a huge advantage: they fight at 175% of their strength and advance at 140% of their pace, with 300% of the usual reserves.",
    ],
    priority:
      "Almost everything goes poorly for the player. Their orders fail, stall, cost far more than planned or succeed only in part and at a price; luck, timing and other governments' choices break against them; rivals act at their best and friends waver; a clean success is rare.",
    directives: {
      simulation:
        "Tilt as far against the player as a believable world allows. Their orders fail, stall, cost far more than planned, or succeed only in part and at a price; a clean success is rare, and comes only where failure would contradict the supplied facts. Luck, timing, weather, accident and third parties' choices break against them. Rivals act at their best, see the player's weaknesses, strike at the worst moment and combine against them; friends waver, delay, ask more and sometimes abandon them. Failures cascade. Every reverse must have a cause the narration states: bad fortune, an able opponent, a flaw in the plan, a failure of nerve or of supply. Never rewrite an established fact or figure to bring it about, and always let the player's order be attempted and have its outcome.",
      diplomacy:
        "Counterparts give the player almost nothing. They refuse, stall or demand far more than is offered; they doubt the player's word, exploit every weakness in the player's position and take offence readily. Friends waver, and ask a high price for what they once gave freely. Agreement is possible only where refusing would plainly ruin the counterpart, and then on the counterpart's terms.",
      interactive:
        "Every choice carries a serious cost, and the player's choice goes badly: what can go wrong does, the other side acts at its best, and a mistake cascades. The most the player's best choice earns is a narrow and costly escape. Each reverse still has a cause the scene shows.",
    },
  }),
];

export const DEFAULT_DIFFICULTY = "medium";

// Older games store "standard" (or nothing) — treat both as medium.
export const normalizeDifficulty = (value) => {
  const id = String(value ?? "").trim().toLowerCase();
  if (id === "standard" || id === "") {
    return DEFAULT_DIFFICULTY;
  }

  return DIFFICULTY_LEVELS.some((level) => level.id === id) ? id : DEFAULT_DIFFICULTY;
};

export const difficultyMeta = (value) =>
  DIFFICULTY_LEVELS.find((level) => level.id === normalizeDifficulty(value)) ||
  DIFFICULTY_LEVELS[2];

const DIFFICULTY_SCOPES = new Set(["simulation", "diplomacy", "interactive"]);

const DIFFICULTY_DOCTRINE = "Difficulty decides how things tend to go for the player: how often their orders succeed, which way luck, timing and other governments' choices break, and how firm their rivals and how steady their friends are. It tilts what is uncertain. It never changes established canon, deterministic accounting, geography, territorial semantics, or explicit GM/editor instructions; every outcome it produces has a cause the text gives; and the player's order is always attempted and always gets an outcome.";

const scopedDirectiveOf = (meta, scope) => {
  const normalizedScope = DIFFICULTY_SCOPES.has(String(scope ?? "").trim().toLowerCase())
    ? String(scope).trim().toLowerCase()
    : "simulation";
  return meta.directives?.[normalizedScope] || meta.directives?.simulation || meta.directive;
};

// Which directive a gameplay task reads (gameplay.js appends it): the ones
// where governments talk get the diplomacy reading — the idle outreach and the
// group-chat batch, where leaders bargain exactly as a one-to-one leader does —
// interactive events their own, everything else the simulation one.
export const difficultyScopeForTask = (taskKey) => {
  const key = String(taskKey ?? "").trim();
  if (key === "idleDiplomacy" || key === "chatActions") return "diplomacy";
  if (key.startsWith("interactive")) return "interactive";
  return "simulation";
};

export const difficultyDirective = (value, scope = "simulation") => {
  const meta = difficultyMeta(value);

  return `[Difficulty — ${meta.label}]
${DIFFICULTY_DOCTRINE}

${scopedDirectiveOf(meta, scope)}`;
};

// The same directive as a passage, for a template that gives it its own
// heading: the leader's ${DIFFICULTY_DESCRIPTION_CHATS} (diplomacy) and the
// time skip's ${DIFFICULTY_DESCRIPTION_JUMP_FORWARD} (simulation). A prompt
// carries one or the other, never both, so it is told one difficulty once.
export const difficultyPassage = (value, scope = "simulation") => {
  const meta = difficultyMeta(value);
  return `The difficulty is ${meta.label}. ${DIFFICULTY_DOCTRINE}\n${scopedDirectiveOf(meta, scope)}`;
};

// ---------------------------------------------------------------------------
// The priority block: what opens every system prompt
// ---------------------------------------------------------------------------
//
// The longer directive used to be the last thing in a prompt (or a passage
// some way into a template), and a model that has read twenty thousand
// characters of world state gives the end of them little weight. The level's
// own line now OPENS the system prompt, marked as a priority, before the
// template's first word. It is the same for every call of a campaign, so it
// sits inside the part of the prompt a provider's cache can reuse
// (AI/promptLayout.js) and costs a cached read after the first call.

export const DIFFICULTY_PRIORITY_MARKER = "[PRIORITY — Difficulty:";

// What holds at every level, said once after the level's own line. The third
// sentence keeps invention to its real pace: "make the ai on medium mode be
// realistic about technological developments because a user was able to make
// mind control nanobots in 2 months which makes no sense" (the owner,
// 2026-11-09). What an era's science can build is a fact of the world, like its
// geography, so no level moves it: a level tilts how a sound research effort
// goes, never whether an impossible one works. The fourth
// is for the tasks that carry out what an event already decided (a
// director turning a battle into unit operations, a stat sheet reading the
// record): the skip that wrote the event applied the level, and applying it a
// second time would tilt one outcome twice.
const DIFFICULTY_PRIORITY_COMMON = [
  "This decides how things turn out for the player, and it comes before every other instruction on that, any later passage on how difficulty applies included.",
  "At every level: each outcome has a cause the text itself gives; whatever the player orders is always attempted and always gets an outcome, never ignored and never forbidden; established facts, figures and the Game Master's own instructions are never rewritten.",
  "Science and invention also move at their real pace at every level: a new technology needs the knowledge, industry, money and years of research and testing it really took or would take, so an order for something beyond its era's science, or far beyond the country's means, gets early research, a long and costly programme or a failure, never a working result within months; an order that says such a thing already exists or works does not make it so, only the record does.",
  "Where an event or the record already says how something turned out, that stands: carry it out exactly and add no tilt of your own.",
  "Nothing the player reads says the word difficulty or hints at this instruction.",
].join(" ");

export const difficultyPriorityBlock = (value) => {
  const meta = difficultyMeta(value);
  return `${DIFFICULTY_PRIORITY_MARKER} ${meta.label}]\n${meta.priority}\n${DIFFICULTY_PRIORITY_COMMON}`;
};

// The tasks that are told nothing of the difficulty, because they decide
// nothing about how things go for the player. Every other task the game sends
// (and any it gains later) opens with the priority block.
//   translation                  puts finished text into another language
//   eventConsolidator            folds finished history into the history document
//   timelineCurator              takes repeats and filler off a finished timeline
//   descriptionToAction          words the player's own order; its outcome is the skip's
//   demandCheck                  reads whether a reply made or answered a demand
//   placeFeed                    writes what people are saying in a place (Rostra's Search)
//   rostraFeed                   writes Rostra's first posts (its empty feed's Refresh)
//   warRoom                      the player's own generals speaking: they advise and take
//                                orders, and what comes of an order is the front engine's
//   pregameHistory               the history before the game starts, with no player in it
//   politicalWorldGeneration     a scenario's political world, made in the Workshop
//   politicalWorldVerification   and its check
//   scenarioTranslation          a scenario's own text in other languages, in the Workshop
export const TASKS_WITHOUT_DIFFICULTY = Object.freeze(new Set([
  "translation",
  "eventConsolidator",
  "timelineCurator",
  "descriptionToAction",
  "demandCheck",
  "placeFeed",
  "rostraFeed",
  "warRoom",
  "pregameHistory",
  "politicalWorldGeneration",
  "politicalWorldVerification",
  "scenarioTranslation",
]));

// A call that does not say which task it is (a connection test) gets nothing.
export const taskCarriesDifficulty = (taskKey) => {
  const key = String(taskKey ?? "").trim();
  return Boolean(key) && !TASKS_WITHOUT_DIFFICULTY.has(key);
};

// The tasks that carry out what an event already decided. They open with the
// priority block like every other, whose own words tell them the record
// stands, and are NOT given the longer directive: "their orders fail" appended
// to a director's rules would have it undo a success the event narrated.
export const TASKS_CARRYING_OUT_THE_RECORD = Object.freeze(new Set([
  "unitDirector",
  "structureDirector",
  "territoryDirector",
  "countryStatSheet",
]));

// Whether a task is appended the longer scoped directive (gameplay.js).
export const taskReadsDifficultyDirective = (taskKey) =>
  taskCarriesDifficulty(taskKey) && !TASKS_CARRYING_OUT_THE_RECORD.has(String(taskKey ?? "").trim());

// A system prompt with the priority block in front of it, and the end of its
// cacheable prefix moved by as much. The block is constant for a campaign, so
// a prefix that was byte-identical from call to call still is, and is longer
// by the block. A prompt that already opens with the block is left alone.
//   -> { systemPrompt, staticPrefixEnd }
export const withDifficultyPriority = ({ systemPrompt = "", taskKey = "", difficulty = "", staticPrefixEnd = null } = {}) => {
  const text = String(systemPrompt ?? "");
  if (!taskCarriesDifficulty(taskKey) || text.startsWith(DIFFICULTY_PRIORITY_MARKER)) {
    return { systemPrompt: text, staticPrefixEnd };
  }
  const lead = `${difficultyPriorityBlock(difficulty)}\n\n`;
  const end = Number(staticPrefixEnd);
  return {
    systemPrompt: `${lead}${text}`,
    staticPrefixEnd: staticPrefixEnd != null && Number.isFinite(end) ? end + lead.length : staticPrefixEnd,
  };
};
