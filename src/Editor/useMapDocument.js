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
import { OWNER_SCHEMA } from "./documentMigration.js";
import { normalizeTagList } from "../runtime/countryTags.js";

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
  }, []);

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
  }, []);

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
  }, []);


  const setPolities = useCallback((updater) => {
    setDoc((d) => ({
      ...d,
      polities: typeof updater === "function"
        ? updater(d.polities || {})
        : (updater || {}),
    }));
    setSaveStatus("dirty");
  }, []);

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
  }, []);

  // Rename the CURRENT DISPLAY name without touching the stable key used by
  // regions, flags, tags, colors and campaign continuity. This is the operation
  // scenario authors actually mean by "Austria -> Austria-Hungary".
  const renamePolityDisplay = useCallback((key, nextName) => {
    const stableKey = String(key || "").trim();
    const name = String(nextName || "").trim();
    if (!stableKey || !name) return;
    setDoc((d) => {
      const current = d.polities?.[stableKey] || { name: stableKey, aliases: [] };
      const oldName = String(current.name || stableKey).trim();
      const aliases = [...new Set([
        ...(Array.isArray(current.aliases) ? current.aliases : []),
        oldName,
        name,
      ].map((v) => String(v || "").trim()).filter(Boolean))];
      return {
        ...d,
        polities: {
          ...(d.polities || {}),
          [stableKey]: { ...current, code: current.code || stableKey, name, aliases },
        },
      };
    });
    setSaveStatus("dirty");
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
      return { ...d, polities, colorOverrides, flags, tags };
    });
    setSaveStatus("dirty");
  }, []);

  // Scenario Workshop bulk polity import. A 1911 roster can contain dozens of
  // landless polity identities before any of the newly imported regions have
  // been painted. Do the whole merge in ONE document update instead of calling
  // upsertPolity/setColor/setTags eighty-plus times.
  const importPolityRoster = useCallback((rows) => {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const normalized = [];
    const seen = new Set();

    const parseRgb = (value) => {
      if (Array.isArray(value) && value.length >= 3) {
        const rgb = value.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))));
        return rgb.every(Number.isFinite) ? rgb : null;
      }
      const m = /^#?([a-f0-9]{6})$/i.exec(String(value || "").trim());
      if (!m) return null;
      return [
        Number.parseInt(m[1].slice(0, 2), 16),
        Number.parseInt(m[1].slice(2, 4), 16),
        Number.parseInt(m[1].slice(4, 6), 16),
      ];
    };

    for (const raw of sourceRows) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const key = String(
        raw.key ?? raw.stableKey ?? raw.stable_key ?? raw.code ?? raw.id ?? raw.name ?? "",
      ).trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const name = String(
        raw.name ?? raw.displayName ?? raw.display_name ?? raw.label ?? key,
      ).trim() || key;
      const aliasesRaw = Array.isArray(raw.aliases)
        ? raw.aliases
        : typeof raw.aliases === "string"
          ? raw.aliases.split("|")
          : [];
      const aliases = [...new Set(
        [key, name, ...aliasesRaw]
          .map((v) => String(v || "").trim())
          .filter(Boolean),
      )];

      const color = parseRgb(raw.color ?? raw.rgb ?? raw.colour ?? null);
      const flag = String(raw.flag ?? raw.flagUrl ?? raw.flag_url ?? raw.flagDataUrl ?? "").trim();
      const rowTags = Array.isArray(raw.tags)
        ? raw.tags
        : typeof raw.tags === "string"
          ? raw.tags.split("|")
          : [];

      normalized.push({
        key,
        name,
        aliases,
        color,
        flag: flag || null,
        tags: normalizeTagList(rowTags),
        status: String(raw.status || "active").trim() || "active",
        note: String(raw.note || ""),
        mapRefs: raw.mapRefs && typeof raw.mapRefs === "object" && !Array.isArray(raw.mapRefs)
          ? raw.mapRefs
          : null,
      });
    }

    if (!normalized.length) {
      return { count: 0, created: 0, updated: 0, colors: 0, flags: 0, tags: 0, firstKey: "" };
    }

    const existingBefore = new Set(Object.keys(doc.polities || {}));
    const summary = {
      count: normalized.length,
      created: normalized.filter((row) => !existingBefore.has(row.key)).length,
      updated: normalized.filter((row) => existingBefore.has(row.key)).length,
      colors: normalized.filter((row) => row.color).length,
      flags: normalized.filter((row) => row.flag).length,
      tags: normalized.filter((row) => row.tags.length).length,
      firstKey: normalized[0]?.key || "",
    };

    setDoc((d) => {
      const polities = { ...(d.polities || {}) };
      const colorOverrides = { ...(d.colorOverrides || {}) };
      const flags = { ...(d.flags || {}) };
      const tags = { ...(d.tags || {}) };

      for (const row of normalized) {
        const current = polities[row.key] || {};
        const aliases = [...new Set([
          ...(Array.isArray(current.aliases) ? current.aliases : []),
          current.name,
          ...row.aliases,
        ].map((v) => String(v || "").trim()).filter(Boolean))];

        polities[row.key] = {
          ...current,
          code: current.code || row.key,
          name: row.name,
          aliases,
          status: row.status || current.status || "active",
          note: row.note || current.note || "",
          ...(row.mapRefs ? { mapRefs: row.mapRefs } : {}),
        };

        if (row.color) colorOverrides[row.key] = row.color;
        if (row.flag) flags[row.key] = row.flag;
        if (row.tags.length) tags[row.key] = row.tags;
      }

      return { ...d, polities, colorOverrides, flags, tags };
    });
    setSaveStatus("dirty");
    return summary;
  }, [doc.polities]);

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
    renamePolityDisplay,
    removePolity,
    importPolityRoster,
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
