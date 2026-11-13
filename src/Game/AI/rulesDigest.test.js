/*! Open Historia — tests for a scenario's rules in short © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/rulesDigest.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    DIGEST_MAX_CHARS,
    DIGEST_TASKS,
    MIN_RULES_CHARS,
    RULES_DIGEST_KEY,
    buildDigestRequest,
    createRulesDigestMemory,
    digestIsDue,
    readDigestAnswer,
    rulesFingerprint,
    rulesForTask,
} from "./rulesDigest.js";
import { MAP_SETTING_KEYS } from "../../runtime/mapSettings.js";

const rules = "It is 1989. The Cold War is ending, and nothing here may run ahead of its date. ".repeat(400);
const digest = `It is 1989 and the Cold War is ending. ${"Nothing runs ahead of its date. ".repeat(20)}`.trim();

const fakeStorage = () => {
    const kept = new Map();
    return { kept, getItem: (key) => (kept.has(key) ? kept.get(key) : null), setItem: (key, value) => { kept.set(key, String(value)); } };
};
const memoryWith = (text = digest, of = rules) => {
    const memory = createRulesDigestMemory(fakeStorage());
    memory.set(rulesFingerprint(of), text);
    return memory;
};

test("a text of rules has its own fingerprint, and an edit gives another", () => {
    assert.equal(rulesFingerprint(rules), rulesFingerprint(`${rules}`));
    assert.notEqual(rulesFingerprint(rules), rulesFingerprint(`${rules} `));
    assert.notEqual(rulesFingerprint(rules), rulesFingerprint(rules.replace("1989", "1988")), "the same length, another text");
    assert.match(rulesFingerprint(rules), new RegExp(`^${rules.length}-`));
});

test("the small tasks get the kept digest, and every other task the rules whole", () => {
    const memory = memoryWith();
    for (const taskKey of DIGEST_TASKS) {
        const given = rulesForTask({ taskKey, rules, enabled: true, memory });
        assert.ok(given.endsWith(digest), taskKey);
        assert.match(given, /^\(The scenario's rules in short, for this task\./);
        assert.ok(given.length < rules.length / 10);
    }
    for (const taskKey of ["jumpForward", "autoJumpForward", "interactiveCreation", "interactiveExecutor", "gameMaster", "chatActions", "projects", ""]) {
        assert.equal(rulesForTask({ taskKey, rules, enabled: true, memory }), rules, taskKey || "(no task)");
    }
});

test("with the setting off, short rules, or no digest of exactly these rules, the rules go whole", () => {
    const memory = memoryWith();
    assert.equal(rulesForTask({ taskKey: "goalProgress", rules, enabled: false, memory }), rules);
    const short = rules.slice(0, MIN_RULES_CHARS - 1);
    assert.equal(rulesForTask({ taskKey: "goalProgress", rules: short, enabled: true, memory: memoryWith(digest, short) }), short);
    const edited = `${rules} A new rule.`;
    assert.equal(rulesForTask({ taskKey: "goalProgress", rules: edited, enabled: true, memory }), edited, "a scenario edited since is not given the old digest");
    assert.equal(rulesForTask({ taskKey: "goalProgress", rules, enabled: true, memory: null }), rules);
    assert.equal(rulesForTask(), "");
});

test("a digest is due only for a small task with the setting on, long rules and none kept", () => {
    const none = createRulesDigestMemory(fakeStorage());
    assert.equal(digestIsDue({ taskKey: "spyIntercept", rules, enabled: true, memory: none }), true);
    assert.equal(digestIsDue({ taskKey: "spyIntercept", rules, enabled: true, memory: memoryWith() }), false);
    assert.equal(digestIsDue({ taskKey: "spyIntercept", rules, enabled: false, memory: none }), false);
    assert.equal(digestIsDue({ taskKey: "jumpForward", rules, enabled: true, memory: none }), false, "a skip asks for none");
    assert.equal(digestIsDue({ taskKey: "spyIntercept", rules: "Short rules.", enabled: true, memory: none }), false);
});

test("digests are kept across sessions, a few at a time", () => {
    const storage = fakeStorage();
    const memory = createRulesDigestMemory(storage, { max: 2 });
    memory.set("a", "first");
    memory.set("b", "second");
    memory.set("c", "third");
    assert.equal(memory.get("a"), "", "the oldest went");
    assert.equal(createRulesDigestMemory(storage).get("c"), "third");
    assert.deepEqual(Object.keys(JSON.parse(storage.kept.get(RULES_DIGEST_KEY))), ["b", "c"]);
    memory.set("", "nothing");
    memory.set("d", "   ");
    assert.equal(memory.get("d"), "");
    // Something else under the key, or a storage that refuses: nothing kept, nothing thrown.
    assert.equal(createRulesDigestMemory({ getItem: () => "[1,2]", setItem: () => {} }).get("a"), "");
    const refusing = createRulesDigestMemory({ getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } });
    refusing.set("a", "kept for the session");
    assert.equal(refusing.get("a"), "kept for the session");
});

test("the request carries the rules whole and says what a digest keeps", () => {
    const { systemPrompt, userMessage } = buildDigestRequest(rules);
    assert.ok(systemPrompt.includes(rules));
    assert.match(systemPrompt, new RegExp(`at most ${DIGEST_MAX_CHARS} characters`));
    assert.match(systemPrompt, /hard limits/);
    assert.match(systemPrompt, /in the language the rules are written in/);
    assert.equal(userMessage, "Write the digest now.");
});

test("an answer is a digest only if it is one: long enough, much shorter than the rules, cut at a paragraph where it runs over", () => {
    assert.equal(readDigestAnswer(`  ${digest}\r\n`, { rules }), digest);
    assert.equal(readDigestAnswer("I cannot do that.", { rules }), "");
    assert.equal(readDigestAnswer(rules.slice(0, rules.length / 2 + 10), { rules }), "", "no shorter than half the rules");
    assert.equal(readDigestAnswer(null), "");
    const long = `${"A paragraph of the digest. ".repeat(150).trim()}\n${"Another paragraph. ".repeat(200).trim()}`;
    const cut = readDigestAnswer(long, { rules: long.repeat(3) });
    assert.ok(cut.length <= DIGEST_MAX_CHARS);
    assert.equal(cut, "A paragraph of the digest. ".repeat(150).trim(), "ends where a paragraph ends");
    const unbroken = "word ".repeat(2000).trim();
    assert.equal(readDigestAnswer(unbroken, { rules: unbroken.repeat(3) }).length <= DIGEST_MAX_CHARS, true);
});

// ---- The wiring, read as source ---------------------------------------------------

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const prompts = JSON.parse(readFileSync(new URL("./defaultPrompts.json", import.meta.url), "utf8"));

test("the setting is off unless switched on, and the rules are swapped where a task's variables are built", () => {
    assert.equal(MAP_SETTING_KEYS.rulesDigest, "ai_rules_digest");
    const from = gameplay.indexOf("const buildTemplateVariables = async");
    const build = gameplay.slice(from, gameplay.indexOf("canonicalWarContext", from));
    assert.match(build, /enabled: getMapSetting\(MAP_SETTING_KEYS\.rulesDigest\), memory: rulesDigests \};/);
    assert.ok(build.indexOf("if (digestIsDue(digestOf)) scheduleRulesDigest(variables.simulationRules);") < build.indexOf("variables.simulationRules = rulesForTask(digestOf);"));
    // Written in the background, once in a session for a text of rules.
    const schedule = gameplay.slice(gameplay.indexOf("const scheduleRulesDigest = "), gameplay.indexOf("const buildTemplateVariables = async"));
    assert.match(schedule, /if \(digestsAsked\.has\(fingerprint\)\) return;/);
    assert.match(schedule, /requestKind: BACKGROUND_REQUEST,/);
});

test("each of the small tasks is a task whose template carries the rules", () => {
    for (const taskKey of DIGEST_TASKS) {
        assert.match(String(prompts.tasks[taskKey]), /HISTORICAL_PRESET_SIMULATION_RULES|simulationRules/, taskKey);
    }
});
