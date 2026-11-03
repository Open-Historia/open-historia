/*! Open Historia — basemap pictures drawn crisp when zoomed in © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// An uploaded basemap picture (a pixel map such as Q-BAM) blurs when the map is
// zoomed past its own resolution, because the canvas smooths each enlarged
// pixel. Smoothing is turned off only then: zoomed out, a picture squeezed
// into fewer screen pixels still needs it, or its one-pixel lines break up.
// OpenLayers runs `prerender` right before it draws the image, after its own
// smoothing setting, and turns smoothing back on afterwards. The listener must
// never throw: an error there stops the whole map drawing.
export const crispWhenMagnified = (layer, imageExtent, url) => {
  // The picture's own width, read from a copy of it (a data URL: no request).
  const probe = new Image();
  probe.src = url;
  layer.on("prerender", (event) => {
    const width = probe.naturalWidth;
    if (!width) return;
    const unitsPerPixel = (imageExtent[2] - imageExtent[0]) / width;
    const screenPixelsPerPixel = (unitsPerPixel / event.frameState.viewState.resolution) * event.frameState.pixelRatio;
    if (screenPixelsPerPixel > 1) event.context.imageSmoothingEnabled = false;
  });
  return layer;
};
