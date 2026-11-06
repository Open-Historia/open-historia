import type { GeoJSONVTFeatureNonPoint, GeoJSONVTFeaturePoint, GeoJSONVTInternalTile, GeoJSONVTInternalTileFeatureNonPoint, GeoJSONVTInternalTileFeaturePoint, GeoJSONVTTile } from "./definitions";

/**
 * Transforms the coordinates of each feature in the given tile from
 * mercator-projected space into (extent x extent) tile space.
 * @param tile - the tile to transform, this gets modified in place
 * @param extent - the tile extent (usually 4096)
 * @returns the transformed tile
 */
export function transformTile(tile: GeoJSONVTInternalTile, extent: number): GeoJSONVTTile {
    if (tile.transformed) {
        return tile as GeoJSONVTTile;
    }

    const z2 = 1 << tile.z;
    const tx = tile.x;
    const ty = tile.y;

    for (const feature of tile.features) {
        if (feature.type === 1) {
            transformPointFeature(feature, extent, z2, tx, ty);
        } else {
            transformNonPointFeature(feature, extent, z2, tx, ty);
        }   
    }
    tile.transformed = true;

    return tile as GeoJSONVTTile;
}

/**
 * Transforms a single point feature from mercator-projected space into (extent x extent) tile space.
 */
function transformPointFeature(feature: GeoJSONVTInternalTileFeaturePoint, extent: number, z2: number, tx: number, ty: number): GeoJSONVTFeaturePoint {
    const transformed = feature as unknown as GeoJSONVTFeaturePoint;

    const geometry = feature.geometry;
    const point: GeoJSONVTFeaturePoint["geometry"] = [];
    for (let i = 0; i < geometry.length; i += 2) {
        point.push(transformPoint(geometry[i], geometry[i + 1], extent, z2, tx, ty));
    }
    transformed.geometry = point;

    return transformed;
}

/**
 * Transforms a single non-point feature from mercator-projected space into (extent x extent) tile space.
 */
function transformNonPointFeature(feature: GeoJSONVTInternalTileFeatureNonPoint, extent: number, z2: number, tx: number, ty: number): GeoJSONVTFeatureNonPoint {
    const transformed = feature as unknown as GeoJSONVTFeatureNonPoint;

    const geometry = feature.geometry;
    const nonPoint: GeoJSONVTFeatureNonPoint["geometry"] = [];
    for (const geom of geometry) {
        const ring: GeoJSONVTFeaturePoint["geometry"] = [];
        for (let i = 0; i < geom.length; i += 2) {
            ring.push(transformPoint(geom[i], geom[i + 1], extent, z2, tx, ty));
        }
        nonPoint.push(ring);
    }
    transformed.geometry = nonPoint;

    return transformed;
}

function transformPoint(x: number, y: number, extent: number, z2: number, tx: number, ty: number): [number, number] {
    return [
        Math.round(extent * (x * z2 - tx)),
        Math.round(extent * (y * z2 - ty))
    ];
}
