import test from "node:test";
import assert from "node:assert/strict";

import {
  newSeal,
  openExchange,
  openPoliticalAssessment,
  openText,
  sealExchange,
  sealPoliticalAssessment,
  sealText,
  spySealingWorks,
} from "./spySeal.js";

// The Android WebView: getRandomValues, but no crypto.subtle (not a secure context).
const withoutSubtle = async (run) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    writable: true,
    value: { getRandomValues: (array) => real.getRandomValues(array) },
  });
  try {
    assert.equal(globalThis.crypto.subtle, undefined);
    return await run();
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
};

test("intercepts seal and open without crypto.subtle, byte for byte as with WebCrypto", async () => {
  const seal = newSeal();
  const text = "Ambassador to the Foreign Ministry: the convoy leaves at dawn. Ölkrise, 石油.";
  const withWebCrypto = await sealText(seal, "report-1:0", text);
  const withoutWebCrypto = await withoutSubtle(() => sealText(seal, "report-1:0", text));
  assert.equal(withoutWebCrypto, withWebCrypto);
  assert.equal(await withoutSubtle(() => openText(seal, "report-1:0", withWebCrypto)), text);
  assert.equal(await openText(seal, "report-1:0", withoutWebCrypto), text);
});

test("a whole report round-trips on the phone path, and a wrong seal reads as unreadable there too", async () => {
  const seal = newSeal();
  const exchange = {
    id: "spy-report-abc:0",
    counterpart: "Ruritania",
    messages: [{ speaker: "Minister", text: "Move the reserves." }, { speaker: "General", text: "Understood." }],
  };
  await withoutSubtle(async () => {
    assert.equal(await spySealingWorks(), true);
    const sealed = await sealExchange(seal, exchange);
    assert.ok(sealed.messages.every((message) => message.cipher && !message.text));
    assert.deepEqual((await openExchange(seal, sealed)).messages.map((message) => message.text), ["Move the reserves.", "Understood."]);
    assert.deepEqual((await openExchange(newSeal(), sealed)).messages.map((message) => message.text), ["[unreadable]", "[unreadable]"]);

    const assessment = { summary: "The cabinet is split.", findings: ["The finance minister wants out."] };
    const sealedAssessment = await sealPoliticalAssessment(seal, "spy-report-abc", assessment);
    assert.deepEqual(await openPoliticalAssessment(seal, "spy-report-abc", sealedAssessment), assessment);
  });
  // Sealed on the phone, opened on the desktop.
  const phoneSealed = await withoutSubtle(() => sealExchange(seal, exchange));
  assert.deepEqual((await openExchange(seal, phoneSealed)).messages.map((message) => message.text), ["Move the reserves.", "Understood."]);
});
