// Run: node --test src/Game/AI/foldedSkipSent.test.js
//
// "Request contains an invalid argument" (the owner's log, 2026-11-03): every
// skip of a WWII game was one folded request until the Soviet Union's parties
// were compiled; the next was refused by Gemini outright, asked again without
// its checks, and held for want of a request to check it with. The Politics
// tab's party ops under every event were what tipped it; they are gone now (a
// polity's parties are the Political World's, moved by its own ops:
// runtime/politics.test.js). What a skip sends stays under what went through.
//
// Gemini took a skip's function at 30,489 characters (2026-11-05,
// gemini-3.5-flash-lite) and refused one at 32,672 (2026-11-03). The review of
// 2026-11-09 measured what a skip could really send: 32,372 for a player with
// agents due, a board, a history fold and Rostra, and 33,234 for a shared
// game's host. So every skip now weighs its function before it asks
// (foldedSkip.js fitSkipRiders) and leaves out what would take it past
// FOLDED_SKIP_SCHEMA_BUDGET; these build every combination a game can send.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { foldJumpTool, getGameplayTool, withEventAudience, withEventImpacts, withFrontOrders, withSocialPosts, withWarFigures, withoutGroupOps } from "./gameplaySchemas.js";
// The stable release has no shared games, so no players' advice: a host adds nothing (seatAdvice.js is beta's).
const withSeatAdvice = (tool) => tool;
import { toGeminiSchema } from "./geminiSchema.js";
import { FOLDED_SKIP_SCHEMA_BUDGET, fitSkipRiders } from "./foldedSkip.js";

const chars = (tool) => JSON.stringify(toGeminiSchema(tool.schema)).length;

// The lean contract as a game builds it (gameplay.js forActiveFeatures, then
// the players' advice and the posts: taskToolFor): `host` is a shared game's
// host, which sends the events' audience and the players' advice; `rostra`
// the social posts with the poll answers; `fronts` the battlefields' orders
// and war figures; `groups` the groups' ops.
const leanFor = ({ host = false, rostra = true, fronts = true, groups = true, task = "jumpForward" } = {}) => {
  let tool = withEventImpacts(withEventAudience(getGameplayTool(task), host));
  if (fronts) tool = withWarFigures(withFrontOrders(tool));
  if (!groups) tool = withoutGroupOps(tool);
  if (host) tool = withSeatAdvice(tool);
  return withSocialPosts(tool, rostra, { polls: true });
};

const GAMES = [];
for (const host of [false, true]) {
  for (const rostra of [true, false]) {
    for (const fronts of [true, false]) {
      for (const groups of [true, false]) {
        for (const task of ["jumpForward", "autoJumpForward"]) GAMES.push({ host, rostra, fronts, groups, task });
      }
    }
  }
}
const RIDER_SETS = [];
for (const board of [false, true]) {
  for (const agentReports of [false, true]) {
    for (const history of [false, true]) RIDER_SETS.push({ board, agentReports, history });
  }
}
const label = (game, wanted) => `${JSON.stringify(game)} wanting ${JSON.stringify(wanted)}`;

test("the ceiling a skip's function is held under is below what Gemini took", () => {
  assert.ok(FOLDED_SKIP_SCHEMA_BUDGET <= 30400, `the ceiling is ${FOLDED_SKIP_SCHEMA_BUDGET}`);
});

test("every skip a game can send, with every rider it can want, goes out under the ceiling", () => {
  for (const game of GAMES) {
    const lean = leanFor(game);
    for (const wanted of RIDER_SETS) {
      for (const historyDue of [false, true]) {
        const fit = fitSkipRiders({ wanted, historyDue, sizeOf: (riders) => chars(foldJumpTool(lean, riders)) });
        const sent = chars(foldJumpTool(lean, fit.riders));
        assert.equal(sent, fit.chars, label(game, wanted));
        assert.ok(sent <= FOLDED_SKIP_SCHEMA_BUDGET, `${label(game, wanted)}: ${sent} characters`);
        assert.equal(fit.fits, true, label(game, wanted));
        // The board is never what gives way on a game as it ships.
        if (wanted.board) assert.equal(fit.riders.board, true, `${label(game, wanted)} keeps the board`);
      }
    }
  }
});

// The worst cases the review measured, as each is now sent: the agents' reports
// and the board both ride, and only one of a due history fold and the agents
// waits a skip when all three are wanted.
test("the worst cases: a player with agents, a board, a fold due and Rostra, and a shared game's host", () => {
  const all = { board: true, agentReports: true, history: true };
  for (const game of [{ host: false }, { host: true }]) {
    const lean = leanFor(game);
    const sizeOf = (riders) => chars(foldJumpTool(lean, riders));
    // Any two riders fit together, so the board and the agents always ride.
    for (const pair of [{ board: true, agentReports: true }, { board: true, history: true }, { board: false, agentReports: true, history: true }]) {
      const size = sizeOf(pair);
      assert.ok(size <= FOLDED_SKIP_SCHEMA_BUDGET, `${JSON.stringify(game)} with ${JSON.stringify(pair)}: ${size} characters`);
    }
    const quiet = fitSkipRiders({ wanted: all, historyDue: false, sizeOf });
    assert.deepEqual(quiet.leftOut, ["history"], "with no fold due, the empty history field is what goes");
    const due = fitSkipRiders({ wanted: all, historyDue: true, sizeOf });
    assert.equal(due.leftOut.length, 1, "with a fold due, one of the fold and the agents waits a skip");
    assert.equal(due.riders.board, true);
  }
});

test("the riders cost what was measured for them: the agents' reports, the board and the fold", () => {
  const lean = leanFor({ host: true });
  const cost = (riders) => chars(foldJumpTool(lean, riders)) - chars(lean);
  // 2,204, 1,682 and 892 characters before the review of 2026-11-09.
  assert.ok(cost({ board: false, agentReports: true }) < 1200, `the agents' reports add ${cost({ board: false, agentReports: true })}`);
  assert.ok(cost({ board: true }) < 1400, `the board adds ${cost({ board: true })}`);
  assert.ok(cost({ board: false, history: true }) < 850, `the history fold adds ${cost({ board: false, history: true })}`);
  // And a shared game's host's own: the players' advice, whose notes are its block's.
  const advice = chars(withSeatAdvice(leanFor({ host: false }))) - chars(leanFor({ host: false }));
  assert.ok(advice < 400, `the players' advice adds ${advice}`);
  assert.ok(!JSON.stringify(toGeminiSchema(foldJumpTool(lean, { board: true, agentReports: true, history: true }).schema)).includes("partyOps"));
});

// A skip asked the old way kept a request for the turn review after it, until
// that went (2026-11-07): it keeps nothing for checks now. And a skip is asked
// the old way only after its folded request was refused, never because an
// earlier skip's was.
test("a skip asked the old way keeps no request for checks after it", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").split("\r\n").join("\n");
  assert.match(gameplay, /if \(state\.folded === undefined\) state\.folded = true;\n/);
  assert.equal(/reserve\?\.\("review"/.test(gameplay), false);
  assert.match(gameplay, /state\.folded = false;\n[^\n]*\n          keepForRefusedSkip\(state\.requests\?\.budget\);/);
});
