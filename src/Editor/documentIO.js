/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Client helpers for persisting map-editor documents to the server
// (/api/mapeditor/documents) plus a local JSON export/download.

import { saveBlobToDisk } from "../runtime/saveFile.js";

const BASE = "/api/mapeditor/documents";

// What went wrong, in the store's own words: both stores answer { error } (the
// desktop server's sendError, the website's errorResponse). The Workshop shows
// it, so a failed save says why instead of only that it failed.
const failure = async (r, fallback) => {
  let message = "";
  try {
    message = String((await r.json())?.error || "");
  } catch {
    // Not JSON: the status is all there is.
  }
  return new Error(message || `${fallback} (HTTP ${r.status})`);
};

export const listDocuments = async () => {
  try {
    const r = await fetch(BASE);
    return r.ok ? r.json() : [];
  } catch {
    return [];
  }
};

export const loadDocument = async (id) => {
  const r = await fetch(`${BASE}/${id}`);
  if (!r.ok) throw await failure(r, "Could not load the map");
  return r.json();
};

// Save: POST creates (returns the new doc incl. id), PUT updates an existing id.
export const saveDocument = async (id, doc) => {
  const r = await fetch(id ? `${BASE}/${id}` : BASE, {
    method: id ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!r.ok) throw await failure(r, "Could not save the map");
  return r.json();
};

export const deleteDocument = async (id) => {
  try {
    const r = await fetch(`${BASE}/${id}`, { method: "DELETE" });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
};

export const downloadJson = (doc) => {
  const name = (doc.name || doc.metadata?.name || "map").replace(/[^a-z0-9]+/gi, "-");
  const blob = new Blob([JSON.stringify(doc)], { type: "application/json" });
  // runtime/saveFile.js: a download in a browser, Downloads/Open Historia in the app.
  return saveBlobToDisk(blob, `${name}.json`);
};
