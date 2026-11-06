// Run: node --test src/Game/Map/frontPaint.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PAINT_OWN_A, PAINT_OWN_B, PAINT_WALL } from "../../runtime/fronts/codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL } from "../../runtime/fronts/constants.js";
import { frontViewOf, normalizeBattlefield } from "../../runtime/fronts/record.js";
import { createReplayRecorder } from "../../runtime/fronts/replay.js";
import { projectorOf } from "../../runtime/fronts/frame.js";
import { FILL_DAYS, createFrontField, createPaintPlayer, landMask, paintPixels, paintScaleFor, pictureFits, pictureCorners, touchedCells, writeFrontField , viewWithin } from "./frontPaint.js";

const COLS = 24;
const ROWS = 12;
const frame = { lng0: 30, lat0: 46, cell: 0.1, cols: COLS, rows: ROWS, km: 8 };
const sides = [["Russia", "Belarus"], ["Ukraine"]];
const at = (col, row) => row * COLS + col;

// Side A west of `line`, side B east of it; the two southern rows are sea; the
// home ground of the two meets at column 12. North of row 8 it is Belarus's
// troops that take ground.
const groundAt = (line, when = null) => {
  const holders = new Uint8Array(COLS * ROWS);
  const painters = new Uint8Array(COLS * ROWS);
  const homes = new Uint8Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const cell = at(col, row);
      holders[cell] = row < 2 ? HOLDER_WALL : col < line ? HOLDER_SIDE_A : HOLDER_SIDE_B;
      homes[cell] = row < 2 ? 2 : col < 12 ? 0 : 1;
      painters[cell] = row >= 8 ? 1 : 0;
    }
  }
  return { holders, painters, homes, ...(when ? { when } : {}) };
};

const viewOf = (lines, whenOf = null) => {
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  lines.forEach((line, day) => recorder.record(day, [[], []], groundAt(line, whenOf ? whenOf(day) : null)));
  return frontViewOf(normalizeBattlefield({
    name: "Eastern Ukraine",
    sides,
    frame,
    replay: recorder.finish({ date: "2024-03-01", days: lines.length - 1 }),
  }));
};

// Russia red, Belarus green, Ukraine blue, each fully solid.
const palette = new Uint8Array(32 * 4);
palette.set([200, 0, 0, 255], 4);
palette.set([0, 200, 0, 255], 8);
palette.set([0, 0, 200, 255], 12);

const picture = (scale = 4) => ({ data: new Uint8ClampedArray(COLS * scale * ROWS * scale * 4), width: COLS * scale, height: ROWS * scale, scale });
// The pixel at the middle of a cell, as [red, green, blue, alpha].
const pixelAt = (target, col, row) => {
  const x = Math.floor((col + 0.5) * target.scale);
  const y = target.height - 1 - Math.floor((row + 0.5) * target.scale);
  return [...target.data.subarray((y * target.width + x) * 4, (y * target.width + x) * 4 + 4)];
};

test("the ground is played to any day of the run, forwards and back", () => {
  const player = createPaintPlayer(viewOf([12, 14, 14, 10]));
  assert.deepEqual(player.bounds, { minCol: 10, maxCol: 13, minRow: 2, maxRow: 11 }, "the cells that are painted at any time in the run");
  assert.equal(player.state[at(12, 5)], PAINT_OWN_B, "as it began, nothing is painted");
  assert.equal(player.state[at(11, 5)], PAINT_OWN_A);
  assert.equal(player.state[at(12, 0)], PAINT_WALL);
  assert.deepEqual([player.sideOf(PAINT_OWN_A), player.sideOf(1), player.sideOf(2), player.sideOf(3), player.sideOf(PAINT_OWN_B)], [0, 0, 0, 1, 1]);

  player.seek(1);
  assert.equal(player.state[at(12, 5)], 1, "Russia's");
  assert.equal(player.state[at(13, 9)], 2, "Belarus's");
  assert.equal(player.since[at(12, 5)], 1);
  player.seek(0.9);
  assert.equal(player.state[at(12, 5)], PAINT_OWN_B, "before it was taken");
  player.seek(3);
  assert.equal(player.state[at(12, 5)], PAINT_OWN_B, "taken back: its own again");
  assert.equal(player.was[at(12, 5)], 1);
  assert.equal(player.state[at(11, 5)], 3, "and Ukraine has taken some of Russia's");
  assert.equal(player.day, 3);

  const none = createPaintPlayer(viewOf([12, 12]));
  assert.equal(none.bounds, null, "a run in which no ground is held away from home paints nothing");
  assert.equal(paintPixels(none, palette, picture()), null);
});

test("taken ground is painted in the colour of whose troops took it, to the coast and no further", () => {
  const player = createPaintPlayer(viewOf([12, 16]));
  player.seek(1 + FILL_DAYS + 1);
  const target = picture();
  const area = paintPixels(player, palette, target);
  assert.ok(area.width > 0 && area.height > 0);
  assert.deepEqual(pixelAt(target, 13, 5), [200, 0, 0, 255], "Russia's troops took the south");
  assert.deepEqual(pixelAt(target, 14, 10), [0, 200, 0, 255], "Belarus's the north");
  assert.equal(pixelAt(target, 9, 5)[3], 0, "home ground is not painted: the map draws it as it always did");
  assert.equal(pixelAt(target, 18, 5)[3], 0);
  // Against its own side's home ground the paint does not stop at the old
  // border: it runs half a cell on, so no sliver of the other side's colour
  // is left along it.
  const border = Math.floor(5.5 * target.scale);
  const row = target.height - 1 - border;
  const alphaAt = (x) => target.data[(row * target.width + x) * 4 + 3];
  assert.equal(alphaAt(12 * target.scale - 1), 255, "the last pixel before the old border");
  assert.equal(alphaAt(12 * target.scale - target.scale / 2), 255);
  assert.equal(alphaAt(12 * target.scale - target.scale / 2 - 1), 0, "and no further than half a cell");
  // The sea is never painted, and the colour runs up to it without thinning.
  assert.equal(pixelAt(target, 13, 1)[3], 0);
  assert.equal(pixelAt(target, 13, 0)[3], 0);
  assert.deepEqual(pixelAt(target, 13, 2), [200, 0, 0, 255]);
  const lowestLandRow = target.height - 1 - 2 * target.scale;
  const x = Math.floor(13.5 * target.scale);
  assert.equal(target.data[(lowestLandRow * target.width + x) * 4 + 3], 255, "solid to the last pixel of land");
  assert.equal(target.data[((lowestLandRow + 1) * target.width + x) * 4 + 3], 0, "and nothing on the first of sea");
});

test("the edge of the colour lies between the cells, smooth, not on their squares", () => {
  const player = createPaintPlayer(viewOf([12, 16]));
  player.seek(9);
  const target = picture(6);
  paintPixels(player, palette, target);
  // Along a row of pixels through the middle of the land: solid inside, clear
  // outside, and a few pixels of rise between, at the border of the cells.
  const y = target.height - 1 - Math.floor(5.5 * target.scale);
  const alpha = (x) => target.data[(y * target.width + x) * 4 + 3];
  const eastEdge = 16 * target.scale;
  assert.equal(alpha(eastEdge - target.scale), 255);
  assert.equal(alpha(eastEdge + target.scale), 0);
  const rising = [];
  for (let x = eastEdge - target.scale; x <= eastEdge + target.scale; x += 1) rising.push(alpha(x));
  assert.deepEqual(rising, [...rising].sort((a, b) => b - a), "falls steadily across the edge");
  assert.ok(rising.some((value) => value > 0 && value < 255), "with a soft step, not a stair");
  const half = rising.findIndex((value) => value < 128);
  assert.ok(Math.abs(half - target.scale) <= 1, "half-way at the border between the two cells");
});

test("an edge that runs aslant across the cells is drawn as a slant, not a stair", () => {
  // Side A holds everything west of a line that steps a column east with every row.
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  const slant = (shift) => {
    const ground = groundAt(12);
    for (let row = 2; row < ROWS; row += 1) {
      for (let col = 12; col < 12 + shift + (row - 2); col += 1) if (col < COLS) ground.holders[at(col, row)] = HOLDER_SIDE_A;
    }
    return ground;
  };
  recorder.record(0, [[], []], groundAt(12));
  recorder.record(1, [[], []], slant(1));
  const view = frontViewOf(normalizeBattlefield({ name: "Slant", sides, frame, replay: recorder.finish({ days: 1 }) }));
  const player = createPaintPlayer(view);
  player.seek(9);
  const target = picture(6);
  paintPixels(player, palette, target);
  // Where the colour ends on each row of pixels through the middle rows: it
  // moves east a little with every row, never in jumps of a whole cell.
  const edges = [];
  for (let y = target.height - 1 - 4 * target.scale; y > target.height - 1 - 9 * target.scale; y -= 1) {
    let edge = 0;
    for (let x = 0; x < target.width; x += 1) if (target.data[(y * target.width + x) * 4 + 3] >= 128) edge = x;
    edges.push(edge);
  }
  const steps = edges.slice(1).map((edge, index) => edge - edges[index]);
  assert.ok(steps.every((step) => step >= 0 && step <= 2), `the edge creeps, a pixel or two a row: ${steps.join(" ")}`);
  assert.ok(Math.abs((edges.at(-1) - edges[0]) - 5 * target.scale) <= target.scale, "by a column for every row all told");
});

test("the colour grows into a cell over the part of a day after it is taken", () => {
  // The four columns are reached a quarter of a day apart.
  const view = viewOf([12, 16], (day) => {
    if (day !== 1) return null;
    const when = new Float32Array(COLS * ROWS);
    for (let row = 0; row < ROWS; row += 1) for (let col = 12; col < 16; col += 1) when[at(col, row)] = (col - 12 + 1) / 4;
    return when;
  });
  const player = createPaintPlayer(view);
  const width = (day) => {
    player.seek(day);
    const target = picture();
    paintPixels(player, palette, target);
    const y = target.height - 1 - Math.floor(5.5 * target.scale);
    let painted = 0;
    for (let x = 0; x < target.width; x += 1) if (target.data[(y * target.width + x) * 4 + 3] >= 128) painted += 1;
    return painted / target.scale;
  };
  const widths = [0.2, 0.5, 0.8, 1.1, 1.4, 1.7, 3].map(width);
  assert.equal(widths[0], 0, "nothing before the first cell is reached");
  assert.deepEqual(widths, [...widths].sort((a, b) => a - b), "it only ever spreads");
  for (let index = 1; index < 6; index += 1) assert.ok(widths[index] > widths[index - 1], "and spreads by degrees");
  assert.ok(Math.abs(widths.at(-1) - 4.5) < 0.3, `its four cells, and half a cell on over its own side's ground: ${widths.at(-1)}`);
});

test("ground taken back loses its colour over the part of a day, and one colour over another changes at once", () => {
  const player = createPaintPlayer(viewOf([12, 16, 12]));
  const solidOn = (day) => {
    player.seek(day);
    const target = picture();
    paintPixels(player, palette, target);
    return pixelAt(target, 13, 5)[3];
  };
  assert.equal(solidOn(1.99), 255);
  assert.ok(solidOn(2 + FILL_DAYS / 2) < 255);
  assert.equal(solidOn(2 + FILL_DAYS + 0.01), 0);
});

test("a picture has enough pixels to a cell for a smooth edge, and never more than about a thousand across", () => {
  assert.equal(paintScaleFor(40, 40), 6);
  assert.equal(paintScaleFor(202, 226), 4);
  assert.equal(paintScaleFor(255, 255), 4);
  assert.equal(paintScaleFor(600, 100), 2);
});

test("a picture the map already has takes another run of the same frame, and no other", () => {
  // As FrontLayers.jsx makes one: so many pixels to a cell, laid corner to corner on the frame.
  const pictureOf = (given) => {
    const scale = paintScaleFor(given.cols, given.rows);
    const { toLngLat } = projectorOf(given);
    const [west, north] = toLngLat(0, given.rows);
    const [east, south] = toLngLat(given.cols, 0);
    return { canvas: { width: given.cols * scale, height: given.rows * scale }, coordinates: [[west, north], [east, north], [east, south], [west, south]] };
  };
  const picture = pictureOf(frame);
  // The next turn's run of the same battlefield: the same frame, another replay. It is played on the same canvas.
  assert.equal(pictureFits(picture, { ...frame }), true);
  // A frame that grew, or was laid somewhere else, needs a picture of its own.
  assert.equal(pictureFits(picture, { ...frame, cols: COLS + 4 }), false);
  assert.equal(pictureFits(picture, { ...frame, rows: ROWS + 1 }), false);
  assert.equal(pictureFits(picture, { ...frame, lng0: frame.lng0 + 0.5 }), false);
  assert.equal(pictureFits(picture, { ...frame, lat0: frame.lat0 - 0.5 }), false);
  for (const nothing of [[null, frame], [picture, null], [{}, frame], [{ canvas: picture.canvas }, frame]]) assert.equal(pictureFits(...nothing), false);
});

test("a part of the picture is drawn alone, and the rest of it is left as it is", () => {
  const player = createPaintPlayer(viewOf([14, 14]));
  player.seek(1);
  const whole = picture();
  paintPixels(player, palette, whole);
  // A change, drawn into a copy of that picture as its own small part only: three cells of the edge turned Russia's.
  for (const row of [6, 7, 8]) {
    player.was[at(14, row)] = player.state[at(14, row)];
    player.state[at(14, row)] = 1;
    player.since[at(14, row)] = -1e6;
  }
  const box = { minCol: 14, maxCol: 14, minRow: 6, maxRow: 8 };
  const part = picture();
  part.data.set(whole.data);
  const area = paintPixels(player, palette, part, box);
  assert.ok(area.width < part.width && area.height < part.height, "a small part of it");
  assert.ok(area.width >= 3 * part.scale && area.height >= 5 * part.scale, "wide enough for the edge it moves");
  // It is the same picture as drawing all of it again would give.
  const again = picture();
  paintPixels(player, palette, again);
  assert.deepEqual(part.data, again.data);
  assert.notDeepEqual(part.data, whole.data);
  // And nothing outside that part was written at all.
  const marked = picture();
  marked.data.fill(77);
  const drawn = paintPixels(player, palette, marked, box);
  for (let y = 0; y < marked.height; y += 1) {
    for (let x = 0; x < marked.width; x += 1) {
      const inside = x >= drawn.x && x < drawn.x + drawn.width && y >= drawn.y && y < drawn.y + drawn.height;
      if (!inside) assert.equal(marked.data[(y * marked.width + x) * 4 + 3], 77, `pixel ${x}, ${y} was left alone`);
    }
  }
  // A part where nothing is painted at any time is no part at all.
  assert.equal(paintPixels(player, palette, picture(), { minCol: 2, maxCol: 3, minRow: 4, maxRow: 5 }), null);
});

test("the colour ends at the land's own edge where the picture is given one, not on the squares of the cells", () => {
  // Russia holds to column 14, so columns 12 and 13 are painted; rows 0 and 1 are sea.
  const player = createPaintPlayer(viewOf([14, 14]));
  player.seek(1);
  const plain = picture();
  paintPixels(player, palette, plain);
  const maskOf = (inCell) => {
    const target = picture();
    target.mask = new Uint8Array(target.width * target.height);
    for (let y = 0; y < target.height; y += 1) {
      for (let x = 0; x < target.width; x += 1) {
        const col = Math.floor(x / target.scale);
        const row = Math.floor(ROWS - (y + 0.5) / target.scale);
        target.mask[y * target.width + x] = inCell(col, row, x, y, target);
      }
    }
    return target;
  };
  // A mask that says what the cells say changes nothing.
  const same = maskOf((col, row) => (row < 2 ? 0 : 255));
  paintPixels(player, palette, same);
  assert.deepEqual(same.data, plain.data);
  // The land reaches half way into the cells that count as sea: the colour runs out to there, and no further.
  const coast = maskOf((col, row, x, y, target) => (row >= 2 ? 255 : y < target.height - 1.5 * target.scale ? 255 : 0));
  paintPixels(player, palette, coast);
  const pixel = (target, x, y) => [...target.data.subarray((y * target.width + x) * 4, (y * target.width + x) * 4 + 4)];
  const xMid = Math.floor(13.5 * coast.scale);
  const yLandward = coast.height - 1 - Math.floor(1.75 * coast.scale);
  const ySeaward = coast.height - 1 - Math.floor(1.25 * coast.scale);
  assert.equal(pixel(plain, xMid, yLandward)[3], 0, "by the cells alone it stops at the square");
  assert.deepEqual(pixel(coast, xMid, yLandward), [200, 0, 0, 255], "with the land's shape it reaches the shore, in the colour of the land beside it");
  assert.equal(pixel(coast, xMid, ySeaward)[3], 0, "and not the water beyond");
  assert.equal(pixel(coast, Math.floor(16.5 * coast.scale), yLandward)[3], 0, "where the land beside it is not painted, neither is this");
  // The sea reaches into a cell that counts as land: the colour is cut back to the shore.
  const bay = maskOf((col, row, x, y, target) => (row < 2 ? 0 : row === 2 && y > target.height - 2.5 * target.scale ? 0 : 255));
  paintPixels(player, palette, bay);
  assert.equal(pixel(bay, xMid, bay.height - 1 - Math.floor(2.125 * bay.scale))[3], 0);
  assert.equal(pixel(bay, xMid, bay.height - 1 - Math.floor(2.75 * bay.scale))[3], 255);
  // A pixel that is half land is half painted.
  const half = maskOf((col, row) => (row < 2 ? 0 : 128));
  paintPixels(player, palette, half);
  assert.ok(Math.abs(pixelAt(half, 13, 5)[3] - 128) <= 1);
});

// A player's crash log (2026-10-11): "x=4, y=1, z=2 outside of bounds" from the map as a war
// between the United States and Canada was painted, and then "source id changed".
test("a picture's corners lie in the map's own copy of the world, whatever turn its frame was told in", () => {
  assert.deepEqual(pictureCorners(20, 52, 28, 46), [[20, 52], [28, 52], [28, 46], [20, 46]]);
  // A frame over North America told a whole turn to the east: the same picture, where the map can place it.
  assert.deepEqual(pictureCorners(215, 62, 300, 40), [[-145, 62], [-60, 62], [-60, 40], [-145, 40]]);
  assert.deepEqual(pictureCorners(-520, 10, -500, 0), [[-160, 10], [-140, 10], [-140, 0], [-160, 0]]);
  // One that reaches over the date line keeps its width, its middle in range.
  const [[west], [east]] = pictureCorners(170, 60, 200, 50);
  assert.deepEqual([west, east], [-190, -160]);
  assert.equal(east - west, 30);
  const [[far], [farEast]] = pictureCorners(175, 60, 215, 50);
  assert.deepEqual([far, farEast], [-185, -145]);
  // Each picture is a source of its own to the map by its slot: one given another slot is declared afresh.
  const layers = fs.readFileSync(new URL("./FrontLayers.jsx", import.meta.url), "utf8");
  assert.ok(layers.includes("key: `${entry.slot}:${entry.target.name}:"));
  assert.ok(layers.includes("coordinates: onto?.coordinates ?? pictureCorners(west, north, east, south),"));
});

test("on the diplomatic map a battlefield's ground is painted in the stances' colours, as the regions round it are", () => {
  // "the drawn territory remains the same color on the diplomatic map making it not be the same color as your country"
  // (the owner, 2026-10-15).
  const layers = fs.readFileSync(new URL("./FrontLayers.jsx", import.meta.url), "utf8");
  assert.ok(layers.includes("mapMode === \"diplomatic\" ? buildDiplomaticStanceMap({ playerCountry, wars, agreements, relations, puppets }) : null"));
  assert.ok(layers.includes("stances ? parseColorToRgb(getDiplomaticOwnerColor(name, stances)) ?? UNOWNED_RGB : rgbOf(name)"));
  assert.ok(layers.includes("const [red, green, blue] = colorRef.current.groundRgbOf(name);"));
  assert.ok(layers.includes("}, [colorMap, polityOverrides, groups, stances]);"), "a change of map repaints the ground");
});

test("the front's field: half-way where the two sides' ground meets, and nowhere else", () => {
  const view = viewOf([12, 14]);
  const player = createPaintPlayer(view);
  player.seek(1 + FILL_DAYS);
  const touched = touchedCells(view);
  assert.equal(touched[at(12, 5)], 1, "a cell the run paints");
  assert.equal(touched[at(15, 5)], 1, "and two beyond it");
  assert.equal(touched[at(2, 5)], 0, "but not ground far from the front");
  const front = writeFrontField(player, createFrontField(COLS, ROWS, null, touched));
  assert.equal(front.version, 1);
  // A pixel a cell, north up: red how far it is side 1's.
  const red = (col, row) => front.data[((ROWS - 1 - row) * COLS + col) * 4];
  const green = (col, row) => front.data[((ROWS - 1 - row) * COLS + col) * 4 + 1];
  const blue = (col, row) => front.data[((ROWS - 1 - row) * COLS + col) * 4 + 2];
  assert.ok(red(2, 5) < 10 && red(21, 5) > 245, "deep in each side's ground");
  assert.ok(red(13, 5) < 128 && red(14, 5) > 128, "half-way between the last taken cell and the first of the other side's");
  assert.ok(red(11, 5) < 128 && red(12, 5) < 128, "no line along the old border the taker has crossed");
  // Sea takes the land beside it: no line along the coast.
  assert.equal(blue(5, 0), 0);
  assert.equal(blue(5, 5), 255);
  assert.ok(Math.abs(red(5, 1) - red(5, 2)) < 40 && red(5, 1) < 128, "the sea beside side A's coast reads as side A's");
  assert.ok(red(20, 1) > 128, "and beside side B's, as side B's");
  assert.equal(green(13, 5), 255);
  assert.equal(green(2, 5), 0);
  // A day the battlefield is not shown draws no line.
  writeFrontField(player, front, false);
  assert.equal(green(13, 5), 0);
  assert.equal(front.version, 2);
});

// The mask as it was first made, a pixel at a time from the whole drawing: the quicker one has to match it exactly.
const landMaskByPixel = ({ width, height, scale, cols, rows, state, drawing, x0, x1, y0, y1 }) => {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = Math.min(rows - 1, Math.max(0, Math.floor(rows - (y + 0.5) / scale)));
    const seen = y >= y0 && y < y1;
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      if (seen && x >= x0 && x < x1) mask[at] = drawing[at * 4 + 3];
      else mask[at] = state[row * cols + Math.min(cols - 1, Math.floor(x / scale))] === PAINT_WALL ? 0 : 255;
    }
  }
  return mask;
};

test("a picture's land mask reads only the part on the screen, and is the same as one read from the whole drawing", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (const [cols, rows, scale] of [[24, 12, 4], [31, 17, 3], [9, 40, 6], [5, 5, 2]]) {
    const width = cols * scale;
    const height = rows * scale;
    const state = Uint8Array.from({ length: cols * rows }, () => (random() < 0.3 ? PAINT_WALL : PAINT_OWN_A));
    const drawing = Uint8ClampedArray.from({ length: width * height * 4 }, () => Math.floor(random() * 256));
    const windows = [[0, width, 0, height], [0, 0, 0, 0], [width, width, 0, height], [3, 3, 2, 9], [0, width, height, height]];
    for (let index = 0; index < 40; index += 1) {
      const a = Math.floor(random() * (width + 1));
      const b = Math.floor(random() * (height + 1));
      windows.push([a, Math.min(width, a + Math.floor(random() * width)), b, Math.min(height, b + Math.floor(random() * height))]);
    }
    for (const [x0, x1, y0, y1] of windows) {
      const seen = x0 < x1 && y0 < y1;
      // What the page reads back: the window alone, or nothing when none of it is on the screen.
      const shape = seen ? new Uint8ClampedArray((x1 - x0) * (y1 - y0) * 4) : null;
      for (let y = y0; seen && y < y1; y += 1) {
        shape.set(drawing.subarray((y * width + x0) * 4, (y * width + x1) * 4), (y - y0) * (x1 - x0) * 4);
      }
      const used = new Uint8Array(width * height).fill(9);
      const quick = landMask(used, { width, height, scale, cols, rows, state, shape, x0, x1, y0, y1 });
      assert.equal(quick, used, "written into the mask it is given");
      assert.deepEqual(quick, landMaskByPixel({ width, height, scale, cols, rows, state, drawing, x0, x1, y0, y1 }), `${cols}x${rows} at ${scale}, window ${[x0, x1, y0, y1]}`);
    }
  }
  const layers = fs.readFileSync(new URL("./FrontLayers.jsx", import.meta.url), "utf8");
  assert.ok(layers.includes("const shape = onScreen ? context.getImageData(x0, y0, x1 - x0, y1 - y0).data : null;"));
  assert.ok(layers.includes("return landMask(mask, { width, height, scale, cols, rows, state, shape, x0, x1, y0, y1 });"));
});

// A playing writes each battlefield's field every frame: a later day of the same run rewrites only the rows round
// the run's cells, or nothing at all, and has to come out as a field written anew for that day.
test("a later day of a run rewrites only the rows round its cells, and comes out as a field written anew", () => {
  const view = viewOf([12, 14, 14, 10, 11, 15, 15, 9]);
  const touched = touchedCells(view);
  const days = [];
  for (let day = 0; day <= 7.6; day += 0.05) days.push(day);
  days.push(3.2, 1.1, 6.4, 0, 7.6, 7.6);
  const H = ROWS * 2 + 3;
  const uneven = Array.from({ length: H }, (_, y) => ROWS * (1 - ((y + 0.5) / H) ** 1.3));
  for (const rowOf of [null, uneven]) {
    const player = createPaintPlayer(view);
    const front = createFrontField(COLS, ROWS, rowOf, touched);
    let before = null;
    let versionBefore = -1;
    for (const [index, day] of days.entries()) {
      const shown = index % 37 !== 5;
      player.seek(day);
      writeFrontField(player, front, shown);
      const anew = createPaintPlayer(view);
      anew.seek(day);
      const fresh = writeFrontField(anew, createFrontField(COLS, ROWS, rowOf, touched), shown);
      assert.deepEqual(front.data, fresh.data, `${rowOf ? "uneven" : "even"} rows, day ${day.toFixed(2)}`);
      if (front.version === versionBefore) assert.deepEqual(front.data, before, "an unchanged version is an unchanged field");
      before = Uint8Array.from(front.data);
      versionBefore = front.version;
    }
  }
  // A run that paints nothing is written once.
  const still = frontViewOf(normalizeBattlefield({ name: "Quiet", sides, frame }));
  const quiet = createPaintPlayer(still);
  const field = createFrontField(COLS, ROWS, null, touchedCells(still));
  writeFrontField(quiet, field);
  writeFrontField(quiet, field);
  assert.equal(field.version, 1);
});

// What a canvas shows of a picture: no colour where nothing is.
const shownOf = (data) => data.map((value, at) => (at % 4 !== 3 && data[at - (at % 4) + 3] === 0 ? 0 : value));

test("a frame of a playing whose cells are as the last left them paints nothing, and the picture is as one painted anew", () => {
  const view = viewOf([12, 14, 14, 10, 11, 15, 15, 9]);
  const mask = new Uint8Array(COLS * 4 * ROWS * 4).map((_, at) => (at % 7 === 0 ? 120 : 255));
  for (const withMask of [false, true]) {
    // As the map paints it, one picture kept from frame to frame: asked to skip, and not.
    const quick = createPaintPlayer(view);
    const every = createPaintPlayer(view);
    const kept = { ...picture(), ...(withMask ? { mask } : {}) };
    const repainted = { ...picture(), ...(withMask ? { mask } : {}) };
    let skipped = 0;
    for (let day = 0; day <= 7.6; day += 0.05) {
      quick.seek(day);
      every.seek(day);
      if (!paintPixels(quick, palette, kept, null, { unlessUnchanged: true })) skipped += 1;
      paintPixels(every, palette, repainted);
      assert.deepEqual(kept.data, repainted.data, `${withMask ? "masked" : "unmasked"}, day ${day.toFixed(2)}`);
      const anew = createPaintPlayer(view);
      anew.seek(day);
      const fresh = { ...picture(), ...(withMask ? { mask } : {}) };
      paintPixels(anew, palette, fresh);
      assert.deepEqual(shownOf(kept.data), shownOf(fresh.data), `as painted anew, day ${day.toFixed(2)}`);
    }
    assert.ok(skipped > 10, "settled frames are not painted again");
    // Not asked to, it always paints.
    assert.ok(paintPixels(quick, palette, kept));
  }
  const layers = fs.readFileSync(new URL("./FrontLayers.jsx", import.meta.url), "utf8");
  assert.ok(layers.includes("const area = paintPixels(player, picture.palette, target, null, { unlessUnchanged: !atRest && !redressed && !picture.blank });"));
});

test("a view inside the one already masked needs no new mask", () => {
  const masked = { west: -10, south: 30, east: 40, north: 60 };
  assert.equal(viewWithin({ west: -5, south: 35, east: 35, north: 55 }, masked), true);
  assert.equal(viewWithin(masked, masked), true);
  assert.equal(viewWithin({ west: -11, south: 35, east: 35, north: 55 }, masked), false);
  assert.equal(viewWithin({ west: -5, south: 35, east: 35, north: 61 }, masked), false);
  assert.equal(viewWithin(masked, null), false);
});
