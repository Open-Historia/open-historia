/*! Open Historia — puppet visibility architecture tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/puppetVisibilityArchitecture.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// THE DRIFT GUARD. Four surfaces answer "is this country a Puppet, and what am
// I allowed to know about it": the country panel, the diplomacy markers, the map
// popup card and the advisor's prompt. Four callers deciding that separately is
// how the game ends up contradicting itself about the player's own empire —
// showing a satellite in the popup that the panel denies, or briefing the
// advisor on a secret the player never discovered.
//
// So: nothing but runtime/puppets.js and the world normalizer may read
// world.puppets directly. This test is what keeps the fifth surface honest when
// somebody adds one later.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const SURFACES = [
    ["the country panel", "../Game/Selection/CountryPanel.jsx"],
    ["the diplomacy markers", "../Game/GameUI/chat.jsx"],
    ["the advisor's own directive", "../Game/AI/main.jsx"],
    ["the map popup card", "../Game/Selection/Regions.jsx"],
];

test("every player-facing surface asks the shared resolver", () => {
    for (const [label, path] of SURFACES) {
        assert.match(
            read(path),
            /from "\.{2}\/\.{2}\/runtime\/puppets\.js"/,
            `${label} must import the shared visibility rule`,
        );
    }
});

test("no player-facing surface reads world.puppets for itself", () => {
    for (const [label, path] of SURFACES) {
        assert.doesNotMatch(
            read(path),
            /\.puppets\b/,
            `${label} must go through visiblePuppetsFor / livePuppetsFor, never the raw ledger`,
        );
    }
});

test("the visibility rule stays import-free so it can be unit tested", () => {
    // Same convention, same reason, as chatVisibility.js and countryTags.js:
    // this decides what one government may know about another, and every module
    // that calls it reaches the whole browser runtime.
    assert.doesNotMatch(read("./puppets.js"), /^\s*import\s/m);
});

test("the off switch sits on the shared resolver, not on the surfaces", () => {
    // The scenario's "Puppet states" feature switches the whole system off. It
    // is gated HERE, on the two roots every surface reads through, for the same
    // reason visibility is: five surfaces each remembering to check a flag is
    // five chances to forget, and the one that forgets shows a player a puppet
    // their scenario said does not exist.
    const puppets = read("./puppets.js");
    assert.match(puppets, /export const setPuppetStatesEnabled/);
    const roots = ["export const visiblePuppetsFor", "export const puppetBriefingFor"];
    for (const root of roots) {
        const body = puppets.slice(puppets.indexOf(root), puppets.indexOf(root) + 400);
        assert.match(body, /if \(!systemEnabled\)/, `${root} must answer empty while the system is off`);
    }
    // And the resolved features must actually reach it, or the switch is dead.
    assert.match(read("./gameFeatures.js"), /setPuppetStatesEnabled\(isFeatureEnabled\(activeFeatures, "puppetStates"\)\)/);
});

test("switching the system off does not erase the ledger", () => {
    // The rows are save data. Nothing in the off path may delete them, or a
    // player who switches the feature off to try it loses a campaign's empire.
    const puppets = read("./puppets.js");
    assert.doesNotMatch(puppets, /puppets\s*=\s*\[\]\s*;/);
    // The world normalizer keeps normalizing them whatever the feature says.
    assert.doesNotMatch(read("./gameState.js"), /puppetStates/);
});

test("Loyalty never reaches a surface as a bare number", () => {
    // A visible score is the threshold players optimise against whether or not
    // the engine enforces one — and nothing in the engine does.
    // The panel and the popup print the shared summary, which speaks in bands.
    const puppets = read("./puppets.js");
    const summary = puppets.slice(puppets.indexOf("export const puppetSummaryFor"));
    assert.match(summary, /loyaltyBand/);
    assert.doesNotMatch(summary, /row\.loyalty\b(?!Band)/);
    for (const path of ["../Game/Selection/CountryPanel.jsx", "../Game/Selection/Regions.jsx"]) {
        assert.match(read(path), /puppetSummaryFor/);
        assert.doesNotMatch(read(path), /row\.loyalty\b(?!Band)/);
    }
});

test("the advisor's puppet section is filtered by the player", () => {
    assert.match(read("../Game/AI/main.jsx"), /buildAdvisorPuppetsDirective\(worldData, gameData\?\.country/);
});

test("the shared world summary carries no subordinations at all", () => {
    // It is read by twelve prompts, the jump and the leader among them, and both
    // of those must see the truth rather than the player's picture. Filtering
    // belongs on the advisor alone.
    const source = read("../Game/AI/promptContext.js");
    assert.doesNotMatch(source, /livePuppetsFor|visiblePuppetsFor|puppetSummary/);
});

test("the simulator reads the whole ledger from the canonical context", () => {
    // The jump is the narrator: it resolves the whole world, so it is given the
    // truth, covert arrangements included.
    const director = read("../Game/AI/nativeDiplomaticDirector.js");
    assert.match(director, /SUBORDINATIONS \(who directs whom\)/);
    assert.doesNotMatch(director, /livePuppetsFor|visiblePuppetsFor/);
});

// This test used to be named "the simulator and chat read the truth", and only
// checked that the ledger CONTAINED the subordinations section — never that the
// chat prompts RECEIVED it. They did not: the section reaches the jump, the idle
// pass and next-speaker, and never the leader or the group turn. So a covert
// Puppet in conversation did not know it was one, and could neither lie about
// it nor mark a refusal of its own Overlord. The assertions below are about the
// prompts themselves, not the ledger.

test("a one-on-one leader is briefed, as its own country knows it", () => {
    const source = read("../Game/AI/main.jsx");
    assert.match(source, /puppetBriefingFor\(worldData, speaker/);
    assert.match(source, /\$\{subordinations \?/, "and the briefing reaches the returned prompt");
});

test("the one-on-one briefing counts the player as present", () => {
    // A chat's countries list only its non-player members. Leave the player out
    // and a covert Puppet talking to them counts nobody as unaware.
    assert.match(read("../Game/AI/main.jsx"), /present: \[\.\.\.countries, playerCountry \|\| gameData\?\.country\]/);
});

test("every AI participant in a group turn is briefed, the player in the room", () => {
    const source = read("../Game/AI/gameplay.js");
    assert.match(source, /puppetBriefingFor\(briefingWorld, speaker, \{ present: inTheRoom \}\)/);
    assert.match(source, /const inTheRoom = \[\.\.\.aiParticipants, player\]/);
    assert.match(source, /\[crossChatKnowledge, subordinationKnowledge\]/, "and it reaches the group prompt");
});
