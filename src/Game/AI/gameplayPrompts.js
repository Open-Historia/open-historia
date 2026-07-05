/*! Open Historia — portions (troop & era prompt additions) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import DEFAULT_PROMPTS from "./defaultPrompts.json";
const normalizeString = (value) => String(value ?? "").trim();

const PROMPT_ADVISOR_DEFAULT = DEFAULT_PROMPTS.advisor;

const PROMPT_LEADER_DEFAULT = DEFAULT_PROMPTS.leader;

const PROMPT_TASK_DEFAULTS = DEFAULT_PROMPTS.tasks;

export const GAMEPLAY_PROMPT_DEFAULTS = PROMPT_TASK_DEFAULTS;

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
