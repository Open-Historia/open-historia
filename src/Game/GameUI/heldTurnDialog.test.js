// Run: node --test src/Game/GameUI/heldTurnDialog.test.js
//
// time.jsx cannot be imported under bare node (it is the browser's), so this
// reads its source, as the other layout tests here do.
//
// The promise: a held turn's notice is a dialog of its own that the date
// widget shows whatever panel is open, it cannot be closed without choosing,
// and every kind of held turn offers a way out.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./time.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const between = (from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `time.jsx no longer has "${from}"`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `time.jsx no longer has "${to}" after "${from}"`);
  return source.slice(start, end);
};

test("the notice is shown by the date widget in a dialog of its own, not inside the skip panel", () => {
  const panel = between("const TimelineSkipPanel = (", "\nconst DateWidget = (");
  assert.ok(!panel.includes("<HeldTurnNotice"), "the skip panel renders the held notice again: under its ladder of dates it is below the fold");
  assert.ok(!panel.includes("<HeldTurnDialog"), "the dialog belongs to the widget, which is there whatever panel is open");
  const widget = source.slice(source.indexOf("\nconst DateWidget = ("));
  assert.equal(widget.split("<HeldTurnDialog").length, 2, "the date widget shows the dialog exactly once");
  const shown = widget.slice(widget.indexOf("<HeldTurnDialog"), widget.indexOf("<TimelineSkipPanel"));
  for (const prop of ["held={held}", "onRetry={retryHeld}", "onRetryWholeSkip={retryWholeSkip}", "onDiscard={discardHeld}", "onCancel={cancelJump}"]) {
    assert.ok(shown.includes(prop), `the dialog is not given ${prop}`);
  }
});

test("the dialog is modal, in the body, and has no way out but the notice's own buttons", () => {
  const dialog = between("const HeldTurnDialog = (", "\n};\n");
  assert.ok(dialog.includes("createPortal(") && dialog.includes("document.body"), "it must sit in the body, above every panel");
  assert.ok(dialog.includes('role="alertdialog"') && dialog.includes('aria-modal="true"'));
  assert.ok(dialog.includes("<HeldTurnNotice {...props} />"));
  assert.ok(!/onClick|onKeyDown|onClose|Escape/.test(dialog), "the dialog itself handles no click or key: closing it would lose the turn");
  const backdrop = between("const heldDialogBackdrop = {", "};");
  assert.ok(/position: "fixed"/.test(backdrop) && /inset: 0/.test(backdrop) && /alignItems: "center"/.test(backdrop) && /justifyContent: "center"/.test(backdrop));
});

test("every kind of held turn leaves the player a choice that ends it", () => {
  const kinds = between("const HELD_NOTICE = Object.freeze({", "\n});");
  const notice = between("const HeldTurnNotice = (", "\n};\n");
  for (const kind of ["segment", "board", "checks", "events"]) {
    assert.ok(kinds.includes(`[HELD_TURN.${kind}]`), `no notice for a turn held on ${kind}`);
  }
  // A turn held on the player's events is kept or run again; every other kind can be discarded.
  assert.ok(notice.includes("Keep it and move on") && notice.includes("Retry the whole skip"));
  assert.ok(notice.includes("notice.playerEvents ? null : (") && notice.includes("Discard the turn"));
});
