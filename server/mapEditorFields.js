/*! Open Historia — what a map-editor document holds © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every field a Workshop document owns besides its id, name, metadata and
// timestamps, each with the value a new document stores when the create
// request leaves it out or sends the wrong shape.
//
// Both stores build a new document from this one list — the desktop one
// (server/mapEditorStore.js) and the website's IndexedDB one
// (src/runtime/web/editorStore.js) — because a create builds its record field by
// field, and a field missing from a hand-kept list is dropped without a word.
// That is how puppets went: the Workshop sent them (buildDocumentFields in
// src/Editor/MapEditor.jsx), both creates left them out, and puppet states set
// before a map's first save were gone on reopening it. A field added to the
// Workshop's save goes here too.

const array = (value) => (Array.isArray(value) ? value : []);
const object = (value) => (value && typeof value === "object" ? value : {});

export const DOCUMENT_FIELDS = {
  types: array,
  regions: (value) => (value && typeof value === "object" ? value : { type: "FeatureCollection", features: [] }),
  features: array,
  // The map-maker's own palette and flags.
  colorOverrides: object,
  flags: object,
  tags: object,
  polities: object,
  units: array,
  groups: object,
  puppets: array,
  ownerSchema: (value) => Number(value || 1),
};

// The stored value of every document field for a create request's body.
export const documentFieldsFromBody = (body) =>
  Object.fromEntries(Object.entries(DOCUMENT_FIELDS).map(([field, normalize]) => [field, normalize(body?.[field])]));
