/*! Open Historia — the Agent folder © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The folder the player opens their own Agent in (Claude Code, Codex or
// Antigravity CLI) to answer time skips through `/skip`
// (docs/adr/0008-subscription-agents-answer-through-the-game.md).
//
// It lives in the data folder, so an update does not remove it, and everything
// the game puts in it is written again at every start: the instructions, the
// `/skip` skill, the sub-agent and the MCP settings carrying this run's address
// and token. A game update therefore updates what the Agent is told, and an
// address or token from an earlier run is never left behind. The player's own
// files in the folder are left alone. The prompt files of the Agent queue live
// under `requests/`; whatever an earlier run left there is deleted.
//
// The game never starts the Agent and never reads its credentials. Nothing
// written here tells an Agent to pick requests up by itself: `/skip` answers
// the skip that is running and stops.
import fs from "fs";
import path from "path";

export const AGENT_MCP_SERVER_NAME = "open-historia";
export const AGENT_REQUESTS_DIR = "requests";

export const AGENT_MODELS_FILE = "models.json";

const TOOL = (name) => `mcp__${AGENT_MCP_SERVER_NAME}__${name}`;

// Which of the two sub-agents answers a request, by its task: the writer for
// the skip's long writing (the jump, retries included, and the history), quick
// jobs for the short checks after it. The player may give each its own model,
// for Open Historia only (models.json); until then both inherit theirs.
export const AGENT_ROLES = Object.freeze({
  writer: Object.freeze({ subagent: "skip-writer", tasks: Object.freeze(["jump", "history"]) }),
  quick: Object.freeze({ subagent: "skip-quick", tasks: Object.freeze(["review", "stats", "institutionBallots"]) }),
  chat: Object.freeze({ subagent: "chat-writer", tasks: Object.freeze(["advisor", "diplomacy", "gameMaster", "interactive"]) }),
});

export const roleForTask = (task) => {
  const base = String(task || "").replace(/(?:Retry|Lookup)$/, "");
  if (AGENT_ROLES.chat.tasks.includes(base)) return "chat";
  return AGENT_ROLES.quick.tasks.includes(base) ? "quick" : "writer";
};

const AGENTS_MD = `# Open Historia: answering what the player starts

This folder belongs to the Open Historia game. The player plays in the game and
opens their own Agent here (Claude Code, Codex or Antigravity CLI). When the
game shows something waiting (a time skip, an advisor message, a foreign
leader's reply, a Game Master command, an interactive event), the player types
\`/answer\` (or \`/skip\`, the same command under its first name). The game writes
this file at every start, so any change to it is lost; put your own notes in a
file of your own.

The game is reached through its MCP server, \`${AGENT_MCP_SERVER_NAME}\`, which has four tools:

- \`list_requests\`: what the game is waiting on. Its \`status\` is
  \`waiting\` (with \`requests\`, oldest first), \`running\` (a time skip is still
  going, nothing to answer yet: ask again) or \`idle\` (nothing is waiting).
- \`read_request\`: one request's prompt file, the file to write the answer to,
  what the answer must look like, and the lookup functions it offers.
- \`lookup\`: asks the game one of those lookup functions (a region's
  neighbours, the exact name of a power, a war's ledger) while you answer.
- \`answer_request\`: hands the answer to the game. It is the only way an answer
  reaches the game. It means delivered, not accepted: the game checks every
  answer itself. If it refuses one, it asks once more, as a new request with
  the reason in the prompt; if it refuses that too, it gives up and tells the
  player. So never tell the player an answer was accepted.

## Rules

- Only answer when the player has typed \`/answer\` or \`/skip\`. Never watch for
  requests by yourself, never schedule or loop, and never keep going once
  nothing the player started is waiting.
- Never edit the game's saves or any file outside this folder. The game checks
  and applies every answer itself.
- An answer is exactly what the request's prompt asks for: a single JSON
  object, or for a chat reply the text it asks for, with no commentary around it.
- If a tool call is refused because of the token or the address, the game has
  restarted since this session began. Tell the player to start the Agent again
  in this folder.

## Models for Open Historia

The player chooses the models that answer Open Historia's requests, in
\`${AGENT_MODELS_FILE}\` in this folder: \`{ "writer": "<model>", "quick": "<model>", "chat": "<model>" }\`.
The writer answers a time skip's jump and history; quick answers the checks
after it (the turn review, stat sheets, institution ballots); chat writes the
replies (the advisor, foreign leaders, the Game Master, interactive events), and
uses the quick model when none is named for it. The file is the player's: the
game never writes it. Their choice here is for Open Historia only and comes
before any general rule they keep about which models sub-agents use. In Claude
Code the game writes it into the \`skip-writer\`, \`skip-quick\` and \`chat-writer\`
sub-agents, and \`/answer\` also starts each sub-agent on it. In another Agent,
start each sub-agent on the model the file names for its role; only where your
Agent cannot choose a sub-agent's model does it run on the session's. A role
the player keeps on their own model is left out of the file.

## What \`/answer\` does

0. If \`${AGENT_MODELS_FILE}\` is missing, or the player typed \`/answer models\` (or
   \`/skip models\`), ask the player which model should write time skips (the
   biggest job), which should do the quick checks after them, and which should
   write chat replies (default: the quick one), offering every model your Agent
   has (in Claude Code: opus, sonnet or haiku; or "my own" to keep the
   session's), including any that a general rule of the player's leaves out of
   their sub-agents, and write their answer to \`${AGENT_MODELS_FILE}\`, leaving out
   a role they keep on their own model. Ask once; then go on.
1. Call \`list_requests\`. If the status is \`idle\`, tell the player
   "Nothing is waiting" and stop.
2. For each request listed, oldest first, hand it to a fresh sub-agent with
   just its id: the one its \`subagent\` names (in Claude Code, \`skip-writer\` for
   a skip's long writing, \`skip-quick\` for the checks after it, \`chat-writer\`
   for a reply). The sub-agent reads the prompt file, writes the answer and
   calls \`answer_request\`. If your Agent has no sub-agents, do this yourself,
   one request at a time.
3. Call \`list_requests\` again. Repeat step 2 while it says \`waiting\`, and keep
   asking while it says \`running\`. A time skip asks its requests one after
   another (the turn review, history and stat sheets are written from the
   jump's result), so more arrive while it runs.
4. When it says \`idle\`, everything the player started is answered. Tell the
   player in one line and stop.
`;

const ANSWER_STEPS = `Answer what Open Historia is waiting on: everything the player started (a time skip, advisor messages, foreign leaders' replies, Game Master commands, interactive events). Follow "What \`/answer\` does" in AGENTS.md:

0. If \`${AGENT_MODELS_FILE}\` is missing from this folder, or the player asked for "models": ask the player which model should write time skips (the biggest job), which should do the quick checks after them, and which should write chat replies (default: the quick one), offering every model you can run (in Claude Code: opus, sonnet or haiku, or "my own" to keep this session's), including any that a general rule of the player's leaves out of their sub-agents: this choice is theirs to make for Open Historia. Write \`{ "writer": "<model>", "quick": "<model>", "chat": "<model>" }\` to \`${AGENT_MODELS_FILE}\`, leaving out a role the player keeps on their own model. This choice is for Open Historia only, and comes before any general rule about which models sub-agents use. Then go on.
1. Call \`list_requests\`. If its status is \`idle\`, say "Nothing is waiting" and stop.
2. For each listed request, oldest first, start a fresh sub-agent of the kind its \`subagent\` names, with only the request id, in the foreground, and wait for it to finish. If \`${AGENT_MODELS_FILE}\` names a model for the request's \`role\` (chat falls back to quick), start the sub-agent on that model. Do not read the prompt file yourself: it is large, and the sub-agent keeps it out of this session. If you cannot start sub-agents, answer each request yourself as that sub-agent would.
3. Call \`list_requests\` again. Answer whatever is \`waiting\`; while it says \`running\`, ask again.
4. When it says \`idle\`, tell the player everything is answered, in one line, and stop.

Never answer anything the player did not start, and never keep watching once nothing is waiting.
`;

// `playerOnly`: Claude Code's skills are started by the player alone.
const skillFile = ({ name, playerOnly, firstName = false }) => `---
name: ${name}
description: Answer what the Open Historia game is waiting on (time skips, chats, Game Master, events). Only when the player ${playerOnly ? "types" : "asks for"} /${name}.${firstName ? " The same command as /answer, under its first name." : ""}
${playerOnly ? "disable-model-invocation: true\n" : ""}---

${ANSWER_STEPS}`;

// One sub-agent per role. Its model is the one the player picked for that role
// in models.json, for Open Historia only; with none picked it names no model
// and no effort, and inherits both from the player's own session (ADR 0008).
const subagentDefinition = ({ name, description, model }) => `---
name: ${name}
description: ${description}
tools: ${TOOL("read_request")}, ${TOOL("lookup")}, ${TOOL("answer_request")}, Read, Write
${model ? `model: ${model}\n` : ""}---

You answer one request from the Open Historia game. You are given its id.

1. Call \`read_request\` with the id. It returns \`promptFile\`, \`answerFile\` and
   what the answer must look like.
2. Read the whole prompt file. It holds the game's instructions and the world as
   it stands. Follow those instructions exactly, as the game's AI would.
   Where it tells you to call a lookup function, and \`read_request\` listed it,
   call the \`lookup\` tool with the id, the function's name and its arguments.
3. Write your answer, and nothing else, to \`answerFile\`. For a JSON answer
   that is the JSON object alone: no code fence, no commentary.
4. Call \`answer_request\` with the id. Leave out \`text\`: the game reads the
   answer file.
5. Reply with one line saying which request you answered. Never repeat the
   prompt or the answer.

Never edit any other file.
`;

const SUBAGENT_DESCRIPTIONS = {
  writer: "Writes one Open Historia time-skip request (the jump, or the history), given its id. Used by /answer.",
  quick: "Answers one of Open Historia's quick checks after a time skip (review, stat sheets, ballots), given its id. Used by /answer.",
  chat: "Writes one Open Historia chat reply (the advisor, a foreign leader, the Game Master, an interactive event), given its id. Used by /answer.",
};

// A plain model name or id ("sonnet", "claude-haiku-4-5", "gpt-5-mini"): it is
// written into a definition's header, so nothing else gets in.
// Brackets are allowed for a context suffix ("opus[1m]").
const plainModel = (value) => (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,63}$/.test(value.trim()) ? value.trim() : "");

// The player's models, or null when the file is there but cannot be read as
// JSON (half written, or broken): then what the sub-agents carry is kept.
export const readAgentModels = (folder) => {
  let text;
  try {
    text = fs.readFileSync(path.join(folder, AGENT_MODELS_FILE), "utf8");
  } catch {
    return { writer: "", quick: "", chat: "" };
  }
  try {
    const chosen = JSON.parse(text);
    const quick = plainModel(chosen?.quick);
    // Chat replies use the quick model unless the player named one for them.
    return { writer: plainModel(chosen?.writer), quick, chat: plainModel(chosen?.chat) || quick };
  } catch {
    return null;
  }
};

// The two sub-agents, with the player's models as they stand. Run at start and
// again on every call from the Agent, so models picked mid-session are used.
export const writeAgentSubagents = (folder) => {
  const models = readAgentModels(folder);
  if (!models) return;
  for (const [role, { subagent }] of Object.entries(AGENT_ROLES)) {
    writeIfChanged(
      path.join(folder, ".claude", "agents", `${subagent}.md`),
      subagentDefinition({ name: subagent, description: SUBAGENT_DESCRIPTIONS[role], model: models[role] }),
    );
  }
};

const writeIfChanged = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.readFileSync(file, "utf8") === text) return;
  } catch {
    /* not written yet */
  }
  // Whole or not at all: two calls of the Agent can arrive together.
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, text, "utf8");
  fs.renameSync(temporary, file);
};

const tomlString = (value) => JSON.stringify(String(value));

// `url`: where this run's MCP server answers. `token`: this run's token; a
// call without it is refused.
export const writeAgentFolder = (folder, { url, token }) => {
  const authorization = `Bearer ${token}`;
  writeIfChanged(path.join(folder, "AGENTS.md"), AGENTS_MD);
  writeIfChanged(path.join(folder, "CLAUDE.md"), "@AGENTS.md\n");

  // Claude Code
  writeIfChanged(
    path.join(folder, ".mcp.json"),
    `${JSON.stringify({ mcpServers: { [AGENT_MCP_SERVER_NAME]: { type: "http", url, headers: { Authorization: authorization } } } }, null, 2)}\n`,
  );
  writeIfChanged(path.join(folder, ".claude", "skills", "answer", "SKILL.md"), skillFile({ name: "answer", playerOnly: true }));
  writeIfChanged(path.join(folder, ".claude", "skills", "skip", "SKILL.md"), skillFile({ name: "skip", playerOnly: true, firstName: true }));
  writeAgentSubagents(folder);
  // The single sub-agent of earlier builds.
  fs.rmSync(path.join(folder, ".claude", "agents", "skip-answerer.md"), { force: true });

  // Codex (and other Agents that read AGENTS.md and .agents/skills)
  writeIfChanged(
    path.join(folder, ".codex", "config.toml"),
    `[mcp_servers.${AGENT_MCP_SERVER_NAME}]\nurl = ${tomlString(url)}\nhttp_headers = { Authorization = ${tomlString(authorization)} }\n`,
  );
  writeIfChanged(path.join(folder, ".agents", "skills", "answer", "SKILL.md"), skillFile({ name: "answer", playerOnly: false }));
  writeIfChanged(path.join(folder, ".agents", "skills", "skip", "SKILL.md"), skillFile({ name: "skip", playerOnly: false, firstName: true }));

  // Prompt files of an earlier run: its queue is gone, and so are they.
  const requests = path.join(folder, AGENT_REQUESTS_DIR);
  fs.rmSync(requests, { recursive: true, force: true });
  fs.mkdirSync(requests, { recursive: true });
};
