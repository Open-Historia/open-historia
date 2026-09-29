import test from "node:test";
import assert from "node:assert/strict";
import { checkFmgAvailable, isFmgIndexPage } from "./fmgDriver.js";

const page = (status, body) => async (url, init) => {
  page.calls.push({ url, init });
  return { ok: status >= 200 && status < 300, status, text: async () => body };
};
page.calls = [];

test("the generator counts as available only when /fmg/ serves its own page", async () => {
  page.calls = [];
  const fmg = "<!DOCTYPE html><html><head><title>Azgaar's Fantasy Map Generator</title></head></html>";
  assert.equal(await checkFmgAvailable(page(200, fmg)), true);
  assert.equal(page.calls[0].url, "/fmg/index.html");
  assert.equal(page.calls[0].init.cache, "no-store");
});

test("the app's own page from the SPA fallback is not the generator", async () => {
  const app = "<!doctype html><html><head><title>Open Historia</title></head><body><div id=\"root\"></div></body></html>";
  assert.equal(await checkFmgAvailable(page(200, app)), false);
});

test("a 404 or a failed request means no generator", async () => {
  assert.equal(await checkFmgAvailable(page(404, "Fantasy Map Generator")), false);
  assert.equal(await checkFmgAvailable(async () => { throw new TypeError("Failed to fetch"); }), false);
  assert.equal(await checkFmgAvailable(async () => undefined), false);
});

test("isFmgIndexPage reads the page text, not its status", () => {
  assert.equal(isFmgIndexPage("<title>Azgaar's Fantasy Map Generator</title>"), true);
  assert.equal(isFmgIndexPage(""), false);
  assert.equal(isFmgIndexPage(null), false);
});
