/*! Open Historia — region seed worker © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Receives the scenario's regions.geojson in its RAW stored form and does the
// expensive part off the main thread: the 55-220 MB JSON.parse plus the
// single-pass index. Only the small seed result crosses back.
import { indexRegionFeatureCollection } from "./regionSeedCore.js";

self.onmessage = (event) => {
  const { kind, payload, jobId } = event.data ?? {};
  try {
    let data;
    if (kind === "bytes") {
      data = JSON.parse(new TextDecoder().decode(payload));
    } else if (kind === "text") {
      data = JSON.parse(payload);
    } else {
      data = payload;
    }
    self.postMessage({ jobId, ok: true, seed: indexRegionFeatureCollection(data) });
  } catch (error) {
    self.postMessage({ jobId, ok: false, error: String(error?.message ?? error) });
  }
};
