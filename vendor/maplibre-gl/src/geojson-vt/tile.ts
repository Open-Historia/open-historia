import type { GeoJSONVTInternalFeature, GeoJSONVTInternalLineStringFeature, GeoJSONVTInternalMultiLineStringFeature, GeoJSONVTInternalMultiPointFeature, GeoJSONVTInternalMultiPolygonFeature, GeoJSONVTInternalPointFeature, GeoJSONVTInternalPolygonFeature, GeoJSONVTInternalTile, GeoJSONVTInternalTileFeature, GeoJSONVTOptions, SliceFixedArray } from "./definitions";

export const GEOJSONVT_CLIP_START = 'geojsonvt_clip_start';
export const GEOJSONVT_CLIP_END = 'geojsonvt_clip_end';

/**
 * Creates a tile object from the given features
 * @param features - the features to include in the tile
 * @param z
 * @param tx
 * @param ty
 * @param options - the options object
 * @returns the created tile
 */
export function createTile(features: GeoJSONVTInternalFeature[], z: number, tx: number, ty: number, options: GeoJSONVTOptions): GeoJSONVTInternalTile {
    const tolerance = z === options.maxZoom ? 0 : options.tolerance / ((1 << z) * options.extent);

    const tile = {
        transformed: false,
        features: [] as GeoJSONVTInternalTileFeature[],
        source: null as GeoJSONVTInternalFeature[],
        x: tx,
        y: ty,
        z: z,
        minX: 2,
        minY: 1,
        maxX: -1,
        maxY: 0,
        numPoints: 0,
        numSimplified: 0,
        numFeatures: features.length
    };

    for (const feature of features) {
        addFeature(tile, feature, tolerance, options);
    }

    return tile;
}

function addFeature(tile: GeoJSONVTInternalTile, feature: GeoJSONVTInternalFeature, tolerance: number, options: GeoJSONVTOptions) {
    tile.minX = Math.min(tile.minX, feature.minX);
    tile.minY = Math.min(tile.minY, feature.minY);
    tile.maxX = Math.max(tile.maxX, feature.maxX);
    tile.maxY = Math.max(tile.maxY, feature.maxY);

    switch (feature.type) {
        case 'Point':
        case 'MultiPoint': 
            addPointsTileFeature(tile, feature);
            return;
        case 'LineString':
            addLineTileFeautre(tile, feature, tolerance, options);
            return;
        case 'MultiLineString':
        case 'Polygon':
            addLinesTileFeature(tile, feature, tolerance);
            return;
        case 'MultiPolygon': 
            addMultiPolygonTileFeature(tile, feature, tolerance);
            return;
    }
}

function addPointsTileFeature(tile: GeoJSONVTInternalTile, feature: GeoJSONVTInternalPointFeature | GeoJSONVTInternalMultiPointFeature) {
    const geometry: number[] = [];
    for (let i = 0; i < feature.geometry.length; i += 3) {
        geometry.push(feature.geometry[i] , feature.geometry[i + 1]);
        tile.numPoints++;
        tile.numSimplified++;
    }
    if (!geometry.length) return;
    const tileFeature: GeoJSONVTInternalTileFeature = {
        type: 1,
        tags: feature.tags || null,
        geometry: geometry
    };
    if (feature.id !== null) {
        tileFeature.id = feature.id;
    }
    tile.features.push(tileFeature);
}

function addLineTileFeautre(tile: GeoJSONVTInternalTile, feature: GeoJSONVTInternalLineStringFeature, tolerance: number, options: GeoJSONVTOptions) {
    const geometry: number[][] = [];
    addLine(geometry, feature.geometry, tile, tolerance, false, false);
    if (!geometry.length) return;
    let tags = feature.tags || null;
    if (options.lineMetrics) {
        tags = {};
        for (const key in feature.tags) tags[key] = feature.tags[key];
        tags[GEOJSONVT_CLIP_START] = feature.geometry.start / feature.geometry.size;
        tags[GEOJSONVT_CLIP_END] = feature.geometry.end / feature.geometry.size;
    }
    const tileFeature: GeoJSONVTInternalTileFeature = {
        type: 2,
        tags: tags,
        geometry: geometry
    }
    if (feature.id !== null) {
        tileFeature.id = feature.id;
    }
    tile.features.push(tileFeature);
}

function addLinesTileFeature(tile: GeoJSONVTInternalTile, feature: GeoJSONVTInternalPolygonFeature | GeoJSONVTInternalMultiLineStringFeature, tolerance: number) {
    const geometry: number[][] = [];
    for (let i = 0; i < feature.geometry.length; i++) {
        addLine(geometry, feature.geometry[i], tile, tolerance, feature.type === 'Polygon', i === 0);
    }
    if (!geometry.length) return;
    const tileFeature: GeoJSONVTInternalTileFeature = {
        type: feature.type === 'Polygon' ? 3 : 2,
        tags: feature.tags || null,
        geometry: geometry
    }
    if (feature.id !== null) {
        tileFeature.id = feature.id;
    }
    tile.features.push(tileFeature);
}

function addMultiPolygonTileFeature(tile: GeoJSONVTInternalTile, feature: GeoJSONVTInternalMultiPolygonFeature, tolerance: number) {
    const geometry: number[][] = [];
    for (let k = 0; k < feature.geometry.length; k++) {
        const polygon = feature.geometry[k];
        for (let i = 0; i < polygon.length; i++) {
            addLine(geometry, polygon[i], tile, tolerance, true, i === 0);
        }
    }
    if (!geometry.length) return;
    const tileFeature: GeoJSONVTInternalTileFeature = {
        type: 3,
        tags: feature.tags || null,
        geometry: geometry
    }
    if (feature.id !== null) {
        tileFeature.id = feature.id;
    }
    tile.features.push(tileFeature);
}

function addLine(result: number[][], geom: SliceFixedArray, tile: GeoJSONVTInternalTile, tolerance: number, isPolygon: boolean, isOuter: boolean) {
    const sqTolerance = tolerance * tolerance;

    if (tolerance > 0 && (geom.size < (isPolygon ? sqTolerance : tolerance))) {
        tile.numPoints += geom.points.length / 3;
        return;
    }

    const ring = [];

    for (let i = 0; i < geom.points.length; i += 3) {
        if (tolerance === 0 || geom.points[i + 2] > sqTolerance) {
            tile.numSimplified++;
            ring.push(geom.points[i], geom.points[i + 1]);
        }
        tile.numPoints++;
    }

    if (isPolygon) rewind(ring, isOuter);

    result.push(ring);
}

function rewind(ring: number[], clockwise: boolean) {
    let area = 0;

    for (let i = 0, len = ring.length, j = len - 2; i < len; j = i, i += 2) {
        area += (ring[i] - ring[j]) * (ring[i + 1] + ring[j + 1]);
    }

    if (area > 0 !== clockwise) return;

    for (let i = 0, len = ring.length; i < len / 2; i += 2) {
        const x = ring[i];
        const y = ring[i + 1];

        ring[i] = ring[len - 2 - i];
        ring[i + 1] = ring[len - 1 - i];
        ring[len - 2 - i] = x;
        ring[len - 1 - i] = y;
    }
}
