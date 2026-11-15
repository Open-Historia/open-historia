/*! Open Historia — the diplomatic map's colours, measured © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every colour is measured in CIEDE2000 against what it must not be mistaken
// for: the interface's Accent, each of the groups' palette (their tints lie over
// these fills), and unowned land; each view's colours against one another; and
// the pairs a player must tell apart under deuteranopia and protanopia
// (Machado et al. 2009). And no purple.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_DIPLOMATIC_COLORS,
  BLOC_COLORS,
  DIPLO_UNKNOWN,
  IDEOLOGY_COLORS,
  POWER_COLORS,
  REGIME_COLORS,
  RELATION_COLORS,
  REPRESENTATION_COLORS,
  WAR_SIDE_COLORS,
  hexToRgb,
  puppetShade,
} from "./diplomaticPalette.js";
import { GROUP_PALETTE } from "./groups.js";

const ACCENT = "#2bc1f3";
const UNOWNED = "#58626e"; // Nations.jsx NEUTRAL_LAND_COLOR, rgb(88, 98, 110)

const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const labOfRgb = ([r, g, b]) => {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
};
const deltaE = (lab1, lab2) => {
  const rad = Math.PI / 180;
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (a, b) => { const v = Math.atan2(b, a) / rad; return v < 0 ? v + 360 : v; };
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  let dhp = h2p - h1p;
  if (C1p * C2p === 0) dhp = 0; else if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * 30 * Math.exp(-(((hbp - 275) / 25) ** 2)) * rad) * RC;
  return Math.sqrt(((L2 - L1) / SL) ** 2 + ((C2p - C1p) / SC) ** 2 + (dHp / SH) ** 2 + RT * ((C2p - C1p) / SC) * (dHp / SH));
};
const CVD = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
};
const unlin = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
const seenAs = (hex, matrix) => { const l = hexToRgb(hex).map(lin); return matrix.map((row) => unlin(row[0] * l[0] + row[1] * l[1] + row[2] * l[2])); };
const dE = (x, y) => deltaE(labOfRgb(hexToRgb(x)), labOfRgb(hexToRgb(y)));

test("no colour of the diplomatic map is the Accent, a group's colour, or unowned land", () => {
  const near = [];
  for (const color of new Set(ALL_DIPLOMATIC_COLORS)) {
    for (const other of [ACCENT, UNOWNED, ...GROUP_PALETTE]) {
      const d = dE(color, other);
      if (d < 9.5) near.push(`${color} ~ ${other}: ${d.toFixed(1)}`);
    }
  }
  assert.deepEqual(near, []);
});

test("no purple, and every colour a flat hex", () => {
  for (const color of new Set(ALL_DIPLOMATIC_COLORS)) {
    assert.match(color, /^#[0-9a-f]{6}$/);
    const [r, g, b] = hexToRgb(color).map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 0.12) continue;
    let hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    hue = (hue * 60 + 360) % 360;
    assert.ok(hue <= 255 || hue >= 335, `${color} is purple (hue ${hue.toFixed(0)})`);
  }
});

test("within each view the colours are told apart", () => {
  const views = { RELATION_COLORS, BLOC_COLORS, REGIME_COLORS, REPRESENTATION_COLORS, IDEOLOGY_COLORS, POWER_COLORS, WARS: Object.fromEntries(WAR_SIDE_COLORS.flat().map((c, i) => [i, c]).concat([["none", DIPLO_UNKNOWN]])) };
  for (const [name, table] of Object.entries(views)) {
    const colors = Object.entries(table);
    assert.equal(new Set(colors.map(([, c]) => c)).size, colors.length, `${name}: one colour a category`);
    for (let i = 0; i < colors.length; i += 1) {
      for (let j = i + 1; j < colors.length; j += 1) {
        assert.ok(dE(colors[i][1], colors[j][1]) >= 6, `${name}: ${colors[i][0]} ~ ${colors[j][0]}`);
      }
    }
  }
});

test("the pairs that matter read apart for red-green colour-blind players", () => {
  const pairs = [
    [RELATION_COLORS.war, RELATION_COLORS.alliance, 20],
    [RELATION_COLORS.hostile, RELATION_COLORS.friendly, 15],
    [RELATION_COLORS.war, RELATION_COLORS.friendly, 15],
    [RELATION_COLORS.unknown, RELATION_COLORS.neutral, 10],
    [RELATION_COLORS.self, RELATION_COLORS.neutral, 10],
    ...WAR_SIDE_COLORS.map(([a, b]) => [a, b, 15]),
  ];
  for (const [a, b, least] of pairs) {
    for (const [name, matrix] of Object.entries(CVD)) {
      const d = deltaE(labOfRgb(seenAs(a, matrix)), labOfRgb(seenAs(b, matrix)));
      assert.ok(d >= least, `${name}: ${a} ~ ${b} ${d.toFixed(1)}`);
    }
  }
});

test("unknown is not neutral, and a puppet's shade is its overlord's family", () => {
  assert.notEqual(RELATION_COLORS.unknown, RELATION_COLORS.neutral);
  assert.ok(dE(RELATION_COLORS.unknown, RELATION_COLORS.neutral) > 20);
  const shade = puppetShade(REGIME_COLORS.democratic);
  assert.notEqual(shade, REGIME_COLORS.democratic);
  assert.ok(dE(shade, REGIME_COLORS.democratic) < dE(shade, REGIME_COLORS.authoritarian));
});
