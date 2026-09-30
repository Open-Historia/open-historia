/*! Open Historia — retrying a community basemap that could not be downloaded © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/missingBasemap.test.js
import assert from "node:assert/strict";
import test from "node:test";

import { noteMissingBasemapTried, retryMissingBasemap } from "./missingBasemap.js";

const REFERENCE = { mode: "communityRef", via: "image", url: "https://github.com/user-attachments/assets/basemap.png" };
const scenario = (id, url = REFERENCE.url) => ({ id, missingBasemap: { reference: { ...REFERENCE, url }, reason: "Download failed (HTTP 502)." } });

test("opening a scenario whose basemap is missing downloads it and hands it to the store", async () => {
  const calls = [];
  const result = await retryMissingBasemap(scenario("rome"), {
    fetchBasemap: async (reference) => {
      calls.push(reference.url);
      return { dataUrl: "data:image/png;base64,T0xE" };
    },
    restore: async (id, payload) => ({ id, payload }),
  });
  assert.deepEqual(calls, [REFERENCE.url]);
  assert.deepEqual(result, { restored: true, details: { id: "rome", payload: { dataUrl: "data:image/png;base64,T0xE" } } });
});

test("a scenario is tried once per session, and again once its reference changes", async () => {
  let fetches = 0;
  const options = {
    fetchBasemap: async () => {
      fetches += 1;
      throw new Error("Not found on the hub");
    },
    restore: async () => assert.fail("nothing to restore"),
  };
  const first = await retryMissingBasemap(scenario("carthage"), options);
  assert.deepEqual(first, { restored: false, reason: "Not found on the hub." }, "a whole sentence, full stop and all");
  assert.equal(await retryMissingBasemap(scenario("carthage"), options), null);
  assert.equal(fetches, 1);

  await retryMissingBasemap(scenario("carthage", "https://github.com/user-attachments/assets/other.png"), options);
  assert.equal(fetches, 2);
});

test("the import that has just failed counts as the session's try", async () => {
  noteMissingBasemapTried(scenario("sparta"));
  const options = { fetchBasemap: async () => assert.fail("tried already"), restore: async () => assert.fail("nothing to restore") };
  assert.equal(await retryMissingBasemap(scenario("sparta"), options), null);
});

test("a scenario with its basemap is left alone", async () => {
  const options = { fetchBasemap: async () => assert.fail("nothing to fetch"), restore: async () => assert.fail("nothing to restore") };
  assert.equal(await retryMissingBasemap({ id: "athens" }, options), null);
  assert.equal(await retryMissingBasemap(null, options), null);
});
