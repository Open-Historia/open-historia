import test from "node:test";
import assert from "node:assert/strict";

import { buildRealHistoryDirective } from "./futureHistoryBoundary.js";

// A skip through May 2014 holds that month's real elections, coups and crises
// unless this game has changed their causes.
test("a game keeps following real history after its start", () => {
  const text = buildRealHistoryDirective({ game: { startDate: "2014-03-22", gameDate: "2014-04-21" } });
  assert.match(text, /^\[This Game and Real History\]/);
  assert.match(text, /This game began on 2014-03-22, and this jump starts on 2014-04-21\./);
  assert.match(text, /stays the default for everything the game has not changed/);
  assert.match(text, /the real events of this period happen, with their real people, places, dates and numbers/);
  assert.match(text, /another history or a world of its own follows that instead/);
});

test("the first jump of a game says only when it began", () => {
  const text = buildRealHistoryDirective({ game: { startDate: "1936-01-01", gameDate: "1936-01-01" } });
  assert.match(text, /This game began on 1936-01-01\. Real history/);
});

test("it forbids nothing the model remembers", () => {
  const text = buildRealHistoryDirective({ game: { startDate: "1912-01-01" } });
  for (const gone of [/MEMORY IS NOT EVIDENCE/i, /COUNTERFACTUAL FUTURE/i, /BRANCH AUDIT/i, /admissible only/i]) {
    assert.doesNotMatch(text, gone);
  }
});
