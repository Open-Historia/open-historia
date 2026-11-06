import type { GeoJSONVTInternalFeature, GeoJSONVTInternalLineStringFeature, GeoJSONVTInternalMultiLineStringFeature, GeoJSONVTInternalMultiPointFeature, GeoJSONVTInternalMultiPolygonFeature, GeoJSONVTInternalPointFeature, GeoJSONVTInternalPolygonFeature, SliceArray, SliceFixedArray } from "./definitions";

type FeatureTypeMap = {
    Point: GeoJSONVTInternalPointFeature["geometry"];
    MultiPoint: GeoJSONVTInternalMultiPointFeature["geometry"];
    LineString: GeoJSONVTInternalLineStringFeature["geometry"];
    MultiLineString: GeoJSONVTInternalMultiLineStringFeature["geometry"];
    Polygon: GeoJSONVTInternalPolygonFeature["geometry"];
    MultiPolygon: GeoJSONVTInternalMultiPolygonFeature["geometry"];
};

/**
 * 
 * @param id - the feature's ID
 * @param type - the feature's type
 * @param geom - the feature's geometry
 * @param tags - the feature's properties
 * @returns the created feature
 */
export function createFeature<T extends GeoJSONVTInternalFeature["type"]>(id: number | string | undefined, type: T, geom: FeatureTypeMap[T], tags: GeoJSON.GeoJsonProperties): GeoJSONVTInternalFeature {
    // This is mostly for TypeScript type narrowing
    const data = { type, geom } as { [K in GeoJSONVTInternalFeature["type"]]: { type: K, geom: FeatureTypeMap[K] } }[GeoJSONVTInternalFeature["type"]];

    const feature = {
        id: id == null ? null : id,
        type: data.type,
        geometry: data.geom,
        tags,
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
    } as GeoJSONVTInternalFeature;

    switch (data.type) {
        case 'Point':
        case 'MultiPoint':
            calcLineBBox(feature, data.geom);
            break;

        case 'LineString':
            calcLineBBox(feature, data.geom.points);
            break;

        case 'Polygon':
            // the outer ring (ie [0]) contains all inner rings
            calcLineBBox(feature, data.geom[0].points);
            break;

        case 'MultiLineString':
            for (const line of data.geom) {
                calcLineBBox(feature, line.points);
            }
            break;

        case 'MultiPolygon':
            for (const polygon of data.geom) {
                // the outer ring (ie [0]) contains all inner rings
                calcLineBBox(feature, polygon[0].points);
            }
            break;
    }

    return feature;
}

export function optimizeLineMemory(line: SliceArray) {
    const lineImmutable = line as SliceFixedArray;
    if (line.points.length > 64) {
        lineImmutable.points = new Float64Array(line.points);
    }
}

function calcLineBBox(feature: GeoJSONVTInternalFeature, geom: number[] | Float64Array) {
    for (let i = 0; i < geom.length; i += 3) {
        feature.minX = Math.min(feature.minX, geom[i]);
        feature.minY = Math.min(feature.minY, geom[i + 1]);
        feature.maxX = Math.max(feature.maxX, geom[i]);
        feature.maxY = Math.max(feature.maxY, geom[i + 1]);
    }
}
