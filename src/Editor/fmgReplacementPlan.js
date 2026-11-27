/*!
 * Native FMG replacement planning. Build the complete canonical document
 * BEFORE clearing any region or old-world state; reject incomplete input.
 */
import { createDocument, newId } from "./useMapDocument.js";

export const planGeneratedMapReplacement = (seed, current, createId = newId) => {
  const regions = seed?.regions;
  if (regions?.type !== "FeatureCollection" || !Array.isArray(regions.features) || !regions.features.length) {
    throw new Error("The generated world has no valid regions; nothing was replaced.");
  }

  const ids = new Set();
  for (const feature of regions.features) {
    const id = String(feature?.id ?? feature?.properties?.id ?? "").trim();
    if (
      !id
      || ids.has(id)
      || !["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)
      || !Array.isArray(feature.geometry.coordinates)
      || !feature.geometry.coordinates.length
    ) {
      throw new Error("The generated map contains an invalid or duplicate region; nothing was replaced.");
    }
    ids.add(id);
  }

  const cities = seed?.cities?.features;
  const background = seed?.background?.geojson;
  if (!Array.isArray(cities) || background?.type !== "FeatureCollection" || !Array.isArray(background.features)) {
    throw new Error("The generated world's cities or background are incomplete; nothing was replaced.");
  }

  const polities = {};
  for (const entry of seed.polities || []) {
    const key = String(entry?.code || entry?.name || "").trim();
    if (!key || polities[key]) {
      throw new Error("The generated world contains an invalid or duplicate polity; nothing was replaced.");
    }
    polities[key] = { name: String(entry.name || key), ...(entry.color ? { color: entry.color } : {}) };
  }

  const names = new Set(Object.keys(polities));
  for (const feature of regions.features) {
    if (!names.has(String(feature.properties?.owner || ""))) {
      throw new Error("The generated map contains a region without a matching polity; nothing was replaced.");
    }
  }

  const features = cities.map((feature) => {
    const coords = feature?.geometry?.coordinates;
    if (
      !Array.isArray(coords)
      || coords.length < 2
      || !Number.isFinite(Number(coords[0]))
      || !Number.isFinite(Number(coords[1]))
    ) {
      throw new Error("The generated world contains an invalid city coordinate; nothing was replaced.");
    }
    return {
      id: createId("feat"),
      name: String(feature.properties?.city || ""),
      type: "Coordinate",
      symbol: "square",
      coord: coords.slice(0, 2),
      country: "",
      owner: null,
      regionId: null,
      population: feature.properties?.population || 0,
      tags: feature.properties?.capital === "primary" ? ["city", "capital"] : ["city"],
    };
  });

  const name = String(current?.metadata?.name || "Generated World");
  const fresh = createDocument({ name, kind: "blank" });
  const document = {
    ...fresh,
    id: current?.id ?? null,
    metadata: {
      ...fresh.metadata,
      name,
      author: current?.metadata?.author || "",
      customBackground: { kind: "vector", geojson: background },
      // This is a complete new polity universe, not an ordinary geometry edit.
      // Keep intent with the working map until an authorised scenario Save.
      generatedWorldReplacementId: createId("fmg-replacement"),
    },
    polities,
    colorOverrides: seed.colors || {},
    features,
  };
  return { regions, document, background: document.metadata.customBackground };
};
