import test from "node:test";
import assert from "node:assert/strict";
import { PREPARED_MARK, checkFmgAvailable, isFmgIndexPage } from "./fmgDriver.js";

const page = (status, body) => async (url, init) => {
  page.calls.push({ url, init });
  return { ok: status >= 200 && status < 300, status, text: async () => body };
};
page.calls = [];

// The generator's page as the game ships it: its own title, and the mark the
// preparation writes first in <head> (scripts/fmg-vendor.mjs).
const prepared = `<!DOCTYPE html><html><head><!-- ${PREPARED_MARK} (scripts/fmg-vendor.mjs) --><title>Azgaar's Fantasy Map Generator</title></head></html>`;
// The same page as its author publishes it, which reports to his analytics.
const asPublished = "<!DOCTYPE html><html><head><title>Azgaar's Fantasy Map Generator</title><script async src=\"https://www.googletagmanager.com/gtag/js?id=G-X\"></script></head></html>";

test("the generator counts as available only when /fmg/ serves the game's prepared copy", async () => {
  page.calls = [];
  assert.equal(await checkFmgAvailable(page(200, prepared)), true);
  assert.equal(page.calls[0].url, "/fmg/index.html");
  assert.equal(page.calls[0].init.cache, "no-store");
});

test("the generator as published, left in a folder by an older checkout, is not run", async () => {
  assert.equal(await checkFmgAvailable(page(200, asPublished)), false);
  assert.equal(isFmgIndexPage(asPublished), false);
});

test("the app's own page from the SPA fallback is not the generator", async () => {
  const app = "<!doctype html><html><head><title>Open Historia</title></head><body><div id=\"root\"></div></body></html>";
  assert.equal(await checkFmgAvailable(page(200, app)), false);
  assert.equal(isFmgIndexPage(`${app}<!-- ${PREPARED_MARK} -->`), false, "the mark alone is not the generator");
});

test("a 404 or a failed request means no generator", async () => {
  assert.equal(await checkFmgAvailable(page(404, prepared)), false);
  assert.equal(await checkFmgAvailable(async () => { throw new TypeError("Failed to fetch"); }), false);
  assert.equal(await checkFmgAvailable(async () => undefined), false);
});

test("isFmgIndexPage reads the page text, not its status", () => {
  assert.equal(isFmgIndexPage(prepared), true);
  assert.equal(isFmgIndexPage(""), false);
  assert.equal(isFmgIndexPage(null), false);
});
