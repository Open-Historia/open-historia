import test from "node:test";
import assert from "node:assert/strict";
import { GAME_FLAG_LIMIT, gameFlagChoices } from "./gameFlagChoices.js";

test("each image is listed once, with every name that uses it", () => {
    const { choices, stored } = gameFlagChoices({
        France: "data:image/png;base64,AAA",
        "Vichy France": "data:image/png;base64,AAA",
        Germany: "data:image/png;base64,BBB",
        Empty: "",
    });
    assert.equal(stored, 2);
    assert.deepEqual(choices.map((choice) => [choice.label, choice.names]), [
        ["France", ["France", "Vichy France"]],
        ["Germany", ["Germany"]],
    ]);
});

test("a search finds a shared flag by any polity's name, and labels it with that name", () => {
    const { choices, stored } = gameFlagChoices({
        France: "data:image/png;base64,AAA",
        "Vichy France": "data:image/png;base64,AAA",
        Germany: "data:image/png;base64,BBB",
    }, "  VICHY ");
    assert.equal(stored, 2);
    assert.deepEqual(choices.map((choice) => [choice.imageUrl, choice.label]), [["data:image/png;base64,AAA", "Vichy France"]]);
});

test("the search runs over the whole store, not the first GAME_FLAG_LIMIT images", () => {
    const flags = {};
    for (let index = 0; index < GAME_FLAG_LIMIT + 30; index += 1) flags[`Polity ${index}`] = `data:image/png;base64,${index}`;
    flags["Last Kingdom"] = "data:image/png;base64,last";
    const all = gameFlagChoices(flags);
    assert.equal(all.choices.length, GAME_FLAG_LIMIT + 31);
    assert.equal(all.stored, GAME_FLAG_LIMIT + 31);
    const found = gameFlagChoices(flags, "last kingdom");
    assert.deepEqual(found.choices.map((choice) => choice.label), ["Last Kingdom"]);
});

test("no store and no match both come back empty", () => {
    assert.deepEqual(gameFlagChoices(null), { choices: [], stored: 0 });
    assert.deepEqual(gameFlagChoices({ France: "x" }, "prussia"), { choices: [], stored: 1 });
});
