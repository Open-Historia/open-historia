/*! Open Historia — who tries to plant an agent in each player, as the time skip says © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The time skip names the polities that would really try to place an agent in
// the player this period (the answer's spiesOnPlayer), and the game rolls only
// for them (gameplay.js espionageCandidatesAgainst, runtime/spycraft.js
// resolveEspionage). It was asked for the host's country alone: every other
// player's would-be spies came from the ledgers, whatever the world said
// (the gap audit of 2026-11-18, E4). With several people playing it is asked
// for each of them, one line each, "France: Spain, Italy", and read back by
// the players' exact names: the format the prompt sets, never words.
//
// Single player is asked and read exactly as before.
//
// Pure.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLocaleLowerCase();

// The block that asks it. `players`: the polities people play, the game's own first.
export const whoSpiesBlock = (players = []) => {
  const names = (Array.isArray(players) ? players : []).map(clean).filter(Boolean);
  if (names.length < 2) {
    const spiedOn = names[0] ?? "";
    return `[Who Spies on the Player]
Write spiesOnPlayer: the polities, by exact name and comma-separated, that would really try to place an agent in ${spiedOn} this period. Choose them as the world stands: enemies and rivals, powers with a real stake in ${spiedOn}'s affairs, a patron keeping watch on a client. A polity with no reason to, no reach, or no intelligence service to speak of sends nobody. An empty string when none would.`;
  }
  return `[Who Spies on the Players]
Write spiesOnPlayer as one line for each player's polity: its exact name, a colon, then the polities, by exact name and comma-separated, that would really try to place an agent in it this period ("${names[0]}: <polity>, <polity>"). The players: ${names.join("; ")}. Choose them as the world stands: enemies and rivals, powers with a real stake in that player's affairs, a patron keeping watch on a client. Never another player's polity: a player places its own agents. A polity with no reason to, no reach, or no intelligence service to speak of sends nobody: a player none would spy on gets its name and the colon alone.`;
};

// What the answer said for each player: Map(player -> [polity]) for those it
// gave a line, by the players' exact names (case and spacing aside); a player
// it said nothing of is not in it. The longest name is tried first, so "Congo"
// never takes the line of "Congo Free State". Lines are split at a newline or a
// semicolon, a line's polities at commas.
export const spiesOnPlayersOf = (text, players = []) => {
  const names = (Array.isArray(players) ? players : []).map(clean).filter(Boolean).sort((a, b) => b.length - a.length);
  const out = new Map();
  for (const raw of String(text ?? "").split(/[\n;]/)) {
    const line = clean(raw);
    const player = names.find((name) => fold(line).startsWith(fold(name)) && line.slice(name.length).trimStart().startsWith(":"));
    if (!player) continue;
    const rest = line.slice(player.length).trimStart().slice(1);
    const spies = rest.split(",").map(clean).filter((name) => name && fold(name) !== fold(player));
    out.set(player, [...new Set([...(out.get(player) ?? []), ...spies])]);
  }
  return out;
};
