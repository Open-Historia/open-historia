import test from "node:test";
import assert from "node:assert/strict";

import { aesGcmDecrypt, aesGcmEncrypt } from "./aesGcm.js";

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const fromHex = (text) => new Uint8Array(Buffer.from(text, "hex"));

test("pure AES-GCM matches the published AES-256 test vectors", () => {
  const key = new Uint8Array(32);
  const iv = new Uint8Array(12);
  assert.equal(hex(aesGcmEncrypt(key, iv, new Uint8Array(0))), "530f8afbc74536b9a963b4f1c4cb738b");
  assert.equal(
    hex(aesGcmEncrypt(key, iv, new Uint8Array(16))),
    "cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919",
  );
});

test("pure AES-GCM produces WebCrypto's bytes, and each opens the other's", async () => {
  const subtle = globalThis.crypto.subtle;
  for (let n = 0; n < 60; n += 1) {
    const key = globalThis.crypto.getRandomValues(new Uint8Array([16, 24, 32][n % 3]));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const plain = globalThis.crypto.getRandomValues(new Uint8Array(n * 7 + (n === 59 ? 3000 : 0)));
    const cryptoKey = await subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    const reference = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, plain));
    const ours = aesGcmEncrypt(key, iv, plain);
    assert.equal(hex(ours), hex(reference), `length ${plain.length}`);
    assert.equal(hex(aesGcmDecrypt(key, iv, reference)), hex(plain));
    assert.equal(hex(new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ours))), hex(plain));
  }
});

test("pure AES-GCM refuses a tampered cipher, a wrong key and a bad IV", () => {
  const key = fromHex("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
  const iv = fromHex("0102030405060708090a0b0c");
  const sealed = aesGcmEncrypt(key, iv, new TextEncoder().encode("the ambassador lied"));
  const tampered = sealed.slice();
  tampered[0] ^= 1;
  assert.throws(() => aesGcmDecrypt(key, iv, tampered), /authentication/);
  assert.throws(() => aesGcmDecrypt(new Uint8Array(32), iv, sealed), /authentication/);
  assert.throws(() => aesGcmEncrypt(key, new Uint8Array(16), sealed), /IV/);
  assert.equal(new TextDecoder().decode(aesGcmDecrypt(key, iv, sealed)), "the ambassador lied");
});
