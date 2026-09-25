// Open Historia — what a custom map's regions file costs the page while it loads.
//
// Two readers parse a scenario's regions.geojson when a game opens: MapLibre's
// GeoJSON source, for the fills (`custom-regions-source` in Nations.jsx), and
// the political cartography worker, for borders and labels
// (vnext/polityBoundariesWorker.js). Every JSON.parse peaks at several times
// the file's size, and a classic save's file is 55 MB.

// MapLibre 5 sends a URL source's whole parsed file back to the page once its
// worker has tiled it, and keeps it on the source (`_data.geojson`) for
// updateData(). Nothing calls updateData on the regions source and getData()
// asks the worker, so on the page that copy only takes memory: hundreds of MB
// for the classic world, for as long as the game is open. Pointing the source
// back at its URL lets it go. `_data` is MapLibre's own field: if a later
// version renames it, this finds nothing and does nothing.
export const forgetParsedSourceCopy = (map, sourceId, url) => {
  if (!url || typeof url !== "string") return false;
  let source = null;
  try {
    source = map?.getSource?.(sourceId);
  } catch {
    return false;
  }
  const data = source?._data;
  if (!data || typeof data !== "object" || data.url || !data.geojson) return false;
  source._data = { url };
  return true;
};

// On a constrained device (runtime/deviceProfile.js) the worker does not start
// its parse until MapLibre's source has loaded, so the two peaks come one after
// the other instead of together: together is what took phones down on the
// second loading screen. Released after `timeoutMs` at most, so a source that
// never loads cannot hold the opening screen. `onRelease` runs exactly once,
// with "source-loaded" or "timeout"; `cancel` drops it without running it.
export const REGIONS_PARSE_HOLD_MS = 30000;

export const holdUntilSourceLoaded = ({
  map,
  sourceId,
  onRelease,
  timeoutMs = REGIONS_PARSE_HOLD_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) => {
  let done = false;
  let timer = null;

  const loaded = () => {
    try {
      return Boolean(map?.getSource?.(sourceId)?.loaded?.());
    } catch {
      return false;
    }
  };
  const stop = () => {
    done = true;
    if (timer != null) clearTimer(timer);
    timer = null;
    map?.off?.("sourcedata", onData);
  };
  const release = (reason) => {
    if (done) return;
    stop();
    onRelease?.(reason);
  };
  // react-maplibre hands the source its URL while rendering, before any effect
  // runs, and a GeoJSON source reports loaded() false from that moment until
  // the parse is done. So loaded() here means THIS file, or a worker restart
  // over a file MapLibre already holds.
  function onData(event) {
    if (event?.sourceId === sourceId && loaded()) release("source-loaded");
  }

  if (loaded()) {
    release("source-loaded");
  } else {
    map?.on?.("sourcedata", onData);
    timer = setTimer(() => release("timeout"), timeoutMs);
  }
  return {
    cancel: () => {
      if (!done) stop();
    },
  };
};
