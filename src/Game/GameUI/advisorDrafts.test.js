// Runs in a BARE CHECKOUT: advisorDrafts.js is import-free on purpose.
import test from "node:test";
import assert from "node:assert/strict";

import { buildMessageDrafts, extractBlockquotes, splitAtBlockquotes, toPlainText } from "./advisorDrafts.js";

// The diplomacy composer shows the player's own message verbatim, so markup
// handed over with the letter arrives as literal asterisks.
test("emphasis markers come off, words stay", () => {
  assert.equal(toPlainText("**Prime Minister's Office, London**"), "Prime Minister's Office, London");
  assert.equal(toPlainText("*Prime Minister,*"), "Prime Minister,");
  assert.equal(toPlainText("***urgent***"), "urgent");
  assert.equal(toPlainText("~~withdrawn~~ offer"), "withdrawn offer");
  assert.equal(toPlainText("the `Annex II` clause"), "the Annex II clause");
});

test("headings, bullets and rules become plain prose", () => {
  assert.equal(toPlainText("## Terms"), "Terms");
  assert.equal(toPlainText("* a) Citizenship rights"), "- a) Citizenship rights");
  assert.equal(toPlainText("+ second"), "- second");
  assert.equal(toPlainText("- already plain"), "- already plain");
  // The rule's line goes entirely, leaving the blank lines that surrounded it.
  assert.equal(toPlainText("one\n\n---\n\ntwo"), "one\n\n\ntwo");
});

test("a link keeps its words and loses its syntax", () => {
  assert.equal(toPlainText("see [the annex](https://example.invalid/a)"), "see the annex");
});

// Removing markup must never remove words, and a letter's shape is its meaning.
test("paragraphs and line breaks survive", () => {
  const letter = "Prime Minister,\n\nThank you for chairing the session.\n\nYours sincerely,\nPrime Minister of the United Kingdom";
  assert.equal(toPlainText(letter), letter);
});

test("a markdown hard break's trailing spaces are removed", () => {
  assert.equal(toPlainText("London  \n2 November 2032  "), "London\n2 November 2032");
});

test("ordinary punctuation is not mistaken for markup", () => {
  assert.equal(toPlainText("a * b and 3 * 4"), "a * b and 3 * 4");
  assert.equal(toPlainText("the snake_case_name field"), "the snake_case_name field");
  assert.equal(toPlainText("US$10 m (e.g. 5-10 units)"), "US$10 m (e.g. 5-10 units)");
});

test("an escaped marker means the character itself", () => {
  assert.equal(toPlainText("5 \\* 3"), "5 * 3");
});

test("plain input and nullish input are safe", () => {
  assert.equal(toPlainText("Nothing to strip here."), "Nothing to strip here.");
  assert.equal(toPlainText(null), "");
});

const quoteTypes = (segments) => segments.map((segment) => segment.type).join(",");

test("a reply with one letter splits into prose, quote, prose", () => {
  const reply = "Here is what I would send.\n\n> Your Excellency,\n> I propose a pact.\n\nSay the word.";
  const segments = splitAtBlockquotes(reply);
  assert.equal(quoteTypes(segments), "text,quote,text");
  assert.equal(segments[1].quoteIndex, 0);
  assert.ok(segments[1].content.includes("I propose a pact."));
  assert.ok(segments[2].content.includes("Say the word."));
});

test("two letters get their own indices, in order", () => {
  const reply = "First:\n\n> To France.\n\nSecond:\n\n> To Spain.\n\nBoth ready.";
  const segments = splitAtBlockquotes(reply);
  assert.equal(quoteTypes(segments), "text,quote,text,quote,text");
  assert.deepEqual(segments.filter((s) => s.type === "quote").map((s) => s.quoteIndex), [0, 1]);
});

// The numbering here indexes into extractBlockquotes' sequence. If the two ever
// disagree, a Send button lands under the wrong letter.
test("the split counts exactly the quotes extractBlockquotes counts", () => {
  const replies = [
    "> alone",
    "a\n> one\nb\n> two\nc",
    "> one\n>\n> still one\n\nprose",
    "> \n\nempty quote above",
    "no quotes at all",
    "trailing\n\n> last word",
  ];
  for (const reply of replies) {
    const quotes = extractBlockquotes(reply);
    const split = splitAtBlockquotes(reply).filter((segment) => segment.type === "quote");
    assert.equal(split.length, quotes.length, `mismatch for: ${JSON.stringify(reply)}`);
  }
});

test("a bare '>' paragraph break stays inside its own quote", () => {
  const reply = "> One.\n>\n> Two.\n\nAfter.";
  const segments = splitAtBlockquotes(reply);
  assert.equal(quoteTypes(segments), "quote,text");
});

// The reason buildMessageDrafts aligns from the END: the advisor quotes the
// player mid-reply, and pairing forwards would attach the wrong body.
test("a draft is paired with the LAST blockquote, not the first", () => {
  const reply = "You said:\n\n> Can we approach France?\n\nYes. Here is the letter:\n\n> Your Excellency, I propose a pact.";
  const drafts = buildMessageDrafts([{ country: "France" }], reply);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].text, "Your Excellency, I propose a pact.");
  // ...and the button belongs under that second quote, not the player's.
  assert.equal(drafts[0].quoteIndex, 1);
});

test("two drafts pair with the last two quotes, in order", () => {
  const reply = "> player quote\n\nok\n\n> To France.\n\nand\n\n> To Spain.";
  const drafts = buildMessageDrafts([{ country: "France" }, { country: "Spain" }], reply);
  assert.deepEqual(drafts.map((draft) => [draft.country, draft.text, draft.quoteIndex]), [
    ["France", "To France.", 1],
    ["Spain", "To Spain.", 2],
  ]);
});

// The filter at the end of buildMessageDrafts can drop an entry, so a draft's
// position in the returned array is NOT its quote's position.
test("a dropped entry does not shift the surviving draft's quote", () => {
  const reply = "> To France.\n\nand\n\n> To Spain.";
  const drafts = buildMessageDrafts([{ country: "" }, { country: "Spain" }], reply);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].country, "Spain");
  assert.equal(drafts[0].quoteIndex, 1);
  assert.equal(drafts[0].text, "To Spain.");
});

test("an explicit text field still wins, as older saved messages rely on", () => {
  const drafts = buildMessageDrafts([{ country: "France", text: "Saved letter." }], "no quotes here");
  assert.equal(drafts[0].text, "Saved letter.");
});

test("a draft with no country and no recoverable text is dropped", () => {
  assert.deepEqual(buildMessageDrafts([{ country: "" }], "> a quote"), []);
  assert.deepEqual(buildMessageDrafts([{ country: "France" }], "no quotes at all"), []);
});

test("empty and nullish input are safe", () => {
  assert.deepEqual(splitAtBlockquotes(""), []);
  assert.deepEqual(splitAtBlockquotes(null), []);
  assert.deepEqual(buildMessageDrafts([], ""), []);
});
