import {convertToInternal} from './convert';
import {wrap} from './wrap';
import type { GeoJSONVTInternalFeature, GeoJSONVTOptions } from './definitions';

export type GeoJSONVTSourceDiff = {
    /**
     * If true, clear all existing features
     */
    removeAll?: boolean;
    /**
     * Array of feature IDs to remove
     */
    remove?: (string | number)[];
    /**
     * Array of GeoJSON features to add
     */
    add?: GeoJSON.Feature[];
    /**
     * Array of per-feature updates
     */
    update?: GeoJSONVTFeatureDiff[];
};

export type GeoJSONVTFeatureDiff = {
    /**
     * ID of the feature being updated
     */
    id: string | number;
    /**
     * Optional new geometry
     */
    newGeometry?: GeoJSON.Geometry;
    /**
     * Remove all properties if true
     */
    removeAllProperties?: boolean;
    /**
     * Specific properties to delete
     */
    removeProperties?: string[];
    /**
     * Properties to add or update
     */
    addOrUpdateProperties?: {
        key: string;
        value: unknown;
    }[];
};

export type ApplySourceDiffResult = {
    /**
     * The features affected by this update, which should be used to invalidate tiles
     */
    affected: GeoJSONVTInternalFeature[];
    /**
     * The updated source data, which should replace the existing source data in the index
     */
    source: GeoJSONVTInternalFeature[];
};

type HashedGeoJSONVTSourceDiff = {
    removeAll?: boolean | undefined;
    remove: Set<string | number>;
    add: Map<string | number | undefined, GeoJSON.Feature>;
    update: Map<string | number, GeoJSONVTFeatureDiff>;
};

/**
 * Applies a GeoJSON Source Diff to an existing set of simplified features
 * @param source 
 * @param dataDiff 
 * @param options 
 * @param unlocated - the features without coordinates, by id, so that an update can give them some
 * @returns 
 */
export function applySourceDiff(source: GeoJSONVTInternalFeature[], dataDiff: GeoJSONVTSourceDiff, options: GeoJSONVTOptions, unlocated?: Map<string | number, GeoJSON.Feature>): ApplySourceDiffResult {
    // convert diff to sets/maps for o(1) lookups
    const diff = diffToHashed(dataDiff, options);

    // collection for features that will be affected by this update and used to invalidate tiles
    let affected: GeoJSONVTInternalFeature[] = [];

    if (diff.removeAll) {
        affected = source;
        source = [];
        unlocated?.clear();
    }

    if (diff.remove.size || diff.add.size) {
        for (const id of diff.remove) unlocated?.delete(id);

        const removeFeatures = [];

        // Collect features to remove (explicit removals + replacements via add)
        for (const feature of source) {
            if (diff.remove.has(feature.id) || diff.add.has(feature.id)) {
                removeFeatures.push(feature);
            }
        }

        if (removeFeatures.length) {
            affected = affected.concat(removeFeatures);
            const removeIds = new Set(removeFeatures.map(f => f.id));
            source = source.filter(f => !removeIds.has(f.id));
        }

        if (diff.add.size) {
            let addFeatures = convertToInternal({type: 'FeatureCollection', features: Array.from(diff.add.values())}, options, unlocated);
            addFeatures = wrap(addFeatures, options);
            affected = affected.concat(addFeatures);
            source = source.concat(addFeatures);
        }
    }

    if (diff.update.size) {
        // Features can be duplicated across the antimeridian (wrap) in a single tile, so must update all instances with the same id
        const oldFeaturesMap = new Map<string | number, GeoJSONVTInternalFeature[]>();
        let keepFeatures: GeoJSONVTInternalFeature[] = [];
        for (const feature of source) {
            if (diff.update.has(feature.id)) {
                oldFeaturesMap.set(feature.id, [...(oldFeaturesMap.get(feature.id) || []), feature]);
            } else {
                keepFeatures.push(feature);
            }
        }
        for (const [id, update] of diff.update) {
            const oldFeatures = oldFeaturesMap.get(id); 
            if (!oldFeatures || oldFeatures.length === 0) {
                if (!unlocated?.has(id)) continue;
                const locatedFeatures = getUpdatedUnlocatedFeatures(id, update, options, unlocated);
                affected = affected.concat(locatedFeatures);
                keepFeatures = keepFeatures.concat(locatedFeatures);
                continue;
            }
            const updatedFeatures = getUpdatedFeatures(oldFeatures, update, options, unlocated);

            affected = affected.concat(oldFeatures, updatedFeatures);
            keepFeatures = keepFeatures.concat(updatedFeatures);
        }
        source = keepFeatures;
    }

    return {affected, source};
}

/**
 * Gets updated simplified feature(s) based on a diff update object.
 * @param vtFeatures - the original features
 * @param update - the update object to apply
 * @param options - the options to use for the wrap method
 * @param unlocated - the features without coordinates, by id, which a new geometry without coordinates adds the feature to
 * @returns Updated features. If geometry is updated, returns new feature(s) converted from geojson and wrapped, with the id the feature already has. If only properties are updated, returns feature(s) with tags updated.
 */
function getUpdatedFeatures(vtFeatures: GeoJSONVTInternalFeature[], update: GeoJSONVTFeatureDiff, options: GeoJSONVTOptions, unlocated?: Map<string | number, GeoJSON.Feature>): GeoJSONVTInternalFeature[] {
    const changeGeometry = !!update.newGeometry;
    const changeProps = hasPropertyChanges(update);

    // if geometry changed, need to create a new geojson feature and convert to internal format
    if (changeGeometry) {
        const vtFeature = vtFeatures[0];
        const properties = changeProps ? applyPropertyUpdates(vtFeature.tags, update) : vtFeature.tags;
        return convertNewGeometry(vtFeature.id, update.newGeometry, properties, options, unlocated);
    }

    if (changeProps) {
        const updated = [];
        for (const vtFeature of vtFeatures) {
            const feature = {...vtFeature};
            feature.tags = applyPropertyUpdates(feature.tags, update);
            updated.push(feature);
        }
        return updated;
    }

    return vtFeatures;
}

/**
 * Gets the features an update gives a feature without coordinates: none, unless its new geometry has some.
 * Its property changes apply either way.
 */
function getUpdatedUnlocatedFeatures(id: string | number, update: GeoJSONVTFeatureDiff, options: GeoJSONVTOptions, unlocated: Map<string | number, GeoJSON.Feature>): GeoJSONVTInternalFeature[] {
    const feature = unlocated.get(id);
    const properties = hasPropertyChanges(update) ? applyPropertyUpdates(feature.properties, update) : feature.properties;
    if (!update.newGeometry) {
        unlocated.set(id, {...feature, properties});
        return [];
    }
    return convertNewGeometry(id, update.newGeometry, properties, options, unlocated);
}

/**
 * Converts the new geometry of a feature to internal format, keeping the id the feature already has
 */
function convertNewGeometry(id: GeoJSONVTInternalFeature['id'], geometry: GeoJSON.Geometry, properties: GeoJSON.GeoJsonProperties, options: GeoJSONVTOptions, unlocated?: Map<string | number, GeoJSON.Feature>): GeoJSONVTInternalFeature[] {
    const geojsonFeature = {type: 'Feature' as const, id, geometry, properties};
    const features = convertToInternal({type: 'FeatureCollection', features: [geojsonFeature]}, {...options, promoteId: undefined, generateId: false}, unlocated);
    return wrap(features, options);
}

function hasPropertyChanges(update: GeoJSONVTFeatureDiff): boolean {
    return update.removeAllProperties ||
        update.removeProperties?.length > 0 ||
        update.addOrUpdateProperties?.length > 0;
}

/**
 * helper to apply property updates from a diff update object to a properties object
 */
function applyPropertyUpdates(tags: GeoJSON.GeoJsonProperties, update: GeoJSONVTFeatureDiff): GeoJSON.GeoJsonProperties {
    if (update.removeAllProperties) {
        return {};
    }

    const properties = {...tags || {}};

    if (update.removeProperties) {
        for (const key of update.removeProperties) {
            delete properties[key];
        }
    }

    if (update.addOrUpdateProperties) {
        for (const {key, value} of update.addOrUpdateProperties) {
            properties[key] = value;
        }
    }

    return properties;
}

/**
 * Convert a GeoJSON Source Diff to an idempotent hashed representation using Sets and Maps
 */
export function diffToHashed(diff: GeoJSONVTSourceDiff, options: GeoJSONVTOptions): HashedGeoJSONVTSourceDiff {
    if (!diff) return {
        remove: new Set(),
        add: new Map(),
        update: new Map()
    };

    const hashed: HashedGeoJSONVTSourceDiff = {
        removeAll: diff.removeAll,
        remove: new Set(diff.remove || []),
        add: new Map(diff.add?.map(feature => [options.promoteId ? feature.properties?.[options.promoteId] : feature.id, feature])),
        update: new Map(diff.update?.map(update => [update.id, update]))
    };

    return hashed;
}
