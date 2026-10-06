/*! Open Historia — permanent Council vs lifecycle-thread identity regression */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const channels = fs.readFileSync(new URL("./institutionalChannels.js", import.meta.url), "utf8");
const governance = fs.readFileSync(new URL("./institutionalGovernance.js", import.meta.url), "utf8");

test("institution channel adapter exposes one canonical Council selector", () => {
  assert.match(channels, /export const findInstitutionalChannel/);
  assert.match(channels, /chatThreadIdentityKey\(chat, world\) === institutionThreadKey/);
  assert.doesNotMatch(
    channels,
    /\.find\(\(chat\) => lower\(chat\?\.institutionId\) === lower\(result\.channel\.institutionId\)\)/,
  );
});

test("institution governance never chooses a returned Council by institutionId alone", () => {
  assert.match(governance, /findInstitutionalChannel/);
  assert.doesNotMatch(
    governance,
    /\.find\(\(chat\) => lower\(chat\??\.?institutionId\)/,
  );
});
