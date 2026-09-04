/*! Open Historia — prompt layout for provider prompt caching. Ported from Abdulrahman Azmy's fork. */
// Import-free on purpose: runs under node --test without a build.
//
// Provider prompt caching — Anthropic's explicit cache_control blocks, and the
// implicit prefix caching OpenAI and Gemini apply on their own — discounts the
// part of a system prompt that is byte-identical from one call to the next,
// and only a LEADING part counts. A task template mixes game-lifetime
// constants (the scenario briefing, simulation rules, difficulty, the player's
// identity) with per-turn data (events, map state, dates). The boundary
// between the two is what a cache needs: everything before the first per-turn
// placeholder renders identically across a campaign's calls, everything after
// it changes every turn.
//
// The template's ORDER decides how much is cacheable. Measured on the stock
// pack, the jump templates keep roughly two thirds of their text ahead of the
// first per-turn placeholder (promptLayout.test.js guards that share), which
// on Anthropic turns into cached input at a tenth of the price on every
// consecutive jump, retry and auto-jump step.

// Template variables that cannot change within one campaign: the
// buildPromptContext keys and the prompt-pack helper keys that alias them
// (helpers resolve to strings before rendering, so both spellings are
// constants by the time a template sees them). Everything else — events,
// units, chats, dates, map state, reputation — is per-turn.
export const STATIC_PROMPT_KEYS = Object.freeze(new Set([
  "language",
  "playerPolity",
  "worldBeforeRoundOne",
  "simulationRules",
  "difficultyGuidanceChats",
  "difficultyGuidanceJumpForward",
  "startDate",
  "numberOfRegions",
  "PLAYER_POLITY",
  "WORLD_BEFORE_ROUND_ONE_TEXT",
  "HISTORICAL_PRESET_SIMULATION_RULES",
  "DIFFICULTY_DESCRIPTION_CHATS",
  "DIFFICULTY_DESCRIPTION_JUMP_FORWARD",
  "STARTING_ROUND_DATE",
  "NUMBER_OF_REGIONS",
]));

// Anthropic ignores a cache breakpoint on a block shorter than its minimum
// (1024 tokens on most models); splitting the system prompt into two content
// blocks for less than that buys nothing, so a shorter prefix is not split.
export const MIN_CACHEABLE_PREFIX_CHARS = 3000;

const PLACEHOLDER_SOURCE = "\\$\\{([^}]+)\\}";

const render = (template, variables) =>
  String(template ?? "").replace(new RegExp(PLACEHOLDER_SOURCE, "g"), (_match, key) => {
    const value = variables?.[key];
    return value == null ? "" : String(value);
  });

// Render `template` and report where its game-lifetime prefix ends in the
// rendered text. The boundary is the first placeholder in the TEMPLATE whose
// key is not a static one; the prefix is the template up to that point,
// rendered on its own. Rendering happens in one pass over the whole template,
// exactly as renderTemplate (promptContext.js) does, so a value that itself
// contains "${...}" text is never re-rendered — the prefix is simply the
// leading part of the same result, which is what makes it byte-identical.
export const renderTemplateCached = (template, variables, staticKeys = STATIC_PROMPT_KEYS) => {
  const source = String(template ?? "");
  const placeholder = new RegExp(PLACEHOLDER_SOURCE, "g");
  let boundary = source.length;
  for (let match = placeholder.exec(source); match; match = placeholder.exec(source)) {
    if (!staticKeys.has(match[1])) {
      boundary = match.index;
      break;
    }
  }
  const text = render(source, variables);
  const staticPrefixEnd = boundary === source.length
    ? text.length
    : render(source.slice(0, boundary), variables).length;
  return { text, staticPrefixEnd };
};

// The offset to hand a provider for a prompt that may have been rewritten
// since it was rendered (directives appended, repeated blocks collapsed): the
// prefix still counts only if the final prompt still opens with it.
export const staticPrefixEndOf = (systemPrompt, staticPrefix) => {
  const prefix = String(staticPrefix ?? "");
  if (!prefix) return null;
  return String(systemPrompt ?? "").startsWith(prefix) ? prefix.length : null;
};

// Split a system prompt into the cacheable prefix and the per-turn tail, or
// null when there is nothing worth pinning: no boundary, a boundary outside
// the text, or a prefix too short for the provider's minimum.
export const splitSystemPromptForCache = (systemPrompt, staticPrefixEnd, { minChars = MIN_CACHEABLE_PREFIX_CHARS } = {}) => {
  const text = String(systemPrompt ?? "");
  const end = Number(staticPrefixEnd);
  if (!Number.isFinite(end) || end < minChars || end >= text.length) return null;
  return { prefix: text.slice(0, end), tail: text.slice(end) };
};
