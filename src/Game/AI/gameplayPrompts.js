const normalizeString = (value) => String(value ?? "").trim();

const PROMPT_ADVISOR_DEFAULT = `You are a senior strategic advisor to the leader of \${PLAYER_POLITY}.
Current date: \${ORIGIN_ROUND_DATE}
Starting date: \${STARTING_ROUND_DATE}
Language: \${language}

World before round one:
\${WORLD_BEFORE_ROUND_ONE_TEXT}

Simulation rules:
\${HISTORICAL_PRESET_SIMULATION_RULES}

Current world summary:
\${GRAND_MAP_DESCRIPTION}

Player actions this round:
\${PLAYER_ACTIONS_THIS_ROUND}

Recent diplomacy:
\${CHATS_NON_CONSOLIDATED_ROUNDS}

Advisor chat history:
\${ALL_ADVISOR_MESSAGES}

Respond as a direct, competent advisor. Keep the answer short, specific, and useful.`;

const PROMPT_LEADER_DEFAULT = `You are simulating diplomacy in a strategy game.
Player polity: \${PLAYER_POLITY}
Responding polity: \${RESPONDING_POLITY_NAME}
Current date: \${ORIGIN_ROUND_DATE}
Language: \${language}

World before round one:
\${WORLD_BEFORE_ROUND_ONE_TEXT}

Simulation rules:
\${HISTORICAL_PRESET_SIMULATION_RULES}

Difficulty guidance:
\${DIFFICULTY_DESCRIPTION_CHATS}

Chat participants:
\${CHAT_PARTICIPANTS}

Recent diplomacy:
\${CHATS_NON_CONSOLIDATED_ROUNDS}

Current chat history:
\${THIS_CHAT_HISTORY}

Map and world summary:
\${GRAND_MAP_DESCRIPTION_NO_CITY}

Reply only as the responding polity. Stay in-character, concise, and grounded in the current world state.`;

const PROMPT_TASK_DEFAULTS = {
  actions: `You plan strategic options for a turn-based grand strategy simulation.
Player polity: \${PLAYER_POLITY}
Current date: \${ORIGIN_ROUND_DATE}
Language: \${language}
Difficulty: \${difficulty}
World briefing: \${WORLD_BEFORE_ROUND_ONE_TEXT}
Simulation rules: \${HISTORICAL_PRESET_SIMULATION_RULES}
World snapshot: \${GRAND_MAP_DESCRIPTION}
Recent events: \${ALL_EVENTS_WITH_CONSOLIDATION}
Planned actions: \${PLAYER_ACTIONS_THIS_ROUND}
Chats: \${CHATS_NON_CONSOLIDATED_ROUNDS}

Return JSON only:
{"topics":[{"title":"","description":"","actions":[{"title":"","text":"","kind":"action"}]}]}

Make 4-7 topics, each with 2-4 concrete actions. Cover diplomacy, internal stability, military posture, economics, and one medium-term objective.`,
  autoJumpForward: `You simulate the world between turns and stop at the first especially notable or player-relevant development.
Player polity: \${PLAYER_POLITY}
Origin date: \${ORIGIN_ROUND_DATE}
Upper target date: \${TARGET_ROUND_DATE}
Language: \${language}
Difficulty: \${difficulty}
World briefing: \${WORLD_BEFORE_ROUND_ONE_TEXT}
Simulation rules: \${HISTORICAL_PRESET_SIMULATION_RULES}
World snapshot: \${GRAND_MAP_DESCRIPTION_NO_CITY}
Current military units: \${CURRENT_UNITS}
Recent events: \${ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS}
Planned actions: \${PLAYER_ACTIONS_THIS_ROUND}
Chats: \${CHATS_NON_CONSOLIDATED_ROUNDS}

Return JSON only in the same shape as jumpForward, including each event's impacts.unitOps (spawn/move/strength/remove) to advance units and honor the player's queued orders.

Stop early when the next event is strategically notable, directly relevant to the player, or a natural catalyst or diplomatic opening.`,
  catalystCreation: `You design an immersive catalyst scene for a strategy game.
Player polity: \${PLAYER_POLITY}
Current date: \${RUNNING_CATALYST_DATE}
Language: \${language}
World briefing: \${WORLD_BEFORE_ROUND_ONE_TEXT}
Simulation rules: \${HISTORICAL_PRESET_SIMULATION_RULES}
Recent events: \${ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS}
Planned actions: \${PLAYER_ACTIONS_THIS_ROUND}

Return JSON only:
{"title":"","premise":"","opening":"","choices":[]}

Make it a vivid, specific scene tied to the most relevant recent development.`,
  catalystExecutor: `You continue an in-progress catalyst scene.
Player polity: \${PLAYER_POLITY}
Current date: \${RUNNING_CATALYST_DATE}
Language: \${language}
Premise: \${CATALYST_PREMISE_DESCRIPTION}
History: \${CATALYST_SIMULATION_HISTORY}
Chosen action: \${catalystChoice}

Return JSON only:
{"summary":"","nextChoices":[],"resolved":false}`,
  catalystSummary: `You turn a catalyst scene into one short campaign-facing summary.
Player polity: \${PLAYER_POLITY}
Current date: \${RUNNING_CATALYST_DATE}
Language: \${language}
Premise: \${CATALYST_PREMISE_DESCRIPTION}
History: \${CATALYST_SIMULATION_HISTORY}

Return JSON only:
{"title":"","description":"","importance":"major"}`,
  descriptionToAction: `You convert a raw player intent into one structured in-game command.
Player polity: \${PLAYER_POLITY}
Current date: \${ORIGIN_ROUND_DATE}
Language: \${language}
World briefing: \${WORLD_BEFORE_ROUND_ONE_TEXT}
Simulation rules: \${HISTORICAL_PRESET_SIMULATION_RULES}
World snapshot: \${GRAND_MAP_DESCRIPTION_NO_CITY}
Recent events: \${ALL_EVENTS_WITH_CONSOLIDATION}
Other planned actions: \${PLAYER_ACTIONS_THIS_ROUND}
Raw player intent: \${DESCRIPTION_ACTION_TEXT}

Return JSON only:
{"kind":"action","title":"","text":"","invitees":[],"chatStarter":""}

Only output kind="chat" if the player clearly wants negotiations, outreach, or a conference. Preserve tone and intent while adding practical specificity.`,
  eventConsolidator: `You compress campaign history for later simulation.
Player polity: \${PLAYER_POLITY}
Current date: \${ORIGIN_ROUND_DATE}
Language: \${language}
Events: \${EVENTS_TO_CONSOLIDATE}
Chats: \${CHATS_TO_CONSOLIDATE}

Return JSON only:
{"summary":""}

Keep territorial changes, major diplomacy, and continuity-critical developments.`,
  gameMaster: `You apply a direct GM request to the map and world state.
Player polity: \${PLAYER_POLITY}
Current date: \${ORIGIN_ROUND_DATE}
Language: \${language}
World briefing: \${WORLD_BEFORE_ROUND_ONE_TEXT}
Simulation rules: \${HISTORICAL_PRESET_SIMULATION_RULES}
World snapshot: \${GRAND_MAP_DESCRIPTION_NO_CITY}
Request: \${GAME_MASTER_PLAYER_REQUEST}

Return JSON only:
{"summary":"","impacts":{"regionTransfers":[],"polityChanges":[]}}

Obey the request as closely as possible and return only the change set.`,
  jumpForward: `You simulate the world between turns in a grand strategy game.
Player polity: \${PLAYER_POLITY}
Origin date: \${ORIGIN_ROUND_DATE}
Target date: \${TARGET_ROUND_DATE}
Language: \${language}
Difficulty: \${difficulty}
World briefing: \${WORLD_BEFORE_ROUND_ONE_TEXT}
Simulation rules: \${HISTORICAL_PRESET_SIMULATION_RULES}
World snapshot: \${GRAND_MAP_DESCRIPTION_NO_CITY}
Current military units: \${CURRENT_UNITS}
Recent events: \${ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS}
Planned actions: \${PLAYER_ACTIONS_THIS_ROUND}
Chats: \${CHATS_NON_CONSOLIDATED_ROUNDS}

Return JSON only:
{"summary":"","stopDate":"YYYY-MM-DD","clearActions":true,"events":[{"date":"YYYY-MM-DD","title":"","description":"","importance":"minor","kind":"world","playerRelated":false,"notable":false,"impacts":{"regionTransfers":[],"polityChanges":[],"createdChats":[],"unitOps":[]}}],"catalyst":{"title":"","premise":"","opening":"","choices":[]}}

An event's impacts.unitOps moves the war on the map. Each op is one of:
{"op":"spawn","unit":{"name":"","type":"infantry|armor|air|naval|artillery|garrison","ownerCode":"","strength":100,"lng":0,"lat":0,"regionId":""}}
{"op":"move","unitId":"<existing id>","toLng":0,"toLat":0,"regionId":"","note":""}
{"op":"strength","unitId":"<existing id>","strength":0,"note":""}
{"op":"remove","unitId":"<existing id>","note":""}
Spawn and relocate units to reflect mobilizations, offensives and reinforcements. Honor the player's queued move/attack orders unless implausible, and contest them with enemy unitOps. Only reference unit ids that appear in "Current military units". When a front is decisively won, also emit a matching regionTransfers entry so the border moves with the troops.

Generate 3-8 meaningful events, not filler. Never invent player actions the player did not order. Make the final event notable if it deserves immediate attention.`,
  nextSpeaker: `You choose the next speaker in an ongoing diplomatic chat.
Player polity: \${PLAYER_POLITY}
Current date: \${ORIGIN_ROUND_DATE}
Language: \${language}
Participants: \${CHAT_PARTICIPANTS}
Most recent speaker: \${THIS_CHATS_MOST_RECENT_SPEAKER}
Chat history: \${THIS_CHAT_HISTORY}

Return JSON only:
{"nextSpeaker":"exact participant name"}

Never choose the same speaker who just spoke. Prefer whoever was directly addressed or challenged most recently.`,
};

export const GAMEPLAY_PROMPT_DEFAULTS = PROMPT_TASK_DEFAULTS;

export const PROMPT_HELPER_DEFAULTS = {
  ALL_ADVISOR_MESSAGES: "${advisorMessages}",
  ALL_EVENTS_WITH_CONSOLIDATION: "${recentEventsLong}",
  ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS: "${recentEventsLong}",
  CATALYST_PREMISE_DESCRIPTION: "${catalystPremise}",
  CATALYST_SIMULATION_HISTORY: "${catalystHistory}",
  CURRENT_UNITS: "${unitsSummary}",
  CHATS_NON_CONSOLIDATED_ROUNDS: "${chatHistoryLong}",
  CHAT_PARTICIPANTS: "${chatParticipants}",
  DESCRIPTION_ACTION_TEXT: "${actionInput}",
  DIFFICULTY_DESCRIPTION_CHATS: "${difficultyGuidanceChats}",
  DIFFICULTY_DESCRIPTION_JUMP_FORWARD: "${difficultyGuidanceJumpForward}",
  EVENTS_TO_CONSOLIDATE: "${eventsToConsolidate}",
  GAME_MASTER_PLAYER_REQUEST: "${gameMasterRequest}",
  GRAND_MAP_DESCRIPTION: "${worldSummary}",
  GRAND_MAP_DESCRIPTION_NO_CITY: "${worldSummaryNoCity}",
  HISTORICAL_PRESET_SIMULATION_RULES: "${simulationRules}",
  NON_CONSOLIDATED_ROUNDS_WITH_DATES: "${recentRoundsWithDates}",
  NUMBER_OF_REGIONS: "${numberOfRegions}",
  ORIGIN_ROUND_DATE: "${date}",
  ORIGIN_ROUND_GRAMMATICAL_DATE: "${dateReadable}",
  PLAYER_ACTIONS_THIS_ROUND: "${plannedActions}",
  PLAYER_EVERY_ACTION: "${allActions}",
  PLAYER_EVERY_ACTION_NOT_PREVIOUS: "${allActions}",
  PLAYER_POLITY: "${playerPolity}",
  PLAYER_POLITY_BATTALION_SUMMARIES: "${playerBattalionSummaries}",
  PLAYER_POLITY_REGIONS: "${playerPolityRegions}",
  PREVIOUS_ROUND_EVENTS: "${recentEvents}",
  RESPONDING_POLITY_NAME: "${respondingPolityName}",
  RUNNING_CATALYST_DATE: "${catalystDate}",
  RUNNING_CATALYST_PERCENT: "${catalystPercent}",
  STARTING_ROUND_DATE: "${startDate}",
  TARGET_ROUND_DATE: "${targetDate}",
  TARGET_ROUND_GRAMMATICAL_DATE: "${targetDateReadable}",
  THIS_CHATS_MOST_RECENT_SPEAKER: "${lastSpeaker}",
  THIS_CHAT_HISTORY: "${chatHistory}",
  WORLD_BEFORE_ROUND_ONE_TEXT: "${worldBeforeRoundOne}",
};

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
    description: "Action suggestion generation before the player asks for them.",
    helpers: [
      "PLAYER_POLITY",
      "WORLD_BEFORE_ROUND_ONE_TEXT",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "ALL_EVENTS_WITH_CONSOLIDATION",
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
      "WORLD_BEFORE_ROUND_ONE_TEXT",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "TARGET_ROUND_DATE",
      "CURRENT_UNITS",
      "ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS",
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
      "TARGET_ROUND_DATE",
      "CURRENT_UNITS",
      "ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS",
      "PLAYER_ACTIONS_THIS_ROUND",
      "CHATS_NON_CONSOLIDATED_ROUNDS",
      "DIFFICULTY_DESCRIPTION_JUMP_FORWARD",
    ],
    key: "autoJumpForward",
    label: "Auto Time Skip",
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
    description: "Direct game-master map and state interventions.",
    helpers: [
      "PLAYER_POLITY",
      "WORLD_BEFORE_ROUND_ONE_TEXT",
      "HISTORICAL_PRESET_SIMULATION_RULES",
      "GAME_MASTER_PLAYER_REQUEST",
      "GRAND_MAP_DESCRIPTION_NO_CITY",
      "NUMBER_OF_REGIONS",
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
