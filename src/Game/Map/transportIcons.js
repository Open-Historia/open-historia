/*! Open Historia — the map's pictures of a transporter © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A ship, a train and an aircraft, each seen from above and pointing north, so
// that the map can turn it the way its carrier is going: drawn once on a
// canvas in a flat colour (no gradient) and handed to the map as images.
// One of each for the player's own, for an enemy's, and for anybody else's.

import { transportIconId } from "./transportFeatures.js";

export const TRANSPORT_TONES = Object.freeze({ own: "#e9b949", enemy: "#e0454d", other: "#ece7da" });
const MEDIA = ["sea", "land", "air"];
const SIZE = 48;
const EDGE = "rgba(5, 8, 13, 0.92)";

// Each shape as the points of its outline, in a box 48 a side.
const SHAPES = {
  // A hull: a sharp bow, straight sides, a squared stern.
  sea: [[[24, 3], [31, 13], [33, 24], [33, 39], [29, 44], [19, 44], [15, 39], [15, 24], [17, 13]]],
  // Two carriages, one behind the other.
  land: [
    [[18, 4], [30, 4], [32, 7], [32, 21], [16, 21], [16, 7]],
    [[16, 25], [32, 25], [32, 43], [16, 43]],
  ],
  // A fuselage, swept wings and a tailplane.
  air: [[[24, 2], [27, 10], [28, 19], [45, 29], [45, 33], [28, 29], [27, 38], [33, 43], [33, 45], [24, 43], [15, 45], [15, 43], [21, 38], [20, 29], [3, 33], [3, 29], [20, 19], [21, 10]]],
};
// What is drawn on it in the edge's colour: a line down a deck, a coupling.
const MARKS = {
  sea: [[[24, 12], [24, 38]], [[19, 26], [29, 26]]],
  land: [[[24, 21], [24, 25]], [[19, 12], [29, 12]], [[19, 34], [29, 34]]],
  air: [],
};

const pictureOf = (medium, colour) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.lineJoin = "round";
  context.lineCap = "round";
  for (const outline of SHAPES[medium]) {
    context.beginPath();
    outline.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    context.closePath();
    context.fillStyle = colour;
    context.fill();
    context.lineWidth = 2.6;
    context.strokeStyle = EDGE;
    context.stroke();
  }
  context.lineWidth = 2;
  context.strokeStyle = EDGE;
  for (const [[fromX, fromY], [toX, toY]] of MARKS[medium]) {
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.lineTo(toX, toY);
    context.stroke();
  }
  return context.getImageData(0, 0, SIZE, SIZE);
};

// Puts on the map whichever of the pictures it does not have yet: asked again
// after every change of style, which takes a map's images away.
export const ensureTransportIcons = (map) => {
  if (!map?.addImage || !map?.hasImage) return false;
  let all = true;
  for (const medium of MEDIA) {
    for (const [tone, colour] of Object.entries(TRANSPORT_TONES)) {
      const id = transportIconId(medium, tone);
      try {
        if (map.hasImage(id)) continue;
        const picture = pictureOf(medium, colour);
        if (!picture) {
          all = false;
          continue;
        }
        map.addImage(id, picture, { pixelRatio: 2 });
      } catch {
        // The map is between styles: asked again when the next one has loaded.
        all = false;
      }
    }
  }
  return all;
};
