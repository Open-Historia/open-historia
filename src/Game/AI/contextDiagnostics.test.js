/*! Open Historia — portions (prompt fingerprint tests) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The prompt fingerprint: what Detailed logging records about each AI attempt in
// place of the prompt itself.
//
// Run: node --test src/Game/AI/contextDiagnostics.test.js
//
// A maintainer rebuilds a prompt from the player's save and compares fingerprints;
// a mismatch has to point at the one section that differed, and the fingerprint
// itself must never carry campaign text.
import test from "node:test";
import assert from "node:assert/strict";
import { buildPromptFingerprint } from "./contextDiagnostics.js";

const attempt = (overrides = {}) => ({
    promptTemplate: "You are the world. {{regionCatalog}} {{statSheets}}",
    variables: {
        regionCatalog: "Alsace belongs to the Kingdom of Aurelia; Lorraine to the Republic of Vell.",
        statSheets: { Aurelia: { gdp: 412 }, Vell: { gdp: 388 } },
        playerCountry: "Aurelia",
    },
    userMessage: "Simulate 1914-06-01 to 1914-07-01.",
    history: [{ role: "user", parts: [{ text: "Earlier turn about the Treaty of Kessel." }] }],
    systemPrompt: "You are the world. Alsace belongs to the Kingdom of Aurelia; Lorraine to the Republic of Vell. {\"Aurelia\":{\"gdp\":412}}",
    ...overrides,
});

const sectionHash = (fingerprint, key) => fingerprint.sections.find((section) => section.key === key)?.hash;

test("the same prompt always gives the same fingerprint", () => {
    assert.deepEqual(buildPromptFingerprint(attempt()), buildPromptFingerprint(attempt()));
});

test("a changed section changes that section's hash and the whole prompt's, and nothing else", () => {
    const before = buildPromptFingerprint(attempt());
    const changed = attempt();
    changed.variables = { ...changed.variables, regionCatalog: "Alsace belongs to the Republic of Vell." };
    changed.systemPrompt = changed.systemPrompt.replace("Kingdom of Aurelia", "Republic of Vell");
    const after = buildPromptFingerprint(changed);

    assert.notEqual(sectionHash(after, "regionCatalog"), sectionHash(before, "regionCatalog"));
    assert.notEqual(after.prompt.hash, before.prompt.hash);
    assert.equal(sectionHash(after, "statSheets"), sectionHash(before, "statSheets"));
    assert.equal(sectionHash(after, "playerCountry"), sectionHash(before, "playerCountry"));
    assert.deepEqual(after.template, before.template);
    assert.deepEqual(after.instruction, before.instruction);
    assert.deepEqual(after.history, before.history);
});

test("sizes are the real sizes of what was sent", () => {
    const fingerprint = buildPromptFingerprint(attempt());
    assert.equal(fingerprint.prompt.chars, attempt().systemPrompt.length);
    assert.equal(fingerprint.instruction.chars, "Simulate 1914-06-01 to 1914-07-01.".length);
    assert.equal(fingerprint.history.messages, 1);
    assert.equal(sectionHash(fingerprint, "playerCountry") !== undefined, true);
    assert.equal(fingerprint.sections.find((section) => section.key === "playerCountry").chars, "Aurelia".length);
});

test("the fingerprint carries none of the prompt's text", () => {
    const text = JSON.stringify(buildPromptFingerprint(attempt()));
    for (const campaignText of ["Alsace", "Kingdom of Aurelia", "Vell", "Simulate 1914", "Treaty of Kessel", "gdp", "You are the world"]) {
        assert.equal(text.includes(campaignText), false, campaignText);
    }
});

test("a jump-sized prompt's fingerprint fits in one Detailed log entry", () => {
    const variables = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`section${index}WithALongishName`, "x".repeat(6000 + index)]));
    const fingerprint = buildPromptFingerprint(attempt({ variables, systemPrompt: "y".repeat(500_000) }));
    assert.ok(JSON.stringify(fingerprint).length < 20_000, `${JSON.stringify(fingerprint).length} chars`);
});

test("the fingerprint measures the prompt as sent, by section, and the output function", () => {
    const systemPrompt = [
        "We are making a game.",
        "[Your Role]",
        "You play the world.",
        "[Wars]",
        "War of the Kessel Gap: Aurelia v Vell.",
        "[24 June 1914] Aurelia: a chat line, not a section.",
        "[Kingdom of Aurelia]",
        "Lore a scenario wrote under its own heading.",
    ].join("\n");
    const fingerprint = buildPromptFingerprint(attempt({
        promptTemplate: "We are making a game.\n[Your Role]\nYou play the world.\n${JUMP_LIVE_STATE}",
        systemPrompt,
        tool: { name: "submit_jump", schema: { type: "object", properties: { events: { type: "array" } } } },
        staticPrefixEnd: 40,
    }));
    assert.deepEqual(fingerprint.rendered.map((section) => section.name), ["(opening)", "Your Role", "Wars", "(campaign section)"]);
    assert.equal(fingerprint.rendered.reduce((sum, section) => sum + section.chars, 0), systemPrompt.length - 3);
    assert.equal(fingerprint.tool.name, "submit_jump");
    assert.equal(fingerprint.tool.schema.chars, JSON.stringify({ type: "object", properties: { events: { type: "array" } } }).length);
    assert.equal(fingerprint.cacheablePrefixChars, 40);
    const text = JSON.stringify(fingerprint);
    for (const campaignText of ["Kessel", "Kingdom of Aurelia", "chat line"]) assert.equal(text.includes(campaignText), false, campaignText);
});

test("a record the builders read is not measured as JSON nobody sends", () => {
    const fingerprint = buildPromptFingerprint(attempt());
    const statSheets = fingerprint.sections.find((section) => section.key === "statSheets");
    assert.deepEqual(statSheets, { key: "statSheets", record: true });
});
