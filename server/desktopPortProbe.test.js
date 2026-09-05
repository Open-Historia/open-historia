/*! Open Historia — desktop free-port probe tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test server/desktopPortProbe.test.js
//
// Reported 2026-09-04: the beta would not launch on a laptop running Docker
// Desktop. app.log had `listen EADDRINUSE 127.0.0.1:3000` followed by
// `ERR_FAILED loading 'http://localhost:3000'` — the server never came up, so the
// window had nothing to load and the app looked like it simply did not start.
//
// The probe had bound the WILDCARD to decide whether a port was free, while
// server.js binds loopback by default. On Windows a wildcard bind succeeds beside
// a listener on a specific interface, so a port Docker was holding on 127.0.0.1
// looked free, and the bind that mattered then failed.
//
// electron/main.cjs requires electron and cannot be imported by `node --test`, so
// the probe is sliced out of it and evaluated with `net` in scope. That keeps the
// test honest — it exercises the shipped text, not a copy of it — at the price of
// failing loudly if those functions are renamed, which is the right trade.

import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import test from "node:test";

const source = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
const start = source.indexOf("const probeHosts = () => {");
const end = source.indexOf("// Starting the server is importing it");
assert.ok(start !== -1 && end > start, "could not find the port probe in electron/main.cjs");
const { findFreePort, canBind } = new Function(
  "net",
  `${source.slice(start, end)}\nreturn { findFreePort, canBind };`,
)(net);

// Holds a port on ONE interface, the way Docker Desktop holds 3000.
const holdOnLoopback = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => resolve({
    port: server.address().port,
    release: () => new Promise((done) => server.close(done)),
  }));
});

test("a port held on loopback only is not offered", async () => {
  const held = await holdOnLoopback();
  try {
    // The bug in one line: on Windows this is true even though the port is taken,
    // and the old probe asked nothing else. On Linux it is false and the old probe
    // happened to be right — which is why this never showed up in CI.
    const wildcardLooksFree = await canBind(held.port, null);
    const loopbackFree = await canBind(held.port, "127.0.0.1");
    assert.equal(loopbackFree, false, "the test did not actually hold the port");

    const chosen = await findFreePort(held.port);
    assert.notEqual(chosen, held.port, `offered a port already held on loopback (wildcard said free: ${wildcardLooksFree})`);
    // The answer has to be usable for the bind server.js actually performs.
    assert.equal(await canBind(chosen, "127.0.0.1"), true, "offered a port server.js still cannot bind");
  } finally {
    await held.release();
  }
});

test("an unheld port is returned as-is, and searching stops", async () => {
  const held = await holdOnLoopback();
  const free = held.port;
  await held.release();
  assert.equal(await findFreePort(free), free, "walked past a port that was free");
});

test("the probe covers loopback before the wildcard", () => {
  // Order is not cosmetic: loopback is what the server binds by default, so
  // checking it first settles the common conflict without ever binding the
  // wildcard - which on a locked-down machine is the bind that draws a firewall
  // prompt.
  const hosts = new Function("net", `${source.slice(start, end)}\nreturn probeHosts();`)(net);
  assert.deepEqual(hosts.slice(0, 2), ["127.0.0.1", null]);
});

test("OH_HOST is probed too when it names one interface", () => {
  const probeHostsWith = (value) => {
    const previous = process.env.OH_HOST;
    if (value === undefined) delete process.env.OH_HOST;
    else process.env.OH_HOST = value;
    try {
      return new Function("net", `${source.slice(start, end)}\nreturn probeHosts();`)(net);
    } finally {
      if (previous === undefined) delete process.env.OH_HOST;
      else process.env.OH_HOST = previous;
    }
  };

  assert.deepEqual(probeHostsWith(undefined), ["127.0.0.1", null]);
  // A player who pinned the server to one interface gets that interface checked;
  // on Windows neither of the other two can see a conflict on it.
  assert.deepEqual(probeHostsWith("192.168.1.9"), ["127.0.0.1", null, "192.168.1.9"]);
  // 0.0.0.0 is the wildcard already in the list, and loopback is already first.
  assert.deepEqual(probeHostsWith("0.0.0.0"), ["127.0.0.1", null]);
  assert.deepEqual(probeHostsWith("127.0.0.1"), ["127.0.0.1", null]);
  assert.deepEqual(probeHostsWith("   "), ["127.0.0.1", null]);
});
