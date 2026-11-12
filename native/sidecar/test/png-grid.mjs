import fs from "node:fs";
import zlib from "node:zlib";

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export const readPng = (file) => {
  const data = fs.readFileSync(file);
  if (data.toString("latin1", 1, 4) !== "PNG") throw new Error(`${file} is not a PNG file.`);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const depth = data[24];
  const colorType = data[25];
  const interlace = data[28];
  const channels = CHANNELS[colorType];
  if (!channels || (depth !== 8 && depth !== 16) || interlace !== 0) throw new Error(`${file} uses a PNG layout this test does not read (type ${colorType}, depth ${depth}, interlace ${interlace}).`);
  const chunks = [];
  for (let at = 8; at + 8 <= data.length;) {
    const size = data.readUInt32BE(at);
    const type = data.toString("latin1", at + 4, at + 8);
    if (type === "IDAT") chunks.push(data.subarray(at + 8, at + 8 + size));
    if (type === "IEND") break;
    at += 12 + size;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const bytesPer = channels * (depth / 8);
  const stride = width * bytesPer;
  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1);
    const filter = raw[base];
    const line = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const value = raw[base + 1 + x];
      const left = x >= bytesPer ? line[x - bytesPer] : 0;
      const up = previous[x];
      const corner = x >= bytesPer ? previous[x - bytesPer] : 0;
      let out = value;
      if (filter === 1) out = value + left;
      else if (filter === 2) out = value + up;
      else if (filter === 3) out = value + ((left + up) >> 1);
      else if (filter === 4) {
        const guess = left + up - corner;
        const toLeft = Math.abs(guess - left);
        const toUp = Math.abs(guess - up);
        const toCorner = Math.abs(guess - corner);
        out = value + (toLeft <= toUp && toLeft <= toCorner ? left : toUp <= toCorner ? up : corner);
      }
      line[x] = out & 255;
    }
    for (let x = 0; x < width; x++) {
      const sample = (channel) => line[x * bytesPer + channel * (depth / 8)];
      const at = (y * width + x) * 4;
      if (channels >= 3) {
        rgba[at] = sample(0);
        rgba[at + 1] = sample(1);
        rgba[at + 2] = sample(2);
      } else {
        rgba[at] = rgba[at + 1] = rgba[at + 2] = sample(0);
      }
      rgba[at + 3] = channels === 4 ? sample(3) : channels === 2 ? sample(1) : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
};

export const GRID = 6;

export const pngGrid = (file) => {
  const { width, height, rgba } = readPng(file);
  const cells = [];
  let translucent = 0;
  for (let at = 3; at < rgba.length; at += 4) if (rgba[at] < 255) translucent += 1;
  for (let row = 0; row < GRID; row++) {
    for (let column = 0; column < GRID; column++) {
      const x0 = Math.floor((column * width) / GRID);
      const x1 = Math.max(x0 + 1, Math.floor(((column + 1) * width) / GRID));
      const y0 = Math.floor((row * height) / GRID);
      const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / GRID));
      const sum = [0, 0, 0, 0];
      let weight = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const at = (y * width + x) * 4;
          const alpha = rgba[at + 3] / 255;
          sum[0] += rgba[at] * alpha;
          sum[1] += rgba[at + 1] * alpha;
          sum[2] += rgba[at + 2] * alpha;
          sum[3] += rgba[at + 3];
          weight += 1;
        }
      }
      cells.push(sum.map((value) => Math.round(value / weight)));
    }
  }
  return { width, height, translucent, cells };
};

export const gridDistance = (a, b) => {
  let worst = 0;
  for (let index = 0; index < a.length; index++) {
    for (let channel = 0; channel < 4; channel++) worst = Math.max(worst, Math.abs(a[index][channel] - b[index][channel]));
  }
  return worst;
};
