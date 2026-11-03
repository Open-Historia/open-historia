/*! Open Historia — a hand-drawn map's colours carry no real countries: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/handDrawnColors.test.js
//
// "Keeps re-adding data of modern countries into one of my scenarios (Saints
// Row) despite them not existing at all" (a player, 2026-10-28). A map with no
// colours file of its own was served the stock palette of real countries, and
// every write of its colours (a turn, a new country, a colour picked) saved that
// whole palette into it. The player's exported scenario carried 68 of them.

import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-colors-test-"));
process.env.OH_DATA_DIR = DATA_DIR;
process.env.PORT = "0";

let httpServer;
let base;

const put = (key, body) =>
  fetch(`${base}/api/runtime/json/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const get = async (key) => (await fetch(`${base}/api/runtime/json/${key}`)).json();

const STOCK = JSON.parse(fs.readFileSync(new URL("../public/assets/colors.json", import.meta.url), "utf8"));

before(async () => {
  ({ httpServer } = await import("./server.js"));
  if (!httpServer.listening) await once(httpServer, "listening");
  const address = httpServer.address();
  base = `http://127.0.0.1:${address.port}`;
});

after(() => {
  httpServer?.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const handDrawn = (extra = {}) => ({
  customRegions: true,
  regionOwnershipOverrides: { reg_brighton: "3rd Street Saints", reg_saints_row: "3rd Street Saints", reg_downtown: "France" },
  polityOverrides: { "3rd Street Saints": { code: "3rd Street Saints", name: "3rd Street Saints", aliases: [] } },
  ...extra,
});

test("a hand-drawn map's colours never carry the stock palette's real countries, and a write saves them without", async () => {
  const [stockName] = Object.keys(STOCK).filter((name) => name !== "France");
  assert.ok(stockName, "the stock palette has real countries");

  assert.equal((await put("world", handDrawn())).status, 200);
  // The polluted file, as the player's scenario had it: the whole palette beside the map's own.
  const polluted = { ...STOCK, "3rd Street Saints": [112, 54, 171], "Trailer Park Boyz": [10, 20, 30] };
  assert.equal((await put("colors", polluted)).status, 200);
  const read = await get("colors");
  assert.equal(read[stockName], undefined, `${stockName} is no country on this map`);
  assert.deepEqual(read["3rd Street Saints"], [112, 54, 171]);
  assert.deepEqual(read["Trailer Park Boyz"], [10, 20, 30], "a name the palette does not have is the author's");
  assert.deepEqual(read.France, STOCK.France, "a real country the map gives land keeps its colour");

  // A colour picked for a stock name keeps it: it is the author's, not the palette's.
  assert.equal((await put("colors", { ...read, [stockName]: [1, 2, 3] })).status, 200);
  assert.deepEqual((await get("colors"))[stockName], [1, 2, 3]);
});

test("a map painted over the stock regions keeps the stock palette as it was", async () => {
  assert.equal((await put("world", { customRegions: true, regionOwnershipOverrides: { "FRA.1_1": "Germany" } })).status, 200);
  assert.equal((await put("colors", { ...STOCK })).status, 200);
  assert.deepEqual(await get("colors"), STOCK);
});
