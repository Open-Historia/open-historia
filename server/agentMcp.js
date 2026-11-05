/*! Open Historia — the game's MCP server for Agents © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The MCP server the player's Agent uses to answer the Agent queue
// (docs/adr/0008-subscription-agents-answer-through-the-game.md). It is served
// by the local server itself, over Streamable HTTP with plain JSON answers, so
// the player installs nothing besides their Agent.
//
// Three tools, and the answer tool is the only way an answer gets in. The read
// tool returns the prompt file's path, never the prompt: a skip prompt is far
// larger than an Agent's limit on one tool result.
import crypto from "crypto";
import { AGENT_MCP_SERVER_NAME, AGENT_ROLES, roleForTask } from "./agentFolder.js";
import { NOT_WAITING } from "./agentQueue.js";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const DELIVERED_NOTE = "Delivered to the game, which checks it now. If the game refuses it, the same request comes back once, as a new request, with the reason in its prompt; a second refusal is final. Tell the player it was delivered, not accepted.";

const TOOLS = [
  {
    name: "list_requests",
    description:
      "What the Open Historia game is waiting on. status is 'waiting' (answer the listed requests), 'running' (the time skip is still going: call again) or 'idle' (no time skip is pending: stop).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_request",
    description: "One request: the path of its prompt file, the file to write the answer to, and what the answer must look like.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "lookup",
    description:
      "Ask the game one of the lookup functions read_request lists for a request, while you answer it. Returns the game's answer as JSON.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" }, arguments: { type: "object" } },
      required: ["id", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "answer_request",
    description:
      "Hand a request's answer to the game. Pass text, or leave it out after writing the answer to the request's answer file.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, text: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

// Constant-time, so the token cannot be guessed a character at a time.
export const tokenMatches = (header, token) => {
  const given = Buffer.from(String(header || ""));
  const wanted = Buffer.from(`Bearer ${token}`);
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
};

const result = (id, value) => ({ jsonrpc: "2.0", id, result: value });
const failure = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const toolText = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const toolRefusal = (message) => ({ content: [{ type: "text", text: message }], isError: true });

const callTool = async (queue, name, args = {}) => {
  if (name === "list_requests") {
    const listed = await queue.list();
    if (!Array.isArray(listed.requests)) return toolText(listed);
    // Which sub-agent answers each: the writer or quick jobs (agentFolder.js).
    const requests = listed.requests.map((request) => {
      const role = roleForTask(request.task);
      return { ...request, role, subagent: AGENT_ROLES[role].subagent };
    });
    return toolText({ ...listed, requests });
  }
  if (name === "read_request") {
    const request = queue.read(args.id);
    if (!request) return toolRefusal(NOT_WAITING);
    return toolText({
      id: request.id,
      task: request.task,
      promptFile: request.promptFile,
      answerFile: request.answerFile,
      answer: "Exactly what the prompt file asks for (usually one JSON object), written to answerFile, then answer_request with this id.",
      lookups: request.lookupTools,
      ...(request.lookupTools.length ? { lookupHow: "Where the prompt says to call one of these functions, call the lookup tool with this request's id, the function's name and its arguments." } : {}),
    });
  }
  if (name === "lookup") {
    const outcome = await queue.lookup(args.id, String(args.name || ""), args.arguments);
    return outcome.ok ? toolText(outcome.result) : toolRefusal(outcome.reason);
  }
  if (name === "answer_request") {
    const outcome = queue.answer(args.id, args.text);
    // Delivered, not accepted: the game checks the answer itself.
    return outcome.ok ? toolText({ ok: true, delivered: DELIVERED_NOTE }) : toolRefusal(outcome.reason);
  }
  return null;
};

// One JSON-RPC message in, its reply out (null for a notification).
export const handleMcpMessage = async (queue, message) => {
  const { id, method, params } = message || {};
  const isNotification = id === undefined || id === null;
  if (method === "initialize") {
    const asked = params?.protocolVersion;
    return result(id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: AGENT_MCP_SERVER_NAME, version: "1" },
      instructions: "Open Historia's Agent queue. Use it only when the player types /skip; see AGENTS.md in this folder.",
    });
  }
  if (isNotification) return null;
  if (method === "ping") return result(id, {});
  if (method === "tools/list") return result(id, { tools: TOOLS });
  if (method === "tools/call") {
    const reply = await callTool(queue, params?.name, params?.arguments || {});
    return reply ? result(id, reply) : failure(id, -32602, `Unknown tool: ${params?.name}`);
  }
  return failure(id, -32601, `Method not found: ${method}`);
};
