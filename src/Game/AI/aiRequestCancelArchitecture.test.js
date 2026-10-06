import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("../GameUI/settings.jsx", import.meta.url), "utf8");

test("callAI composes the global emergency-stop signal before provider routing and always releases it", () => {
  assert.match(main, /import \{ beginAiRequestScope \} from "\.\/aiRequestControl\.js";/);
  assert.match(main, /const requestScope = beginAiRequestScope\(providerOpts\.signal\);/);
  assert.match(main, /providerOpts\.signal = requestScope\.signal;/);
  assert.match(main, /finally \{\s*requestScope\.finish\(\);\s*\}/);
});

test("Settings exposes one emergency stop in the canonical AI requests section", () => {
  assert.match(settings, /Cancel all AI requests/);
  assert.match(settings, /cancelAllAiRequests\(\)/);
  assert.match(settings, /AI_REQUEST_CONTROL_EVENT/);
  assert.match(settings, /Cancels all live AI generation requests the client can abort/);
});
