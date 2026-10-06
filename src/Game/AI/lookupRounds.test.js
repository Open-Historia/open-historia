/*! Open Historia — the lookup rounds of one AI call: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/lookupRounds.test.js
//
// The loop is driven with a scripted model: each turn of the script is what one
// provider request comes back with. What is counted is REQUESTS, because that is
// what a lookup round costs the player (the whole prompt goes out again).
//
// From a player's log, a small local model asking the board the same thing
// three rounds running:
//   task "projects": lookup round 1: list_projects(owner="Russia", status="all").
//   task "projects": lookup round 2: list_projects(owner="Russia", status="all").
//   task "projects": lookup round 3: list_projects(owner="Russia", status="all").
//   task "projects": answered after 3 lookup rounds.
// Four requests where two rounds told it nothing new.

import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_LOOKUP_ROUNDS, runWithLookups } from "./lookupRounds.js";
import { lookupCallKey, repeatedLookupAnswer } from "./toolTurns.js";

const TOOLS = [
    { name: "list_projects", description: "the board", schema: { type: "object" } },
    { name: "list_powers", description: "the powers", schema: { type: "object" } },
    { name: "list_regions", description: "a power's regions", schema: { type: "object" } },
];

let callId = 0;
const call = (name, args = {}) => ({ id: `call_${(callId += 1)}`, name, args });
const asks = (...calls) => ({ rawText: "", toolInput: null, lookupCalls: calls });
const answers = (input = { projectOps: [] }) => ({ rawText: "", toolInput: input });

// A model that says each scripted turn in order, and its last turn for ever
// after; and the campaign that answers its lookups.
const play = async (script, { maxRounds, execute, onRound } = {}) => {
    const requests = [];
    const ran = [];
    const dispatch = async (conversation, options) => {
        requests.push({ conversation, ...options });
        return script[Math.min(requests.length - 1, script.length - 1)];
    };
    const lookups = {
        tools: TOOLS,
        ...(maxRounds === undefined ? {} : { maxRounds }),
        execute: execute ?? (async (name, args) => {
            ran.push(`${name}(${JSON.stringify(args)})`);
            return { rows: [`${name} result`] };
        }),
    };
    const result = await runWithLookups(lookups, [{ role: "user", parts: [{ text: "Update the board." }] }], dispatch, {
        label: 'task "projects"', provider: "openai-compatible", outputTool: "submit_project_ops", onRound,
    });
    return { result, requests, ran };
};

// What the model was shown in answer to each call of the newest round.
const lastAnswers = (request) => request.conversation.at(-1).parts.map((part) => part.functionResponse.response);

test("a lookup asked again with the same arguments is not run again, and the next request may only answer", async () => {
    const board = () => call("list_projects", { owner: "Russia", status: "all" });
    const { result, requests, ran } = await play([asks(board()), asks(board()), answers()]);

    assert.deepEqual(ran, ['list_projects({"owner":"Russia","status":"all"})'], "run once");
    assert.deepEqual(requests.map((request) => request.requireOutputTool), [false, false, true],
        "after the repeat, only the output function is offered");
    assert.deepEqual(result.toolInput, { projectOps: [] });

    // The repeat was answered, with where the result is and what to do now.
    const [told] = lastAnswers(requests[2]);
    assert.equal(told.repeated, true);
    assert.match(told.note, /already made this exact call/);
    assert.match(told.note, /Call submit_project_ops now/);
    // The first answer is still in the conversation for it to use.
    assert.deepEqual(requests[2].conversation.at(-3).parts[0].functionResponse.response, { rows: ["list_projects result"] });
});

test("the round cannot be spent a third time: the log's four requests are three", async () => {
    // The model from the log: it asks the same thing whatever it is told.
    const stuck = asks(call("list_projects", { owner: "Russia", status: "all" }));
    const { result, requests, ran } = await play([stuck]);
    assert.equal(requests.length, 3, "ask, ask again, then the request that may only answer");
    assert.equal(ran.length, 1);
    assert.equal(requests.at(-1).requireOutputTool, true);
    // It still did not answer: handed back as before, for the task runner's own retry.
    assert.equal(result.toolInput, null);
});

test("a model that never repeats itself keeps every round it had", async () => {
    const { requests, ran } = await play([
        asks(call("list_powers", { query: "" })),
        asks(call("list_regions", { owner: "Russian Federation" })),
        asks(call("list_projects", { owner: "Russian Federation" })),
        answers(),
    ]);
    assert.equal(DEFAULT_LOOKUP_ROUNDS, 3);
    assert.deepEqual(requests.map((request) => request.requireOutputTool), [false, false, false, true]);
    assert.equal(ran.length, 3);
});

// How many requests the same script cost before repeats were noticed: every
// round is made until the model answers or the budget is spent.
const requestsUnderTheOldRule = (script, maxRounds = DEFAULT_LOOKUP_ROUNDS) => {
    for (let request = 0; ; request += 1) {
        const turn = script[Math.min(request, script.length - 1)];
        if (turn.toolInput || !turn.lookupCalls?.length || request >= maxRounds) return request + 1;
    }
};

test("no request is ever added: with a repeat there are as many or fewer, never more", async () => {
    const board = () => call("list_projects", { owner: "Russia", status: "all" });
    const powers = () => call("list_powers", { query: "" });
    const regions = () => call("list_regions", { owner: "Russian Federation" });
    const scripts = [
        // [script, requests it now costs]
        [[asks(board()), asks(board()), answers()], 3],
        [[asks(board()), asks(powers()), asks(board()), answers()], 4],
        [[asks(board()), asks(powers()), asks(powers()), answers()], 4],
        [[asks(board(), powers()), asks(powers()), answers()], 3],
        [[asks(board()), asks(powers()), asks(regions()), answers()], 4],
        [[asks(board()), answers()], 2],
        [[answers()], 1],
        // Going round for ever from the first round: one request saved.
        [[asks(board())], 3],
        // From the second: the repeat lands on the budget's last round anyway.
        [[asks(board()), asks(powers())], 4],
    ];
    for (const [script, expected] of scripts) {
        const { requests } = await play(script);
        const before = requestsUnderTheOldRule(script);
        assert.equal(requests.length, expected);
        assert.ok(requests.length <= before, `${requests.length} request(s) now, ${before} before`);
    }
    assert.equal(requestsUnderTheOldRule([asks(board())]), 4, "what the log shows: three rounds and the forced answer");
});

test("the order of the arguments does not matter, and different arguments are a different question", async () => {
    const same = await play([
        asks(call("list_regions", { owner: "Russian Federation", limit: 200 })),
        asks(call("list_regions", { limit: 200, owner: "Russian Federation" })),
        answers(),
    ]);
    assert.equal(same.ran.length, 1);
    assert.equal(same.requests[2].requireOutputTool, true);

    // From the same log: the defaults spelled out the second time. The model
    // changed its question, so it is asked and answered.
    const different = await play([
        asks(call("list_regions", { owner: "Russian Federation" })),
        asks(call("list_regions", { owner: "Russian Federation", offset: 0, limit: 200 })),
        answers(),
    ]);
    assert.equal(different.ran.length, 2);
    assert.equal(different.requests[2].requireOutputTool, false);
});

test("a repeat beside a new question: the new one is answered, the repeat is not, and the asking ends", async () => {
    const { requests, ran } = await play([
        asks(call("list_powers", { query: "" })),
        asks(call("list_powers", { query: "" }), call("list_regions", { owner: "Ukraine" })),
        answers(),
    ]);
    assert.deepEqual(ran, ['list_powers({"query":""})', 'list_regions({"owner":"Ukraine"})']);
    const [repeat, fresh] = lastAnswers(requests[2]);
    assert.equal(repeat.repeated, true);
    assert.deepEqual(fresh, { rows: ["list_regions result"] });
    assert.equal(requests[2].requireOutputTool, true);
});

test("the same call twice in one turn is answered twice, as it always was", async () => {
    const { requests, ran } = await play([
        asks(call("list_powers", { query: "" }), call("list_powers", { query: "" })),
        answers(),
    ]);
    assert.equal(ran.length, 2, "a careless model, not one going round in a circle");
    assert.equal(requests[1].requireOutputTool, false);
    assert.equal(lastAnswers(requests[1]).some((answer) => answer.repeated), false);
});

test("a lookup that was answered with an error is still one that was answered", async () => {
    // list_projects(owner="Russia") in the log: an error each time, three times.
    let runs = 0;
    const { requests } = await play([
        asks(call("list_projects", { owner: "Russia", status: "all" })),
        asks(call("list_projects", { owner: "Russia", status: "all" })),
        answers(),
    ], { execute: async () => { runs += 1; throw new Error('No power is named "Russia". Did you mean "Russian Federation"?'); } });
    assert.equal(runs, 1);
    assert.match(requests[1].conversation.at(-1).parts[0].functionResponse.response.error, /Did you mean/);
    assert.equal(lastAnswers(requests[2])[0].repeated, true);
});

test("each round is reported, with which calls were repeats, and an observer that throws costs nothing", async () => {
    const rounds = [];
    const board = () => call("list_projects", { owner: "Russia", status: "all" });
    const { result } = await play([asks(board()), asks(board()), answers()], {
        onRound: (round) => { rounds.push(round); throw new Error("observer exploded"); },
    });
    assert.deepEqual(rounds.map((round) => [round.round, round.calls.map((entry) => entry.repeat)]), [[1, [false]], [2, [true]]]);
    assert.equal(rounds[1].calls[0].error, false, "a repeat is not counted as a failed lookup");
    assert.deepEqual(result.toolInput, { projectOps: [] });
});

test("a task with no lookups makes its one request, untouched", async () => {
    const requests = [];
    const dispatch = async (conversation, options) => { requests.push(options); return answers(); };
    await runWithLookups(null, [], dispatch, { label: "x", provider: "gemini" });
    await runWithLookups({ tools: [], execute: async () => ({}) }, [], dispatch, { label: "x", provider: "gemini" });
    assert.deepEqual(requests, [{}, {}]);
});

test("a call's identity is its function and its arguments", () => {
    assert.equal(lookupCallKey({ name: "list_powers", args: { query: "" } }), lookupCallKey({ id: "other", name: " list_powers ", args: { query: "" } }));
    assert.equal(lookupCallKey({ name: "x", args: { a: 1, b: { d: [1, 2], c: null } } }), lookupCallKey({ name: "x", args: { b: { c: null, d: [1, 2] }, a: 1 } }));
    assert.notEqual(lookupCallKey({ name: "x", args: { a: [1, 2] } }), lookupCallKey({ name: "x", args: { a: [2, 1] } }), "the order of a list is part of the question");
    assert.notEqual(lookupCallKey({ name: "list_powers", args: {} }), lookupCallKey({ name: "list_powers", args: { query: "" } }));
    assert.notEqual(lookupCallKey({ name: "list_powers", args: {} }), lookupCallKey({ name: "list_regions", args: {} }));
    assert.equal(lookupCallKey({ name: "list_powers" }), lookupCallKey({ name: "list_powers", args: {} }), "no arguments at all is the empty object");
});

test("what a repeated lookup is told names the output function, or says it plainly when there is none to name", () => {
    assert.match(repeatedLookupAnswer("submit_jump_result").note, /Call submit_jump_result now with your answer\./);
    assert.match(repeatedLookupAnswer("").note, /Call the output function now/);
    assert.equal(repeatedLookupAnswer("x").repeated, true);
});
