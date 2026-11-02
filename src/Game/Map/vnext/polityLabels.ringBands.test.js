// Run: node --test src/Game/Map/vnext/polityLabels.ringBands.test.js
// A long outline is tested through bands of its edges (polityLabels.js ringBandsOf), so a point visits only the
// edges near its height. Every point must get the answer the whole outline gave it before: inside, outside, or on
// the outline itself, however short the edges are.
import test from "node:test";
import assert from "node:assert/strict";

import { pointInRingStateTile } from "./polityLabels.js";

// The test as it was before the bands, every edge visited: the reference.
const onSegment = (point, a, b, epsilon = 1e-5) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const px = point[0] - a[0];
  const py = point[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= epsilon * epsilon) return px * px + py * py <= epsilon * epsilon;
  const cross = dx * py - dy * px;
  if (Math.abs(cross) > epsilon * Math.max(1, Math.sqrt(lengthSquared))) return false;
  const dot = px * dx + py * dy;
  if (dot < -epsilon) return false;
  return dot <= lengthSquared + epsilon;
};
const wholeRing = (point, ring) => {
  if (!Array.isArray(ring) || ring.length < 3) return -1;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[previous];
    const b = ring[index];
    if (onSegment(point, a, b)) return 0;
    if ((a[1] > point[1]) === (b[1] > point[1])) continue;
    const x = a[0] + ((point[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
    if (x > point[0]) inside = !inside;
  }
  return inside ? 1 : -1;
};

const randomFrom = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

// A jagged closed outline of `count` edges round (cx, cy), as an outline in tile units is: its first point again last.
const jagged = (count, cx, cy, radius, random) => {
  const ring = [];
  for (let at = 0; at < count; at += 1) {
    const angle = (at / count) * Math.PI * 2;
    const r = radius * (0.55 + 0.45 * random());
    ring.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  ring.push([...ring[0]]);
  return ring;
};

// Points that try the outline hard: anywhere about it, on its corners and edges, and just off them either side.
const pointsAbout = (ring, random, spread = 1) => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const points = [];
  const w = maxX - minX;
  const h = maxY - minY;
  for (let at = 0; at < 3000; at += 1) points.push([minX - w * 0.1 + random() * w * 1.2, minY - h * 0.1 + random() * h * 1.2]);
  for (let at = 1; at < ring.length; at += 1) {
    const [ax, ay] = ring[at - 1];
    const [bx, by] = ring[at];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const [nx, ny] = [-(by - ay) / length, (bx - ax) / length];
    points.push([ax, ay]);
    for (const t of [0.5, random(), -1e-6, 1 + 1e-6]) {
      const [x, y] = [ax + (bx - ax) * t, ay + (by - ay) * t];
      points.push([x, y]);
      for (const off of [1e-6, 9e-6, 1.1e-5, 2e-5, 3e-5].map((d) => d * spread)) {
        points.push([x + nx * off, y + ny * off], [x - nx * off, y - ny * off]);
      }
    }
  }
  points.push([minX + w / 2, minY - 1e-5], [minX + w / 2, maxY + 1e-5], [minX + w / 2, minY - 1], [minX + w / 2, maxY + 1]);
  return points;
};

const sameAsWhole = (ring, points) => {
  let differ = 0;
  const states = { 1: 0, 0: 0, [-1]: 0 };
  for (const point of points) {
    const banded = pointInRingStateTile(point, ring);
    if (banded !== wholeRing(point, ring)) differ += 1;
    states[banded] += 1;
  }
  return { differ, states };
};

test("a long outline gives every point the answer the whole outline gave it", () => {
  const random = randomFrom(7);
  const ring = jagged(2000, 2048, 2048, 900, random);
  const { differ, states } = sameAsWhole(ring, pointsAbout(ring, random));
  assert.equal(differ, 0);
  // (Points of every kind were tried.)
  assert.ok(states[1] > 500 && states[-1] > 500 && states[0] > 1000, JSON.stringify(states));
});

test("an outline of very short edges, where a point is on an edge from further off, gives the same answers", () => {
  const random = randomFrom(11);
  // Edges some 1e-4 long: pointOnSegmentTile takes a point as on one from up to about 0.14 away.
  const ring = jagged(600, 10, 10, 0.01, random);
  const { differ, states } = sameAsWhole(ring, pointsAbout(ring, random, 1000));
  assert.equal(differ, 0);
  assert.ok(states[0] > 100, JSON.stringify(states));
});

test("flat edges, repeated corners and edges along the bands' borders give the same answers", () => {
  const random = randomFrom(3);
  const ring = [];
  for (let at = 0; at <= 100; at += 1) ring.push([at, 0], [at, 0]);
  for (let at = 0; at <= 40; at += 1) ring.push([100, at], [100 - (at % 2) * 3, at + 0.5]);
  for (let at = 100; at >= 0; at -= 1) ring.push([at, 41 + (at % 7)]);
  ring.push([0, 0]);
  const points = pointsAbout(ring, random);
  for (let y = -1; y <= 50; y += 0.25) for (let x = -1; x <= 101; x += 0.5) points.push([x, y]);
  assert.equal(sameAsWhole(ring, points).differ, 0);
});

test("a short outline, a point that is not a number and an outline with a corner that is not one are tested whole", () => {
  const random = randomFrom(5);
  const short = jagged(30, 50, 50, 20, random);
  assert.equal(sameAsWhole(short, pointsAbout(short, random)).differ, 0);
  const ring = jagged(500, 50, 50, 20, random);
  for (const point of [[Number.NaN, 50], [50, Number.NaN], [Infinity, 50], [50, -Infinity]]) {
    assert.equal(pointInRingStateTile(point, ring), wholeRing(point, ring));
  }
  const broken = jagged(500, 50, 50, 20, random);
  broken[200] = [Infinity, 52];
  broken[300] = [Number.NaN, 48];
  assert.equal(sameAsWhole(broken, pointsAbout(jagged(500, 50, 50, 20, random), random)).differ, 0);
});

test("an outline asked again gives the same answers from the bands it kept", () => {
  const random = randomFrom(9);
  const ring = jagged(1000, 0, 0, 100, random);
  const points = pointsAbout(ring, random);
  const first = points.map((point) => pointInRingStateTile(point, ring));
  assert.deepEqual(points.map((point) => pointInRingStateTile(point, ring)), first);
  assert.equal(sameAsWhole(ring, points).differ, 0);
});
