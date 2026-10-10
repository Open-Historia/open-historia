import assert from "node:assert/strict";
import { test } from "node:test";
import { findNarratedCaptures, mayNarrateCapture, statedCapture } from "./narratedCapture.js";

// The built-in map's own names: the region and the city are both "Ar-Raqqa",
// and an event writes "Raqqa".
const RAQQA = ["Ar-Raqqa"];
const states = (text, names = RAQQA) => Boolean(statedCapture(text, names));

test("a stated capture is found, however the sentence is built", () => {
    for (const text of [
        "U.S. Marines captured Raqqa after a week of street fighting.",
        "The I Marine Expeditionary Force captures Raqqa",
        "Marine units seized the city of Raqqa at dawn.",
        "Coalition forces took Raqqa on the third day.",
        "The Marines retook Raqqa.",
        "American troops liberated the Syrian city of Raqqa.",
        "The division overran the Islamic State stronghold of Raqqa.",
        "The Marines take control of Raqqa.",
        "The Marines took full control of the city of Raqqa.",
        "U.S. forces established firm control over Raqqa.",
        "Raqqa falls to the Marines.",
        "Raqqa Falls",
        "Raqqa fell to American forces after nine days.",
        "Raqqa has fallen.",
        "Raqqa was captured by the I Marine Expeditionary Force.",
        "Raqqa has been fully liberated.",
        "The city of Raqqa is taken.",
        "Raqqa comes under the full control of the United States.",
        "Raqqa Liberated by Coalition Forces",
        "Marine forces capture Raqqa.",
        "Ar-Raqqah was captured.",
    ]) {
        assert.equal(states(text), true, text);
    }
});

test("an offensive, an intention, a failure or a claim is no capture", () => {
    for (const text of [
        // The event of the 45-skip test (2026-10-09), which moved the Marines
        // to Raqqa and said only what they had set out to do.
        "I Marine Expeditionary Force Launches Ground Offensive to Secure Raqqa. Executing direct military orders, elements of the United States I Marine Expeditionary Force spearheaded a decisive mechanized and infantry ground assault into the urban outskirts of Raqqa in northern Syria. Supported by precision coalition air cover and local allied SDF detachments, Marine units overran remaining Islamic State defensive trench networks along the city's perimeter. Heavy urban skirmishing ensued around former municipal government complexes as engineering teams cleared improvised explosive devices and secured vital supply routes into the municipal center.",
        "The Marines launched an offensive to capture Raqqa.",
        "The operation, aimed at capturing Raqqa, began on Tuesday.",
        "The Marines will capture Raqqa within the month.",
        "Commanders vowed to take control of Raqqa.",
        "The Marines failed to capture Raqqa.",
        "The Marines have not captured Raqqa.",
        "Damascus claimed its forces captured Raqqa.",
        "The assault on Raqqa continues.",
        "The Marines advanced toward Raqqa and seized two villages.",
        "The Marines captured the outskirts of Raqqa.",
        "The Marines seized most of Raqqa.",
        "The Marines captured Raqqa's airport.",
        "The outskirts of Raqqa were captured.",
        "The Marines captured positions overlooking the city of Raqqa.",
        "Marine engineers secured supply routes into Raqqa.",
        "The capture of Raqqa remains the objective.",
        "If Raqqa falls, the road south lies open.",
        "Raqqa may yet fall.",
        "Refugees streamed out of occupied Raqqa.",
        "Raqqa fell silent after the bombardment.",
        "Capture Raqqa and hold it.",
    ]) {
        assert.equal(states(text), false, text);
    }
});

test("a month is not a modal", () => {
    assert.equal(states("In May the Marines captured Raqqa."), true);
    assert.equal(states("The Marines may have captured Raqqa."), false);
});

test("a region's administrative word and a name's article may be left off", () => {
    assert.equal(states("Russian forces captured Kharkiv.", ["Kharkiv Oblast"]), true);
    assert.equal(states("Iraqi troops retook Anbar.", ["Al-Anbar Governorate"]), true);
    // A name too short to be told from a word is never matched.
    assert.equal(states("They captured Ur.", ["Ur"]), false);
});

test("the cheap check lets through every text a capture could be in", () => {
    assert.equal(mayNarrateCapture("Raqqa falls to the Marines"), true);
    assert.equal(mayNarrateCapture("The Marines take control of Raqqa"), true);
    assert.equal(mayNarrateCapture("A summit opens in Geneva"), false);
});

// The other names the built-in world gives the United States.
const marines = { owner: "United States", aliases: ["United States of America", "USA", "US", "America"], unitName: "I Marine Expeditionary Force" };
const raqqa = { regionId: "2453", regionName: "Ar-Raqqa", names: RAQQA, controller: "Syria", move: marines };
const POWERS = ["United States", "Syria", "Iraq", "Russia", "Turkey", "Syrian Democratic Forces"];
const captures = (title, description, extra = {}) => findNarratedCaptures({ title, description, candidates: [raqqa], powers: POWERS, ...extra });

test("the capture is the mover's, from whoever held the region", () => {
    const found = captures("Marines Capture Raqqa", "After nine days of street fighting the I Marine Expeditionary Force captured Raqqa and raised the flag over its ruined centre.");
    assert.equal(found.length, 1);
    assert.deepEqual(
        { regionId: found[0].regionId, fromCode: found[0].fromCode, toCode: found[0].toCode },
        { regionId: "2453", fromCode: "Syria", toCode: "United States" },
    );
});

test("the event of the 45-skip test moves nothing: it tells of no capture", () => {
    assert.deepEqual(captures(
        "I Marine Expeditionary Force Launches Ground Offensive to Secure Raqqa",
        "Executing direct military orders, elements of the United States I Marine Expeditionary Force spearheaded a decisive mechanized and infantry ground assault into the urban outskirts of Raqqa in northern Syria. Marine units overran remaining Islamic State defensive trench networks along the city's perimeter.",
    ), []);
});

test("a region the mover already holds, or one the event already changed, is left alone", () => {
    const text = ["Marines Capture Raqqa", "The Marines captured Raqqa."];
    assert.deepEqual(findNarratedCaptures({ title: text[0], description: text[1], candidates: [{ ...raqqa, controller: "United States" }], powers: POWERS }), []);
    assert.deepEqual(captures(text[0], text[1], { changed: ["2453"] }), []);
});

test("a capture credited to somebody else is not the mover's", () => {
    // The town its own government won back, with the Marines moving up beside it.
    assert.deepEqual(captures("Syrian Army Retakes Raqqa", "Syrian government troops retook Raqqa while the I Marine Expeditionary Force held the river crossings."), []);
    assert.deepEqual(captures("Raqqa Falls to the Syrian Democratic Forces", "Raqqa fell to the Syrian Democratic Forces, with the Marines in support."), []);
    assert.deepEqual(captures("Raqqa Falls", "Raqqa was captured by Russian paratroopers as the United States looked on."), []);
    // A third power in the sentence, and nobody said to have done it.
    assert.deepEqual(captures("Raqqa Falls", "Raqqa has fallen as Turkish armour closed in. The I Marine Expeditionary Force moved up."), []);
});

test("a capture with nobody named is the mover's when the story has no other side in it", () => {
    const found = captures("Raqqa Falls", "The I Marine Expeditionary Force fought its way into the centre. Raqqa has fallen.");
    assert.equal(found.length, 1);
    assert.equal(found[0].toCode, "United States");
    // "American", for a power whose other name is America.
    assert.equal(captures("Raqqa Falls", "Raqqa fell to American forces.").length, 1);
    // "Marines", for the formation that moved.
    assert.equal(captures("Raqqa Falls", "Raqqa fell to the Marines.").length, 1);
});

test("where it happened is not who did it, and \"U.S.\" ends no sentence", () => {
    // The holder's name stands in the sentence as the place, before a comma.
    assert.equal(captures("Marines Capture Raqqa", "In northern Syria, the Marines captured Raqqa.").length, 1);
    assert.equal(captures("Raqqa Falls to U.S. Marines", "Raqqa fell to U.S. forces after the last positions collapsed.").length, 1);
    // The holder as the one doing it is the holder's own story.
    assert.deepEqual(captures("Raqqa Retaken", "Syrian troops recaptured Raqqa as the Marines watched from the east bank."), []);
});

test("a mover the story never mentions took nothing", () => {
    const stranger = { ...raqqa, move: { owner: "Iraq", aliases: [], unitName: "9th Armoured Division" } };
    assert.deepEqual(findNarratedCaptures({ title: "Raqqa Falls", description: "Raqqa has fallen.", candidates: [stranger], powers: POWERS }), []);
});

test("two powers' formations at one captured place are not chosen between", () => {
    const turks = { ...raqqa, move: { owner: "Turkey", aliases: [], unitName: "2nd Army" } };
    assert.deepEqual(findNarratedCaptures({
        title: "Raqqa Falls",
        description: "United States and Turkish forces captured Raqqa together.",
        candidates: [raqqa, turks],
        powers: POWERS,
    }), []);
});

test("a city stands for the region it is in", () => {
    const viaCity = { regionId: "77", regionName: "Halab", names: ["Aleppo"], controller: "Syria", move: marines };
    const found = findNarratedCaptures({ title: "Aleppo Falls", description: "The Marines captured Aleppo.", candidates: [viaCity], powers: POWERS });
    assert.equal(found.length, 1);
    assert.equal(found[0].regionId, "77");
    assert.equal(found[0].place, "Aleppo");
});
