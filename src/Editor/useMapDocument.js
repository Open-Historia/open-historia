/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Map-editor document state: the single source of truth for a map's metadata,
// region types, and point features (cities). Region GEOMETRY lives in the
// OpenLayers vector source (too heavy for React state); it is materialised into
// the document only on save/export. Ephemeral UI state (active tool, selection,
// save status, live region count) also lives here for the panels to read.

import { useCallback, useEffect, useState } from "react";

// The official editor ships a handful of region "types" carrying render +
// gameplay settings. We seed the two core ones (Land / Coastal); users add more.
export const DEFAULT_TYPES = [
  {
    id: "land",
    name: "Land",
    opacity: 0.55,
    unownedOpacity: 0.25,
    zIndex: 1,
    strokeWidth: 1.5,
    strokeColor: [0, 0, 0],
    strokeOpacity: 1,
    overrideColor: null,
    pathfindingSpeed: 1,
    interactable: true,
    showToDefaultPrompt: true,
    passable: true,
    includedInLabels: true,
    zoomSettings: [{ minZoom: 0, maxZoom: 24 }],
  },
  {
    id: "coastal",
    name: "Coastal",
    opacity: 0.55,
    unownedOpacity: 0.25,
    zIndex: 2,
    strokeWidth: 1.5,
    strokeColor: [0, 0, 0],
    strokeOpacity: 1,
    overrideColor: null,
    pathfindingSpeed: 1,
    interactable: true,
    showToDefaultPrompt: true,
    passable: true,
    includedInLabels: true,
    zoomSettings: [{ minZoom: 0, maxZoom: 24 }],
  },
];

let _uid = 0;
export const newId = (prefix = "reg") =>
  `${prefix}_${Date.now().toString(36)}${(_uid++).toString(36)}`;

export const createDocument = ({ name = "Untitled Map", kind = "import-world" } = {}) => {
  const now = new Date().toISOString();
  return {
    id: null,
    version: 1,
    metadata: {
      name,
      kind,
      author: "",
      basemap: "ocean",
      view: { center: [0, 20], zoom: 2, rotation: 0 },
      reference: { image: null },
      createdAt: now,
      updatedAt: now,
    },
    types: structuredClone(DEFAULT_TYPES),
    features: [],
  };
};

export const useMapDocument = (initial) => {
  const [doc, setDoc] = useState(
    () => initial || createDocument({ name: "2025 World", kind: "import-world" }),
  );
  const [colors, setColors] = useState({});
  const [activeTool, setActiveTool] = useState("select");
  const [selection, setSelection] = useState([]); // selected region ids
  const [regionCount, setRegionCount] = useState(0);
  const [saveStatus, setSaveStatus] = useState("saved"); // saved | dirty | saving | error

  // Owner -> [r,g,b] palette (shared with the game map for export compatibility).
  useEffect(() => {
    let alive = true;
    fetch("/assets/colors.json")
      .then((r) => (r.ok ? r.json() : {}))
      .then((c) => {
        if (alive) setColors(c || {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Layer a scenario's own palette (custom polity colors) over the base one.
  const mergeColors = useCallback((extra) => {
    if (!extra || typeof extra !== "object") return;
    setColors((current) => ({ ...current, ...extra }));
  }, []);

  const patchMetadata = useCallback((patch) => {
    setDoc((d) => ({ ...d, metadata: { ...d.metadata, ...patch } }));
    setSaveStatus("dirty");
  }, []);
  const setBasemap = useCallback((basemap) => patchMetadata({ basemap }), [patchMetadata]);
  const setName = useCallback((name) => patchMetadata({ name }), [patchMetadata]);
  const setAuthor = useCallback((author) => patchMetadata({ author }), [patchMetadata]);
  const setTypes = useCallback((updater) => {
    setDoc((d) => ({ ...d, types: typeof updater === "function" ? updater(d.types) : updater }));
    setSaveStatus("dirty");
  }, []);
  const setFeatures = useCallback((updater) => {
    setDoc((d) => ({ ...d, features: typeof updater === "function" ? updater(d.features) : updater }));
    setSaveStatus("dirty");
  }, []);

  return {
    doc,
    setDoc,
    colors,
    mergeColors,
    types: doc.types,
    setTypes,
    features: doc.features,
    setFeatures,
    metadata: doc.metadata,
    basemap: doc.metadata.basemap,
    setBasemap,
    name: doc.metadata.name,
    setName,
    author: doc.metadata.author || "",
    setAuthor,
    patchMetadata,
    activeTool,
    setActiveTool,
    selection,
    setSelection,
    regionCount,
    setRegionCount,
    saveStatus,
    setSaveStatus,
    counts: {
      regions: regionCount,
      features: doc.features.length,
      types: doc.types.length,
    },
  };
};
