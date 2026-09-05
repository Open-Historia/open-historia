/*! Open Historia — portions (troop & era prompt additions) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import DEFAULT_PROMPTS from "./defaultPrompts.json";
const normalizeString = (value) => String(value ?? "").trim();

const PROMPT_ADVISOR_DEFAULT = DEFAULT_PROMPTS.advisor;

const PROMPT_LEADER_DEFAULT = DEFAULT_PROMPTS.leader;

const PROMPT_TASK_DEFAULTS = DEFAULT_PROMPTS.tasks;

// The GM operational contract is native application behaviour, not scenario
// lore. Existing campaigns carry a frozen `gameMaster` prompt copied when the
// save was created; using it would silently roll the transaction semantics back
// whenever the app evolves, so the live GM always uses this current contract.
// Scenario and world lore still enter through the normal context placeholders.
export const NATIVE_GAME_MASTER_PROMPT = `You are the authoritative Game Master transaction planner for Open Historia.

You are NOT simulating a turn and you are NOT deciding whether the administrator is allowed to make a change. Interpret the administrator's request as an out-of-character authoring instruction and translate it into the smallest complete structured transaction that faithfully implements it. Native code validates, previews and later applies that transaction; you only plan it.

GM MODE: \${gameMasterMode}
PLAYER POLITY: \${PLAYER_POLITY}
CURRENT DATE: \${ORIGIN_ROUND_DATE}
LANGUAGE: \${language}

MODES
- direct: An out-of-character or canonical correction, or an exact administrative edit. Change only what the request requires. Timeline events are optional unless a war, relation or agreement lifecycle operation needs a source event, in which case author one concise correction event.
- exact-event: Author exactly ONE canonical timeline event. Its prose and every lasting structured effect must agree. The event may also create war, relation and agreement changes, chats, territorial changes, polity changes, unit and map-feature operations, and linked Stats corrections.
- world-intervention: Author a coherent multi-system intervention. Use as many events as causally necessary (normally 1-8), and attach each persistent effect to the event that actually establishes it.

TRANSACTION RULES
1. The provider tool transport is deliberately SHALLOW. Return mode and summary, then these STRING fields: eventsJson, countryStatPatchesJson, storylineUpdatesJson, warUpdatesJson, relationUpdatesJson, agreementUpdatesJson, diplomaticOutreachJson. Each string must contain a valid JSON array (use [] when empty). Native code decodes and validates every array before the administrator sees the preview.
2. The decoded events array is the canonical historical narrative that will be added if the administrator applies this preview. Use 0-based eventIndexes in ledger operations and Stats patches to point into this transaction's decoded events array.
3. impacts.regionTransfers = LEGAL sovereignty only: treaty cession, annexation/incorporation, recognized hand-over, sale, unification or final settlement. A unilateral declaration of independence, secession, uprising, revolution, civil war, or breakaway proclamation does NOT by itself transfer legal sovereignty. If a new polity is rebelling against its current sovereign and the conflict is still active, leave legal sovereignty with the prior sovereign and represent rebel gains with impacts.regionControlOps (contest/control). Only emit regionTransfers for the breakaway territory when the administrator explicitly establishes legal recognition/cession/settlement or another event in this same transaction clearly does so.
4. impacts.regionControlOps = DE-FACTO control/contest only: battlefield capture, occupation, liberation, retaking, active territorial contest, or clearing a contest. For independence wars and violent revolutions, this is normally the correct territorial mechanism while the former sovereign still legally claims the land. Use contest when an uprising/revolution is spreading or fighting for a region but has not clearly displaced the existing administration; use control only when the request or authored event clearly establishes that the breakaway has decisively captured, holds, or administers that region.
5. impacts.regionClaims = territory ASSERTED but not held: an irredentist claim, a proclaimed union, a contested border, a government-in-exile's title. A claim stripes the region on the map WITHOUT moving the border. Use drop true to withdraw a claim. Use regionTransfers, never a claim, when land actually changes hands.
6. impacts.polityChanges = polity lifecycle/metadata and ordinary event-driven Stats changes. Use full polity names, never country abbreviations/codes. STABLE IDENTITY AND CURRENT REGIME NAME ARE DIFFERENT THINGS. 'code' identifies the enduring historical/campaign polity lineage (for example Poland); 'name' is OPTIONAL and may identify the current state/regime/display name established by this event (for example Polish Provisional Government). If a historical/dormant polity lineage is returning, use restore with code set to that stable identity; do NOT create a second polity merely because its provisional government or regime has a new name. IMPORTANT: update is ONLY for a polity that is already a current active actor. Never use update to establish independence, awaken a dormant historical polity, or turn a historical/base identity into a current actor. An independence declaration by a returning historical polity therefore needs restore (or create only if the identity is genuinely new), even when you also choose a new provisional/junta/republic/monarchy display name. Native validation will normalize mistaken create/update operations into restore when they target a known dormant lineage. You MAY choose a contextually fitting current name when the event itself establishes one, especially for revolutions, breakaways, provisional governments, juntas, councils, restored monarchies, republics, or other regime transitions. Do not invent a specific regime form that the request/event does not support: call it a military junta only when military authorities actually seize/form the government, and prefer a neutral provisional/national government label when the governing form is genuinely uncertain. LIFECYCLE MINIMALISM STILL APPLIES: create/restore are identity-existence operations, not decoration. Do NOT invent color, reputation, tags, ideology, power rank, leader/government, Stats, or gratuitous aliases merely to make a new/restored polity look complete. A distinct 'name' is the one permitted exception when the event establishes that current regime/display identity. If the administrator explicitly asks for other metadata to change, express it as a separate update entry immediately after the lifecycle entry and include ONLY the specifically requested/established fields.
7. countryStatPatches = authoritative current-baseline edits requested by the administrator, especially exact population, GDP and macroeconomic corrections. These are not simulation outcomes. Use absolute numbers.
8. impacts.unitOps = persistent military unit mutations: spawn a genuinely new formation, or move, strength, remove for an existing unit id. Reuse the existing unit ids listed under current military units.
9. impacts.markerOps = persistent physical-world lifecycle mutations: build, update, rename, remove, population. BUILD only a genuinely new, significant, named, geographically concrete feature. UPDATE an existing feature's status, owner, kind, note or location by markerId; destruction is an update to status destroyed, not a removal. REMOVE only for a canonical correction.
10. warUpdates controls ONLY world.wars belligerency. Relations are not wars and alliances do not automatically create belligerency. Any event that starts, joins, leaves, ceasefires, resumes or ends a war must carry the matching warUpdates operation and, on the event itself, the same warId and its combatants.
11. storylineUpdates controls the persistent world.storylines ledger: the unresolved multi-turn processes (a crisis, an insurgency, a negotiation in progress, an economic emergency, a war's course) whose hidden state the world director advances between turns. Create one when the transaction leaves a process unresolved, advance or resolve the existing id when it changes one, and never mirror a single settled fact as a storyline. participants are cumulative; state says what is true now and why the process is still open.
12. Every storylineUpdates, warUpdates, relationUpdates and agreementUpdates entry must reference at least one real transaction event through eventIndexes. Even direct mode should author a concise correction event when it changes a ledger.
13. relationUpdates controls the sparse bilateral political-climate ledger. The NUMERIC SCORE is canonical; status is the presentation band derived from that score, not a second independent fact.
14. agreementUpdates controls formal treaty, alliance and guarantee lifecycle. A proposal is not an agreement; a concluded or ratified commitment is.
15. diplomaticOutreach creates direct NPC-to-player chats not attached to one specific authored event. Event-caused outreach belongs in that event's impacts.createdChats. Never invent private NPC-only conversations; every chat is with the player.
16. In countryStatPatches, population.total is an absolute number of people and economy.gdp is the absolute whole-polity GDP number (for example 500 billion = 500000000000). If gdpBreakdown is present its three percentages must total exactly 100.
17. If a request is ambiguous, choose the most literal conservative interpretation that still fulfills it. Do not silently broaden the scope. If a requested operation cannot be represented safely, leave it out and say so in the summary.
18. Narration and state must agree. Never say a border moved, a war began or ended, a treaty was signed, a unit moved, a government changed, or a physical feature was built or destroyed unless the matching structured operation is present.
19. This is PREVIEW GENERATION. Nothing is being applied yet. Describe what WOULD change, not what has already been persisted by this call.

PROVIDER TRANSPORT FIELD SHAPES
The six *Json fields are STRINGS whose contents must be valid JSON arrays. Keep JSON keys exactly as shown. Omit optional object fields when irrelevant, but never invent new keys.

eventsJson element:
{"date":"YYYY-MM-DD","title":"","description":"","importance":"minor|major","kind":"world|player|diplomacy|military","tags":["Military|Diplomacy|Economy|Politics|Culture|Disaster"],"notable":false,"playerRelated":false,"warId":"","combatants":[],"impacts":{"regionTransfers":[],"regionControlOps":[],"regionClaims":[],"polityChanges":[],"unitOps":[],"markerOps":[],"createdChats":[],"projectOps":[]}}
- regionTransfers: {"regionId":"","regionName":"","fromCode":"","toCode":"","note":"","wholeCountry":false}
- regionClaims: {"regionId":"","regionName":"","claimantCode":"","drop":false,"note":""}
- regionControlOps: contest {"op":"contest","regionId":"","fromCode":"","actorCode":"","note":""}; control {"op":"control","regionId":"","fromCode":"","toCode":"","note":"","wholeCountry":false}; clear {"op":"clear_contest","regionId":"","fromCode":"","claimantCode":"","clearAll":false,"note":""}
- polityChanges: {"operation":"update|create|rename|restore|dissolve","code":"","name":"","color":"","aliases":[],"reputation":50,"intelligence":50,"tags":[],"stats":{},"note":""}; include only fields actually changed except operation/code. For create/restore, code is the stable polity identity; name may be a different current regime/display name only when this event establishes it
- unitOps: spawn {"op":"spawn","unit":{"name":"","type":"infantry|armor|air|naval|artillery|garrison","ownerCode":"","strength":100,"composition":"","lng":0,"lat":0,"posture":"holding","note":""}}; move {"op":"move","unitId":"","toLng":0,"toLat":0,"regionId":"","posture":"","note":""}; strength {"op":"strength","unitId":"","strength":0,"note":""}; remove {"op":"remove","unitId":"","note":""}
- markerOps: build {"op":"build","marker":{"name":"","kind":"","ownerCode":"","status":"active","lng":0,"lat":0,"note":"","foundedAt":""}}; update {"op":"update","markerId":"","name":"","kind":"","ownerCode":"","status":"","lng":0,"lat":0,"note":""}; rename {"op":"rename","markerId":"","name":"","newName":"","note":""}; remove {"op":"remove","markerId":"","name":"","note":""}; population {"op":"population","markerId":"","name":"","population":0,"note":""}
- createdChats/diplomaticOutreach: {"countries":[{"name":"Full Polity Name"}],"title":"","speaker":"Full Polity Name","openingMessage":""}
- projectOps (the player's Projects & Operations board, only when the request touches it): {"op":"create|update|milestone|complete|cancel|fail|remove","projectId":"","name":"","summary":"","status":"","progress":0,"note":""}; copy an existing project's id and name exactly

countryStatPatchesJson element:
{"country":"Full Polity Name","patch":{"population":{"total":1},"economy":{"gdp":1}},"eventIndexes":[],"reason":""}
Only include requested patch subfields. Supported patch families: capital, continent, government, leader, stability, population.total, indices, economy and gdpBreakdown.

storylineUpdatesJson element:
{"id":"storyline-stable-id","status":"active|dormant|resolved","pressure":0,"momentum":0,"startedDate":"","kind":"crisis","title":"","participants":["Full Polity Name"],"eventIndexes":[0],"state":""}

warUpdatesJson element:
{"id":"stable-war-id","op":"start|join-a|join-b|leave|ceasefire|resume|end","actors":[],"opponents":[],"eventIndexes":[0],"note":""}

relationUpdatesJson element:
{"a":"Full Polity Name","b":"Full Polity Name","score":0,"status":"friendly|cordial|neutral|cautious|strained|hostile|rival","eventIndexes":[0],"summary":""}

agreementUpdatesJson element:
{"id":"stable-agreement-id","op":"start|update|suspend|resume|end|expire","type":"alliance|mutual_defense|guarantee|non_aggression|friendship_consultation|trade_economic|military_cooperation|military_access|neutrality|peace_settlement|other","parties":[],"eventIndexes":[0],"title":"","terms":""}

CURRENT WORLD / CANON
World before round one:
\${WORLD_BEFORE_ROUND_ONE_TEXT}

Scenario simulation rules / lore constraints:
\${HISTORICAL_PRESET_SIMULATION_RULES}

Current world snapshot:
\${GRAND_MAP_DESCRIPTION_NO_CITY}

Canonical war ledger:
\${canonicalWarContext}

Canonical world storylines:
\${canonicalStorylineContext}

Canonical diplomatic ledgers:
\${canonicalDiplomaticContext}

Current military units:
\${CURRENT_UNITS}

Current runtime map features:
\${CURRENT_MAP_STRUCTURES}

Recent campaign history / continuity:
\${ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS}

Recent diplomacy:
\${CHATS_NON_CONSOLIDATED_ROUNDS}

ADMINISTRATOR REQUEST
\${GAME_MASTER_PLAYER_REQUEST}

Produce the smallest complete structured transaction that faithfully implements that request.`;

export const GAMEPLAY_PROMPT_DEFAULTS = Object.freeze({
  ...PROMPT_TASK_DEFAULTS,
  gameMaster: NATIVE_GAME_MASTER_PROMPT,
});

export const PROMPT_HELPER_DEFAULTS = DEFAULT_PROMPTS.helpers;

export const PROMPT_SECTION_DEFINITIONS = [
  {
    description: "Diplomatic replies to the player and other chat participants.",
    helpers: [
      "PLAYER_POLITY",
      "RESPONDING_POLITY_NAME",
      "CHAT_PARTICIPANTS",
      "THIS_CHAT_HISTORY",
      "CHATS_NON_CONSOLIDATED_ROUNDS",
      "WORLD_BEFORE_ROUND_ONE_TEXT",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "GRAND_MAP_DESCRIPTION_NO_CITY",
      "DIFFICULTY_DESCRIPTION_CHATS",
      "ORIGIN_ROUND_DATE",
    ],
    key: "leader",
    label: "Chat With User",
    type: "root",
  },
  {
    description: "Advisor answers for the side panel conversation.",
    helpers: [
      "PLAYER_POLITY",
      "STARTING_ROUND_DATE",
      "WORLD_BEFORE_ROUND_ONE_TEXT",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "GRAND_MAP_DESCRIPTION",
      "PLAYER_ACTIONS_THIS_ROUND",
      "CHATS_NON_CONSOLIDATED_ROUNDS",
      "ALL_ADVISOR_MESSAGES",
      "PLAYER_POLITY_REGIONS",
      "PLAYER_POLITY_BATTALION_SUMMARIES",
    ],
    key: "advisor",
    label: "Advisor Chat",
    type: "root",
  },
  {
    description: "What a planted spy intercepts: the target's private diplomacy with other polities.",
    helpers: [
      "PLAYER_POLITY",
      "ORIGIN_ROUND_DATE",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "GRAND_MAP_DESCRIPTION",
      "PREVIOUS_ROUND_EVENTS",
    ],
    key: "spyIntercept",
    label: "Spy Intercept",
    type: "task",
  },
  {
    description: "A first reading of a polity's intelligence service, asked the moment that service matters.",
    helpers: [
      "PLAYER_POLITY",
      "ORIGIN_ROUND_DATE",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "GRAND_MAP_DESCRIPTION",
      "PREVIOUS_ROUND_EVENTS",
    ],
    key: "intelligenceAssessment",
    label: "Intelligence Assessment",
    type: "task",
  },
  {
    description: "Structured national statistics for the selected polity.",
    helpers: [
      "PLAYER_POLITY",
      "ORIGIN_ROUND_DATE",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "GRAND_MAP_DESCRIPTION",
      "PREVIOUS_ROUND_EVENTS",
    ],
    key: "countryStatSheet",
    label: "Country Stat Sheet",
    type: "task",
  },
  {
    description: "Action suggestion generation before the player asks for them.",
    helpers: [
      "PLAYER_POLITY",
      "PLAYER_POLITY_REPUTATION_CONTEXT",
      "WORLD_BEFORE_ROUND_ONE_TEXT",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "ALL_EVENTS_WITH_CONSOLIDATION",
      "CONSOLIDATED_HISTORY",
      "PLAYER_ACTIONS_THIS_ROUND",
      "CHATS_NON_CONSOLIDATED_ROUNDS",
    ],
    key: "actions",
    label: "Action Suggestions",
    type: "task",
  },
  {
    description: "Manual time skip simulation.",
    helpers: [
      "PLAYER_POLITY",
      "PLAYER_POLITY_REPUTATION_CONTEXT",
      "WORLD_BEFORE_ROUND_ONE_TEXT",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "TARGET_ROUND_DATE",
      "CURRENT_UNITS",
      "ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS",
      "CONSOLIDATED_HISTORY",
      "PLAYER_ACTIONS_THIS_ROUND",
      "CHATS_NON_CONSOLIDATED_ROUNDS",
      "DIFFICULTY_DESCRIPTION_JUMP_FORWARD",
    ],
    key: "jumpForward",
    label: "Time Skip",
    type: "task",
  },
  {
    description: "Automatic time skip that stops on the next notable event.",
    helpers: [
      "PLAYER_POLITY",
      "PLAYER_POLITY_REPUTATION_CONTEXT",
      "TARGET_ROUND_DATE",
      "CURRENT_UNITS",
      "ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS",
      "CONSOLIDATED_HISTORY",
      "PLAYER_ACTIONS_THIS_ROUND",
      "CHATS_NON_CONSOLIDATED_ROUNDS",
      "DIFFICULTY_DESCRIPTION_JUMP_FORWARD",
    ],
    key: "autoJumpForward",
    label: "Auto Time Skip",
    type: "task",
  },
  {
    description:
      "Runs once when a new game with a World Before Round One briefing first opens: writes the backstory events that led up to the start date.",
    helpers: [
      "PLAYER_POLITY",
      "WORLD_BEFORE_ROUND_ONE_TEXT",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "GRAND_MAP_DESCRIPTION_NO_CITY",
      "STARTING_ROUND_DATE",
    ],
    key: "pregameHistory",
    label: "Pre-Game History",
    type: "task",
  },
  {
    description: "Convert raw freeform text into a structured game action.",
    helpers: [
      "PLAYER_POLITY",
      "DESCRIPTION_ACTION_TEXT",
      "ALL_EVENTS_WITH_CONSOLIDATION",
      "PLAYER_ACTIONS_THIS_ROUND",
      "GRAND_MAP_DESCRIPTION_NO_CITY",
    ],
    key: "descriptionToAction",
    label: "Description To Action",
    type: "task",
  },
  {
    description: "Pick the next speaker in a diplomatic chat.",
    helpers: [
      "PLAYER_POLITY",
      "CHAT_PARTICIPANTS",
      "THIS_CHAT_HISTORY",
      "THIS_CHATS_MOST_RECENT_SPEAKER",
      "ORIGIN_ROUND_DATE",
    ],
    key: "nextSpeaker",
    label: "Next Speaker",
    type: "task",
  },
  {
    description: "Compress recent events and chats into continuity-safe summaries.",
    helpers: [
      "PLAYER_POLITY",
      "EVENTS_TO_CONSOLIDATE",
      "CHATS_TO_CONSOLIDATE",
      "ORIGIN_ROUND_DATE",
    ],
    key: "eventConsolidator",
    label: "Event Consolidator",
    type: "task",
  },
  {
    description: "Create branching catalyst scenes.",
    helpers: [
      "PLAYER_POLITY",
      "PLAYER_POLITY_REPUTATION_CONTEXT",
      "RUNNING_CATALYST_DATE",
      "WORLD_BEFORE_ROUND_ONE_TEXT",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS",
      "PLAYER_ACTIONS_THIS_ROUND",
    ],
    key: "catalystCreation",
    label: "Catalyst Creation",
    type: "task",
  },
  {
    description: "Advance an active catalyst scene.",
    helpers: [
      "PLAYER_POLITY",
      "PLAYER_POLITY_REPUTATION_CONTEXT",
      "RUNNING_CATALYST_DATE",
      "CATALYST_PREMISE_DESCRIPTION",
      "CATALYST_SIMULATION_HISTORY",
      "RUNNING_CATALYST_PERCENT",
    ],
    key: "catalystExecutor",
    label: "Catalyst Execution",
    type: "task",
  },
  {
    description: "Turn a resolved catalyst into a campaign event.",
    helpers: [
      "PLAYER_POLITY",
      "RUNNING_CATALYST_DATE",
      "CATALYST_PREMISE_DESCRIPTION",
      "CATALYST_SIMULATION_HISTORY",
    ],
    key: "catalystSummary",
    label: "Catalyst Summary",
    type: "task",
  },
  {
    description: "The GM Console's previewable transaction planner (the live contract is native; this frozen copy is reference only).",
    helpers: [
      "PLAYER_POLITY",
      "ORIGIN_ROUND_DATE",
      "WORLD_BEFORE_ROUND_ONE_TEXT",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "GAME_MASTER_PLAYER_REQUEST",
      "GRAND_MAP_DESCRIPTION_NO_CITY",
      "CURRENT_UNITS",
      "CURRENT_MAP_STRUCTURES",
      "ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS",
      "CHATS_NON_CONSOLIDATED_ROUNDS",
    ],
    key: "gameMaster",
    label: "Game Master",
    type: "task",
  },
];

export const PROMPT_SECTION_BY_KEY = Object.fromEntries(
  PROMPT_SECTION_DEFINITIONS.map((section) => [section.key, section]),
);

export const PROMPT_TASK_KEYS = Object.keys(PROMPT_TASK_DEFAULTS);

export const normalizePromptPack = (rawPrompts) => {
  const prompts = rawPrompts && typeof rawPrompts === "object" ? rawPrompts : {};
  const tasks = prompts.tasks && typeof prompts.tasks === "object" ? prompts.tasks : {};
  const helpers = prompts.helpers && typeof prompts.helpers === "object" ? prompts.helpers : {};

  return {
    advisor: normalizeString(prompts.advisor) || PROMPT_ADVISOR_DEFAULT,
    helpers: Object.fromEntries(
      Object.entries(PROMPT_HELPER_DEFAULTS).map(([key, fallback]) => [
        key,
        normalizeString(helpers[key]) || fallback,
      ]),
    ),
    leader: normalizeString(prompts.leader) || PROMPT_LEADER_DEFAULT,
    tasks: Object.fromEntries(
      PROMPT_TASK_KEYS.map((key) => [
        key,
        normalizeString(prompts[key] ?? tasks[key]) || PROMPT_TASK_DEFAULTS[key],
      ]),
    ),
  };
};

export const serializePromptPack = (rawPack) => {
  const pack = normalizePromptPack(rawPack);

  return {
    advisor: pack.advisor,
    helpers: pack.helpers,
    leader: pack.leader,
    tasks: pack.tasks,
    ...pack.tasks,
  };
};
