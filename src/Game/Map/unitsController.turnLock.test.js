/*! Open Historia — the map's unit changes wait for a running turn © 2026. */
// A turn writes back the world it read when it started, so a unit placed,
// disbanded or moved while it ran came back or vanished when it landed. While a
// turn runs those changes are refused and nothing is written; a requested order
// still goes to the queue, which the turn reads again before writing it.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { setRuntimeAssetEndpoints } from "../../runtime/assets.js";
import { beginSimulation, endSimulation } from "../AI/simulationStatus.js";
import { deployUnit, disbandUnit, removeUnit, requestUnitOrders, revertUnitOrder, updateUnitAdmin } from "./unitsController.js";

const store = new Map();
const writes = [];
globalThis.fetch = async (url, init = {}) => {
  const match = /\/api\/runtime\/json\/(\w+)/.exec(String(url));
  if (!match) return new Response("not found", { status: 404 });
  const key = match[1];
  if (String(init.method || "GET").toUpperCase() === "PUT") {
    writes.push(key);
    store.set(key, String(init.body));
    return new Response(String(init.body), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (!store.has(key)) return new Response("missing", { status: 404 });
  return new Response(store.get(key), { status: 200, headers: { "Content-Type": "application/json" } });
};

const reset = () => {
  setRuntimeAssetEndpoints({ token: `units-lock-${Math.random()}` });
  store.clear();
  writes.length = 0;
  store.set("game", JSON.stringify({ country: "France", gameDate: "1914-08-01", round: 3 }));
  store.set("world", JSON.stringify({ units: [{ id: "u1", type: "infantry", ownerCode: "France", name: "1st Army", strength: 90, lng: 2, lat: 49 }] }));
  store.set("actions", JSON.stringify([]));
};

afterEach(() => {
  endSimulation();
});

const realWarn = console.warn;
console.warn = () => {};
test.after(() => { console.warn = realWarn; });

test("while a turn runs, placing, disbanding, removing and moving a unit write nothing", async () => {
  reset();
  beginSimulation();
  assert.equal(await deployUnit({ type: "infantry", strength: 100, name: "2nd Army", lng: 3, lat: 48 }), null);
  await disbandUnit("u1");
  await removeUnit("u1");
  assert.equal(await updateUnitAdmin("u1", { lng: 4, lat: 47 }), null);
  await revertUnitOrder({ unitId: "u1", remove: true });
  assert.deepEqual(writes, []);
});

test("with no turn running, a unit is placed and its deploy order queued", async () => {
  reset();
  const saved = await deployUnit({ type: "infantry", strength: 100, name: "2nd Army", lng: 3, lat: 48 });
  assert.ok(Array.isArray(saved));
  assert.ok(writes.includes("world"));
  assert.ok(writes.includes("actions"));
  assert.equal(JSON.parse(store.get("world")).units.some((unit) => unit.name === "2nd Army"), true);
});

test("while a turn runs, requesting orders still queues them and touches no unit", async () => {
  // The units are loaded by the placement above.
  writes.length = 0;
  beginSimulation();
  assert.equal(await requestUnitOrders("u1", "hold the Marne"), true);
  assert.deepEqual(writes, ["actions"]);
  assert.match(JSON.parse(store.get("actions")).at(-1).text, /hold the Marne/);
});
