/*! Open Historia - uiDialog non-blocking modal helper tests. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { alertDialog, confirmDialog, hasOpenUiDialog, setUiDialogHandler } from "./uiDialog.js";

test("uiDialog routes confirmDialog and alertDialog through injectable handler and fails closed without DOM", async () => {
  assert.equal(hasOpenUiDialog(), false);
  assert.equal(await confirmDialog("Proceed?"), false);
  assert.equal(await alertDialog("Notice"), undefined);

  const calls = [];
  setUiDialogHandler((request) => {
    calls.push(request);
    return request.kind === "confirm" ? true : undefined;
  });
  try {
    assert.equal(await confirmDialog("Delete item?", { danger: true, confirmLabel: "Delete" }), true);
    assert.equal(await alertDialog("Saved."), undefined);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].kind, "confirm");
    assert.equal(calls[0].danger, true);
    assert.equal(calls[0].confirmLabel, "Delete");
    assert.equal(calls[1].kind, "alert");
    assert.equal(calls[1].message, "Saved.");

    // A synchronous throw inside overrideHandler must reject asynchronously.
    setUiDialogHandler(() => { throw new Error("handler boom"); });
    let threwSync = false;
    let rejection = null;
    try {
      await confirmDialog("Boom?").catch((err) => { rejection = err; });
    } catch {
      threwSync = true;
    }
    assert.equal(threwSync, false);
    assert.match(rejection?.message || "", /handler boom/);
  } finally {
    setUiDialogHandler(null);
  }
});

test("uiDialog sets role=dialog, tracks open state, autofocuses safely, handles external close, and serializes concurrent calls", async () => {
  const priorDocument = globalThis.document;
  let focusedEl = null;
  const makeNode = (tagName) => {
    const listeners = new Map();
    const attrs = new Map();
    const node = {
      tagName: tagName.toUpperCase(),
      id: "",
      className: "",
      textContent: "",
      dataset: {},
      children: [],
      parentNode: null,
      open: false,
      appendChild(child) {
        child.parentNode = node;
        node.children.push(child);
        return child;
      },
      remove() {
        if (!node.parentNode) return;
        const idx = node.parentNode.children.indexOf(node);
        if (idx >= 0) node.parentNode.children.splice(idx, 1);
        node.parentNode = null;
      },
      setAttribute(name, value) { attrs.set(name, String(value)); },
      getAttribute(name) { return attrs.get(name) ?? null; },
      addEventListener(type, fn) {
        const list = listeners.get(type) || [];
        list.push(fn);
        listeners.set(type, list);
      },
      dispatch(type, event = { preventDefault() {} }) {
        for (const fn of [...(listeners.get(type) || [])]) fn(event);
      },
      focus() { focusedEl = node; },
      showModal() { node.open = true; attrs.set("open", ""); },
      close() {
        if (!node.open) return;
        node.open = false;
        attrs.delete("open");
        node.dispatch("close");
      },
    };
    return node;
  };
  const head = makeNode("head");
  const body = makeNode("body");
  globalThis.document = {
    head,
    body,
    createElement: makeNode,
    getElementById: (id) => head.children.find((child) => child.id === id) || null,
    querySelector: () => body.children.find((child) => child.tagName === "DIALOG" && child.open) || null,
  };
  try {
    // Queue two concurrent dialogs: second must wait until the first closes.
    const firstPromise = confirmDialog("Delete everything?", { danger: true, confirmLabel: "Delete", cancelLabel: "Keep" });
    const secondPromise = alertDialog("Done", { okLabel: "Close" });
    await Promise.resolve();
    const dialogs = () => body.children.filter((child) => child.tagName === "DIALOG");
    assert.equal(dialogs().length, 1);
    const first = dialogs()[0];
    assert.equal(first.getAttribute("role"), "dialog");
    assert.equal(first.getAttribute("aria-modal"), "true");
    assert.equal(hasOpenUiDialog(), true);
    // Danger dialog autofocuses the safe Cancel button, not Delete.
    assert.equal(focusedEl?.textContent, "Keep");

    // External dialog.close() must settle the promise cleanly and unblock the queued alert.
    first.close();
    assert.equal(await firstPromise, false);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(dialogs().length, 1);
    const second = dialogs()[0];
    assert.equal(focusedEl?.textContent, "Close");
    second.dispatch("cancel");
    assert.equal(await secondPromise, undefined);
    assert.equal(hasOpenUiDialog(), false);
    assert.equal(dialogs().length, 0);
  } finally {
    globalThis.document = priorDocument;
  }
});
