// Each tile's fills and lines are clipped to it by a mask in the stencil buffer. MapLibre draws the masks again
// for every source, some 30 times a frame and each about a screenful of writes, though most sources share their
// tiles and the stencil already holds the masks it would draw. Those draws were half of all draws on a flat map.
//
// Whatever else writes to the stencil clears currentStencilSource, and the masks are drawn again after it.
// Skipped if MapLibre no longer has what this relies on (clippingMasks.test.js names it).

const sameTiles = (tileIDs, keys) => {
  if (!keys || keys.length !== tileIDs.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    if (tileIDs[index].key !== keys[index]) return false;
  }
  return true;
};

const keepMasks = (painter) => {
  const work = painter?._renderTileClippingMasks;
  if (typeof work !== "function" || !painter.context?.bindFramebuffer) return;
  let keys = null;
  let target = null;
  let drape = false;
  painter._renderTileClippingMasks = function _renderTileClippingMasks(layer, tileIDs, renderToTexture) {
    if (this.currentStencilSource === layer.source || !layer.isTileClipped() || !tileIDs?.length) return;
    const framebuffer = this.context.bindFramebuffer.current;
    if (this.currentStencilSource !== undefined && framebuffer === target && renderToTexture === drape && sameTiles(tileIDs, keys)) {
      this.currentStencilSource = layer.source;
      return;
    }
    work.call(this, layer, tileIDs, renderToTexture);
    keys = tileIDs.map((tileID) => tileID.key);
    target = framebuffer;
    drape = renderToTexture;
  };
};

// Put on each map instance; a restored context comes with a new painter.
export const attachClippingMasks = (map) => {
  let tuned = null;
  const tune = () => {
    if (!map.painter || map.painter === tuned) return;
    tuned = map.painter;
    keepMasks(tuned);
  };
  tune();
  map.on("webglcontextrestored", tune);
  return () => map.off("webglcontextrestored", tune);
};
