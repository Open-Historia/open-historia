/*! Open Historia — desktop "page stopped" handler tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/desktopPageGone.test.js
//
// Reported 2026-09-21: saving a detailed scenario in the Workshop sent some
// players to a dark grey screen with nothing on it, and the game never came
// back. That grey is the desktop window's own background colour: the page
// under it had died (the save-time border cleanup asked for more heap than the
// machine gave the page), and nothing answered a page that stops. Now the
// reason goes to the diagnostics log, the player is told, and Reload brings the
// game back.
//
// electron/main.cjs requires electron and cannot be imported by `node --test`,
// so the handler is sliced out of it and run with stand-ins for dialog, the log
// and the window: the shipped text is what is tested.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
const start = source.indexOf("const pageGoneWording = ");
const end = source.indexOf("// --- end of a page that stops");
assert.ok(start !== -1 && end > start, "could not find the page-stopped handler in electron/main.cjs");

const load = ({ isBeta = false, response = 0 } = {}) => {
  const logs = [];
  const dialogs = [];
  const quits = [];
  const dialog = {
    showMessageBox: (win, options) => {
      dialogs.push(options);
      return Promise.resolve({ response });
    },
  };
  const logMain = (level, event, message, data) => logs.push({ level, event, message, data });
  const app = { quit: () => quits.push(true) };
  const { handlePageGone } = new Function(
    "dialog",
    "logMain",
    "app",
    "IS_BETA",
    "BETA_APP_NAME",
    `${source.slice(start, end)}\nreturn { handlePageGone };`,
  )(dialog, logMain, app, isBeta, "Open Historia Beta");
  return { handlePageGone, logs, dialogs, quits };
};

const makeWindow = () => {
  const win = { destroyed: false, reloads: 0 };
  win.isDestroyed = () => win.destroyed;
  win.webContents = { reload: () => { win.reloads += 1; } };
  return win;
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a page that runs out of memory is logged, explained, and Reload brings the game back", async () => {
  const { handlePageGone, logs, dialogs, quits } = load({ response: 0 });
  const win = makeWindow();
  assert.equal(handlePageGone(win, { reason: "oom", exitCode: -536870904 }), true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, "error");
  assert.equal(logs[0].event, "window.pageGone");
  assert.equal(logs[0].data.reason, "oom", "the diagnostics log says why");
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].message, "Open Historia ran out of memory.");
  assert.ok(dialogs[0].detail.includes("Reload"), "the player is told the way back");
  assert.deepEqual(dialogs[0].buttons, ["Reload", "Quit"]);
  await settle();
  assert.equal(win.reloads, 1, "Reload reloads the page");
  assert.equal(quits.length, 0);
});

test("Quit quits, and any other reason gets the plain wording", async () => {
  const { handlePageGone, dialogs, quits } = load({ response: 1 });
  const win = makeWindow();
  assert.equal(handlePageGone(win, { reason: "crashed", exitCode: 1 }), true);
  assert.equal(dialogs[0].message, "Open Historia's page stopped unexpectedly.");
  assert.ok(dialogs[0].detail.includes("(crashed)"));
  await settle();
  assert.equal(quits.length, 1);
  assert.equal(win.reloads, 0);
});

test("a normal close, the app quitting, or a window already gone is not a crash", () => {
  const { handlePageGone, logs, dialogs } = load();
  assert.equal(handlePageGone(makeWindow(), { reason: "clean-exit", exitCode: 0 }), false);
  assert.equal(handlePageGone(makeWindow(), { reason: "killed" }, { quitting: true }), false, "the page closes on the way out");
  const gone = makeWindow();
  gone.destroyed = true;
  assert.equal(handlePageGone(gone, { reason: "crashed" }), false);
  assert.equal(handlePageGone(null, { reason: "crashed" }), false);
  assert.equal(logs.length, 0);
  assert.equal(dialogs.length, 0);
});

test("the beta says its own name, and a window closed during the dialog is left alone", async () => {
  const { handlePageGone, dialogs, quits } = load({ isBeta: true, response: 0 });
  const win = makeWindow();
  handlePageGone(win, { reason: "oom" });
  assert.equal(dialogs[0].title, "Open Historia Beta");
  assert.equal(dialogs[0].message, "Open Historia Beta ran out of memory.");
  win.destroyed = true;
  await settle();
  assert.equal(win.reloads, 0);
  assert.equal(quits.length, 0);
});

test("the handler is wired to the main window, and quitting is known before the page closes", () => {
  assert.ok(
    source.includes('win.webContents.on("render-process-gone", (_event, details) => handlePageGone(win, details, { quitting }));'),
    "the main window answers a page that stops",
  );
  const quit = source.indexOf('app.on("before-quit", () => {');
  assert.ok(quit !== -1 && source.slice(quit, quit + 80).includes("quitting = true;"), "quitting is marked before windows close");
});
