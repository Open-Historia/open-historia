import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectedCountryFromMap } from "./selectedCountryFromMap.js";

test("map selection opens the one region's exact canonical owner without guessing from aliases", () => {
  const lookup = (id) => ({ owner: id === "region-1" ? "U.S Army Alaskan HQ" : "U.S. Army Alaskan HQ" });
  assert.equal(selectedCountryFromMap(["region-1"], lookup), "U.S Army Alaskan HQ");
  assert.equal(selectedCountryFromMap(["region-2"], lookup), "U.S. Army Alaskan HQ");
});

test("empty, mixed, invalid or unavailable selection never guesses a country", () => {
  const lookup = () => ({ owner: "Kingdom of Bulgaria" });
  assert.equal(selectedCountryFromMap([], lookup), "");
  assert.equal(selectedCountryFromMap(["a", "b"], lookup), "");
  assert.equal(selectedCountryFromMap(["a"], () => null), "");
  assert.equal(selectedCountryFromMap(["a"], () => ({ owner: null })), "");
  assert.equal(selectedCountryFromMap(["a"], null), "");
  assert.equal(selectedCountryFromMap(undefined, lookup), "");
});

test("country manager initializes from selected owner without overriding later manual selection", () => {
  const source = readFileSync(new URL("./PolitiesPanel.jsx", import.meta.url), "utf8");
  const map = readFileSync(new URL("./MapEditor.jsx", import.meta.url), "utf8");
  assert.match(map, /initialCountryKey=\{selectedCountryFromMap\(d\.selection, api\?\.getRegionSummary\)\}/);
  assert.match(source, /initialCountryKey\s*=\s*""/);
  assert.match(source, /useState\(\(\) => clean\(initialCountryKey\)\)/);
  assert.match(source, /useState\(\(\) => !clean\(initialCountryKey\)\)/);
  assert.doesNotMatch(source, /useEffect\([^]*setSelectedKey\(initialCountryKey\)/);
});
