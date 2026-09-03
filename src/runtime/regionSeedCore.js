/*! Open Historia — regions.geojson single-pass indexer © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Pure, dependency-free single pass over a scenario's regions FeatureCollection
// that produces everything the map needs: the owner/provenance index for every
// region (tile fills, click resolution, labels) and ONLY the authored shapes
// (editor-drawn "reg_*" geometry + reshaped GADM regions) for rendering. The
// full-resolution geometry is dropped — geojson-vt tiling of 2.6M+ vertices and
// O(vertices) passes over it were the multi-second startup freeze.
//
// Runs identically on the main thread (fallback) and inside regionSeedWorker.js.

export const indexRegionFeatureCollection = (data) => {
  const ownersById = new Map(); // region id -> seed owner ("" = unowned)
  const propsById = new Map(); // region id -> compact props record
  const authoredFeatures = [];
  let hasDrawn = false;
  let hasGadm = false;
  for (const feature of data?.features ?? []) {
    const props = feature.properties || {};
    const id = String(props.id ?? "");
    if (!id) continue;
    propsById.set(id, {
      owner: props.owner ?? "",
      gid0: props.gid0 ?? "",
      name: props.name ?? "",
      edited: props.edited === true,
      claimants: Array.isArray(props.claimants) && props.claimants.length ? props.claimants : null,
    });
    ownersById.set(id, props.owner ?? "");
    if (!id.includes(".")) {
      authoredFeatures.push(feature);
      hasDrawn = true;
    } else {
      hasGadm = true;
      if (props.edited === true) authoredFeatures.push(feature);
    }
  }
  return {
    ownersById,
    propsById,
    authoredFC: { type: "FeatureCollection", features: authoredFeatures },
    hasDrawn,
    hasGadm,
  };
};

export const emptyRegionSeed = () => indexRegionFeatureCollection({ type: "FeatureCollection", features: [] });
