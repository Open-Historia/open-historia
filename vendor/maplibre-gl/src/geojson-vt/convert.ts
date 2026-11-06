
import {simplify} from './simplify';
import {createFeature, optimizeLineMemory} from './feature';
import {getWorldCoordinateHelper, type WorldCoordinateHelper} from './world-coordinate-helper';
import type {GeoJSONVTInternalFeature, GeoJSONVTOptions, SliceArray} from './definitions';

const MAX_GEOMETRY_COLLECTION_DEPTH = 1024;

/**
 * converts GeoJSON to internal source features (an intermediate projected JSON vector format with simplification data)
 * @param data
 * @param options
 * @param unlocated - the features without coordinates, by id: a feature with an id that converts to nothing is set in it, and one that converts to something is deleted from it
 * @returns
 */
export function convertToInternal(data: GeoJSON.GeoJSON, options: GeoJSONVTOptions, unlocated?: Map<string | number, GeoJSON.Feature>): GeoJSONVTInternalFeature[] {
    const features: GeoJSONVTInternalFeature[] = [];

    switch (data.type) {
        case 'FeatureCollection':
            for (let i = 0; i < data.features.length; i++) {
                convertFeature(features, data.features[i], options, unlocated, i);
            }
            break;
        case 'Feature':
            convertFeature(features, data, options, unlocated);
            break;
        default:
            convertFeature(features, {type: "Feature" as const, geometry: data, properties: undefined}, options, unlocated);
    }

    return features;
}

function convertFeature(features: GeoJSONVTInternalFeature[], geojson: GeoJSON.Feature, options: GeoJSONVTOptions, unlocated?: Map<string | number, GeoJSON.Feature>, index?: number) {
    const count = features.length;
    featureToInternal(features, geojson, options, index);
    if (!unlocated) return;

    const id = getFeatureId(geojson, options, index);
    if (id == null) return;
    if (features.length > count) {
        unlocated.delete(id);
    } else {
        unlocated.set(id, {...geojson, id});
    }
}

function featureToInternal(features: GeoJSONVTInternalFeature[], geojson: GeoJSON.Feature, options: GeoJSONVTOptions, index?: number, depth = 0) {
    if (!geojson.geometry) return;

    if (depth > MAX_GEOMETRY_COLLECTION_DEPTH) {
        throw new Error('GeometryCollection nesting exceeds supported depth: ' + MAX_GEOMETRY_COLLECTION_DEPTH);
    }

    if (geojson.geometry.type === 'GeometryCollection') {
        convertGeometryCollection(features, geojson, geojson.geometry, options, index, depth + 1);
        return;
    }

    const coords = geojson.geometry.coordinates;
    if (!coords?.length) return;

    const id = getFeatureId(geojson, options, index);
    const tolerance = Math.pow(options.tolerance / ((1 << options.maxZoom) * options.extent), 2);
    const worldCoordinateHelper = getWorldCoordinateHelper(options.coordinates);

    switch (geojson.geometry.type) {
        case 'Point':
            convertPointFeature(features, id, geojson.geometry, worldCoordinateHelper, geojson.properties);
            return;

        case 'MultiPoint':
            convertMultiPointFeature(features, id, geojson.geometry, worldCoordinateHelper, geojson.properties);
            return;

        case 'LineString':
            convertLineStringFeature(features, id, geojson.geometry, tolerance, worldCoordinateHelper, geojson.properties);
            return;

        case 'MultiLineString':
            convertMultiLineStringFeature(features, id, geojson.geometry, tolerance, worldCoordinateHelper, options, geojson.properties);
            return;

        case 'Polygon':
            convertPolygonFeature(features, id, geojson.geometry, tolerance, worldCoordinateHelper, geojson.properties);
            return;

        case 'MultiPolygon':
            convertMultiPolygonFeature(features, id, geojson.geometry, tolerance, worldCoordinateHelper, geojson.properties);
            return;

        default:
            throw new Error('Input data is not a valid GeoJSON object.');
    }
}

function getFeatureId(geojson: GeoJSON.Feature, options: GeoJSONVTOptions, index?: number): number | string | undefined {
    if (options.promoteId) {
        return geojson.properties?.[options.promoteId];
    }
    if (options.generateId) {
        return index || 0;
    }
    return geojson.id;
}

function convertGeometryCollection(features: GeoJSONVTInternalFeature[], geojson: GeoJSON.Feature, geometry: GeoJSON.GeometryCollection, options: GeoJSONVTOptions, index?: number, depth = 0) {
    for (const geom of geometry.geometries) {
        featureToInternal(features, {
            id: geojson.id,
            type: 'Feature',
            geometry: geom,
            properties: geojson.properties
        }, options, index, depth);
    }
}

function convertPointFeature(features: GeoJSONVTInternalFeature[], id: number | string | undefined, geom: GeoJSON.Point, worldCoordinateHelper: WorldCoordinateHelper, properties: GeoJSON.GeoJsonProperties) {
    const out: number[] = [];
    out.push(worldCoordinateHelper.projectX(geom.coordinates[0]), worldCoordinateHelper.projectY(geom.coordinates[1]), 0);
    features.push(createFeature(id, 'Point', out, properties));
}

function convertMultiPointFeature(features: GeoJSONVTInternalFeature[], id: number | string | undefined, geom: GeoJSON.MultiPoint, worldCoordinateHelper: WorldCoordinateHelper, properties: GeoJSON.GeoJsonProperties) {
    const out: number[] = [];
    for (const coords of geom.coordinates) {
        out.push(worldCoordinateHelper.projectX(coords[0]), worldCoordinateHelper.projectY(coords[1]), 0);
    }
    features.push(createFeature(id, 'MultiPoint', out, properties));
}

function convertLineStringFeature(features: GeoJSONVTInternalFeature[], id: number | string | undefined, geom: GeoJSON.LineString, tolerance: number, worldCoordinateHelper: WorldCoordinateHelper, properties: GeoJSON.GeoJsonProperties) {
    const out: SliceArray = {points: []};
    convertLine(geom.coordinates, out, tolerance, false, worldCoordinateHelper);
    features.push(createFeature(id, 'LineString', out, properties));
}

function convertMultiLineStringFeature(features: GeoJSONVTInternalFeature[], id: number | string | undefined, geom: GeoJSON.MultiLineString, tolerance: number, worldCoordinateHelper: WorldCoordinateHelper, options: GeoJSONVTOptions, properties: GeoJSON.GeoJsonProperties) {
    if (options.lineMetrics) {
        // explode into linestrings to be able to track metrics
        for (const line of geom.coordinates) {
            const out: SliceArray = {points: []};
            convertLine(line, out, tolerance, false, worldCoordinateHelper);
            features.push(createFeature(id, 'LineString', out, properties));
        }
    } else {
        const out: SliceArray[] = [];
        convertLines(geom.coordinates, out, tolerance, false, worldCoordinateHelper);
        features.push(createFeature(id, 'MultiLineString', out, properties));
    }
}

function convertPolygonFeature(features: GeoJSONVTInternalFeature[], id: number | string | undefined, geom: GeoJSON.Polygon, tolerance: number, worldCoordinateHelper: WorldCoordinateHelper, properties: GeoJSON.GeoJsonProperties) {
    const out: SliceArray[] = [];
    convertLines(geom.coordinates, out, tolerance, true, worldCoordinateHelper);
    features.push(createFeature(id, 'Polygon', out, properties));
}

function convertMultiPolygonFeature(features: GeoJSONVTInternalFeature[], id: number | string | undefined, geom: GeoJSON.MultiPolygon, tolerance: number, worldCoordinateHelper: WorldCoordinateHelper, properties: GeoJSON.GeoJsonProperties) {
    const out: SliceArray[][] = [];
    for (const polygon of geom.coordinates) {
        const polygonOut: SliceArray[] = [];
        convertLines(polygon, polygonOut, tolerance, true, worldCoordinateHelper);
        if (!polygonOut.length) continue;

        out.push(polygonOut);
    }
    if (!out.length) return;

    features.push(createFeature(id, 'MultiPolygon', out, properties));
}

function convertLine(ring: GeoJSON.Position[], out: SliceArray, tolerance: number, isPolygon: boolean, worldCoordinateHelper: WorldCoordinateHelper) {
    let x0, y0;
    let size = 0;

    for (let j = 0; j < ring.length; j++) {
        const x = worldCoordinateHelper.projectX(ring[j][0]);
        const y = worldCoordinateHelper.projectY(ring[j][1]);

        out.points.push(x, y, 0);

        if (j > 0) {
            if (isPolygon) {
                size += (x0 * y - x * y0) / 2; // area
            } else {
                size += Math.sqrt(Math.pow(x - x0, 2) + Math.pow(y - y0, 2)); // length
            }
        }
        x0 = x;
        y0 = y;
    }

    const last = out.points.length - 3;
    out.points[2] = 1;
    if (tolerance > 0) simplify(out.points, 0, last, tolerance);
    out.points[last + 2] = 1;

    optimizeLineMemory(out);
    out.size = Math.abs(size);
    out.start = 0;
    out.end = out.size;
}

function convertLines(rings: GeoJSON.Position[][], out: SliceArray[], tolerance: number, isPolygon: boolean, worldCoordinateHelper: WorldCoordinateHelper) {
    for (let i = 0; i < rings.length; i++) {
        const geom: SliceArray = {points: []};
        convertLine(rings[i], geom, tolerance, isPolygon, worldCoordinateHelper);
        out.push(geom);
    }
}
