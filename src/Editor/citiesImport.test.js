import test from "node:test";
import assert from "node:assert/strict";

const SEED = [
  { name: "Paris", coord: [2.35, 48.85], country: "France", population: 2100000, capital: true },
  { name: "Lyon", coord: [4.83, 45.76], country: "France", population: 520000 },
  { name: "Arles", coord: [4.63, 43.68], country: "France", population: 50000 },
];

// Each test gets its own copy of the module, so the seed cache starts empty.
let copy = 0;
const freshModule = () => import(`./citiesImport.js?copy=${copy++}`);

// fetch answers from the list in turn; each answer is a Response, or an Error
// to reject with.
const withFetch = async (answers, run) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
    console.warn = originalWarn;
  }
};

const seedResponse = () => new Response(JSON.stringify(SEED), { status: 200, headers: { "Content-Type": "application/json" } });

test("a failed seed download is not cached: the next import downloads it again", async () => {
  const { importMajorCities } = await freshModule();
  await withFetch([new TypeError("Failed to fetch"), seedResponse()], async (calls) => {
    await assert.rejects(importMajorCities());
    const cities = await importMajorCities();
    assert.deepEqual(cities.map((c) => c.name), ["Paris", "Lyon"]);
    assert.equal(calls.length, 2);
    // Loaded once, it is kept.
    await importMajorCities();
    assert.equal(calls.length, 2);
  });
});

test("an HTML page served with 200, or an error status, counts as a failure", async () => {
  const { importAllCities } = await freshModule();
  const html = new Response("<!doctype html><title>app</title>", { status: 200, headers: { "Content-Type": "text/html" } });
  await withFetch([html, new Response("", { status: 503 }), seedResponse()], async (calls) => {
    await assert.rejects(importAllCities());
    await assert.rejects(importAllCities());
    assert.equal((await importAllCities()).length, 3);
    assert.equal(calls.length, 3);
  });
});

test("the search finds nothing while the seed is unreachable, then finds cities once it is back", async () => {
  const { searchSeedCities } = await freshModule();
  await withFetch([new TypeError("offline"), seedResponse()], async () => {
    assert.deepEqual(await searchSeedCities("par"), []);
    assert.deepEqual((await searchSeedCities("par")).map((c) => c.name), ["Paris"]);
  });
});

test("imports that start together share one download", async () => {
  const { importAllCities, importMajorCities } = await freshModule();
  await withFetch([seedResponse()], async (calls) => {
    const [all, major] = await Promise.all([importAllCities(), importMajorCities()]);
    assert.equal(all.length, 3);
    assert.equal(major.length, 2);
    assert.equal(calls.length, 1);
  });
});

test("estimateJsonBytes: close to the real size of a large list, from a sample", async () => {
  const { estimateJsonBytes } = await freshModule();
  const list = Array.from({ length: 5000 }, (_, i) => ({ id: `feat_${i}`, name: `Town number ${i}`, coord: [i / 100, i / 200], tags: ["city"] }));
  const real = list.reduce((sum, item) => sum + JSON.stringify(item).length + 1, 0);
  const estimate = estimateJsonBytes(list);
  assert.ok(Math.abs(estimate - real) / real < 0.05, `estimate ${estimate} vs ${real}`);
  assert.equal(estimateJsonBytes([]), 0);
  assert.equal(estimateJsonBytes(null), 0);
});
