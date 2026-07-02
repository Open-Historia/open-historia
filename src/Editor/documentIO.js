/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Client helpers for persisting map-editor documents to the server
// (/api/mapeditor/documents) plus a local JSON export/download.

const BASE = "/api/mapeditor/documents";

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
  if (!r.ok) throw new Error("Failed to load document");
  return r.json();
};

// Save: POST creates (returns the new doc incl. id), PUT updates an existing id.
export const saveDocument = async (id, doc) => {
  const r = await fetch(id ? `${BASE}/${id}` : BASE, {
    method: id ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!r.ok) throw new Error("Failed to save document");
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
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
};
