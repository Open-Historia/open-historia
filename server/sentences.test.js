/*! Open Historia — where a sentence ends, in any script: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/sentences.test.js
//
// [.!?] split no Chinese or Japanese sentence: their full stop is 。 and no space
// follows it. The rule is Unicode's Sentence_Terminal, never a list of characters,
// and each language below is split the way its English twin is.

import test from "node:test";
import assert from "node:assert/strict";

import { endsSentence, firstSentence, sentenceEnds, sentenceSlices, splitSentences, withoutFinalTerminal } from "./sentences.js";

test("a sentence ends at any script's terminal, with or without a space after it", () => {
  const twins = [
    ["Germany invades Poland. Britain declares war.", ["Germany invades Poland.", "Britain declares war."]],
    ["L'Allemagne envahit la Pologne. La Grande-Bretagne déclare la guerre.", ["L'Allemagne envahit la Pologne.", "La Grande-Bretagne déclare la guerre."]],
    ["德国入侵波兰。英国宣战。", ["德国入侵波兰。", "英国宣战。"]],
    ["ドイツがポーランドに侵攻した。イギリスが宣戦布告した。", ["ドイツがポーランドに侵攻した。", "イギリスが宣戦布告した。"]],
    ["هل ستأتي؟ نعم.", ["هل ستأتي؟", "نعم."]],
    ["जर्मनी ने पोलैंड पर आक्रमण किया। ब्रिटेन ने युद्ध की घोषणा की।", ["जर्मनी ने पोलैंड पर आक्रमण किया।", "ब्रिटेन ने युद्ध की घोषणा की।"]],
    ["独逸？　はい！", ["独逸？", "はい！"]],
    ["德国入侵波兰。1940年，法国陷落。", ["德国入侵波兰。", "1940年，法国陷落。"]],
  ];
  for (const [text, sentences] of twins) assert.deepEqual(splitSentences(text), sentences, text);
});

test("inside a word or a number, and before a comma, a full stop ends nothing", () => {
  assert.deepEqual(splitSentences("U.S. troops land at 3.5 km from e.g. the coast, etc., and hold. Then v2.0 ships."), [
    "U.S. troops land at 3.5 km from e.g. the coast, etc., and hold.",
    "Then v2.0 ships.",
  ]);
  assert.deepEqual(splitSentences('He said "Stop!" Then he left.'), ['He said "Stop!"', "Then he left."], "the closing quote stays with its sentence");
  assert.deepEqual(splitSentences("「止まれ。」と彼は言った。"), ["「止まれ。」", "と彼は言った。"]);
  assert.deepEqual(splitSentences("No terminal at all"), ["No terminal at all"]);
  assert.deepEqual(sentenceEnds(""), []);
});

test("the slices are the text as written, spaces and all", () => {
  for (const text of ["One. Two!  Three", "德国入侵波兰。英国宣战。", "  Lead. Tail  "]) {
    assert.equal(sentenceSlices(text).join(""), text, text);
  }
});

test("the first sentence of a given length, the end of a text, and a title without its terminal", () => {
  assert.equal(firstSentence("Dr. Smith becomes king. He rules.", { min: 13 }), "Dr. Smith becomes king.");
  assert.equal(firstSentence("德国入侵波兰。英国宣战。"), "德国入侵波兰。");
  assert.equal(firstSentence("No end here"), "");
  for (const text of ["Done.", "完了。", "Fertig!", "تم؟", '"Done."', "（完了。）"]) assert.equal(endsSentence(text), true, text);
  for (const text of ["Done", "完了", "Done,", ""]) assert.equal(endsSentence(text), false, text);
  assert.equal(withoutFinalTerminal("Germany invades Poland."), "Germany invades Poland");
  assert.equal(withoutFinalTerminal("德国入侵波兰。"), "德国入侵波兰");
  assert.equal(withoutFinalTerminal("Why?!"), "Why");
});
