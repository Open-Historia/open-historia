/*! Open Historia — AES-GCM without WebCrypto © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A pure-JS AES-GCM for spySeal.js, used only where crypto.subtle is missing.
//
// Why: the Android app's WebView is served from http://app.paxhistoria, which is
// not a secure context, so Chromium withholds crypto.subtle there (sha256.js has
// the same story for hashing). Spy intercepts are sealed with AES-GCM; without
// this, every agent report on the phone spent its AI request and then failed to
// save, and anything sealed on the desktop read "[unreadable]".
//
// The output is byte-for-byte what WebCrypto produces for AES-GCM with a 96-bit
// IV, no additional data and a 128-bit tag (ciphertext followed by the tag), so a
// seal made on either path opens on the other. `node --test` holds the two to
// the same bytes. Straightforward, not fast or constant-time: intercepts are a
// few kilobytes, and the seal is obfuscation rather than a security boundary
// (see spySeal.js).

// The AES S-box, generated rather than pasted: walk the multiplicative group of
// GF(2^8) with generator 3, pairing each element with its inverse, and apply the
// affine transform to the inverse.
const SBOX = (() => {
  const box = new Uint8Array(256);
  const rotl = (value, shift) => ((value << shift) | (value >>> (8 - shift))) & 0xff;
  let p = 1;
  let q = 1;
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    box[p] = q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 0x63;
  } while (p !== 1);
  box[0] = 0x63;
  return box;
})();

const xtime = (byte) => ((byte << 1) ^ (byte & 0x80 ? 0x1b : 0)) & 0xff;

// Round keys for a 16-, 24- or 32-byte key, as one flat byte array.
const expandKey = (key) => {
  if (![16, 24, 32].includes(key.length)) throw new Error("AES key must be 16, 24 or 32 bytes.");
  const nk = key.length / 4;
  const rounds = nk + 6;
  const words = 4 * (rounds + 1);
  const w = new Uint8Array(4 * words);
  w.set(key);
  let rcon = 1;
  for (let i = nk; i < words; i += 1) {
    let t0 = w[4 * i - 4];
    let t1 = w[4 * i - 3];
    let t2 = w[4 * i - 2];
    let t3 = w[4 * i - 1];
    if (i % nk === 0) {
      const first = t0;
      t0 = SBOX[t1] ^ rcon;
      t1 = SBOX[t2];
      t2 = SBOX[t3];
      t3 = SBOX[first];
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) {
      t0 = SBOX[t0];
      t1 = SBOX[t1];
      t2 = SBOX[t2];
      t3 = SBOX[t3];
    }
    const back = 4 * (i - nk);
    w[4 * i] = w[back] ^ t0;
    w[4 * i + 1] = w[back + 1] ^ t1;
    w[4 * i + 2] = w[back + 2] ^ t2;
    w[4 * i + 3] = w[back + 3] ^ t3;
  }
  return { w, rounds };
};

// One 16-byte block through the forward cipher (GCM never needs the inverse).
const encryptBlock = ({ w, rounds }, input) => {
  const state = new Uint8Array(16);
  const shifted = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) state[i] = input[i] ^ w[i];
  for (let round = 1; round <= rounds; round += 1) {
    // SubBytes and ShiftRows together: row r moves left by r columns.
    for (let c = 0; c < 4; c += 1) {
      for (let r = 0; r < 4; r += 1) shifted[r + 4 * c] = SBOX[state[r + 4 * ((c + r) & 3)]];
    }
    if (round < rounds) {
      for (let c = 0; c < 4; c += 1) {
        const a0 = shifted[4 * c];
        const a1 = shifted[4 * c + 1];
        const a2 = shifted[4 * c + 2];
        const a3 = shifted[4 * c + 3];
        const all = a0 ^ a1 ^ a2 ^ a3;
        state[4 * c] = a0 ^ all ^ xtime(a0 ^ a1);
        state[4 * c + 1] = a1 ^ all ^ xtime(a1 ^ a2);
        state[4 * c + 2] = a2 ^ all ^ xtime(a2 ^ a3);
        state[4 * c + 3] = a3 ^ all ^ xtime(a3 ^ a0);
      }
    } else {
      state.set(shifted);
    }
    for (let i = 0; i < 16; i += 1) state[i] ^= w[16 * round + i];
  }
  return state;
};

// GF(2^128) multiply, blocks as four big-endian 32-bit words (NIST SP 800-38D,
// algorithm 1).
const toWords = (bytes, offset = 0) => [0, 1, 2, 3].map((i) => (
  ((bytes[offset + 4 * i] << 24) | (bytes[offset + 4 * i + 1] << 16) | (bytes[offset + 4 * i + 2] << 8) | bytes[offset + 4 * i + 3]) >>> 0
));

const gfMultiply = (x, y) => {
  let z0 = 0;
  let z1 = 0;
  let z2 = 0;
  let z3 = 0;
  let [v0, v1, v2, v3] = y;
  for (let i = 0; i < 128; i += 1) {
    if ((x[i >>> 5] >>> (31 - (i & 31))) & 1) {
      z0 ^= v0;
      z1 ^= v1;
      z2 ^= v2;
      z3 ^= v3;
    }
    const carry = v3 & 1;
    v3 = ((v3 >>> 1) | (v2 << 31)) >>> 0;
    v2 = ((v2 >>> 1) | (v1 << 31)) >>> 0;
    v1 = ((v1 >>> 1) | (v0 << 31)) >>> 0;
    v0 >>>= 1;
    if (carry) v0 = (v0 ^ 0xe1000000) >>> 0;
  }
  return [z0 >>> 0, z1 >>> 0, z2 >>> 0, z3 >>> 0];
};

// GHASH over the ciphertext alone (no additional data), then its length block.
const ghash = (hashKey, cipher) => {
  let y = [0, 0, 0, 0];
  const block = new Uint8Array(16);
  for (let offset = 0; offset < cipher.length; offset += 16) {
    block.fill(0);
    block.set(cipher.subarray(offset, Math.min(offset + 16, cipher.length)));
    const words = toWords(block);
    y = gfMultiply([y[0] ^ words[0], y[1] ^ words[1], y[2] ^ words[2], y[3] ^ words[3]], hashKey);
  }
  const bits = cipher.length * 8;
  const lengths = [0, 0, Math.floor(bits / 0x100000000) >>> 0, bits >>> 0];
  y = gfMultiply([y[0] ^ lengths[0], y[1] ^ lengths[1], y[2] ^ lengths[2], y[3] ^ lengths[3]], hashKey);
  const out = new Uint8Array(16);
  y.forEach((word, i) => {
    out[4 * i] = word >>> 24;
    out[4 * i + 1] = (word >>> 16) & 0xff;
    out[4 * i + 2] = (word >>> 8) & 0xff;
    out[4 * i + 3] = word & 0xff;
  });
  return out;
};

// CTR keystream from inc32(J0), with J0 = IV || 0^31 || 1.
const counterMode = (schedule, iv, input) => {
  const out = new Uint8Array(input.length);
  const counter = new Uint8Array(16);
  counter.set(iv);
  let count = 1;
  for (let offset = 0; offset < input.length; offset += 16) {
    count = (count + 1) >>> 0;
    counter[12] = count >>> 24;
    counter[13] = (count >>> 16) & 0xff;
    counter[14] = (count >>> 8) & 0xff;
    counter[15] = count & 0xff;
    const stream = encryptBlock(schedule, counter);
    for (let i = offset; i < Math.min(offset + 16, input.length); i += 1) out[i] = input[i] ^ stream[i - offset];
  }
  return out;
};

const tagFor = (schedule, iv, cipher) => {
  const j0 = new Uint8Array(16);
  j0.set(iv);
  j0[15] = 1;
  const mask = encryptBlock(schedule, j0);
  const hash = ghash(toWords(encryptBlock(schedule, new Uint8Array(16))), cipher);
  return hash.map((byte, i) => byte ^ mask[i]);
};

const checkIv = (iv) => {
  if (!(iv instanceof Uint8Array) || iv.length !== 12) throw new Error("AES-GCM IV must be 12 bytes.");
};

// Ciphertext followed by its 16-byte tag, as WebCrypto returns it.
export const aesGcmEncrypt = (key, iv, plaintext) => {
  checkIv(iv);
  const schedule = expandKey(key);
  const cipher = counterMode(schedule, iv, plaintext);
  const out = new Uint8Array(cipher.length + 16);
  out.set(cipher);
  out.set(tagFor(schedule, iv, cipher), cipher.length);
  return out;
};

// Throws, as WebCrypto does, when the tag does not match.
export const aesGcmDecrypt = (key, iv, sealed) => {
  checkIv(iv);
  if (!(sealed instanceof Uint8Array) || sealed.length < 16) throw new Error("AES-GCM data is too short.");
  const schedule = expandKey(key);
  const cipher = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  const expected = tagFor(schedule, iv, cipher);
  let difference = 0;
  for (let i = 0; i < 16; i += 1) difference |= expected[i] ^ tag[i];
  if (difference) throw new Error("AES-GCM authentication failed.");
  return counterMode(schedule, iv, cipher);
};
