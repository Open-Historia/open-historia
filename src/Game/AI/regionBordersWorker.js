// A modern map's regions file is 55 MB: parsing it and reading its borders took the page 2.5 seconds, during which nothing moved.
import { regionTouchingMap } from "./regionVocab.js";

self.onmessage = async ({ data: { url } }) => {
  try {
    const response = await fetch(url, { cache: "default", credentials: "same-origin" });
    if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
    const shapes = await response.json();
    self.postMessage({ borders: [...regionTouchingMap(shapes?.features)].map(([id, others]) => [id, [...others]]) });
  } catch (error) {
    self.postMessage({ error: String(error?.message || error) });
  }
};
