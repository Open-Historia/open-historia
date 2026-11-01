// Run: node --test src/Game/AI/chatTags.test.js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { chatMessageTags } from "./chatTags.js";

test("a tag is a member's whole, exact name", () => {
  assert.equal(chatMessageTags("@Nigeria we need your answer", "Nigeria"), true);
  assert.equal(chatMessageTags("@Nigeria we need your answer", "Niger"), false);
  assert.equal(chatMessageTags("@Niger, and you?", "Nigeria"), false);
  assert.equal(chatMessageTags("@niger, and you?", "Niger"), true, "in any case");
  assert.equal(chatMessageTags("A word for @United States and @France.", "United States"), true);
  assert.equal(chatMessageTags("A word for @United States and @France.", "France"), true);
  assert.equal(chatMessageTags("email@France.example", "France"), false, "only a tag that starts a word");
  assert.equal(chatMessageTags("No tags here, France.", "France"), false);
  assert.equal(chatMessageTags("@Côte d'Ivoire?", "Côte d'Ivoire"), true);
  assert.equal(chatMessageTags(null, "France"), false);
});

test("the chat answers the members tagged, and as usual when it tags none of the governments that answer", () => {
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /const taggedAnswering = answering\.filter\(\(name\) => chatMessageTags\(playerMessage, name\)\);/);
  assert.match(source, /const aiParticipants = taggedAnswering\.length \? taggedAnswering : answering;/);
  assert.doesNotMatch(source, /lower\.includes\(`@\$\{/, "no substring tags");
});
