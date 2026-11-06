/*! Open Historia — the browser's own dialogs, translated: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/nativeDialogs.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createPhraseBook } from "./phraseBook.js";
import { installNativeDialogTranslation, translateDialogText } from "./nativeDialogs.js";

const book = createPhraseBook();
book.setAll({
  "Discard unsaved institution edits?": "Nicht gespeicherte Änderungen an der Institution verwerfen?",
  "Delete {{count}} selected features?": "{{count}} ausgewählte Objekte löschen?",
  "Close the editor?": "Den Editor schließen?",
});
const translate = (text) => book.translate(text) ?? text;

test("a dialog's message is translated exactly or by its pattern", () => {
  assert.equal(translateDialogText("Discard unsaved institution edits?", translate), "Nicht gespeicherte Änderungen an der Institution verwerfen?");
  assert.equal(translateDialogText("Delete 12 selected features?", translate), "12 ausgewählte Objekte löschen?");
  // Unknown text, and what is not text, are left as they are.
  assert.equal(translateDialogText("Something new", translate), "Something new");
  assert.equal(translateDialogText(undefined, translate), undefined);
  assert.equal(translateDialogText(42, translate), 42);
});

test("a message of several lines is translated line by line when it is not known whole", () => {
  assert.equal(
    translateDialogText("Close the editor?\n\nDiscard unsaved institution edits?", translate),
    "Den Editor schließen?\n\nNicht gespeicherte Änderungen an der Institution verwerfen?",
  );
  assert.equal(translateDialogText("Close the editor?\nNot known.", translate), "Den Editor schließen?\nNot known.");
});

test("alert, confirm and prompt show the translated message, once wrapped", () => {
  const shown = [];
  const target = {
    alert(message) { assert.equal(this, target); shown.push(["alert", message]); },
    confirm(message) { shown.push(["confirm", message]); return true; },
    prompt(message, value) { shown.push(["prompt", message, value]); return value; },
  };
  assert.equal(installNativeDialogTranslation(target, translate), true);
  assert.equal(installNativeDialogTranslation(target, translate), false, "wrapped once");
  target.alert("Close the editor?");
  assert.equal(target.confirm("Discard unsaved institution edits?"), true);
  assert.equal(target.prompt("Close the editor?", "Close the editor?"), "Close the editor?", "the default value is the player's");
  assert.deepEqual(shown, [
    ["alert", "Den Editor schließen?"],
    ["confirm", "Nicht gespeicherte Änderungen an der Institution verwerfen?"],
    ["prompt", "Den Editor schließen?", "Close the editor?"],
  ]);
});
