/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Map-editor document state: the single source of truth for a map's metadata,
// region types, and point features (cities). Region GEOMETRY lives in the
// OpenLayers vector source (too heavy for React state); it is materialised into
// the document only on save/export. Ephemeral UI state (active tool, selection,
// save status, live region count) also lives here for the panels to read.

import { useCallback, useEffect, useRef, useState } from "react";
import { migrateDocumentOwners, OWNER_SCHEMA } from "./documentMigration.js";
import { normalizeTagList } from "../runtime/countryTags.js";
import { findPolityKey, renamePolityInDocument } from "../../server/polityRename.js";
import { mergeCityMarkers } from "./cityMarkers.js";
import { mergePolityRoster } from "./polityRoster.js";
import { withoutPolities } from "./scenarioPuppets.js";

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
    // Starting units (world.units, source "scenario"): what stands on the map at
    // round one. Placed with the Unit tool; the game moves them from there.
    units: [],
    // The map-maker's own choices, and the only colour/flag state that belongs to
    // the document. The base palette (293 countries) and any scenario palette are
    // fetched at mount and merged for display only — saving those into every doc
    // would bloat it and freeze a copy of a file that is meant to be shared.
    // A document created now is name-keyed by construction, so say so. Without the
    // marker a brand-new map reads as legacy to documentMigration and gets migrated
    // on every open — harmless, since the resolver is a fixpoint, but it means the
    // marker never tells the truth about anything.
    ownerSchema: OWNER_SCHEMA,
    // country name -> [r,g,b]
    colorOverrides: {},
    // country name -> data URL (PNG, downscaled on upload). Author-set; the AI never
    // writes these.
    flags: {},
    // country name -> string[] (e.g. ["socialist","authoritarian","anti-nato"]).
    // What a country IS, in the map-maker's words. Unlike flags these are only the
    // STARTING characterisation: the AI reads them as context for everything that
    // country does, and can rewrite them as the world changes (a revolution can
    // drop "socialist"), which lands in world.countryTags — not here.
    tags: {},
    // Scenario polity registry keyed by STABLE polity identity. `name` is only
    // presentation state and may change without re-keying region ownership. This
    // mirrors world.polityOverrides instead of the old editor rule that
    // "a country exists because a region contains its display name".
    polities: {},
    // Groups (runtime/groups.js): name -> { name, description, color }. A region
    // in a group's area carries the group's name as its `group`; the export
    // writes world.groups and world.groupAreas (exportPreset.js).
    groups: {},
    // Puppet states the scenario starts with, as world.puppets rows
    // (scenarioPuppets.js); set in the Countries panel.
    puppets: [],
  };
};

// A saved document as the editor holds it, and its regions, for Open. Built in
// full before anything on screen changes, so a document that cannot be read
// throws with the open map untouched (MapEditor openDoc).
export const openStoredDocument = (stored) => {
  // Bring a pre-rename document forward before anything reads it. A document
  // saved when owners were codes renders in hash colours (every palette lookup
  // misses) and forks a country in two on the first edit. It is also the one
  // path where legacy owners can reach a scenario already wearing an
  // ownerSchema marker, past the store's migration. No-op once migrated.
  const doc = migrateDocumentOwners(stored);
  const base = createDocument();
  return {
    regions: doc.regions,
    doc: {
      id: doc.id,
      version: doc.version || 1,
      ownerSchema: doc.ownerSchema ?? OWNER_SCHEMA,
      metadata: { ...base.metadata, ...(doc.metadata || {}), name: doc.name || doc.metadata?.name || "Map" },
      types: doc.types?.length ? doc.types : base.types,
      features: doc.features || [],
      // Default to {} rather than leaving them undefined: a map saved before these
      // existed has neither key, and setColorOverride/setFlag spread the current
      // value.
      colorOverrides: doc.colorOverrides || {},
      flags: doc.flags || {},
      tags: doc.tags || {},
      polities: doc.polities || {},
      units: Array.isArray(doc.units) ? doc.units : [],
      groups: doc.groups && typeof doc.groups === "object" ? doc.groups : {},
      puppets: Array.isArray(doc.puppets) ? doc.puppets : [],
    },
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
  const [saveStatus, setSaveStatusState] = useState("saved"); // saved | dirty | saving | error
  // Counts edits: every change marks the document "dirty" through here. A save
  // notes the count before it writes and calls the document saved only if the
  // count has not moved, so an edit made while a save is in flight stays unsaved
  // rather than being covered by a "saved" it was never part of.
  const editsRef = useRef(0);
  const setSaveStatus = useCallback((status) => {
    if (status === "dirty") editsRef.current += 1;
    setSaveStatusState(status);
  }, []);
  const editCount = useCallback(() => editsRef.current, []);

  // Owner -> [r,g,b] palette (shared with the game map for export compatibility).
  useEffect(() => {
    let alive = true;
    fetch("/assets/colors.json")
      .then((r) => (r.ok ? r.json() : {}))
      .then((c) => {
        // Under what is there, never over it: a scenario's own palette may
        // have been merged in already (mergeColors, at hydration), and this
        // fetch landing after it used to wipe it — the next save then wrote
        // generated colours over every country the author had coloured.
        if (alive) setColors((current) => ({ ...(c || {}), ...current }));
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

  // Set (or clear, with null) one country's colour. This is the map-maker's own
  // choice, so it goes in the document — the fetched palette is display-only and
  // would be thrown away on reload. buildGameSeed layers these over the base
  // palette, which is what makes an edited colour actually reach the game.
  const setColorOverride = useCallback((country, rgb) => {
    const owner = String(country || "").trim();
    if (!owner) return;
    setDoc((d) => {
      const next = { ...(d.colorOverrides || {}) };
      if (rgb) next[owner] = rgb; else delete next[owner];
      return { ...d, colorOverrides: next };
    });
    setSaveStatus("dirty");
  }, [setSaveStatus]);

  // Set (or clear, with null) one country's flag. The value is an already
  // downscaled PNG data URL — see flagImage.js; we never store the raw upload.
  const setFlag = useCallback((country, dataUrl) => {
    const owner = String(country || "").trim();
    if (!owner) return;
    setDoc((d) => {
      const next = { ...(d.flags || {}) };
      if (dataUrl) next[owner] = dataUrl; else delete next[owner];
      return { ...d, flags: next };
    });
    setSaveStatus("dirty");
  }, [setSaveStatus]);

  // Set (or clear) one country's tags. Note the .length check rather than the
  // truthiness test setColorOverride/setFlag use: [] is truthy, so the same
  // shape would persist an empty array for every country ever touched.
  const setTags = useCallback((country, list) => {
    const owner = String(country || "").trim();
    if (!owner) return;
    const tags = normalizeTagList(list);
    setDoc((d) => {
      const next = { ...(d.tags || {}) };
      if (tags.length) next[owner] = tags; else delete next[owner];
      return { ...d, tags: next };
    });
    setSaveStatus("dirty");
  }, [setSaveStatus]);


  const setPolities = useCallback((updater) => {
    setDoc((d) => ({
      ...d,
      polities: typeof updater === "function"
        ? updater(d.polities || {})
        : (updater || {}),
    }));
    setSaveStatus("dirty");
  }, [setSaveStatus]);

  const upsertPolity = useCallback((key, patch = {}) => {
    const stableKey = String(key || "").trim();
    if (!stableKey) return;
    setDoc((d) => {
      const current = d.polities?.[stableKey] || {};
      const next = {
        ...(d.polities || {}),
        [stableKey]: {
          ...current,
          ...patch,
          name: String(patch.name ?? current.name ?? stableKey).trim() || stableKey,
          aliases: Array.isArray(patch.aliases ?? current.aliases)
            ? [...new Set((patch.aliases ?? current.aliases).map((v) => String(v || "").trim()).filter(Boolean))]
            : [],
        },
      };
      return { ...d, polities: next };
    });
    setSaveStatus("dirty");
  }, [setSaveStatus]);

  // Renaming a polity re-keys it: the record moves to the new name and every
  // colour, flag, tag and city marker keyed by the old one follows, and the old
  // name is not kept anywhere (server/polityRename.js). The map's regions are
  // re-keyed by OlMap.renameOwner; MapEditor calls both.
  //
  // The scenario's own game and world still use the old key, so every accepted
  // rename is also logged, in order, as `polityRenames` (session state: not in
  // the saved document). A scenario save replays the log onto them
  // (playerCountryAfterSave.js scenarioAfterWorkshopRenames) and then settles it.
  const renamePolity = useCallback((key, nextName) => {
    const from = String(key || "").trim();
    const to = String(nextName || "").trim();
    if (!from || !to) return;
    setDoc((d) => {
      try {
        const renamed = renamePolityInDocument(d, from, to);
        const fromKey = findPolityKey(d.polities, from) || from;
        return { ...renamed, polityRenames: [...(Array.isArray(d.polityRenames) ? d.polityRenames : []), { from: fromKey, to }] };
      } catch (error) {
        console.warn("[editor] polity rename refused:", error);
        return d;
      }
    });
    setSaveStatus("dirty");
  }, [setSaveStatus]);

  // Drops the first `count` logged renames once a scenario save has applied
  // them; any made while the save ran stay for the next one.
  const settlePolityRenames = useCallback((count) => {
    if (!count) return;
    setDoc((d) => (Array.isArray(d.polityRenames) ? { ...d, polityRenames: d.polityRenames.slice(count) } : d));
  }, []);

  const removePolity = useCallback((key) => {
    const stableKey = String(key || "").trim();
    if (!stableKey) return;
    setDoc((d) => {
      const polities = { ...(d.polities || {}) };
      delete polities[stableKey];
      const colorOverrides = { ...(d.colorOverrides || {}) };
      const flags = { ...(d.flags || {}) };
      const tags = { ...(d.tags || {}) };
      delete colorOverrides[stableKey];
      delete flags[stableKey];
      delete tags[stableKey];
      return { ...d, polities, colorOverrides, flags, tags, puppets: withoutPolities(d.puppets, stableKey) };
    });
    setSaveStatus("dirty");
  }, [setSaveStatus]);

  const removePolities = useCallback((keys) => {
    const stableKeys = [...new Set((keys || []).map((key) => String(key || "").trim()).filter(Boolean))];
    if (!stableKeys.length) return;
    setDoc((d) => {
      const polities = { ...(d.polities || {}) };
      const colorOverrides = { ...(d.colorOverrides || {}) };
      const flags = { ...(d.flags || {}) };
      const tags = { ...(d.tags || {}) };
      for (const stableKey of stableKeys) {
        delete polities[stableKey];
        delete colorOverrides[stableKey];
        delete flags[stableKey];
        delete tags[stableKey];
      }
      return { ...d, polities, colorOverrides, flags, tags, puppets: withoutPolities(d.puppets, stableKeys) };
    });
    setSaveStatus("dirty");
  }, [setSaveStatus]);

  // Scenario Workshop bulk polity import. A 1911 roster can contain dozens of
  // landless polity identities before any of the newly imported regions have
  // been painted. Do the whole merge in ONE document update instead of calling
  // upsertPolity/setColor/setTags eighty-plus times. The merge itself is
  // polityRoster.js, which runs in node; this is the state wrapper. The summary is
  // computed from the document as it is now; the state update recomputes on
  // whatever the document is when React applies it.
  const importPolityRoster = useCallback((rows) => {
    const { summary } = mergePolityRoster({ polities: doc.polities }, rows);
    if (!summary.count) return summary;
    setDoc((d) => mergePolityRoster(d, rows).doc);
    setSaveStatus("dirty");
    return summary;
  }, [doc.polities, setSaveStatus]);

  // City markers from the Province Map Importer (its "Import explicit city Point
  // markers" option): the rows collectImportedCityPoints builds become point
  // features next to the hand-placed ones, so they reach the scenario's
  // cities.geojson through buildGameSeed like any other city. The merge itself is
  // the import-free cityMarkers.js; this is the state wrapper. Returns the
  // summary the importer's status line reports ({ count, created, updated,
  // replaced, skipped }) — computed from the document as it is now; the state
  // update recomputes on whatever the document is when React applies it.
  const importCityMarkers = useCallback((rows, { replaceExisting = false } = {}) => {
    const options = { replaceExisting, nextId: () => newId("feat") };
    const { count, created, updated, replaced, skipped } = mergeCityMarkers(doc.features, rows, options);
    setDoc((d) => ({ ...d, features: mergeCityMarkers(d.features, rows, options).features }));
    setSaveStatus("dirty");
    return { count, created, updated, replaced, skipped };
  }, [doc.features, setSaveStatus]);

  const patchMetadata = useCallback((patch) => {
    setDoc((d) => ({ ...d, metadata: { ...d.metadata, ...patch } }));
    setSaveStatus("dirty");
  }, [setSaveStatus]);
  const setBasemap = useCallback((basemap) => patchMetadata({ basemap }), [patchMetadata]);
  const setName = useCallback((name) => patchMetadata({ name }), [patchMetadata]);
  const setAuthor = useCallback((author) => patchMetadata({ author }), [patchMetadata]);
  const setTypes = useCallback((updater) => {
    setDoc((d) => ({ ...d, types: typeof updater === "function" ? updater(d.types) : updater }));
    setSaveStatus("dirty");
  }, [setSaveStatus]);
  const setFeatures = useCallback((updater) => {
    setDoc((d) => ({ ...d, features: typeof updater === "function" ? updater(d.features) : updater }));
    setSaveStatus("dirty");
  }, [setSaveStatus]);
  const setGroups = useCallback((updater) => {
    setDoc((d) => ({ ...d, groups: typeof updater === "function" ? updater(d.groups || {}) : (updater || {}) }));
    setSaveStatus("dirty");
  }, [setSaveStatus]);
  const setPuppets = useCallback((updater) => {
    setDoc((d) => ({ ...d, puppets: typeof updater === "function" ? updater(d.puppets || []) : (updater || []) }));
    setSaveStatus("dirty");
  }, [setSaveStatus]);
  const setUnits = useCallback((updater) => {
    setDoc((d) => ({ ...d, units: typeof updater === "function" ? updater(d.units || []) : (updater || []) }));
    setSaveStatus("dirty");
  }, [setSaveStatus]);

  return {
    doc,
    setDoc,
    // What the editor should PAINT with: the map-maker's choices layered over the
    // fetched palette. Everything that renders an owner colour uses this, so an
    // edit shows up immediately, exactly as it will in the game.
    colors: { ...colors, ...(doc.colorOverrides || {}) },
    // The fetched palette alone — for telling "you changed this" from "this is the
    // stock colour", so the UI can offer a Reset.
    basePalette: colors,
    colorOverrides: doc.colorOverrides || {},
    setColorOverride,
    flags: doc.flags || {},
    setFlag,
    tags: doc.tags || {},
    setTags,
    polities: doc.polities || {},
    setPolities,
    upsertPolity,
    renamePolity,
    polityRenames: Array.isArray(doc.polityRenames) ? doc.polityRenames : [],
    settlePolityRenames,
    removePolity,
    removePolities,
    importPolityRoster,
    importCityMarkers,
    mergeColors,
    types: doc.types,
    setTypes,
    features: doc.features,
    setFeatures,
    units: doc.units || [],
    setUnits,
    groups: doc.groups || {},
    setGroups,
    puppets: doc.puppets || [],
    setPuppets,
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
    editCount,
    counts: {
      regions: regionCount,
      features: doc.features.length,
      units: (doc.units || []).length,
      types: doc.types.length,
    },
  };
};
