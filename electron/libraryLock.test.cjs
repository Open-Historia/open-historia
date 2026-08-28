/*! Open Historia — portions (shared save-library lock tests) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The guard that stops the fork's beta and the official app writing one save
// library at the same time. Worth testing directly: the failure it prevents is a
// corrupted campaign, and it only shows up with two installs and a specific
// sequence of launches — which is exactly the thing nobody exercises by hand.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { claimSharedLibrary, lockHolder, releaseSharedLibrary } = require("./libraryLock.cjs");

const lockFile = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oh-lock-")), "library-lock.json");

// pid liveness is injected so a test never depends on what is running on the box.
const running = (...pids) => (pid) => pids.includes(pid);
const never = () => false;
const refuse = () => assert.fail("the player should not have been asked");

test("a free library is claimed without asking anyone", () => {
  const file = lockFile();
  assert.equal(claimSharedLibrary(file, { label: "Open Historia", ask: refuse, pid: 100 }), true);
  assert.equal(lockHolder(file, { pid: 200, isRunning: running(100) }), "Open Historia");
});

test("a lock whose process is gone is not a holder", () => {
  const file = lockFile();
  claimSharedLibrary(file, { label: "Open Historia", ask: refuse, pid: 100 });
  // A crash or a force-kill never runs the release. Refusing to start after one
  // would be worse than the race this guards against.
  assert.equal(lockHolder(file, { pid: 200, isRunning: never }), null);
  assert.equal(
    claimSharedLibrary(file, { label: "Open Historia (Beta)", ask: refuse, pid: 200, isRunning: never }),
    true,
  );
});

test("the second build is told who holds the library, and can quit", () => {
  const file = lockFile();
  claimSharedLibrary(file, { label: "Open Historia", ask: refuse, pid: 100 });

  let asked = "";
  const quit = claimSharedLibrary(file, {
    label: "Open Historia (Beta)",
    pid: 200,
    isRunning: running(100),
    ask: (holder) => { asked = holder; return false; },
  });

  assert.equal(asked, "Open Historia", "the dialog must name the build actually holding it");
  assert.equal(quit, false);
});

// The bug this file exists for. "Start anyway" used to fall through and write the
// lock with the SECOND build's pid, so when that build quit it deleted a lock the
// first build still needed — and a third launch, with the stable app still running,
// got no warning at all.
test("starting anyway leaves the first build's lock intact", () => {
  const file = lockFile();
  claimSharedLibrary(file, { label: "Open Historia", ask: refuse, pid: 100 });

  const started = claimSharedLibrary(file, {
    label: "Open Historia (Beta)",
    pid: 200,
    isRunning: running(100),
    ask: () => true,
  });
  assert.equal(started, true);
  assert.equal(
    JSON.parse(fs.readFileSync(file, "utf8")).pid,
    100,
    "the beta took over a lock it was only borrowing",
  );

  // The beta quits. The stable app is still running, so the lock must survive.
  releaseSharedLibrary(file, { pid: 200 });
  assert.equal(
    lockHolder(file, { pid: 300, isRunning: running(100) }),
    "Open Historia",
    "a third launch was left unwarned while two copies still shared the library",
  );
});

test("quitting normally releases the library for the next launch", () => {
  const file = lockFile();
  claimSharedLibrary(file, { label: "Open Historia", ask: refuse, pid: 100 });
  releaseSharedLibrary(file, { pid: 100 });

  assert.equal(fs.existsSync(file), false);
  assert.equal(
    claimSharedLibrary(file, { label: "Open Historia (Beta)", ask: refuse, pid: 200, isRunning: running(100) }),
    true,
  );
});

test("a build never warns about itself", () => {
  const file = lockFile();
  claimSharedLibrary(file, { label: "Open Historia", ask: refuse, pid: 100 });
  assert.equal(lockHolder(file, { pid: 100, isRunning: running(100) }), null);
});
