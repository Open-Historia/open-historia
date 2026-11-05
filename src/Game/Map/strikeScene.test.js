/*! Open Historia — strikes on the map: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/strikeScene.test.js
//
// What the map shows of a strike (strikeScene.js), the vertices the layer
// draws it with (strikeCustomLayer.js), where its places are found
// (strikePlaces.js), who asks for it to be played (strikeStore.js), and that
// all of it is wired to the map and to the Events panel.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";
import { STRIKE_LAYER_ID, WORLD_COPIES_MOST, buildStrikeVertices, worldCopies } from "./strikeCustomLayer.js";
import { findPlaceEntry, strikeEnds } from "./strikePlaces.js";
import { AIRCRAFT_HEIGHT_KM, AIRCRAFT_SHOWN_MOST, APOGEE_SHARE, INTERCEPTOR_HEAD_PX, MISSILES_SHOWN_MOST, placeFrom, planStrike, rangeKm, ringOf, strikeItemsAt, strikeLasts } from "./strikeScene.js";
import { forgetStrikeRequests, getStrikeRequest, replayStrikes, showStrikesOfEvent, subscribeStrikeRequests } from "./strikeStore.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

const MOSCOW = [37.6, 55.75];
const LONDON = [-0.12, 51.5];
const KYIV = [30.5, 50.45];
const WASHINGTON = [-77.04, 38.9];
const strike = (extra = {}) => ({ id: "strike:2024-03-11:0", owner: "Aland", weapon: "silo missile", count: 1, down: 0, ...extra });
const plan = (extra = {}, ends = { from: MOSCOW, to: LONDON }) => planStrike(strike(extra), ends);
// What is drawn at a moment, sorted into kinds.
const seen = (laid, seconds, options) => {
  const items = strikeItemsAt(laid, seconds, options);
  return {
    items,
    aircraft: items.points.filter((point) => point.shape === 1 && point.at[2] > 0),
    shadows: items.points.filter((point) => point.shape === 1 && point.at[2] === 0),
    flashes: items.points.filter((point) => point.shape === 2),
    rings: items.points.filter((point) => point.shape === 3),
    glows: items.points.filter((point) => point.shape === 0),
  };
};

test("a strike is laid out between its two places, and one without both is not played", () => {
  assert.equal(planStrike(strike(), { from: MOSCOW, to: null }), null);
  assert.equal(planStrike(strike(), { from: [Number.NaN, 5], to: LONDON }), null);
  assert.equal(planStrike(null, { from: MOSCOW, to: LONDON }), null);
  const laid = plan();
  assert.equal(laid.weapon, "silo missile");
  assert.deepEqual([laid.nuclear, laid.aircraft, laid.flat, laid.shown, laid.down, laid.hits], [true, false, false, 1, 0, true]);
  assert.ok(Math.abs(laid.km - rangeKm(MOSCOW, LONDON)) < 1e-9 && laid.km > 2400 && laid.km < 2600);
  assert.equal(strikeLasts(laid), laid.lasts);
  // A salvo of hundreds is a dozen arcs, a raid of hundreds a score of aircraft.
  assert.equal(plan({ count: 400 }).shown, MISSILES_SHOWN_MOST);
  assert.equal(plan({ weapon: "bombing run", count: 400 }).shown, AIRCRAFT_SHOWN_MOST);
  // As many of those shown are lost as their share of the whole: none, some, all.
  assert.equal(plan({ count: 400, down: 0 }).down, 0);
  assert.equal(plan({ count: 400, down: 200 }).down, 7);
  assert.equal(plan({ count: 400, down: 1 }).down, 1);
  assert.equal(plan({ count: 400, down: 399 }).down, MISSILES_SHOWN_MOST - 1);
  assert.equal(plan({ count: 400, down: 400 }).down, MISSILES_SHOWN_MOST);
  assert.equal(plan({ count: 400, down: 400 }).hits, false);
  assert.equal(plan({ count: 6, down: 2 }).units.filter((unit) => unit.down !== null).length, 2);
  // The same strike is the same spectacle every time.
  const again = plan({ count: 9, down: 3 });
  const once = plan({ count: 9, down: 3 });
  assert.deepEqual(again.units.map((unit) => [unit.start, unit.flight, unit.down, unit.lands]), once.units.map((unit) => [unit.start, unit.flight, unit.down, unit.lands]));
  assert.deepEqual(strikeItemsAt(again, 2.5), strikeItemsAt(once, 2.5));
  // Nothing before it begins, and nothing after it is over.
  assert.deepEqual(strikeItemsAt(laid, -1), { ribbons: [], points: [], discs: [] });
  assert.deepEqual(strikeItemsAt(laid, laid.lasts + 0.01), { ribbons: [], points: [], discs: [] });
  assert.deepEqual(strikeItemsAt(null, 1), { ribbons: [], points: [], discs: [] });
});

test("a missile flies an arc: off the ground from its launch, highest half way, down at its target", () => {
  const laid = plan();
  const [missile] = laid.units;
  assert.equal(missile.height(0), 0);
  assert.equal(missile.height(1), 0);
  const top = missile.height(0.5);
  // About a quarter of its range, as a ballistic arc is.
  assert.ok(top > laid.km * APOGEE_SHARE["silo missile"] * 0.8 && top < laid.km * APOGEE_SHARE["silo missile"] * 1.2, `${Math.round(top)} km up over ${Math.round(laid.km)} km`);
  assert.ok(missile.height(0.25) < top && missile.height(0.75) < top && missile.height(0.25) > 0);
  // A conventional missile flies far lower than a ballistic one.
  assert.ok(plan({ weapon: "missile strike" }).units[0].height(0.5) < top * 0.5);
  // It starts where it is launched and ends on what it hits.
  assert.ok(rangeKm(missile.way(0), MOSCOW) < 1 && rangeKm(missile.way(1), LONDON) < 1);
  // In flight: a head, a trail behind it that climbs with it, and the fire of its launch at first.
  const early = seen(laid, missile.flight * 0.03);
  assert.equal(early.glows.length, 1);
  assert.equal(early.flashes.length, 1, "the fire of its launch");
  const mid = seen(laid, missile.flight * 0.5);
  assert.equal(mid.glows.length, 1);
  assert.ok(Math.abs(mid.glows[0].at[2] - top) < 1e-6, "the head is at the top of its arc half way");
  assert.equal(mid.flashes.length, 0);
  const trail = mid.items.ribbons.at(-1);
  assert.equal(trail.points.length, 15);
  assert.ok(trail.points.every((point) => point[2] > 0), "its trail is in the air");
  assert.ok(trail.from === 0 && trail.to > 0.9, "and fades behind it");
  assert.equal(mid.items.discs.length, 0, "nothing has been hit yet");
});

test("on a globe the arc is in the air with its shadow under it; on a flat map it is bowed across the map instead", () => {
  const globe = plan();
  const flat = planStrike(strike(), { from: MOSCOW, to: LONDON, flat: true });
  assert.equal(flat.flat, true);
  // The globe's way is the shortest one; the flat map's bows to the north of it.
  const straight = globe.units[0].way(0.5);
  const bowed = flat.units[0].way(0.5);
  assert.ok(bowed[1] > straight[1] + 1.5, `bowed to ${bowed[1].toFixed(2)} N from ${straight[1].toFixed(2)} N`);
  assert.ok(rangeKm(flat.units[0].way(0), MOSCOW) < 1 && rangeKm(flat.units[0].way(1), LONDON) < 1, "between the same two places");
  // The other way round it still bows north, as an arc is drawn.
  const back = planStrike(strike(), { from: LONDON, to: MOSCOW, flat: true });
  assert.ok(back.units[0].way(0.5)[1] > straight[1] + 1.5);
  // The globe shows the shadow of the arc on the ground under it; the flat map has none to show.
  // (A missile in flight is its trail and the glow round it.)
  const shadowed = strikeItemsAt(globe, globe.units[0].flight * 0.5).ribbons;
  assert.equal(shadowed.length, 3);
  assert.ok(shadowed[0].points.every((point) => point[2] === 0), "the shadow lies on the ground");
  assert.deepEqual(shadowed[0].points.map(([lng, lat]) => [lng, lat]), shadowed[2].points.map(([lng, lat]) => [lng, lat]), "under the arc itself");
  assert.ok(shadowed[1].width > shadowed[2].width && shadowed[1].to < shadowed[2].to, "the glow is wider and fainter than the trail");
  assert.equal(strikeItemsAt(flat, flat.units[0].flight * 0.5).ribbons.length, 2);
  // Over the top of the world the bow goes the other way: a flat map ends before the pole.
  const polar = planStrike(strike(), { from: [60, 55], to: [-100, 40], flat: true });
  let highest = 0;
  for (let step = 0; step <= 40; step += 1) highest = Math.max(highest, polar.units[0].way(step / 40)[1]);
  assert.ok(highest < 84, `it reaches ${highest.toFixed(1)} N`);
  // A salvo on a flat map is a fan of arcs, all bowed the same way.
  const salvo = planStrike(strike({ count: 8 }), { from: MOSCOW, to: LONDON, flat: true });
  assert.ok(salvo.units.every((unit) => unit.way(0.5)[1] > straight[1] + 1));
  assert.ok(new Set(salvo.units.map((unit) => unit.way(0.5)[1].toFixed(3))).size > 4, "each on a way of its own");
});

test("a way over the date line is one way: its longitudes run on, they do not jump a world", () => {
  for (const flat of [false, true]) {
    const laid = planStrike(strike({ count: 5 }), { from: [140, 36], to: [-122, 38], flat });
    for (const unit of laid.units) {
      let before = unit.way(0)[0];
      assert.ok(Math.abs(before - 140) < 1e-6);
      for (let step = 1; step <= 200; step += 1) {
        const [lng] = unit.way(step / 200);
        assert.ok(Math.abs(lng - before) < 5, `a jump from ${before} to ${lng}`);
        before = lng;
      }
      assert.ok(before > 180, `it ends at ${before}, past the date line`);
    }
  }
});

test("where a nuclear missile comes down: a flash, a fireball, a shock wave that spreads, and a glow that lingers", () => {
  const laid = plan();
  const [missile] = laid.units;
  const at = (after, options) => seen(laid, missile.start + missile.flight + after, options);
  const hit = at(0.1);
  assert.equal(hit.flashes.length, 1, "the flash");
  assert.equal(hit.glows.length, 0, "the missile is no more");
  assert.equal(hit.items.discs.length, 2, "the fireball and the glow under it");
  // (A ring is drawn pale over a wider ring of fire's colour: the pale one is the one counted.)
  const wave = (items) => items.ribbons.filter((ribbon) => ribbon.points.length === 49 && ribbon.colour[2] > 0.5);
  assert.equal(wave(hit.items).length, 1, "the shock wave");
  assert.equal(hit.items.ribbons.filter((ribbon) => ribbon.points.length === 49).length, 2, "with its ring of fire under it");
  // The wave spreads and fades; a second follows it.
  const reach = (ribbon) => rangeKm([ribbon.points[0][0], ribbon.points[0][1]], LONDON);
  const later = at(1.5);
  assert.equal(wave(later.items).length, 2);
  assert.ok(reach(wave(later.items)[0]) > reach(wave(hit.items)[0]) * 2);
  assert.ok(wave(later.items)[0].to < wave(hit.items)[0].to);
  // Everything is centred on what was hit.
  assert.ok(rangeKm(hit.items.discs[0].centre, LONDON) < 1);
  // The glow outlasts the rest, and then it is over.
  const last = at(6.5);
  assert.deepEqual([last.flashes.length, wave(last.items).length, last.items.discs.length], [0, 0, 1]);
  assert.ok(laid.lasts >= missile.start + missile.flight + 7.4);
  // Far out, a blast is drawn no smaller than can be seen: 80 km to a pixel makes the fireball 720 km on the map.
  const near = at(2).items.discs[0].km;
  const far = at(2, { kmPerPixel: 80 }).items.discs[0].km;
  assert.ok(near < 70 && far > 600, `${near} km, and ${far} km from far out`);
  // A conventional missile bursts and is done.
  const small = plan({ weapon: "missile strike" });
  const burst = seen(small, small.units[0].flight + 0.1);
  assert.equal(burst.flashes.length, 1);
  assert.ok(burst.items.discs[0].km < 20);
  assert.ok(small.lasts < small.units[0].flight + 2.5);
});

test("what is shot down bursts in the air where it was, and never reaches the ground", () => {
  const laid = plan({ count: 4, down: 4 });
  assert.equal(laid.hits, false);
  for (const unit of laid.units) {
    assert.ok(unit.down > 0.4 && unit.down < 0.9, `shot down ${unit.down} of the way along`);
    const moment = unit.start + unit.down * unit.flight + 0.1;
    const then = seen(laid, moment);
    const where = unit.way(unit.down);
    const high = unit.height(unit.down);
    assert.ok(high > 50, "well off the ground");
    const flash = then.flashes.find((point) => Math.abs(point.at[0] - where[0]) < 1e-9 && Math.abs(point.at[2] - high) < 1e-9);
    assert.ok(flash, "a flash where it was, at its height");
    assert.ok(then.rings.some((point) => Math.abs(point.at[2] - high) < 1e-9), "and a ring opening round it");
  }
  // None of them is ever a blast on the ground.
  for (let seconds = 0; seconds <= laid.lasts; seconds += 0.2) assert.equal(strikeItemsAt(laid, seconds).discs.length, 0);
  // Some shot down: those burst in the air, the rest arrive.
  const some = plan({ count: 4, down: 2 });
  assert.equal(some.hits, true);
  let blasts = 0;
  for (let seconds = 0; seconds <= some.lasts; seconds += 0.1) blasts = Math.max(blasts, strikeItemsAt(some, seconds).discs.length);
  assert.ok(blasts >= 2 && blasts <= 4, `${blasts} discs at the most, for the two that arrive`);
  // Aircraft too: one shot down bursts at the height it flew, and drops nothing.
  const raid = plan({ weapon: "bombing run", count: 3, down: 3 });
  const lostOne = raid.units[0];
  const fell = seen(raid, lostOne.start + lostOne.down * lostOne.flight + 0.05);
  assert.ok(fell.flashes.some((point) => point.at[2] === AIRCRAFT_HEIGHT_KM));
  for (let seconds = 0; seconds <= raid.lasts; seconds += 0.2) assert.equal(strikeItemsAt(raid, seconds).discs.length, 0);
});

// "There should also be missile and bomber interception (the missile or plane
// blows up in the air during the animation if it's meant to be intercepted)."
test("one that is intercepted is met in the air by what was sent up at it, blows up there, and falls in pieces", () => {
  const laid = plan({ count: 3, down: 3 });
  const tagged = (items, what) => [...items.points, ...items.ribbons].filter((item) => item.what === what);
  for (const unit of laid.units) {
    const met = [...unit.way(unit.down), unit.height(unit.down)];
    const when = unit.start + unit.down * unit.flight;
    // What brings it down leaves the ground on the defenders' side of it: nearer the target than the place they meet.
    assert.ok(unit.interceptor.seconds >= 0.8 && unit.interceptor.seconds <= 1.5);
    assert.ok(rangeKm(unit.interceptor.from, LONDON) < rangeKm(met, LONDON), "from the target's side");
    assert.ok(rangeKm(unit.interceptor.from, met) <= 1400 + 40, `${Math.round(rangeKm(unit.interceptor.from, met))} km to climb`);
    // It climbs, and it is where the missile is as they meet.
    const [fromLng, fromLat] = unit.interceptor.from;
    const heights = [0.9, 0.6, 0.3, 0.02].map((left) => {
      const gone = 1 - left;
      const heads = strikeItemsAt(laid, when - unit.interceptor.seconds * left).points.filter((point) => point.what === "interceptor" && point.size === INTERCEPTOR_HEAD_PX);
      // (Others of the salvo are in the air too: this one's is on the straight way from where it left to where they meet.)
      const own = heads.find((point) => Math.abs(point.at[0] - (fromLng + (met[0] - fromLng) * gone)) < 1e-6 && Math.abs(point.at[1] - (fromLat + (met[1] - fromLat) * gone)) < 1e-6);
      assert.ok(own, `its head, ${Math.round(gone * 100)}% of the way up`);
      return own.at[2];
    });
    assert.ok(heights[0] > 0 && heights[0] < heights[1] && heights[1] < heights[2] && heights[2] < heights[3], `it climbs: ${heights.map(Math.round)}`);
    assert.ok(Math.abs(heights[3] - met[2]) < met[2] * 0.03, "to the height the missile is at");
    // The missile is still flying a moment before they meet, and gone a moment after: nothing of it goes on.
    const head = (seconds) => strikeItemsAt(laid, seconds).points.filter((point) => point.shape === 0 && point.size === 9 && !point.what);
    assert.ok(head(when - 0.05).some((point) => Math.abs(point.at[2] - unit.height(unit.down - 0.05 / unit.flight)) < 1));
    // It blows up where they met: a flash and a ring there, larger than a bomb's, and the smoke of it afterwards.
    const blast = seen(laid, when + 0.3);
    const flash = blast.flashes.find((point) => Math.abs(point.at[0] - met[0]) < 1e-9 && Math.abs(point.at[2] - met[2]) < 1e-9);
    assert.ok(flash && flash.size >= 60, `a flash of ${flash?.size} px`);
    assert.ok(blast.rings.some((point) => Math.abs(point.at[2] - met[2]) < 1e-9 && point.size > 30));
    assert.ok(tagged(strikeItemsAt(laid, when + 1.6), "smoke").some((point) => Math.abs(point.at[2] - met[2]) < 1e-9));
    // And what is left of it falls: five pieces, each lower than the last time it was looked at, down to the ground.
    const pieces = (seconds) => strikeItemsAt(laid, seconds).points.filter((point) => point.what === "debris").map((point) => ({ point, far: Math.hypot(point.at[0] - met[0], point.at[1] - met[1]) })).sort((a, b) => a.far - b.far).slice(0, 5).map((entry) => entry.point);
    const early = pieces(when + 0.4);
    const late = pieces(when + 1.7);
    assert.equal(early.length, 5);
    assert.ok(early.every((point) => point.at[2] < met[2] && point.at[2] > met[2] * 0.9), "they have only begun to fall");
    assert.ok(late.every((point) => point.at[2] < met[2] * 0.25), "and are nearly down");
    assert.ok(strikeItemsAt(laid, when + 0.8).ribbons.some((ribbon) => ribbon.what === "debris"), "each trailing smoke");
  }
  // Before what is sent up has left the ground nothing of it is seen, and once it has, it is.
  const solo = plan({ count: 1, down: 1 });
  const [only] = solo.units;
  const meets = only.start + only.down * only.flight;
  assert.equal(tagged(strikeItemsAt(solo, meets - only.interceptor.seconds - 0.2), "interceptor").length, 0);
  assert.ok(tagged(strikeItemsAt(solo, meets - only.interceptor.seconds * 0.5), "interceptor").length >= 2, "its head and its trail");
  // Nothing of a strike that was all shot down reaches the ground, and it is played until the last piece is down.
  for (let seconds = 0; seconds <= laid.lasts; seconds += 0.1) assert.equal(strikeItemsAt(laid, seconds).discs.length, 0);
  const lastMet = Math.max(...laid.units.map((unit) => unit.start + unit.down * unit.flight));
  assert.ok(strikeLasts(laid) >= lastMet + 1.9, `played ${strikeLasts(laid)} s, the last met at ${lastMet}`);
  // A strike nothing of which was shot down has no interceptor in it at all.
  const clean = plan({ count: 3 });
  assert.ok(clean.units.every((unit) => unit.interceptor === null && unit.down === null));
  for (let seconds = 0; seconds <= clean.lasts; seconds += 0.25) assert.equal(strikeItemsAt(clean, seconds).points.filter((point) => point.what).length, 0);
  // Some shot down: an interceptor for each of those, and the others arrive and burst as ever.
  const some = plan({ weapon: "missile strike", count: 6, down: 2 }, { from: MOSCOW, to: KYIV });
  assert.equal(some.units.filter((unit) => unit.interceptor).length, 2);
  assert.equal(some.hits, true);
  // The same strike is the same interception every time it is played.
  assert.deepEqual(strikeItemsAt(plan({ count: 3, down: 3 }), 2.4), strikeItemsAt(laid, 2.4));

  // An aircraft too: it is met, blows up, and its wreck goes down turning with the pieces, dropping no bomb.
  const raid = plan({ weapon: "bombing run", count: 4, down: 4 }, { from: MOSCOW, to: KYIV });
  const lost = raid.units[0];
  const fell = lost.start + lost.down * lost.flight;
  assert.ok(lost.interceptor && rangeKm(lost.interceptor.from, KYIV) < 40, "sent up from round what it came to bomb");
  assert.ok(strikeItemsAt(raid, fell - lost.interceptor.seconds * 0.5).points.some((point) => point.what === "interceptor"));
  const wreck = (seconds) => strikeItemsAt(raid, seconds).points.filter((point) => point.what === "wreck").sort((a, b) => Math.hypot(a.at[0] - lost.way(lost.down)[0], a.at[1] - lost.way(lost.down)[1]) - Math.hypot(b.at[0] - lost.way(lost.down)[0], b.at[1] - lost.way(lost.down)[1]))[0];
  const [first, second] = [wreck(fell + 0.3), wreck(fell + 1.5)];
  assert.ok(first && second && first.shape === 1 && second.at[2] < first.at[2] && first.at[2] < AIRCRAFT_HEIGHT_KM, "the wreck falls");
  assert.notDeepEqual([first.toward[0] - first.at[0], first.toward[1] - first.at[1]].map((value) => Math.sign(value)), [second.toward[0] - second.at[0], second.toward[1] - second.at[1]].map((value) => Math.sign(value)), "turning as it goes");
  for (let seconds = 0; seconds <= raid.lasts; seconds += 0.2) assert.equal(strikeItemsAt(raid, seconds).discs.length, 0);
  // The layer draws it all as it draws anything else of a strike.
  const { ribbons, points } = buildStrikeVertices(strikeItemsAt(raid, fell + 0.4));
  assert.ok(ribbons.length % 12 === 0 && points.length % 12 === 0 && points.length > 0 && ![...ribbons, ...points].some((value) => !Number.isFinite(value)));
});

test("aircraft fly above the ground in formation, cast their shadows, drop their bombs and fly on", () => {
  const raid = plan({ weapon: "bombing run", count: 12 }, { from: MOSCOW, to: KYIV });
  assert.deepEqual([raid.aircraft, raid.nuclear, raid.shown], [true, false, 12]);
  // Rows of five abreast, each row behind the one before: no two are ever in the same place.
  assert.equal(new Set(raid.units.map((unit) => unit.way(0.5).map((value) => value.toFixed(4)).join())).size, 7, "five ways abreast, and the last row's two between them");
  assert.equal(new Set(raid.units.map((unit) => `${unit.start.toFixed(3)}|${unit.way(0.5).map((value) => value.toFixed(4)).join()}`)).size, 12);
  // On the ground where they take off, then up, and up they stay.
  const [lead] = raid.units;
  assert.equal(lead.height(0), 0);
  assert.equal(lead.height(0.5), AIRCRAFT_HEIGHT_KM);
  assert.equal(lead.height(1.1), AIRCRAFT_HEIGHT_KM);
  const mid = seen(raid, 4);
  assert.equal(mid.aircraft.length, 12);
  assert.equal(new Set(mid.aircraft.map((point) => point.at.map((value) => value.toFixed(4)).join())).size, 12);
  assert.ok(mid.aircraft.every((point) => point.at[2] === AIRCRAFT_HEIGHT_KM && point.toward), "each above the ground, turned the way it flies");
  // A shadow for each, on the ground, a little way off to one side.
  assert.equal(mid.shadows.length, 12);
  const off = rangeKm(mid.shadows[0].at, mid.aircraft[0].at);
  assert.ok(off > 40 && off < 60, `its shadow lies ${off.toFixed(1)} km off`);
  // (Never farther than looks right where the map is close in: 14 pixels of it.)
  const close = seen(raid, 4, { kmPerPixel: 0.5 });
  assert.ok(Math.abs(rangeKm(close.shadows[0].at, close.aircraft[0].at) - 7) < 0.1);
  // Seen from far out they keep far enough apart to be told from one another: 21 pixels of the map.
  const far = planStrike(strike({ weapon: "bombing run", count: 12 }), { from: MOSCOW, to: KYIV, kmPerPixel: 4 });
  const abreast = seen(far, 4, { kmPerPixel: 4 }).aircraft;
  const apart = rangeKm(abreast[0].at, abreast[1].at);
  assert.ok(Math.abs(apart - 84) < 6, `${apart.toFixed(1)} km apart, 21 pixels at 4 km a pixel`);
  assert.equal(abreast[0].size, 17);
  // But a formation is never wider than half its own flight: farther out still, they are drawn smaller instead.
  const tiny = planStrike(strike({ weapon: "bombing run", count: 12 }), { from: MOSCOW, to: KYIV, kmPerPixel: 12 });
  assert.ok(Math.abs(tiny.gapKm - rangeKm(MOSCOW, KYIV) / 8) < 1e-6);
  const small = seen(tiny, 4, { kmPerPixel: 12 }).aircraft[0].size;
  assert.ok(small >= 8 && small < 17, `drawn ${small} pixels across`);
  // Their contrails are in the air.
  assert.ok(mid.items.ribbons.every((ribbon) => ribbon.points.at(-1)[2] === AIRCRAFT_HEIGHT_KM));
  // As they come over: bombs fall from where the aircraft are to the ground, then burst there.
  const last = raid.units.reduce((latest, unit) => Math.max(latest, unit.start), 0);
  let falling = 0;
  let bursts = 0;
  let firstBurst = Infinity;
  for (let seconds = 0; seconds <= raid.lasts; seconds += 0.05) {
    const now = seen(raid, seconds);
    falling = Math.max(falling, now.glows.length);
    bursts = Math.max(bursts, now.items.discs.length);
    if (now.items.discs.length > 0) firstBurst = Math.min(firstBurst, seconds);
  }
  assert.ok(falling >= 6, `${falling} bombs seen falling at once`);
  assert.ok(bursts >= 12, `${bursts} bursts at once`);
  assert.ok(firstBurst > lead.flight * 0.9, "nothing bursts before they are there");
  // A bomb in the air is between its aircraft's height and the ground.
  const dropping = seen(raid, lead.start + lead.flight * 0.94);
  assert.ok(dropping.glows.some((point) => point.at[2] > 0 && point.at[2] < AIRCRAFT_HEIGHT_KM));
  // Every burst is round what was bombed.
  const struck = seen(raid, last + lead.flight * 1.02).items.discs;
  assert.ok(struck.length > 0 && struck.every((disc) => rangeKm(disc.centre, KYIV) < 60));
  // And they fly on past it, fading from sight.
  const gone = seen(raid, lead.start + lead.flight * 1.12);
  assert.ok(gone.aircraft.some((point) => point.alpha < 1 && point.alpha > 0));
  assert.ok(rangeKm(lead.way(1.15), MOSCOW) > rangeKm(KYIV, MOSCOW));
});

test("a bomber with a nuclear bomb lets one go, and it is one blast", () => {
  const laid = plan({ weapon: "nuclear bomber", count: 3 }, { from: LONDON, to: MOSCOW });
  assert.deepEqual([laid.aircraft, laid.nuclear], [true, true]);
  // The first of them to get there carries it.
  const first = laid.units.reduce((best, unit) => (unit.start < best.start ? unit : best));
  assert.equal(laid.bomber, first.index);
  // It falls from the aircraft, and where it lands there is one fireball (with its glow), not three.
  const fallingAt = first.start + first.flight * 0.9 + 0.4;
  const dropping = seen(laid, fallingAt);
  assert.equal(dropping.glows.length, 1);
  assert.ok(dropping.glows[0].at[2] > 0 && dropping.glows[0].at[2] < AIRCRAFT_HEIGHT_KM);
  assert.equal(dropping.items.discs.length, 0);
  let most = 0;
  for (let seconds = 0; seconds <= laid.lasts; seconds += 0.1) most = Math.max(most, strikeItemsAt(laid, seconds).discs.length);
  assert.equal(most, 2);
  const blast = seen(laid, first.start + first.flight * 0.9 + 0.9 + 0.2);
  assert.ok(rangeKm(blast.items.discs[0].centre, MOSCOW) < 1);
  // Shot down, the one that carried it lets nothing go: the next to arrive does.
  const one = plan({ weapon: "nuclear bomber", count: 1, down: 1 });
  assert.deepEqual([one.bomber, one.hits], [-1, false]);
  for (let seconds = 0; seconds <= one.lasts; seconds += 0.2) assert.equal(strikeItemsAt(one, seconds).discs.length, 0);
});

test("a submarine's missile breaks the water it leaves", () => {
  const laid = plan({ weapon: "submarine missile" }, { from: [-40, 45], to: WASHINGTON });
  const start = seen(laid, laid.units[0].flight * 0.05);
  assert.equal(start.rings.length, 1);
  assert.ok(rangeKm(start.rings[0].at, [-40, 45]) < 1);
  assert.equal(seen(plan(), plan().units[0].flight * 0.05).rings.length, 0, "a silo's does not");
});

test("the layer's vertices: twelve numbers each, heights in metres, a ribbon two triangles a stretch", () => {
  const ring = ringOf(LONDON, 100, 3);
  assert.equal(ring.length, 49);
  assert.ok(ring.every((point) => Math.abs(rangeKm([point[0], point[1]], LONDON) - 100) < 0.5 && point[2] === 3));
  assert.deepEqual(ring[0].slice(0, 2).map((value) => value.toFixed(6)), ring[48].slice(0, 2).map((value) => value.toFixed(6)), "it closes");
  const items = {
    ribbons: [{ points: [[0, 0, 10], [10, 0, 20], [20, 0, 30]], width: 2.5, colour: [1, 0.5, 0.25], from: 0, to: 1 }],
    points: [{ at: [10, 20, 5], toward: [11, 20, 5], size: 17, shape: 1, colour: [0.9, 0.9, 0.9], alpha: 0.5 }, { at: [0, 0, 0], size: 9, shape: 0, colour: [1, 1, 1], alpha: 1 }],
    discs: [{ centre: [0, 0], km: 50, colour: [1, 0.7, 0.2], alpha: 0.8, rim: ringOf([0, 0], 50, 1) }],
  };
  const { ribbons, points } = buildStrikeVertices(items);
  // Two stretches of six vertices, then the disc: three for each of its 48 slices.
  assert.equal(ribbons.length, (2 * 6 + 48 * 3) * 12);
  assert.equal(points.length, 2 * 12);
  // The first vertex: the map's own flat coordinates (0 to 1), its height in metres, its neighbour, its side and width, its colour.
  assert.deepEqual(Array.from(ribbons.slice(0, 12)).map((value) => Number(value.toFixed(4))), [0.5, 0.5, 10000, 0.5278, 0.5, 20000, 1, 2.5, 1, 0.5, 0.25, 0]);
  // A ribbon fades along its length: the last vertex of its last stretch is at its end.
  assert.equal(ribbons[(2 * 6 - 1) * 12 + 11], 1);
  // A point: where it is, what it faces, its shape and size.
  assert.deepEqual(Array.from(points.slice(0, 12)).map((value) => Number(value.toFixed(4))), [0.5278, 0.4433, 5000, 0.5306, 0.4433, 5000, 1, 17, 0.9, 0.9, 0.9, 0.5]);
  // One with nowhere to face faces itself.
  assert.deepEqual(Array.from(points.slice(12, 18)), [0.5, 0.5, 0, 0.5, 0.5, 0]);
  // A longitude past the date line stays past it: the way is one way.
  assert.ok(buildStrikeVertices({ points: [{ at: [200, 0, 0], size: 1, shape: 0, colour: [1, 1, 1], alpha: 1 }] }).points[0] > 1);
  assert.deepEqual([buildStrikeVertices(null).ribbons.length, buildStrikeVertices({}).points.length], [0, 0]);
});

test("a flat map that repeats is drawn the strike on every copy of the world in view", () => {
  // Looking at one world: it, and one to each side for a way that runs over its edge.
  assert.deepEqual(worldCopies({ west: -120, east: 60 }), [-1, 0, 1]);
  // Far out, three worlds in view.
  assert.deepEqual(worldCopies({ west: -400, east: 400 }), [-2, -1, 0, 1, 2]);
  // The camera has gone round to the next world.
  assert.deepEqual(worldCopies({ west: 300, east: 420 }), [0, 1, 2]);
  // A globe is one world, as is a map that does not repeat, and a view that cannot be read.
  assert.deepEqual(worldCopies({ west: -120, east: 60, globe: true }), [0]);
  assert.deepEqual(worldCopies({ west: -120, east: 60, repeats: false }), [0]);
  assert.deepEqual(worldCopies({}), [0]);
  assert.equal(worldCopies({ west: -5000, east: 5000 }).length, WORLD_COPIES_MOST);
  const layer = read("./strikeCustomLayer.js");
  assert.match(layer, /projectTileWithElevation\(a_pos \+ copy, a_height \* u_lift\)/);
  assert.match(layer, /renderingMode: "2d"/);
  // Lifted on the globe only.
  assert.match(layer, /const lift = globeness > 0\.999 \? 1 : 0;/);
});

test("a place the turn could not find is looked for among the places the map knows by name", () => {
  const entries = [
    { source: "city", aliases: ["brod"], lng: 51, lat: 45, weight: 60 },
    { source: "polity", aliases: ["brod", "republic of brod"], lng: 55, lat: 40, weight: 100 },
    { source: "polity", aliases: ["aland"], lng: 3, lat: 46, weight: 100 },
    { source: "marker", aliases: ["silo north"], lng: 5, lat: 47, weight: 30 },
    { source: "city", aliases: ["ghost"], lng: Number.NaN, lat: 4, weight: 9 },
  ];
  // Of the kind it was written with; with no kind, the weightier of that name.
  assert.deepEqual(findPlaceEntry(entries, "city: Brod"), [51, 45]);
  assert.deepEqual(findPlaceEntry(entries, "country: Brod"), [55, 40]);
  assert.deepEqual(findPlaceEntry(entries, "Brod"), [55, 40]);
  assert.deepEqual(findPlaceEntry(entries, "structure: Silo  NORTH"), [5, 47]);
  assert.equal(findPlaceEntry(entries, "city: Atlantis"), null);
  assert.equal(findPlaceEntry(entries, "Ghost"), null);
  assert.equal(findPlaceEntry(null, "Brod"), null);
  // What the strike already carries is taken as it is.
  assert.deepEqual(strikeEnds({ owner: "Aland", from: { name: "x", lng: 1, lat: 2 }, to: { name: "y", lng: 3, lat: 4 } }, entries), { from: [1, 2], to: [3, 4] });
  // A named place is found; one launched from nowhere known sets off from its owner's country.
  assert.deepEqual(strikeEnds({ owner: "Aland", from: { name: "structure: Silo North", lng: null, lat: null }, to: { name: "city: Brod", lng: null, lat: null } }, entries), { from: [5, 47], to: [51, 45] });
  assert.deepEqual(strikeEnds({ owner: "Aland", from: null, to: { name: "city: Brod", lng: null, lat: null } }, entries), { from: [3, 46], to: [51, 45] });
  assert.deepEqual(strikeEnds({ owner: "Carpathia", from: null, to: { name: "city: Atlantis" } }, entries), { from: null, to: null });
});

test("who asks the map to play a strike: an event coming into view, or a card that wants it again", () => {
  forgetStrikeRequests();
  assert.equal(getStrikeRequest(), null);
  let heard = 0;
  const stop = subscribeStrikeRequests(() => {
    heard += 1;
  });
  showStrikesOfEvent("e1");
  assert.deepEqual([getStrikeRequest().eventId, getStrikeRequest().ids, getStrikeRequest().again], ["e1", null, false]);
  const first = getStrikeRequest().serial;
  // The same event again is asked again: the map decides whether it has only just played it.
  showStrikesOfEvent("e1");
  assert.ok(getStrikeRequest().serial > first);
  replayStrikes({ eventId: "e2" });
  assert.deepEqual([getStrikeRequest().eventId, getStrikeRequest().again], ["e2", true]);
  replayStrikes({ ids: ["s1", " ", "s2"] });
  assert.deepEqual(getStrikeRequest().ids, ["s1", "s2"]);
  assert.equal(heard, 4);
  // Nothing asked is nothing heard.
  showStrikesOfEvent("");
  replayStrikes({});
  replayStrikes({ ids: [] });
  assert.equal(heard, 4);
  stop();
  showStrikesOfEvent("e3");
  assert.equal(heard, 4);
  forgetStrikeRequests();
});

test("the strikes are wired to the map and to the Events panel", () => {
  // Above everything else the map draws.
  assert.equal(STRIKE_LAYER_ID, "strikes-flight");
  assert.equal(MAP_LAYER_ORDER.at(-1), STRIKE_LAYER_ID);
  assert.ok(MAP_LAYER_ORDER.indexOf(STRIKE_LAYER_ID) > MAP_LAYER_ORDER.indexOf("units-name"));
  assert.match(read("./MapScene.jsx"), /<TransportLayers \/>\s*<StrikeLayers \/>/);
  const layers = read("./StrikeLayers.jsx");
  // The world's strikes, played when a turn lands (not what a game already held), and when asked.
  assert.match(layers, /useRuntimeState\("world", selectStrikes\)/);
  assert.match(layers, /const fresh = strikes\.filter\(\(strike\) => !before\.has\(strike\.id\)\);/);
  assert.match(layers, /subscribeStrikeRequests\(/);
  // Laid out for the map it is on, and never played for someone who asked for no motion.
  assert.match(layers, /planStrike\(strike, \{ \.\.\.ends, flat, kmPerPixel \}\)/);
  assert.match(layers, /reduceMotionEnabled\(\)/);
  // Its layer is put back after a change of style, in its place in the order.
  assert.match(layers, /map\.on\("styledata", put\)/);
  assert.match(layers, /enforceMapLayerOrder\(map\)/);
  assert.match(layers, /window\.__OH_STRIKES__ = probe/);
  // The Events panel: an event coming into view plays what it tells of, and its card can play it again.
  const panel = read("../GameUI/time.jsx");
  assert.match(panel, /if \(activeVisibleEventId\) showStrikesOfEvent\(activeVisibleEventId\);/);
  assert.match(panel, /eventStrikes: \(event\) => strikesOfEvent\(worldStrikes, event\?\.id\)/);
  assert.match(panel, /replayStrikes\(\{ eventId: event\?\.id \}\)/);
  assert.match(panel, /\{struck && <StrikePill onWatch=\{\(\) => lookups\?\.watchStrikes\?\.\(event\)\} \/>\}/);
  assert.match(panel, /Watch it on the map/);
  // A place a distance from another is that far from it.
  assert.ok(Math.abs(rangeKm(placeFrom(LONDON, 77, 500), LONDON) - 500) < 0.5);
});
