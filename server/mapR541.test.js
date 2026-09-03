import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const world = fs.readFileSync(path.resolve(here, "../src/Game/Map/World.jsx"), "utf8");

test("R5.4.1 fades fixed relief before regional overzoom becomes ugly", () => {
  assert.match(world, /3\.50,\s*0\.78/);
  assert.match(world, /4\.00,\s*0\.42/);
  assert.match(world, /4\.45,\s*0\.16/);
  assert.match(world, /4\.85,\s*0/);
});

test("R5.4.1 brings detailed World Terrain Base in through the same handoff band", () => {
  assert.match(world, /3\.20,\s*0\.18/);
  assert.match(world, /3\.65,\s*0\.52/);
  assert.match(world, /4\.10,\s*0\.78/);
  assert.match(world, /4\.60,\s*0\.90/);
});
