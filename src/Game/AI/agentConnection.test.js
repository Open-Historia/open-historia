// Run: node --test src/Game/AI/agentConnection.test.js
//
// The browser's side of an Agent Connection (agentConnection.js; ADR 0008): a
// call reaching an Agent entry goes to the local server's Agent queue and waits
// for the player's Agent, with no time limit, until it is answered or cancelled.
// The server is faked here by its routes; server/agentConnection.test.js plays
// the real one.
import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentPrompt, createAgentClient } from "./agentConnection.js";

// A fake of the server's Agent routes: requests wait until the test answers or
// the client cancels.
const fakeServer = () => {
  const requests = new Map();
  const skips = { opened: [], finished: [] };
  const lookupAnswers = [];
  let nextId = 1;
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, { method = "GET", body } = {}) => {
    const route = new URL(url, "http://game.local");
    const parts = route.pathname.split("/").filter(Boolean); // api agent ...
    if (parts[2] === "skips" && method === "POST") {
      const { skipId } = JSON.parse(body);
      skips.opened.push(skipId);
      return json({ skipId });
    }
    if (parts[2] === "skips" && method === "DELETE") {
      skips.finished.push(decodeURIComponent(parts[3]));
      return json({ ok: true });
    }
    if (parts[2] === "requests" && parts.length === 3 && method === "POST") {
      const id = `r${nextId++}`;
      requests.set(id, { ...JSON.parse(body), state: "waiting", polls: 0 });
      return json({ id });
    }
    const request = requests.get(decodeURIComponent(parts[3]));
    if (!request) return json({ error: "gone" }, 404);
    if (parts[4] === "lookups" && method === "POST") {
      lookupAnswers.push({ callId: decodeURIComponent(parts[5]), ...JSON.parse(body) });
      return json({ ok: true });
    }
    if (method === "DELETE") {
      request.state = "cancelled";
      return json({ ok: true });
    }
    request.polls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (request.state === "answered") return json({ state: "answered", answer: request.answer });
    const lookups = (request.asked ?? []).splice(0);
    return json({ state: request.state, ...(lookups.length ? { lookups } : {}) });
  };
  const answer = (id, text) => Object.assign(requests.get(id), { state: "answered", answer: text });
  const ask = (id, lookup) => { const request = requests.get(id); request.asked = [...(request.asked ?? []), lookup]; };
  return { fetch, requests, skips, answer, ask, lookupAnswers };
};

const tool = {
  name: "submit_turn",
  schema: { type: "object", properties: { events: { type: "array", items: { type: "object", properties: { title: { type: "string" } } } } } },
};

const history = [{ role: "user", parts: [{ text: "Skip a year." }] }];

const until = async (check) => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition never held");
};

test("the prompt file carries the system prompt, the conversation and what the answer must look like", () => {
  const { system, prompt } = buildAgentPrompt("You write history.", history, { tool });
  assert.match(system, /You write history\./);
  assert.match(prompt, /Skip a year\./);
  assert.match(prompt, /\[Answer Format\]/);
  assert.match(prompt, /events/);
});

test("a call is queued under the skip, waits for the Agent, and returns its answer as a provider's", async () => {
  const server = fakeServer();
  const client = createAgentClient({ fetch: server.fetch, pollMs: 0 });
  const streamed = [];
  const sent = [];
  const call = client.call("You write history.", history, {
    tool, spender: "jump", taskKey: "jumpForward",
    onToolStream: (part) => streamed.push(part),
    onSend: () => sent.push("sent"),
  });
  await until(() => server.requests.size === 1);
  const [[id, request]] = [...server.requests];
  assert.equal(request.task, "jump");
  assert.equal(request.skipId, server.skips.opened[0], "the skip is opened before its first request");
  assert.equal(sent.length, 1);

  await until(() => request.polls >= 3);
  server.answer(id, '{"events":[{"title":"Peace"}]}');
  const result = await call;
  assert.deepEqual(result, { rawText: '{"events":[{"title":"Peace"}]}', toolInput: null });
  assert.deepEqual(streamed, [{ name: "submit_turn", json: '{"events":[{"title":"Peace"}]}' }], "the Events panel gets the answer's events");
});

test("one skip's requests share the skip, and it is finished when the game is done with it", async () => {
  const server = fakeServer();
  const client = createAgentClient({ fetch: server.fetch, pollMs: 0 });
  const first = client.call("s", history, { spender: "jump" });
  await until(() => server.requests.size === 1);
  server.answer("r1", "{}");
  await first;
  const second = client.call("s", history, { spender: "review" });
  await until(() => server.requests.size === 2);
  server.answer("r2", "{}");
  await second;

  assert.equal(server.skips.opened.length, 1);
  assert.equal(server.requests.get("r2").skipId, server.skips.opened[0]);
  await client.finishSkip();
  assert.deepEqual(server.skips.finished, server.skips.opened);

  // The next skip is a new one.
  const third = client.call("s", history, { spender: "jump" });
  await until(() => server.requests.size === 3);
  server.answer("r3", "{}");
  await third;
  assert.equal(server.skips.opened.length, 2);
  assert.notEqual(server.skips.opened[1], server.skips.opened[0]);
});

test("a cancel while waiting removes the request from the queue and fails the call as a cancel", async () => {
  const server = fakeServer();
  const client = createAgentClient({ fetch: server.fetch, pollMs: 0 });
  const controller = new AbortController();
  const call = client.call("s", history, { spender: "jump", signal: controller.signal });
  await until(() => server.requests.size === 1);
  controller.abort(new DOMException("Timeline jump cancelled.", "AbortError"));
  await assert.rejects(call, (error) => error.name === "AbortError");
  await until(() => server.requests.get("r1").state === "cancelled");
});

test("waiting keeps the call alive for an idle watchdog, and says it is waiting for the Agent", async () => {
  const server = fakeServer();
  const client = createAgentClient({ fetch: server.fetch, pollMs: 0 });
  let activity = 0;
  let waiting = 0;
  const call = client.call("s", history, { spender: "jump", onActivity: () => { activity += 1; }, onAgentWait: () => { waiting += 1; } });
  await until(() => server.requests.size === 1 && server.requests.get("r1").polls >= 3);
  server.answer("r1", "{}");
  await call;
  assert.ok(activity >= 2, "every wait that comes back empty counts as life");
  assert.equal(waiting, 1);
});

test("a request the server no longer holds (it restarted) fails the call and says why", async () => {
  const server = fakeServer();
  const client = createAgentClient({ fetch: server.fetch, pollMs: 0 });
  const call = client.call("s", history, { spender: "jump" });
  await until(() => server.requests.size === 1);
  server.requests.clear();
  await assert.rejects(call, /restarted|no longer/i);
});

test("the lookups a call offers go with the request, and the Agent's lookups are answered by the game while it waits", async () => {
  const server = fakeServer();
  const client = createAgentClient({ fetch: server.fetch, pollMs: 0 });
  const executed = [];
  const lookups = {
    tools: [{ name: "region_neighbours", description: "Next door.", schema: { type: "object" } }],
    execute: async (name, args) => { executed.push([name, args]); return { neighbours: ["Lorraine"] }; },
    onRound: () => { throw new Error("an Agent's lookups are not the skip's requests"); },
  };
  const call = client.call("s", history, { spender: "jump", agentLookups: lookups });
  await until(() => server.requests.size === 1);
  assert.deepEqual(server.requests.get("r1").lookupTools, [{ name: "region_neighbours", description: "Next door.", schema: { type: "object" } }]);

  server.ask("r1", { callId: "c1", name: "region_neighbours", args: { region: "Alsace" } });
  await until(() => server.lookupAnswers.length === 1);
  assert.deepEqual(executed, [["region_neighbours", { region: "Alsace" }]]);
  assert.deepEqual(server.lookupAnswers[0], { callId: "c1", result: { neighbours: ["Lorraine"] } });

  server.answer("r1", "{}");
  await call;
});

test("a lookup that throws answers the Agent with the error, and the wait goes on", async () => {
  const server = fakeServer();
  const client = createAgentClient({ fetch: server.fetch, pollMs: 0 });
  const lookups = { tools: [{ name: "broken", description: "", schema: { type: "object" } }], execute: async () => { throw new Error("no such region"); } };
  const call = client.call("s", history, { spender: "jump", agentLookups: lookups });
  await until(() => server.requests.size === 1);
  server.ask("r1", { callId: "c1", name: "broken", args: {} });
  await until(() => server.lookupAnswers.length === 1);
  assert.deepEqual(server.lookupAnswers[0].result, { error: "no such region" });
  server.answer("r1", "{}");
  await call;
});

test("a chat the player started is queued without opening a skip", async () => {
  const server = fakeServer();
  const client = createAgentClient({ fetch: server.fetch, pollMs: 0 });
  const call = client.call("s", history, { agentKind: "advisor" });
  await until(() => server.requests.size === 1);
  assert.equal(server.skips.opened.length, 0);
  assert.equal(server.requests.get("r1").task, "advisor");
  assert.equal(server.requests.get("r1").skipId, undefined);
  server.answer("r1", "Steady as she goes.");
  assert.equal(await call, "Steady as she goes.", "a chat's reply comes back as its text");
});

test("what is waiting on the Agent is told to the page, by kind", async () => {
  const server = fakeServer();
  const client = createAgentClient({ fetch: server.fetch, pollMs: 0 });
  const seen = [];
  const stop = client.subscribeWaits(() => seen.push(client.waits()));
  const chat = client.call("s", history, { agentKind: "diplomacy" });
  await until(() => client.waits().diplomacy === 1);
  server.answer("r1", "Agreed.");
  await chat;
  assert.equal(client.waits().diplomacy ?? 0, 0);
  assert.ok(seen.length >= 2);
  stop();
});

test("Use API key ends the wait as passed on, not cancelled, and takes the request out of the queue", async () => {
  const server = fakeServer();
  const client = createAgentClient({ fetch: server.fetch, pollMs: 0 });
  const call = client.call("s", history, { agentKind: "advisor" });
  await until(() => client.waits().advisor === 1);
  client.passOn(["advisor"]);
  await assert.rejects(call, (error) => error.providerFailure?.kind === "passedOn" && error.name !== "AbortError");
  await until(() => server.requests.get("r1").state === "cancelled");
});

test("Use API key on a time skip sends the rest of that skip on, until the skip is finished", async () => {
  const server = fakeServer();
  const client = createAgentClient({ fetch: server.fetch, pollMs: 0 });
  const jump = client.call("s", history, { spender: "jump" });
  await until(() => client.waits().skip === 1);
  assert.equal(client.skipPassedOn(), false);
  client.passOn(["skip"]);
  await assert.rejects(jump, (error) => error.providerFailure?.kind === "passedOn");
  assert.equal(client.skipPassedOn(), true, "the review and stats after it go to the key too");
  await client.finishSkip();
  assert.equal(client.skipPassedOn(), false, "the next skip starts on the Agent again");
});

test("a skip is finished only once the follow-ups held for it are done, so /answer answers them too", async () => {
  const server = fakeServer();
  const client = createAgentClient({ fetch: server.fetch, pollMs: 0 });
  const jump = client.call("s", history, { spender: "jump" });
  await until(() => server.requests.size === 1);
  server.answer("r1", "{}");
  await jump;
  let release;
  client.holdSkip(new Promise((resolve) => { release = resolve; }));
  const finishing = client.finishSkip();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(server.skips.finished, [], "held open while its follow-up runs");
  const followUp = client.call("s", history, { agentKind: "skip", spender: "stats" });
  await until(() => server.requests.size === 2);
  assert.equal(server.requests.get("r2").skipId, server.skips.opened[0], "the follow-up joins the same skip");
  server.answer("r2", "{}");
  await followUp;
  release();
  await finishing;
  assert.deepEqual(server.skips.finished, server.skips.opened);
});
