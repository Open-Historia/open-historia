/*! Open Historia — difficulty levels & AI directives © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Difficulty is stored on game.json (game.difficulty) and steers the AI:
// every gameplay task gets the matching directive appended to its system
// prompt, so the same simulation engine plays soft or ruthless.
export const DIFFICULTY_LEVELS = [
  {
    id: "very-easy",
    label: "Very Easy",
    emoji: "😴",
    blurb: "The world bends your way",
    directive:
      "DIFFICULTY very-easy: The world favors the player heavily. Their actions almost always succeed and outperform expectations, rival nations act passively and rarely oppose them, and events tend to benefit the player's nation.",
  },
  {
    id: "easy",
    label: "Easy",
    emoji: "🙂",
    blurb: "A forgiving world",
    directive:
      "DIFFICULTY easy: The world is forgiving. Reasonable player actions succeed, rivals are slow to exploit mistakes, and setbacks stay small and recoverable.",
  },
  {
    id: "medium",
    label: "Medium",
    emoji: "⚖️",
    blurb: "Realistic and balanced",
    directive:
      "DIFFICULTY medium: Simulate a balanced, realistic world. Player actions succeed or fail on their merits, and rival nations pursue their own interests with normal competence.",
  },
  {
    id: "hard",
    label: "Hard",
    emoji: "😰",
    blurb: "Rivals play to win",
    directive:
      "DIFFICULTY hard: The world is demanding. Rival nations are competent and opportunistic, weak or vague player actions fail or backfire, and success requires sound strategy.",
  },
  {
    id: "very-hard",
    label: "Very Hard",
    emoji: "🔥",
    blurb: "A hostile world",
    directive:
      "DIFFICULTY very-hard: The world is hostile to the player. Rivals actively counter their moves and form coalitions against them, only well-reasoned plans succeed, and events often work against the player's nation.",
  },
  {
    id: "impossible",
    label: "Impossible",
    emoji: "💀",
    blurb: "Everything conspires against you",
    directive:
      "DIFFICULTY impossible: The world conspires against the player. Rival nations are ruthless, coordinated, and relentless; even good plans meet complications; crises compound. The player survives only through brilliance — never luck.",
  },
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

export const difficultyDirective = (value) => difficultyMeta(value).directive;
