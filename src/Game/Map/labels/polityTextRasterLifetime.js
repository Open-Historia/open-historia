// Open Historia — a polity label's pixels live on the GPU, not in the page.
//
// A label's canvas is its text at a 128 px font (polityTextRasterizer.js):
// about half a megabyte of pixels, a megabyte for a long name, and a world
// carries 200+ labels. Preparing the map only measures each one. The canvas is
// drawn when the label is first uploaded, which is when it first comes into
// view, and let go straight after — width and height 0 free its pixels at once
// rather than whenever the collector runs. It is drawn again from the same
// inputs if the texture ever has to be rebuilt: the layer re-added after a
// style change, or a lost WebGL context.
import { rasterizePolityText } from "./polityTextRasterizer.js";

// The canvas to upload: the one in hand, or the same label drawn again.
export const labelRasterCanvas = (entry, rasterize = rasterizePolityText) => {
  const raster = entry?.raster;
  if (!raster) return null;
  if (raster.canvas) return raster.canvas;
  if (!entry.rasterOptions) return null;
  // Same text, fonts and sizes, so the same canvas size: the ribbon it is
  // stretched over was built from the first draw's aspect ratio.
  raster.canvas = rasterize(entry.rasterOptions)?.canvas ?? null;
  return raster.canvas;
};

// After a successful upload. A label with no recipe to draw it again keeps its
// canvas (it could never be uploaded a second time without it).
export const releaseLabelRasterCanvas = (entry) => {
  const canvas = entry?.raster?.canvas;
  if (!canvas || !entry.rasterOptions) return false;
  entry.raster.canvas = null;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // Dropping the reference is enough on its own.
  }
  return true;
};
