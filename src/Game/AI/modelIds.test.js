/*! Open Historia — model-id matching tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/modelIds.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { looksLikeModelFilePath, modelFileCandidates, resolveServedModelId } from "./modelIds.js";

// Verbatim from issue #721: the id the game sent, and the four models the
// player's llama-server listed at startup in router mode.
const REPORTED_ID = "F:\\Models\\LLM\\gemma-4-31B-it-APEX-Quality.gguf";
const ROUTER_MODELS = [
  "ArliAI_GLM-4.5-Air-Derestricted-Q4_K_M",
  "Hermes3.6-35B-A3B-Uncensored-Genesis-V7-MTP-APEX",
  "RavenX-CyberAgent-35B-v5.1-Q4_K_M",
  "gemma-4-31B-it-APEX-Quality",
];

test("issue #721: a remembered file path resolves to the name the router serves", () => {
  assert.equal(resolveServedModelId(REPORTED_ID, ROUTER_MODELS), "gemma-4-31B-it-APEX-Quality");
});

test("only file-like ids pay for a /models lookup", () => {
  assert.equal(looksLikeModelFilePath(REPORTED_ID), true);
  assert.equal(looksLikeModelFilePath("F:\\Models\\LLM\\no-extension"), true, "a Windows path is never a model name");
  assert.equal(looksLikeModelFilePath("/home/me/models/qwen.GGUF"), true);
  // Everything else is sent exactly as configured, with no extra request.
  for (const id of ["gemma-4-31B-it-APEX-Quality", "anthropic/claude-sonnet-4", "llama3:8b", "gpt-4o", "/models/llama", "", null, undefined]) {
    assert.equal(looksLikeModelFilePath(id), false, JSON.stringify(id));
  }
});

test("a server whose ids really are paths keeps the exact id", () => {
  // vLLM serving a file without --served-model-name lists the path itself, and
  // LM Studio lists org/repo/file.gguf — the configured id must win there.
  const vllm = ["/srv/models/qwen2.5-7b.gguf"];
  assert.equal(resolveServedModelId("/srv/models/qwen2.5-7b.gguf", vllm), "/srv/models/qwen2.5-7b.gguf");
  const lmStudio = ["lmstudio-community/Qwen2.5-7B-GGUF/Qwen2.5-7B-Q4_K_M.gguf", "qwen2.5-7b"];
  assert.equal(
    resolveServedModelId("lmstudio-community/Qwen2.5-7B-GGUF/Qwen2.5-7B-Q4_K_M.gguf", lmStudio),
    "lmstudio-community/Qwen2.5-7B-GGUF/Qwen2.5-7B-Q4_K_M.gguf",
  );
});

test("candidates run from most to least specific", () => {
  assert.deepEqual(modelFileCandidates(REPORTED_ID), [
    REPORTED_ID,
    "gemma-4-31B-it-APEX-Quality.gguf",
    "gemma-4-31B-it-APEX-Quality",
  ]);
  assert.deepEqual(modelFileCandidates("C:\\m\\big-00001-of-00003.gguf"), [
    "C:\\m\\big-00001-of-00003.gguf",
    "big-00001-of-00003.gguf",
    "big-00001-of-00003",
    "big",
  ]);
  assert.deepEqual(modelFileCandidates(""), []);
});

test("a listing that keeps the extension, or differs only in case, still matches", () => {
  assert.equal(resolveServedModelId(REPORTED_ID, ["gemma-4-31B-it-APEX-Quality.gguf"]), "gemma-4-31B-it-APEX-Quality.gguf");
  assert.equal(resolveServedModelId(REPORTED_ID, ["Gemma-4-31B-IT-APEX-Quality"]), "Gemma-4-31B-IT-APEX-Quality");
});

test("no match, or no list, leaves the decision to the caller", () => {
  // null means "send what the player configured" — never a guess at some other model.
  assert.equal(resolveServedModelId(REPORTED_ID, ["qwen3-32b", "llama-3.3-70b"]), null);
  assert.equal(resolveServedModelId(REPORTED_ID, []), null);
  assert.equal(resolveServedModelId(REPORTED_ID, undefined), null);
  assert.equal(resolveServedModelId(REPORTED_ID, [null, "", 7]), null);
});
