/*! Open Historia — portions (troop & era prompt additions) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import DEFAULT_PROMPTS from "./defaultPrompts.json";
import { POLITICAL_TRAIT_KEYS } from "../../runtime/politicalTraitRegistry.js";
import { POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE } from "../../runtime/politicalActorOps.js";
import {
  localizeGuidanceTree,
  localizedPassages,
  promptTranslationsVersion,
  withoutLocalizedDefaults,
} from "../../runtime/promptTranslations.js";
import {
  PROMPT_MODEL_VERSION,
  buildGuidanceDefaults,
  composePrompt,
  guidanceCharLimit,
  guidanceSegmentsFor,
  hasGuidance,
  materializePackGuidance,
  normalizePackGuidance,
  overLimitPackGuidance,
  promptCharCount,
} from "./promptGuidance.js";

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

MODES
- auto: This is the player's routing preference, not a transaction mode. Select exactly one of direct, exact-event or world-intervention for the returned mode. Choose direct only for a clearly specified administrative correction to existing canon (e.g. explicitly setting a baseline or leader), never to simulate a crisis, war or downstream consequences. Choose exact-event for one finished occurrence, and world-intervention for an ongoing process or linked multi-system change. Supply one short modeReason explaining your choice. When uncertain whether an instruction is Direct or a narrative intervention, prefer the narrative mode. An Auto choice of exact-event or world-intervention must leave countryStatPatchesJson empty; simulated economic consequences belong in dated event impacts, never in an unrequested absolute baseline rewrite. Auto never relaxes any native guard or validator.
- direct: An out-of-character or canonical correction, or an exact administrative edit. Change only what the request requires. Timeline events are optional unless a war, relation or agreement lifecycle operation needs a source event, in which case author one concise correction event.
- exact-event: Author exactly ONE canonical timeline event. Its prose and every lasting structured effect must agree. The event may also create war, relation and agreement changes, chats, territorial changes, polity changes, unit and map-feature operations, and linked Stats corrections.
- world-intervention: Author a coherent multi-system intervention. Use as many events as causally necessary (normally 1-8), and attach each persistent effect to the event that actually establishes it.

TRANSACTION RULES
1. The provider tool transport is deliberately SHALLOW. Return the concrete mode (never auto), modeReason (one short sentence explaining your choice), and summary, then these STRING fields: eventsJson, territorialScopesJson, countryStatPatchesJson, storylineUpdatesJson, warUpdatesJson, relationUpdatesJson, agreementUpdatesJson, puppetUpdatesJson, diplomaticOutreachJson. Each string must contain a valid JSON array (use [] when empty). Native code decodes and validates every array before the administrator sees the preview. Then say what the administrator's request itself asks for, in whatever language it is written: requestedSubordination (true when it asks for one country to become another's puppet, satellite, protectorate or client; false when it asks to end or prevent one), requestedDate (the one exact date it names for the event as YYYY-MM-DD, a negative year for BC; empty when it names none or several) and requestedOngoingProcess (true when it describes an unresolved or changing multi-turn process). Native code holds your transaction to these.
2. The decoded events array is the canonical historical narrative that will be added if the administrator applies this preview. Use 0-based eventIndexes in ledger operations and Stats patches to point into this transaction's decoded events array.
2A. EXHAUSTIVE TERRITORY IS A SET CONTRACT ONLY WHEN TERRITORY ACTUALLY CHANGES. If the administrator asks to transfer/control/contest all/every/entire/whole territories, regions, states, provinces or lands, do NOT enumerate a representative handful of provinces in eventsJson. Put the semantic footprint in territorialScopesJson. A preservation statement is NOT a territorial change: phrases such as "keeps all of its territory", "retains its existing territory", or "all of its territory remains unchanged" require NO territorialScopes entry and NO region operation. baseCountries are the exact immutable rendered base geographies listed below, not the polity that currently owns them. Example: a request for all Baltic-state territory can name the three rendered base geographies for Estonia, Latvia and Lithuania once; native code then expands EVERY rendered region in those footprints into exact operations before Preview. Use kind=legal-transfer for legal sovereignty, kind=control for decisive de-facto control, and kind=contest for an active territorial contest. The event at eventIndex must narrate the same change. Avoid duplicating that scope with a partial manual region list.
3. impacts.regionTransfers = LEGAL sovereignty only: treaty cession, annexation/incorporation, recognized hand-over, sale, unification or final settlement. A unilateral declaration of independence, secession, uprising, revolution, civil war, or breakaway proclamation does NOT by itself transfer legal sovereignty. If a new polity is rebelling against its current sovereign and the conflict is still active, leave legal sovereignty with the prior sovereign and represent rebel gains with impacts.regionControlOps (contest/control). Only emit regionTransfers for the breakaway territory when the administrator explicitly establishes legal recognition/cession/settlement or another event in this same transaction clearly does so.
4. impacts.regionControlOps = DE-FACTO control/contest only: battlefield capture, occupation, liberation, retaking, active territorial contest, or clearing a contest. For independence wars and violent revolutions, this is normally the correct territorial mechanism while the former sovereign still legally claims the land. Use contest when an uprising/revolution is spreading or fighting for a region but has not clearly displaced the existing administration; use control only when the request or authored event clearly establishes that the breakaway has decisively captured, holds, or administers that region.
5. impacts.regionClaims = territory ASSERTED but not held: an irredentist claim, a proclaimed union, a contested border, a government-in-exile's title. A claim stripes the region on the map WITHOUT moving the border. Use drop true to withdraw a claim. Use regionTransfers, never a claim, when land actually changes hands.
5A. impacts.groupOps = groups: actors that are not countries (a terrorist organisation, a cartel, a militia, a zombie outbreak, a cult) and the areas they control. A group owns no land; its area is drawn over the countries' map and the regions stay theirs. create founds one with a description (what it is) and optionally its regions; update changes description, colour or name (newName); take adds regions to its area; release gives them back (all when regionIds is empty); dissolve erases the group and its area. A group taking a region is never a regionTransfer. Copy group names exactly from [Groups].
6. impacts.polityChanges = polity lifecycle/metadata and ordinary event-driven Stats changes. Use full polity names, never country abbreviations/codes. STABLE IDENTITY AND CURRENT REGIME NAME ARE DIFFERENT THINGS. 'code' identifies the enduring historical/campaign polity lineage (for example Poland); 'name' is OPTIONAL and may identify the current state/regime/display name established by this event (for example Polish Provisional Government). If a historical/dormant polity lineage is returning, use restore with code set to that stable identity; do NOT create a second polity merely because its provisional government or regime has a new name. IMPORTANT: update is ONLY for a polity that is already a current active actor. Never use update to establish independence, awaken a dormant historical polity, or turn a historical/base identity into a current actor. An independence declaration by a returning historical polity therefore needs restore (or create only if the identity is genuinely new), even when you also choose a new provisional/junta/republic/monarchy display name. Native validation will normalize mistaken create/update operations into restore when they target a known dormant lineage. You MAY choose a contextually fitting current name when the event itself establishes one, especially for revolutions, breakaways, provisional governments, juntas, councils, restored monarchies, republics, or other regime transitions. Do not invent a specific regime form that the request/event does not support: call it a military junta only when military authorities actually seize/form the government, and prefer a neutral provisional/national government label when the governing form is genuinely uncertain. LIFECYCLE MINIMALISM STILL APPLIES: create/restore are identity-existence operations, not decoration. Do NOT invent color, reputation, tags, ideology, power rank, leader/government, Stats, or gratuitous aliases merely to make a new/restored polity look complete. A distinct 'name' is the one permitted exception when the event establishes that current regime/display identity. If the administrator explicitly asks for other metadata to change, express it as a separate update entry immediately after the lifecycle entry and include ONLY the specifically requested/established fields. A regionTransfers, regionControlOps control or contest entry naming a polity that does not exist founds it under exactly that name (native code adds the create); a create entry is then only needed for its colour, aliases or note. The polity that loses a region must already exist.
7. impacts.politicalActorOps = canonical political-state mutations. Political Actors own government/leader/party/power-bloc/strategy/traits/perceptions truth; do NOT write leader or government through polityChanges.stats or countryStatPatches. Each entry is {"op":"...","polityKey":"Full Polity Name","argsJson":"{...}"}; argsJson is a JSON STRING containing the native operation arguments. Never guess the decoded argsJson shape.
${POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE}
Never emit native-only set-political-pressures or set-behavioral-disposition. If the same event renames a polity, address politicalActorOps to the NEW name because rename is applied first. STRUCTURAL COMPLETENESS: when a constitution, election result, government formation, coalition, coup or succession establishes durable politics, write all political facts that event and surrounding campaign canon actually establish. A foundational election result for a sparse/emergent polity must not leave it as an unspecified shell: establish the political system, represented parties/power actors and their support/influence, governing force/coalition/leadership, and strategic goals/fears/ambitions; include decision-maker traits when the political settlement supports them. For set-traits, use only canonical keys: ${POLITICAL_TRAIT_KEYS.join(", ")}. Do not fabricate unsupported detail merely to fill fields; if final results are not known yet, narrate polling/counting rather than a completed result.
8. countryStatPatches = authoritative current-baseline edits requested by the administrator. These are not simulation outcomes. Use absolute numbers. On the standard National Stats sheet this includes exact population, GDP and macroeconomic corrections. In standard or custom scenarios, explicitly requested live capabilities use patch.intelligence (0..100 integer), patch.military (quality, technology, spending, manpowerShare, land, sea, air), patch.warWeariness or patch.warResources. These are canonical espionage/combat owners, not scenario-custom Stats. Military Power is calculated, never patched directly. If a [Scenario National Stats Sheet — LIVE] block is present later in this prompt, it OVERRIDES the standard Stats families: write numeric Stats only as patch.customStats using the exact live machine keys listed there.
9. impacts.unitOps = persistent military unit mutations: spawn a genuinely new formation, or move, strength, remove for an existing unit, named in unitId exactly as current military units lists it. Reuse the existing units listed there.
10. impacts.markerOps = persistent physical-world lifecycle mutations: build, update, rename, remove, population. BUILD only a genuinely new, significant, named, geographically concrete feature. UPDATE an existing feature's status, owner, kind, note or location by its name; destruction is an update to status destroyed, not a removal. RENAME a city, capital, structure or region whenever an action or event decrees a name change: {"op":"rename","name":"<current name or region: name>","newName":"<new name>"}. REMOVE only for a canonical correction.
11. warUpdates controls ONLY world.wars belligerency. Relations are not wars. A defensive alliance binds once a turn is played (the game then enters a defender's allies in its war itself); in this console nothing is entered for you, so write every join you mean. Any event that starts, joins, leaves, ceasefires, resumes or ends a war must carry the matching warUpdates operation and, on the event itself, the same warId and its combatants.
12. storylineUpdates controls the persistent world.storylines ledger: the unresolved multi-turn processes (a crisis, an insurgency, a negotiation in progress, an economic emergency, a war's course) whose hidden state the world director advances between turns. Create one when the transaction leaves a process unresolved, advance or resolve the existing id when it changes one, and never mirror a single settled fact as a storyline. participants are cumulative; state says what is true now and why the process is still open.
13. Every storylineUpdates, warUpdates, relationUpdates, agreementUpdates and puppetUpdates entry must reference at least one real transaction event through eventIndexes. Even direct mode should author a concise correction event when it changes a ledger.
14. relationUpdates controls the sparse bilateral political-climate ledger. The NUMERIC SCORE is canonical; status is the presentation band derived from that score, not a second independent fact.
15. agreementUpdates controls formal treaty, alliance and guarantee lifecycle. A proposal is not an agreement; a concluded or ratified commitment is.
16. puppetUpdates controls canonical subordination lifecycle: installing, reclassifying, changing loyalty/secrecy, releasing, annexing, revolting or suppressing a puppet/protectorate/client. A narrated puppet relationship without the matching puppetUpdates operation does not exist in canonical state.
17. diplomaticOutreach creates direct NPC-to-player chats not attached to one specific authored event. Event-caused outreach belongs in that event's impacts.createdChats. Never invent private NPC-only conversations; every chat is with the player.
18. On the standard National Stats sheet, population.total is an absolute number of people and economy.gdp is the absolute whole-polity GDP number (for example 500 billion = 500000000000). If gdpBreakdown is present its three percentages must total exactly 100. On a custom National Stats sheet, do not emit those standard numeric families at all; use patch.customStats with the exact live machine keys and ranges instead.
19. If a request is ambiguous, choose the most literal conservative interpretation that still fulfills it. Do not silently broaden the scope. If a requested operation cannot be represented safely, leave it out and say so in the summary.
20. Narration and state must agree. Never say a border moved, a war began or ended, a treaty was signed, a unit moved, a government changed, a puppet relationship changed, or a physical feature was built or destroyed unless the matching structured operation is present.
21. This is PREVIEW GENERATION. Nothing is being applied yet. Describe what WOULD change, not what has already been persisted by this call.

PROVIDER TRANSPORT FIELD SHAPES
The *Json fields are STRINGS whose contents must be valid JSON arrays. Keep JSON keys exactly as shown. Omit optional object fields when irrelevant, but never invent new keys. Dates are YYYY-MM-DD; a year before AD 1 is written with a leading minus and counts backwards with no year zero (-0218-03-01 is 1 March 218 BC, -0001-12-31 the last day of 1 BC), and every date you output in such a scenario uses exactly that form.

eventsJson element:
{"date":"YYYY-MM-DD","title":"","description":"","importance":"minor|major","kind":"world|player|diplomacy|military","tags":["Military|Diplomacy|Economy|Politics|Culture|Disaster"],"notable":false,"playerRelated":false,"warId":"","combatants":[],"impacts":{"regionTransfers":[],"regionControlOps":[],"regionClaims":[],"polityChanges":[],"politicalActorOps":[],"unitOps":[],"markerOps":[],"createdChats":[],"projectOps":[]}}
- regionTransfers: {"regionId":"region: <name>","fromCode":"","toCode":"","note":""}; regionId is the region's NAME as the map spells it, never an id. For ALL of a polity's land write regionId "country: <that polity's full current name>" with the same name in fromCode (never one province/colony)
- regionClaims: {"regionId":"region: <name>","claimantCode":"","drop":false,"note":""}
- groupOps: {"op":"create|update|dissolve|take|release","name":"","newName":"","description":"","color":"#RRGGBB","regionIds":["region: <name>"],"note":""}; regionIds are region NAMES as the map spells them, never ids
- regionControlOps: contest {"op":"contest","regionId":"region: <name>","fromCode":"","actorCode":"","note":""}; control {"op":"control","regionId":"region: <name>","fromCode":"","toCode":"","note":""}; for ALL the land a polity controls write regionId "country: <the losing/current controller's full current name>" with the same name in fromCode; clear {"op":"clear_contest","regionId":"region: <name>","fromCode":"","claimantCode":"","clearAll":false,"note":""}
- polityChanges: {"operation":"update|create|rename|restore|dissolve","code":"","name":"","color":"","aliases":[],"reputation":50,"intelligence":50,"tags":[],"stats":{},"note":""}; include only fields actually changed except operation/code. For create/restore, code is the stable polity identity; name may be a different current regime/display name only when this event establishes it
- politicalActorOps: {"op":"replace-leader|set-government|set-political-system|create-party|update-party|set-party-support|set-party-influence|set-party-leader|create-power-bloc|update-power-bloc|set-power-bloc-influence|form-coalition|leave-coalition|set-strategy|set-traits|set-perceptions|remove-perception","polityKey":"Full Polity Name","argsJson":"{...}"}; operation-specific args live inside the JSON string and are validated natively. Use the exact decoded argsJson shapes in rule 7; never improvise wrappers. set-traits keys are limited to: ${POLITICAL_TRAIT_KEYS.join(", ")}
- unitOps: spawn {"op":"spawn","unit":{"name":"","type":"infantry|armor|air|naval|artillery|garrison","ownerCode":"","strength":100,"composition":"","at":"<where, in words, each name with its kind and its country: region: Montana, country: United States / near city: Kharkiv, country: Ukraine / off city: Sevastopol, country: Ukraine>","posture":"holding","note":""}}; move {"op":"move","unitId":"<the unit's name>","at":"<where, in words, with kinds and the country>","posture":"","note":""}; strength {"op":"strength","unitId":"<the unit's name>","strength":50,"note":""} (0 destroys it), or for a refit {"op":"strength","unitId":"<the unit's name>","composition":"<its new make-up>","note":""}; remove {"op":"remove","unitId":"<the unit's name>","note":""}. Say WHERE with at (see [Placing Things]); lng/lat only for a spot no name describes.
- markerOps: build {"op":"build","marker":{"name":"","kind":"","ownerCode":"","status":"active","at":"<where, in words, with kinds and the country: region: Montana, country: United States>","note":"","foundedAt":""}}; update {"op":"update","name":"<its name as the list spells it>","kind":"","ownerCode":"","status":"","note":""}; rename {"op":"rename","name":"<current name or region: name>","newName":"","note":""}; remove {"op":"remove","name":"","note":""}; population {"op":"population","name":"","population":0,"note":""}
- createdChats/diplomaticOutreach: {"countries":["Full Polity Name"],"title":"","speaker":"Full Polity Name","openingMessage":""}; speaker is one of countries, spelled as there, and openingMessage is its words; an alliance, bloc or organisation writes through one of its member governments, never through the country it addresses
- projectOps (the player's Projects & Operations board, only when the request touches it): {"op":"create|update|milestone|complete|cancel|fail|remove","projectId":"","name":"","summary":"","status":"","progress":0,"note":""}; copy an existing project's id and name exactly

territorialScopesJson element:
{"kind":"legal-transfer|control|contest","baseCountries":["Exact Rendered Base Geography"],"toCode":"Full Polity Name","eventIndex":0,"note":""}
Use this only for exhaustive geographic-set CHANGES. The names in baseCountries must come exactly from the rendered base-geography catalog below; native code expands the full set. Preservation/no-change statements such as "keeps all of its territory" are not territorialScopes. Use [] when the request is not an exhaustive territorial-set change.

countryStatPatchesJson element:
Standard National Stats sheet:
{"country":"Full Polity Name","patch":{"population":{"total":1},"economy":{"gdp":1}},"eventIndexes":[],"reason":""}
Scenario-defined National Stats sheet, when a [Scenario National Stats Sheet — LIVE] block is present:
{"country":"Full Polity Name","patch":{"customStats":{"<exact live machine key>":1}},"eventIndexes":[],"reason":""}
Only include requested patch subfields. Either sheet may include "intelligence":82, "military":{"quality":75,"technology":90,"spending":80,"manpowerShare":2,"land":65,"sea":85,"air":80}, "warWeariness":0 or "warResources":100. Capability scores run 0..100; manpowerShare is a percent from 0.1..100. Use the live war ledger values for weariness/resources. These are Direct administrative corrections only. On the standard sheet the supported patch families are capital, continent, government, leader, stability, population.total, indices, economy and gdpBreakdown. On a custom sheet, numeric Stats MUST use customStats with the exact live machine keys; never invent a field inside economy or another standard family for a custom stat.

storylineUpdatesJson element:
{"id":"storyline-stable-id","status":"active|dormant|resolved","pressure":0,"momentum":0,"startedDate":"","kind":"crisis","title":"","participants":["Full Polity Name"],"eventIndexes":[0],"state":""}

warUpdatesJson element:
{"id":"stable-war-id","op":"start|join-a|join-b|leave|ceasefire|resume|end","actors":[],"opponents":[],"eventIndexes":[0],"note":""}

relationUpdatesJson element:
{"a":"Full Polity Name","b":"Full Polity Name","score":0,"status":"friendly|cordial|neutral|cautious|strained|hostile|rival","eventIndexes":[0],"summary":""}

agreementUpdatesJson element:
{"id":"stable-agreement-id","op":"start|update|suspend|resume|end|expire","type":"alliance|mutual_defense|guarantee|non_aggression|friendship_consultation|trade_economic|military_cooperation|military_access|neutrality|peace_settlement|other","parties":[],"eventIndexes":[0],"title":"","terms":""}

puppetUpdatesJson element — a SUBORDINATION: one polity directing another's will while it remains a separate country holding its own territory and sovereignty:
{"op":"install|reclassify|loyalty|reveal|release|annex|revolt|suppress","overlord":"Full Polity Name","puppet":"Full Polity Name","kind":"protectorate|satellite|client","loyalty":50,"secrecy":"open|covert","eventIndexes":[0],"note":""}
- install makes the puppet state; kind says which powers the overlord holds — the player sees these as PROTECTORATE, PUPPET STATE and CLIENT STATE (protectorate: it runs the puppet's foreign policy and defence, the puppet governs itself at home; satellite: the player's "puppet state" — it controls the puppet's government behind an independent front; client: the puppet's government depends on its backing and follows its lead but makes most of its own decisions). Use the kind the administrator names; "puppet", "puppet state" or "satellite" all mean kind satellite; secrecy is open if the world knows, covert if only the two parties do; loyalty 0-100 is how far the puppet accepts it. reclassify changes kind, loyalty moves the score, reveal makes a covert one open for good, release/annex/revolt end it, suppress puts down a rising. Every field is required; for an op that does not use one, repeat the arrangement's current value.
- A country has at most one overlord, cannot direct its own overlord, and a puppet holds no puppets of its own. Tie each change to the event that brings it about with eventIndexes.
- When the administrator asks for a country to become someone's puppet, satellite, protectorate or client, the puppetUpdatesJson install IS the change. An event that only narrates it leaves the world exactly as it was: no puppet on the map, none in the country's panel, and nothing that can later be demanded of it, refused or ended. Write the event AND the install.

CURRENT WORLD / CANON
World before round one:
\${WORLD_BEFORE_ROUND_ONE_TEXT}

Scenario simulation rules / lore constraints:
\${HISTORICAL_PRESET_SIMULATION_RULES}

GM MODE: \${gameMasterMode}
PLAYER POLITY: \${PLAYER_POLITY}
CURRENT DATE: \${ORIGIN_ROUND_DATE}
LANGUAGE: \${language}

Current world snapshot:
\${GRAND_MAP_DESCRIPTION_NO_CITY}

Canonical war ledger:
\${canonicalWarContext}

Canonical world storylines:
\${canonicalStorylineContext}

Canonical Political Actor entity references relevant to this request (exact ids; reuse existing ids instead of inventing replacements):
\${gameMasterPoliticalActorContext}

Canonical diplomatic ledgers:
\${canonicalDiplomaticContext}

Current military units:
\${CURRENT_UNITS}

Current runtime map features:
\${CURRENT_MAP_STRUCTURES}

Rendered base-geography catalog (exact names/counts for territorialScopesJson):
\${gameMasterBaseGeographyCatalog}

Recent campaign history / continuity:
\${ALL_EVENTS_WITH_CONSOLIDATION}

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
    key: "leader",
    label: "Chat With User",
    type: "root",
  },
  {
    description: "Advisor answers for the side panel conversation.",
    key: "advisor",
    label: "Advisor Chat",
    type: "root",
  },
  {
    description: "What a planted spy intercepts: the target's private diplomacy with other polities.",
    key: "spyIntercept",
    label: "Spy Intercept",
    type: "task",
  },
  {
    description: "A first reading of a polity's intelligence service, asked the moment that service matters.",
    key: "intelligenceAssessment",
    label: "Intelligence Assessment",
    type: "task",
  },
  {
    description: "A polity's government and its main parties or factions, for the Politics tab.",
    helpers: [
      "PLAYER_POLITY",
      "ORIGIN_ROUND_DATE",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "GRAND_MAP_DESCRIPTION",
      "PREVIOUS_ROUND_EVENTS",
    ],
    key: "politicalLandscape",
    label: "Political Landscape",
    type: "task",
  },
  {
    description: "How far the player's standing goal has come, for the Actions panel.",
    helpers: [
      "PLAYER_POLITY",
      "ORIGIN_ROUND_DATE",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "GRAND_MAP_DESCRIPTION",
      "PREVIOUS_ROUND_EVENTS",
    ],
    key: "goalProgress",
    label: "Goal Progress",
    type: "task",
  },
  {
    description: "Structured national statistics for the selected polity.",
    key: "countryStatSheet",
    label: "Country Stat Sheet",
    type: "task",
  },
  {
    description: "Action suggestion generation before the player asks for them.",
    key: "actions",
    label: "Action Suggestions",
    type: "task",
  },
  {
    description: "Manual time skip simulation.",
    key: "jumpForward",
    label: "Time Skip",
    type: "task",
  },
  {
    description: "Automatic time skip that stops on the next notable event.",
    key: "autoJumpForward",
    label: "Auto Time Skip",
    type: "task",
  },
  {
    description:
      "Writes a scenario's pre-game history when its designer clicks Generate in the Workshop's Pre-history tab: the backstory events that led up to the start date. A scenario made before scenarios kept one still runs it once, when a new game first opens.",
    key: "pregameHistory",
    label: "Pre-Game History",
    type: "task",
  },
  {
    description: "Convert raw freeform text into a structured game action.",
    key: "descriptionToAction",
    label: "Description To Action",
    type: "task",
  },
  {
    description: "Compress recent events and chats into continuity-safe summaries.",
    key: "eventConsolidator",
    label: "Event Consolidator",
    type: "task",
  },
  {
    description: "Open the scene of an interactive event the player took up.",
    key: "interactiveCreation",
    label: "Interactive Event Creation",
    type: "task",
  },
  {
    description: "Play one move of an interactive event.",
    key: "interactiveExecutor",
    label: "Interactive Event Execution",
    type: "task",
  },
  {
    description: "Turn a finished interactive event into a campaign event.",
    key: "interactiveSummary",
    label: "Interactive Event Summary",
    type: "task",
  },
  {
    description: "The GM Console's previewable transaction planner (the live contract is native; this frozen copy is reference only).",
    key: "gameMaster",
    label: "Game Master",
    type: "task",
  },
  {
    description: "An unprompted note between turns: while the game sits open, whether some polity has a live reason to write to the player, and the small movement of forces that rides on the same call. How often it is asked is the Features tab's idle diplomacy setting.",
    key: "idleDiplomacy",
    label: "Idle Diplomacy",
    type: "task",
  },
  {
    description: "The first posts on Rostra, the social network: what the people who make the news write when the player presses Refresh on an empty feed.",
    key: "rostraFeed",
    label: "Rostra Refresh",
    type: "task",
  },
  {
    description: "What ordinary people in a place are posting: the feed Rostra's Search tab opens on a country or a region. It is there while the game has social media (the Features tab's Social media switch).",
    key: "placeFeed",
    label: "Rostra Search",
    type: "task",
  },
  {
    description: "The generals in the war room: how they answer the player over a battlefield, when they push back, and how an order they accept is written down. The war room opens from the red button that appears while the player's troops are on a battlefield.",
    key: "warRoom",
    label: "War Room",
    type: "task",
  },
];

export const PROMPT_TASK_KEYS = Object.keys(PROMPT_TASK_DEFAULTS);

// The sections the Prompts tab shows: only the prompts with editable guidance.
// The rest (the curator, the directors, the resolver, the stat sheet, the spy
// desks and the board) are technical from end to end.
export const PROMPT_EDITOR_SECTIONS = PROMPT_SECTION_DEFINITIONS.filter((section) => hasGuidance(section.key));

// A stored prompt pack is { promptModel: 2, guidance }: nothing but the
// author's edits to the guidance passages, keyed by section and segment (see
// promptGuidance.js). The technical text is never stored — every scenario and
// game composes its prompts from the current defaults when it loads, so a
// change to the defaults (a new feature, a new rule, a new placeholder)
// reaches all of them. A pack in the old shape, whole prompt strings that
// froze the technical text at the time of the save, is ignored: the defaults
// are used.
export const PROMPT_GUIDANCE_DEFAULTS = Object.freeze(buildGuidanceDefaults(DEFAULT_PROMPTS));

// The same defaults in the player's language: every passage the language pack
// translates (runtime/promptTranslations.js), the English one where it has
// none. English, or before the pack has loaded, this is the English tree.
let localizedDefaults = { version: -1, tree: PROMPT_GUIDANCE_DEFAULTS };
export const localizedGuidanceDefaults = () => {
  const version = promptTranslationsVersion();
  if (localizedDefaults.version !== version) {
    localizedDefaults = { version, tree: localizeGuidanceTree(PROMPT_GUIDANCE_DEFAULTS) };
  }
  return localizedDefaults.tree;
};

// An edit identical to the default in the player's language is no edit
// (withoutLocalizedDefaults), as one identical to the English default is not.
// A pack may bypass the length limit (bypassLengthLimit: true, the Prompts
// tab's "Bypass prompt length limit" switch): its passages are kept and run
// whatever their length, and a new game started from it warns the player first.
export const promptPackBypassesLimit = (rawPack) =>
  Boolean(rawPack && typeof rawPack === "object" && rawPack.bypassLengthLimit === true);
const bypassField = (rawPack) => (promptPackBypassesLimit(rawPack) ? { bypassLengthLimit: true } : {});

export const normalizePromptGuidance = (rawPack) => {
  const guidance = normalizePackGuidance(rawPack, PROMPT_GUIDANCE_DEFAULTS, { bypassLimit: promptPackBypassesLimit(rawPack) });
  const localized = localizedGuidanceDefaults();
  return localized === PROMPT_GUIDANCE_DEFAULTS ? guidance : withoutLocalizedDefaults(guidance, localized);
};

// The runtime pack: the composed prompts the game renders, plus the guidance
// they were composed from (what the Prompts tab edits). The helpers are always
// the defaults; they are the technical placeholder map. Each passage the
// author left alone is the default in the player's language; each one they
// wrote is theirs, whatever language they wrote it in.
//
// `overLimit` lists the passages left out because they are longer than their
// limit (overLimitPromptPassages): the game runs the default in their place
// and tells the player once (runtime/promptLimitNotice.js).
export const normalizePromptPack = (rawPrompts) => {
  const guidance = normalizePromptGuidance(rawPrompts);
  const localized = localizedGuidanceDefaults();
  const passages = (defaults, edits) => (localized === PROMPT_GUIDANCE_DEFAULTS ? edits : localizedPassages(defaults, edits));
  const bypassLimit = promptPackBypassesLimit(rawPrompts);
  const compose = (key, text, edits) => composePrompt(key, text, edits, { bypassLimit });
  return {
    promptModel: PROMPT_MODEL_VERSION,
    ...bypassField(rawPrompts),
    guidance,
    overLimit: overLimitPromptPassages(rawPrompts),
    advisor: compose("advisor", PROMPT_ADVISOR_DEFAULT, passages(localized.advisor, guidance.advisor)),
    helpers: { ...PROMPT_HELPER_DEFAULTS },
    leader: compose("leader", PROMPT_LEADER_DEFAULT, passages(localized.leader, guidance.leader)),
    tasks: Object.fromEntries(
      PROMPT_TASK_KEYS.map((key) => [key, compose(key, PROMPT_TASK_DEFAULTS[key], passages(localized.tasks?.[key], guidance.tasks[key]))]),
    ),
  };
};

// ---------------------------------------------------------------------------
// The length limit (promptGuidance.js guidanceCharLimit): every edited passage
// may be at most 20% longer than the longest built-in version of it.

const sectionDefaults = (tree, sectionKey) =>
  (sectionKey === "advisor" || sectionKey === "leader" ? tree?.[sectionKey] : tree?.tasks?.[sectionKey]) ?? {};

// The most characters a passage may have, by section and segment id.
export const guidanceLimitFor = (sectionKey, segmentId) =>
  guidanceCharLimit(sectionDefaults(PROMPT_GUIDANCE_DEFAULTS, sectionKey)[segmentId]);

const sectionLabelOf = (sectionKey) =>
  PROMPT_SECTION_DEFINITIONS.find((section) => section.key === sectionKey)?.label ?? sectionKey;
const segmentLabelOf = (sectionKey, segmentId) =>
  guidanceSegmentsFor(sectionKey).find((segment) => segment.id === segmentId)?.label ?? segmentId;

// The passages of a stored pack that are longer than their limit, with the
// names the Prompts tab gives them: { sectionKey, sectionLabel, segmentId,
// segmentLabel, text, length, limit }.
export const overLimitPromptPassages = (rawPack) =>
  overLimitPackGuidance(rawPack, PROMPT_GUIDANCE_DEFAULTS).map((entry) => ({
    ...entry,
    sectionLabel: sectionLabelOf(entry.sectionKey),
    segmentLabel: segmentLabelOf(entry.sectionKey, entry.segmentId),
  }));

// The pack the Prompts tab edits: the runtime pack, with each passage that is
// over its limit put back in its place, so the author sees their own text
// beside its count and can shorten it. The game never runs one (the composed
// prompts here leave them out), and Save waits until each is within its limit
// or reset.
export const editablePromptPack = (rawPrompts) => {
  const pack = normalizePromptPack(rawPrompts);
  if (!pack.overLimit.length) return pack;
  const guidance = {
    advisor: { ...pack.guidance.advisor },
    leader: { ...pack.guidance.leader },
    tasks: Object.fromEntries(Object.entries(pack.guidance.tasks ?? {}).map(([key, bucket]) => [key, { ...bucket }])),
  };
  for (const { sectionKey, segmentId, text } of pack.overLimit) {
    if (sectionKey === "advisor" || sectionKey === "leader") guidance[sectionKey][segmentId] = text;
    else guidance.tasks[sectionKey] = { ...(guidance.tasks[sectionKey] ?? {}), [segmentId]: text };
  }
  return { ...pack, guidance };
};

// The passages of an editor's guidance ({ advisor, leader, tasks }, as typed,
// untrimmed) that are over their limit: [{ sectionKey, segmentId, length, limit }].
// A pack that bypasses the limit has none (overLimitEdits(guidance, true)).
export const overLimitEdits = (guidance, bypassLimit = false) => {
  const found = [];
  if (bypassLimit) return found;
  const check = (sectionKey, bucket) => {
    for (const [segmentId, text] of Object.entries(bucket ?? {})) {
      if (typeof text !== "string") continue;
      const limit = guidanceLimitFor(sectionKey, segmentId);
      const length = promptCharCount(text);
      if (length > limit) found.push({ sectionKey, segmentId, length, limit });
    }
  };
  check("advisor", guidance?.advisor);
  check("leader", guidance?.leader);
  for (const [key, bucket] of Object.entries(guidance?.tasks ?? {})) check(key, bucket);
  return found;
};

// The default text of a prompt: the template with every passage in the
// player's language, as an unedited pack composes it.
const defaultTemplateFor = (sectionKey) => {
  const defaultText = sectionKey === "advisor"
    ? PROMPT_ADVISOR_DEFAULT
    : sectionKey === "leader" ? PROMPT_LEADER_DEFAULT : PROMPT_TASK_DEFAULTS[sectionKey];
  const localized = localizedGuidanceDefaults();
  return composePrompt(sectionKey, defaultText, localized === PROMPT_GUIDANCE_DEFAULTS ? {} : sectionDefaults(localized, sectionKey));
};

// The longest a composed prompt template can be with every passage at its
// limit: the default template, plus each passage's allowance over its English
// default. A prompt with no editable passages can only be its default.
export const promptTemplateLimit = (sectionKey) => {
  const defaultText = sectionKey === "advisor"
    ? PROMPT_ADVISOR_DEFAULT
    : sectionKey === "leader" ? PROMPT_LEADER_DEFAULT : PROMPT_TASK_DEFAULTS[sectionKey];
  if (typeof defaultText !== "string") return 0;
  let limit = promptCharCount(defaultText);
  for (const [segmentId, passage] of Object.entries(sectionDefaults(PROMPT_GUIDANCE_DEFAULTS, sectionKey))) {
    limit += Math.max(0, guidanceLimitFor(sectionKey, segmentId) - promptCharCount(passage));
  }
  return limit;
};

// The last guard, where a template is rendered for a request (gameplay.js
// buildTaskSystemPrompt, main.jsx's advisor and leaders): a template longer
// than its section's limit never goes out; the default template does. Every
// pack the game loads is composed within the limit (normalizePromptPack), so
// this only ever catches a template that came some other way.
// A pack that bypasses the limit passes bypassLimit: its template goes out.
export const guardPromptTemplate = (sectionKey, template, bypassLimit = false) => {
  if (typeof template !== "string" || bypassLimit) return template;
  const limit = promptTemplateLimit(sectionKey);
  if (!limit || promptCharCount(template) <= limit) return template;
  console.warn(`[prompts] the ${sectionKey} prompt is ${promptCharCount(template)} characters, over its limit of ${limit}; the default is used`);
  return defaultTemplateFor(sectionKey);
};

// What a scenario or game stores: the edits alone.
export const serializePromptPack = (rawPack) => ({
  promptModel: PROMPT_MODEL_VERSION,
  ...bypassField(rawPack),
  guidance: normalizePromptGuidance(rawPack),
});

// What an explicit "Export all prompts" transfer carries: every editable
// guidance passage as concrete text, including passages that still match the
// current defaults. This is deliberately different from serializePromptPack():
// persistence stays sparse so app-owned prompt contracts can evolve, while an
// author-requested export is a complete portable snapshot of the editable layer.
export const materializePromptPack = (rawPack) => ({
  promptModel: PROMPT_MODEL_VERSION,
  ...bypassField(rawPack),
  guidance: materializePackGuidance(rawPack, PROMPT_GUIDANCE_DEFAULTS, { bypassLimit: promptPackBypassesLimit(rawPack) }),
});
