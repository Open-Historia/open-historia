// Integration tests for LAN sharing — the setting that decides whether the
// Android app and other computers can reach this server.
//
// These boot the REAL server in a child process rather than unit-testing a
// helper, because the thing worth protecting is not a function's return value:
// it is that a phone can still connect. The server binds loopback by default,
// and every one of those cases is a supported setup that used to work by
// accident and now works on purpose. If someone changes the binding logic, this
// is what should stop them.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, before, describe, test } from "node:test";

const SERVER = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "server.js");

// A non-loopback IPv4 address of this machine — what a phone would type in.
// Absent on a host with no network (some CI sandboxes), in which case the
// reachability assertions are skipped rather than failed.
const lanAddress = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .find((address) => address?.family === "IPv4" && !address.internal)?.address ?? null;

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

// Resolves when the server answers on loopback, rejects if it dies or hangs.
const waitForServer = async (port, child) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/server/network`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not start in time");
};

// True when `host` accepts a connection on `port`. A refused connection is the
// expected answer for a loopback-bound server, not a failure.
const reachable = async (host, port) => {
  try {
    const response = await fetch(`http://${host}:${port}/api/library`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
};

const setLan = async (port, lanEnabled) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/server/network`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify({ lanEnabled }),
  });
  const body = await response.json();
  // The listener rebinds just after replying, so give it a moment to land.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { status: response.status, body };
};

describe("LAN sharing", () => {
  let dataDir;
  let port;
  let child;

  const start = async (env = {}) => {
    child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, OH_DATA_DIR: dataDir, PORT: String(port), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.resume();
    child.stderr.resume();
    await waitForServer(port, child);
  };

  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  };

  before(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "oh-network-test-"));
    port = await freePort();
  });

  after(async () => {
    await stop();
    rmSync(dataDir, { force: true, recursive: true });
  });

  test("a fresh install answers this machine and nothing else", async () => {
    await start();
    assert.equal(await reachable("127.0.0.1", port), true, "the game itself must always work");

    const lan = lanAddress();
    if (lan) {
      assert.equal(await reachable(lan, port), false, "the network must not reach it by default");
    }

    const state = await (await fetch(`http://127.0.0.1:${port}/api/server/network`)).json();
    assert.equal(state.lanEnabled, false);
    assert.equal(state.lockedByEnv, false);
  });

  test("turning the setting on lets other devices in, without a restart", async () => {
    const { status, body } = await setLan(port, true);
    assert.equal(status, 200);
    assert.equal(body.lanEnabled, true);

    // The address the UI tells the player to type into the Android app.
    assert.ok(Array.isArray(body.addresses));

    assert.equal(await reachable("127.0.0.1", port), true, "the local game must keep working across a rebind");
    const lan = lanAddress();
    if (lan) {
      assert.equal(await reachable(lan, port), true, "a phone must be able to reach it now");
    }
  });

  test("turning it back off shuts the door again", async () => {
    const { body } = await setLan(port, false);
    assert.equal(body.lanEnabled, false);

    assert.equal(await reachable("127.0.0.1", port), true);
    const lan = lanAddress();
    if (lan) {
      assert.equal(await reachable(lan, port), false);
    }
  });

  test("the setting survives a restart", async () => {
    await setLan(port, true);
    await stop();
    await start();

    const state = await (await fetch(`http://127.0.0.1:${port}/api/server/network`)).json();
    assert.equal(state.lanEnabled, true, "a player who turned sharing on should not have to do it every launch");

    const lan = lanAddress();
    if (lan) {
      assert.equal(await reachable(lan, port), true);
    }
  });

  test("OH_HOST overrides the saved setting and locks the switch", async () => {
    // The saved setting says "shared" from the previous test; the environment
    // says loopback. Headless and scripted installs need that to be the last
    // word, and the UI needs to know the switch is not theirs to flip.
    await stop();
    await start({ OH_HOST: "127.0.0.1" });

    const state = await (await fetch(`http://127.0.0.1:${port}/api/server/network`)).json();
    assert.equal(state.lanEnabled, false);
    assert.equal(state.lockedByEnv, true);

    const lan = lanAddress();
    if (lan) {
      assert.equal(await reachable(lan, port), false);
    }

    const { status, body } = await setLan(port, true);
    assert.equal(status, 409);
    assert.match(body.error, /OH_HOST/);
  });

  // The rollback in rebindListener used to be unreachable code. The startup error
  // handler is registered first and calls process.exit(1) on EADDRINUSE, and Node
  // runs "error" listeners in REGISTRATION ORDER — so a LAN toggle that could not
  // take the new interface killed the game server out from under a player
  // mid-campaign instead of staying on the interface that was already working.
  test("a rebind that cannot take the new interface leaves the server running", async (t) => {
    const lan = lanAddress();
    if (!lan) {
      t.skip("no non-loopback address on this host");
      return;
    }

    // A clean loopback binding to rebind AWAY from, with the switch unlocked.
    await stop();
    await start({ OH_HOST: "" });
    await setLan(port, false);

    // Hold the port on one real interface. The server's next move is to bind
    // 0.0.0.0 on the same port, which this makes impossible.
    const squatter = net.createServer();
    await new Promise((resolve, reject) => {
      squatter.once("error", reject);
      squatter.listen(port, lan, resolve);
    });

    try {
      await setLan(port, true);

      // The reply is sent before the rebind is attempted (by design — it travels
      // over a connection the rebind drops), so the rolled-back state is what a
      // FOLLOW-UP read reports. Poll: the fallback bind takes a moment to land.
      let state = null;
      for (let attempt = 0; attempt < 40 && !state; attempt += 1) {
        assert.equal(child.exitCode, null, "the server exited instead of falling back");
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/server/network`, {
            signal: AbortSignal.timeout(500),
          });
          if (response.ok) state = await response.json();
        } catch {
          /* mid-rebind: loopback is briefly closed */
        }
        if (!state) await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assert.ok(state, "the server never came back on loopback after a failed rebind");
      assert.equal(state.lanEnabled, false, "it should have rolled back to the binding that worked");
      assert.equal(child.exitCode, null, "the server must survive a rebind it cannot complete");
    } finally {
      await new Promise((resolve) => squatter.close(resolve));
    }
  });
});
