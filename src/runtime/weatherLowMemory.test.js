import test from "node:test";
import assert from "node:assert/strict";

const held = new Map([["oh_device_profile", "constrained"]]);
globalThis.localStorage = {
  getItem: (key) => (held.has(key) ? held.get(key) : null),
  setItem: (key, value) => { held.set(key, String(value)); },
  removeItem: (key) => { held.delete(key); },
};

const { MAP_SETTING_KEYS, getMapSettingDefaultOn } = await import("./mapSettings.js");
const { isConstrainedDevice } = await import("./deviceProfile.js");

test("weather effects start off in Low memory mode, and the player's own choice still wins", () => {
  assert.equal(isConstrainedDevice(), true);
  assert.equal(getMapSettingDefaultOn(MAP_SETTING_KEYS.weatherEffects), false);
  held.set(MAP_SETTING_KEYS.weatherEffects, "1");
  assert.equal(getMapSettingDefaultOn(MAP_SETTING_KEYS.weatherEffects), true);
  held.set(MAP_SETTING_KEYS.weatherEffects, "0");
  assert.equal(getMapSettingDefaultOn(MAP_SETTING_KEYS.weatherEffects), false);
  // Only the weather effects: the other default-on settings stay on.
  assert.equal(getMapSettingDefaultOn(MAP_SETTING_KEYS.seasonsWeather), true);
  assert.equal(getMapSettingDefaultOn(MAP_SETTING_KEYS.soundEffects), true);
});
