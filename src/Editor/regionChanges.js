/*! Open Historia — what a map-editor save has to carry © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Editor/regionChanges.test.js
//
// The editor autosaves every two seconds while a map is dirty, and it used to
// write the entire world each time — 5.5 MB of JSON on the shipped map, an
// ~83 MB string on the z9 seed, whether or not a polygon had moved. That churn
// is what ran the tab out of memory (OlMap.jsx serializeRegions).
//
// So a save asks this what has actually changed. Each region is written on its
// own and stamped; a stamp that matches the last save's means the region did not
// move. Nothing asks a tool to declare what it touched — the comparison is
// against the geometry itself, so an edit cannot be missed, however it was made.
//
// Deliberately free of OpenLayers: the caller writes the features (it owns the
// projection and the five-decimal rounding), and this decides what travels. The
// other half, applying the result to the stored map, is server/regionDelta.js.

// A stamp for one written region. FNV-1a with the length mixed in: cheap, and a
// collision would only ever mean one region's edit rode in the next save rather
// than this one.
export const hashRegionText = (text) => {
    let hash = 0x811c9dc5;
    for (let at = 0; at < text.length; at += 1) {
        hash ^= text.charCodeAt(at);
        hash = Math.imul(hash, 0x01000193);
    }
    return `${text.length.toString(36)}:${(hash >>> 0).toString(36)}`;
};

// GeoJSON puts a feature's id at the top level; the editor's own regions also
// carry it in properties, and a scenario's geometry is keyed by that.
export const regionIdOf = (written) => {
    const id = written?.id ?? written?.properties?.id;
    return id === undefined || id === null || id === "" ? null : String(id);
};

// `writtenFeatures` is an iterable of written GeoJSON features — a generator, so
// a map that cannot travel as a difference is abandoned without having built the
// whole thing. `saved` is what the last save wrote: id -> stamp.
//
// Returns one of three shapes:
//   { full: true,  features: [...], marks }  every region, and the stamps for it
//   { full: true,  features: null,  marks: null }  a region had no id — the caller
//                                                  serialises the map its old way
//   { full: false, changed, removed, count, marks }  only what moved
export const buildRegionChanges = ({ writtenFeatures, saved = new Map() }) => {
    const hashes = new Map();
    const changed = [];
    let keyed = true;

    for (const written of writtenFeatures) {
        const id = regionIdOf(written);
        if (id === null) {
            keyed = false;
            break;
        }
        const stamp = hashRegionText(JSON.stringify(written));
        hashes.set(id, stamp);
        if (saved.get(id) !== stamp) changed.push(written);
    }

    if (!keyed) return { full: true, features: null, marks: null };
    // Nothing to compare against — the first save after a map is opened, loaded
    // or reseeded. Everything counted as changed, so it is already the whole map.
    if (saved.size === 0) return { full: true, features: changed, marks: hashes };

    const removed = [];
    for (const id of saved.keys()) if (!hashes.has(id)) removed.push(id);
    return { full: false, changed, removed, count: hashes.size, marks: hashes };
};
