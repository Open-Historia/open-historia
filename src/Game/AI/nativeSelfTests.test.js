/*! Open Historia — the in-bundle AI self-tests, run in CI © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The world director, the timeline curator and the territory director each
// carry a self-test reachable only from the browser console
// (globalThis.__OH_NATIVE_*__.selfTest()). They guard which events survive a
// jump, so a regression costs a whole skip; this runs every one of them under
// node --test. The integrity screen's cases are ordinary tests now
// (nativeWorldIntegrity.test.js).
import test from "node:test";
import assert from "node:assert/strict";

// Loaded first, while there is no `window`: its imports read the page's
// location when one exists.
import "./nativeWorldDirector.js";

const quietly = (run) => {
  const { info, warn, table } = console;
  console.info = () => {};
  console.warn = () => {};
  console.table = () => {};
  try {
    return run();
  } finally {
    Object.assign(console, { info, warn, table });
  }
};

const failures = (result) => (result?.cases || [])
  .filter((entry) => !entry.pass)
  .map((entry) => entry.name);

for (const [module, hook, minimumCases] of [
  ["./nativeWorldDirector.js", "__OH_NATIVE_WORLD_DIRECTOR__", 17],
  ["./nativeTimelineCurator.js", "__OH_NATIVE_TIMELINE_CURATOR__", 3],
  ["./nativeTerritoryDirector.js", "__OH_NATIVE_TERRITORY_DIRECTOR__", 3],
]) {
  test(`${hook} self-test passes`, async () => {
    // The curator and territory director publish their hooks on `window`.
    globalThis.window ??= globalThis;
    await import(module);
    const selfTest = globalThis[hook]?.selfTest;
    assert.equal(typeof selfTest, "function", `${module} no longer publishes ${hook}.selfTest`);
    const result = quietly(selfTest);
    assert.ok(result.cases.length >= minimumCases, `only ${result.cases.length} case(s) ran`);
    assert.deepEqual(failures(result), []);
    assert.equal(result.passed, true);
  });
}
