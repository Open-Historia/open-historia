import test from "node:test";
import assert from "node:assert/strict";
import { buildFontFamilyCss, measurePolityText, rasterizePolityText } from "./polityTextRasterizer.js";

test("PTR-0 arbitrary scenario font stack becomes valid Canvas CSS", () => {
  assert.equal(
    buildFontFamilyCss(["Cinzel Decorative", "Georgia", "serif"]),
    '"Cinzel Decorative", "Georgia", serif',
  );
  assert.equal(buildFontFamilyCss([]), "serif");
});

// Just enough of a canvas: fixed glyph metrics, and a record of what was drawn.
const withFakeDocument = (run) => {
  const created = [];
  const drawn = [];
  globalThis.document = {
    createElement: () => {
      const canvas = {
        width: 300,
        height: 150,
        getContext: () => ({
          canvas,
          letterSpacing: "0px",
          measureText: (value) => ({ width: value.length * 70, actualBoundingBoxAscent: 92, actualBoundingBoxDescent: 4 }),
          clearRect: () => {},
          strokeText: (value) => drawn.push(["stroke", value]),
          fillText: (value) => drawn.push(["fill", value]),
        }),
      };
      created.push(canvas);
      return canvas;
    },
  };
  try {
    return run({ created, drawn });
  } finally {
    delete globalThis.document;
  }
};

test("measuring a label gives the size drawing it would, without drawing it", () => {
  const options = { text: "RUSSIAN FEDERATION", fontFamilies: ["Georgia"], fontSizePx: 128, haloWidthPx: 5 };
  withFakeDocument(({ created, drawn }) => {
    const measured = measurePolityText(options);
    assert.equal(measured.canvas, null);
    assert.equal(created.length, 1, "only the probe it measures with");
    assert.deepEqual(drawn, []);

    const raster = rasterizePolityText(options);
    assert.equal(raster.canvas.width, measured.width);
    assert.equal(raster.canvas.height, measured.height);
    const { canvas, ...metrics } = raster;
    assert.deepEqual({ canvas: null, ...metrics }, measured);
    assert.deepEqual(drawn, [["stroke", "RUSSIAN FEDERATION"], ["fill", "RUSSIAN FEDERATION"]]);
  });
});
