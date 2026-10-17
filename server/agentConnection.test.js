// The Agent queue, played from both sides against the REAL server
// (docs/adr/0008-subscription-agents-answer-through-the-game.md).
//
// The game side is what the browser does: open a skip, queue a request, wait
// for its answer, cancel, finish. The Agent side is what Claude Code, Codex or
// Antigravity CLI does through the game's MCP server, using only what the
// Agent folder tells it: the address and the token in its MCP settings.
//
// Every server here runs against a temporary data folder, never the real one.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, afterEach, describe, test } from "node:test";

const SERVER = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "server.js");

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const waitForServer = async (port, child) => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/server/network`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not start in time");
};

const dataDirs = [];
const children = [];

const newDataDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "oh-agent-test-"));
  dataDirs.push(dir);
  return dir;
};

// A short wait for "anything next?", so a test does not sit for the real 30 s.
const startServer = async (dataDir) => {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, OH_DATA_DIR: dataDir, PORT: String(port), OH_AGENT_WAIT_MS: "400", OH_AGENT_FOLLOW_UP_MS: "300" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume();
  child.stderr.resume();
  children.push(child);
  await waitForServer(port, child);
  return { port, child };
};

// A killed child has a signalCode and no exitCode.
const stopServer = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
};

afterEach(async () => {
  for (const child of children.splice(0)) await stopServer(child);
});

after(() => {
  for (const dir of dataDirs) rmSync(dir, { force: true, recursive: true });
});

// --- the game side, as the browser calls it (same origin) ---
const game = (port) => {
  const call = async (method, route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, ...json };
  };
  return {
    openSkip: (skipId) => call("POST", "/api/agent/skips", { skipId }),
    finishSkip: (skipId) => call("DELETE", `/api/agent/skips/${encodeURIComponent(skipId)}`),
    ask: (skipId, task, prompt, lookupTools) => call("POST", "/api/agent/requests", { ...(skipId ? { skipId } : {}), task, system: "You write history.", prompt, ...(lookupTools ? { lookupTools } : {}) }),
    answerLookup: (id, callId, result) => call("POST", `/api/agent/requests/${encodeURIComponent(id)}/lookups/${encodeURIComponent(callId)}`, { result }),
    poll: (id, waitMs = 0) => call("GET", `/api/agent/requests/${encodeURIComponent(id)}?waitMs=${waitMs}`),
    cancel: (id) => call("DELETE", `/api/agent/requests/${encodeURIComponent(id)}`),
    folder: () => call("GET", "/api/agent/folder"),
  };
};

// --- the Agent side: only what the Agent folder's MCP settings say ---
const mcpSettings = (dataDir) => {
  const settings = JSON.parse(readFileSync(path.join(dataDir, "agent", ".mcp.json"), "utf8"));
  return settings.mcpServers["open-historia"];
};

const agent = (server) => {
  let nextId = 1;
  const rpc = async (method, params) => {
    const response = await fetch(server.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...server.headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, ...json };
  };
  const tool = async (name, args = {}) => {
    const reply = await rpc("tools/call", { name, arguments: args });
    if (reply.error) return { refused: reply.error.message, status: reply.status };
    if (reply.result?.isError) return { refused: reply.result.content?.[0]?.text, status: reply.status };
    return JSON.parse(reply.result.content[0].text);
  };
  return { rpc, tool };
};

describe("Agent folder", () => {
  test("is written at start with the current address and a token, and gets a new token on the next start", async () => {
    const dataDir = newDataDir();
    const first = await startServer(dataDir);
    const folder = path.join(dataDir, "agent");

    assert.ok(existsSync(path.join(folder, "AGENTS.md")), "AGENTS.md");
    assert.match(readFileSync(path.join(folder, "CLAUDE.md"), "utf8"), /@AGENTS\.md/);
    assert.ok(existsSync(path.join(folder, ".claude", "skills", "skip", "SKILL.md")), "the /skip skill");
    // Until the player picks models for Open Historia, both sub-agents inherit
    // the player's own model and effort: the definitions set neither.
    for (const name of ["skip-writer", "skip-quick", "chat-writer"]) {
      const subAgent = readFileSync(path.join(folder, ".claude", "agents", `${name}.md`), "utf8");
      assert.doesNotMatch(subAgent, /^model:/m, name);
      assert.doesNotMatch(subAgent, /^effort:/m, name);
    }

    const firstServer = mcpSettings(dataDir);
    assert.equal(firstServer.url, `http://127.0.0.1:${first.port}/api/agent/mcp`);
    const firstToken = firstServer.headers.Authorization;
    assert.match(firstToken, /^Bearer [A-Za-z0-9_-]{32,}$/);

    const reported = await game(first.port).folder();
    assert.equal(path.resolve(reported.path), path.resolve(folder));

    await stopServer(first.child);
    const second = await startServer(dataDir);
    const secondServer = mcpSettings(dataDir);
    assert.equal(secondServer.url, `http://127.0.0.1:${second.port}/api/agent/mcp`);
    assert.notEqual(secondServer.headers.Authorization, firstToken);
  });

  test("the models the player picked for Open Historia go into the sub-agents, and the game never overwrites the choice", async () => {
    const dataDir = newDataDir();
    const folder = path.join(dataDir, "agent");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "models.json"), JSON.stringify({ writer: "sonnet", quick: "haiku" }));

    await startServer(dataDir);
    assert.match(readFileSync(path.join(folder, ".claude", "agents", "skip-writer.md"), "utf8"), /^model: sonnet$/m);
    assert.match(readFileSync(path.join(folder, ".claude", "agents", "skip-quick.md"), "utf8"), /^model: haiku$/m);
    assert.match(readFileSync(path.join(folder, ".claude", "agents", "chat-writer.md"), "utf8"), /^model: haiku$/m, "chat replies use the quick model unless named");
    assert.deepEqual(JSON.parse(readFileSync(path.join(folder, "models.json"), "utf8")), { writer: "sonnet", quick: "haiku" });
  });

  test("models picked while the game runs reach the sub-agents on the Agent's next call", async () => {
    const dataDir = newDataDir();
    await startServer(dataDir);
    const folder = path.join(dataDir, "agent");
    writeFileSync(path.join(folder, "models.json"), JSON.stringify({ writer: "opus", quick: "haiku" }));
    await agent(mcpSettings(dataDir)).tool("list_requests");
    assert.match(readFileSync(path.join(folder, ".claude", "agents", "skip-writer.md"), "utf8"), /^model: opus$/m);
    assert.match(readFileSync(path.join(folder, ".claude", "agents", "skip-quick.md"), "utf8"), /^model: haiku$/m);
  });

  test("a models file caught half written leaves the sub-agents as they were", async () => {
    const dataDir = newDataDir();
    const folder = path.join(dataDir, "agent");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "models.json"), JSON.stringify({ writer: "opus[1m]", quick: "haiku" }));
    await startServer(dataDir);
    assert.match(readFileSync(path.join(folder, ".claude", "agents", "skip-writer.md"), "utf8"), /^model: opus\[1m\]$/m);
    writeFileSync(path.join(folder, "models.json"), '{ "writer": "son');
    await agent(mcpSettings(dataDir)).tool("list_requests");
    assert.match(readFileSync(path.join(folder, ".claude", "agents", "skip-writer.md"), "utf8"), /^model: opus\[1m\]$/m);
  });

  test("a model name that is not a plain name is ignored", async () => {
    const dataDir = newDataDir();
    const folder = path.join(dataDir, "agent");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "models.json"), JSON.stringify({ writer: "sonnet\ntools: Bash", quick: 7 }));
    await startServer(dataDir);
    for (const name of ["skip-writer", "skip-quick"]) {
      const subAgent = readFileSync(path.join(folder, ".claude", "agents", `${name}.md`), "utf8");
      assert.doesNotMatch(subAgent, /^model:/m, name);
      assert.doesNotMatch(subAgent, /Bash/, name);
    }
  });

  test("leftover prompt files are deleted at start", async () => {
    const dataDir = newDataDir();
    const stale = path.join(dataDir, "agent", "requests", "old-request");
    mkdirSync(stale, { recursive: true });
    writeFileSync(path.join(stale, "prompt.md"), "an old campaign's prompt");

    await startServer(dataDir);
    assert.equal(existsSync(stale), false);
  });
});

describe("Agent MCP server", () => {
  test("refuses a call without the token, or with an old one", async () => {
    const dataDir = newDataDir();
    const first = await startServer(dataDir);
    const oldServer = mcpSettings(dataDir);
    await stopServer(first.child);
    const second = await startServer(dataDir);

    const noToken = await agent({ url: `http://127.0.0.1:${second.port}/api/agent/mcp`, headers: {} }).rpc("tools/list", {});
    assert.equal(noToken.status, 401);
    const oldToken = await agent({ url: `http://127.0.0.1:${second.port}/api/agent/mcp`, headers: oldServer.headers }).rpc("tools/list", {});
    assert.equal(oldToken.status, 401);

    const current = await agent(mcpSettings(dataDir)).rpc("tools/list", {});
    assert.equal(current.status, 200);
    assert.deepEqual(current.result.tools.map((entry) => entry.name).sort(), ["answer_request", "list_requests", "lookup", "read_request"]);
  });

  test("speaks the MCP handshake", async () => {
    const dataDir = newDataDir();
    await startServer(dataDir);
    const client = agent(mcpSettings(dataDir));
    const hello = await client.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.equal(hello.status, 200);
    assert.equal(hello.result.serverInfo.name, "open-historia");
    assert.ok(hello.result.capabilities.tools);
  });

  test("with no skip open, says no time skip is pending and does not wait", async () => {
    const dataDir = newDataDir();
    await startServer(dataDir);
    const startedAt = Date.now();
    const listed = await agent(mcpSettings(dataDir)).tool("list_requests");
    assert.equal(listed.status, "idle");
    assert.equal(listed.message, "Nothing is waiting.");
    assert.ok(Date.now() - startedAt < 300, "an idle list must answer at once");
  });

  test("list, read and answer: the game gets the answer exactly as sent, and the prompt file is gone", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    const client = agent(mcpSettings(dataDir));

    await side.openSkip("skip-1");
    const asked = await side.ask("skip-1", "jump", "What happens next in 1914?");
    assert.equal(asked.status, 200);
    assert.equal((await side.poll(asked.id)).state, "waiting");

    const listed = await client.tool("list_requests");
    assert.equal(listed.status, "waiting");
    assert.deepEqual(listed.requests.map((entry) => [entry.id, entry.task, entry.role, entry.subagent]), [[asked.id, "jump", "writer", "skip-writer"]]);

    const read = await client.tool("read_request", { id: asked.id });
    assert.ok(path.resolve(read.promptFile).startsWith(path.resolve(dataDir, "agent")));
    const prompt = readFileSync(read.promptFile, "utf8");
    assert.match(prompt, /You write history\./);
    assert.match(prompt, /What happens next in 1914\?/);

    const answer = '{"events":[{"title":"The guns of August"}]}';
    assert.equal((await client.tool("answer_request", { id: asked.id, text: answer })).ok, true);

    const polled = await side.poll(asked.id);
    assert.equal(polled.state, "answered");
    assert.equal(polled.answer, answer);
    assert.match((await client.tool("read_request", { id: asked.id })).refused ?? "", /not waiting/);
    assert.equal(existsSync(read.promptFile), false);

    // A second answer to the same request is refused.
    assert.ok((await client.tool("answer_request", { id: asked.id, text: "again" })).refused);
  });

  test("an answer may be left in the request's answer file instead of sent in the call", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    const client = agent(mcpSettings(dataDir));

    await side.openSkip("skip-1");
    const asked = await side.ask("skip-1", "review", "Review the turn.");
    const read = await client.tool("read_request", { id: asked.id });
    writeFileSync(read.answerFile, "{\"ok\":true}");
    assert.equal((await client.tool("answer_request", { id: asked.id })).ok, true);
    assert.equal((await side.poll(asked.id)).answer, "{\"ok\":true}");
  });

  test("the game waits for an answer that has not come yet", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    const client = agent(mcpSettings(dataDir));

    await side.openSkip("skip-1");
    const asked = await side.ask("skip-1", "jump", "Go.");
    const waiting = side.poll(asked.id, 5000);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await client.tool("answer_request", { id: asked.id, text: "done" });
    const polled = await waiting;
    assert.equal(polled.state, "answered");
    assert.equal(polled.answer, "done");
  });

  test("cancel: the game's wait ends as cancelled, the file is gone, and a later answer is refused", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    const client = agent(mcpSettings(dataDir));

    await side.openSkip("skip-1");
    const asked = await side.ask("skip-1", "jump", "Go.");
    const read = await client.tool("read_request", { id: asked.id });
    const waiting = side.poll(asked.id, 5000);
    await side.cancel(asked.id);

    assert.equal((await waiting).state, "cancelled");
    assert.equal(existsSync(read.promptFile), false);
    assert.ok((await client.tool("answer_request", { id: asked.id, text: "late" })).refused);
  });

  test("while the skip runs, list waits for the game's next request, then reports idle once the skip is finished", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    const client = agent(mcpSettings(dataDir));

    await side.openSkip("skip-1");
    const jump = await side.ask("skip-1", "jump", "Go.");
    await client.tool("answer_request", { id: jump.id, text: "jumped" });

    // Nothing waiting, but the skip is still open: "still running, ask again".
    const running = await client.tool("list_requests");
    assert.equal(running.status, "running");

    // A request queued while the Agent is asking reaches it in that same call.
    const asking = client.tool("list_requests");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const review = await side.ask("skip-1", "review", "Review.");
    const listed = await asking;
    assert.equal(listed.status, "waiting");
    assert.deepEqual(listed.requests.map((entry) => [entry.id, entry.role, entry.subagent]), [[review.id, "quick", "skip-quick"]]);
    await client.tool("answer_request", { id: review.id, text: "reviewed" });

    await side.finishSkip("skip-1");
    const done = await client.tool("list_requests");
    assert.equal(done.status, "idle");
    assert.equal(done.message, "Nothing is waiting.");
  });

  test("opening a new skip drops what an earlier one left waiting, as a reload does", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);

    await side.openSkip("skip-1");
    const old = await side.ask("skip-1", "jump", "Go.");
    await side.openSkip("skip-2");
    assert.equal((await side.poll(old.id)).state, "cancelled");
  });

  test("a lookup the Agent asks reaches the game while it waits, and the game's answer goes back to the Agent", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    const client = agent(mcpSettings(dataDir));
    const neighbours = { name: "region_neighbours", description: "The regions next to a region.", schema: { type: "object", properties: { region: { type: "string" } } } };

    await side.openSkip("skip-1");
    const asked = await side.ask("skip-1", "jump", "Go.", [neighbours]);
    const read = await client.tool("read_request", { id: asked.id });
    assert.deepEqual(read.lookups.map((entry) => entry.name), ["region_neighbours"]);

    // The game is waiting on its answer when the Agent asks.
    const waiting = side.poll(asked.id, 5000);
    const looking = client.tool("lookup", { id: asked.id, name: "region_neighbours", arguments: { region: "Alsace" } });
    const polled = await waiting;
    assert.equal(polled.state, "waiting");
    assert.equal(polled.lookups.length, 1);
    const [question] = polled.lookups;
    assert.equal(question.name, "region_neighbours");
    assert.deepEqual(question.args, { region: "Alsace" });

    await side.answerLookup(asked.id, question.callId, { neighbours: ["Lorraine", "Baden"] });
    assert.deepEqual(await looking, { neighbours: ["Lorraine", "Baden"] });

    // A question is handed to the game once.
    assert.deepEqual((await side.poll(asked.id)).lookups ?? [], []);
  });

  test("a lookup the game has taken is held until it answers, however long that is", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    const client = agent(mcpSettings(dataDir));

    await side.openSkip("skip-1");
    const asked = await side.ask("skip-1", "jump", "Go.", [{ name: "order_troops", description: "", schema: { type: "object" } }]);
    const looking = client.tool("lookup", { id: asked.id, name: "order_troops", arguments: {} });
    const [question] = (await side.poll(asked.id, 5000)).lookups;
    // Longer than the server's wait (OH_AGENT_WAIT_MS is 400 here).
    await new Promise((resolve) => setTimeout(resolve, 900));
    await side.answerLookup(asked.id, question.callId, { account: "the war, fought again" });
    assert.deepEqual(await looking, { account: "the war, fought again" });
  });

  test("a lookup the request did not offer, or on a request that is not waiting, is refused", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    const client = agent(mcpSettings(dataDir));

    await side.openSkip("skip-1");
    const asked = await side.ask("skip-1", "jump", "Go.");
    assert.ok((await client.tool("lookup", { id: asked.id, name: "region_neighbours", arguments: {} })).refused);
    await side.cancel(asked.id);
    assert.ok((await client.tool("lookup", { id: asked.id, name: "region_neighbours", arguments: {} })).refused);
  });

  test("a lookup the game does not answer in time tells the Agent to ask again", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    const client = agent(mcpSettings(dataDir));

    await side.openSkip("skip-1");
    const asked = await side.ask("skip-1", "jump", "Go.", [{ name: "region_neighbours", description: "", schema: { type: "object" } }]);
    const looked = await client.tool("lookup", { id: asked.id, name: "region_neighbours", arguments: {} });
    assert.ok(looked.refused);
    assert.match(looked.refused, /again/);
  });

  test("a chat the player started is queued without a skip, listed oldest first, and listing does not wait", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    const client = agent(mcpSettings(dataDir));

    const first = await side.ask(null, "diplomacy", "France writes back.");
    const second = await side.ask(null, "advisor", "The advisor answers.");
    const startedAt = Date.now();
    const listed = await client.tool("list_requests");
    assert.ok(Date.now() - startedAt < 300, "nothing open to wait for: answer at once");
    assert.equal(listed.status, "waiting");
    assert.deepEqual(listed.requests.map((entry) => [entry.id, entry.task, entry.role, entry.subagent]), [
      [first.id, "diplomacy", "chat", "chat-writer"],
      [second.id, "advisor", "chat", "chat-writer"],
    ]);
    await client.tool("answer_request", { id: first.id, text: "Mon ami." });
    assert.equal((await side.poll(first.id)).answer, "Mon ami.");
  });

  test("after an answer, /answer waits briefly for its follow-up, then stops", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    const client = agent(mcpSettings(dataDir));

    const reply = await side.ask(null, "diplomacy", "France writes back.");
    await client.tool("answer_request", { id: reply.id, text: "Non." });
    // The demand check on that reply is asked once it has landed.
    const asking = client.tool("list_requests");
    await new Promise((resolve) => setTimeout(resolve, 80));
    const check = await side.ask(null, "diplomacy", "Did France give way?");
    const listed = await asking;
    assert.deepEqual(listed.requests.map((entry) => entry.id), [check.id]);
    await client.tool("answer_request", { id: check.id, text: "{}" });

    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal((await client.tool("list_requests")).status, "idle");
  });

  test("a skip's follow-up arriving after its jump is answered in the same skip, on the quick sub-agent", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    const client = agent(mcpSettings(dataDir));
    await side.openSkip("skip-1");
    const jump = await side.ask("skip-1", "jump", "Go.");
    await client.tool("answer_request", { id: jump.id, text: "{}" });
    const asking = client.tool("list_requests");
    await new Promise((resolve) => setTimeout(resolve, 80));
    const stats = await side.ask("skip-1", "stats", "A first stat sheet.");
    const listed = await asking;
    assert.deepEqual(listed.requests.map((entry) => [entry.id, entry.role]), [[stats.id, "quick"]]);
  });

  test("a skip that finishes leaves the player's waiting chats alone", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    await side.openSkip("skip-1");
    const chat = await side.ask(null, "advisor", "Advise me.");
    await side.finishSkip("skip-1");
    await side.openSkip("skip-2");
    assert.equal((await side.poll(chat.id)).state, "waiting");
  });

  test("a page that loads afresh drops the skip an earlier page left open", async () => {
    const dataDir = newDataDir();
    const { port } = await startServer(dataDir);
    const side = game(port);
    await side.openSkip("skip-1");
    const old = await side.ask("skip-1", "jump", "Go.");
    const oldChat = await side.ask(null, "advisor", "Advise me.");
    const dropped = await fetch(`http://127.0.0.1:${port}/api/agent/skips`, { method: "DELETE", headers: { Origin: `http://127.0.0.1:${port}` } });
    assert.equal(dropped.status, 200);
    assert.equal((await side.poll(old.id)).state, "cancelled");
    assert.equal((await side.poll(oldChat.id)).state, "cancelled", "its chats too");
    assert.equal((await agent(mcpSettings(dataDir)).tool("list_requests")).status, "idle");
  });

  test("a restart drops the queue", async () => {
    const dataDir = newDataDir();
    const first = await startServer(dataDir);
    await game(first.port).openSkip("skip-1");
    const asked = await game(first.port).ask("skip-1", "jump", "Go.");
    await stopServer(first.child);

    const second = await startServer(dataDir);
    assert.equal((await game(second.port).poll(asked.id)).status, 404);
    assert.equal((await agent(mcpSettings(dataDir)).tool("list_requests")).status, "idle");
  });
});
