import {mercatorWorldCoordinateHelper, type WorldCoordinateHelper} from './world-coordinate-helper';
import type {GeoJSONVTInternalFeature} from './definitions';

/**
 * Converts internal source features back to GeoJSON format.
 */
export function convertToGeoJSON(source: GeoJSONVTInternalFeature[], worldCoordinateHelper: WorldCoordinateHelper = mercatorWorldCoordinateHelper): GeoJSON.GeoJSON {
    const geojson: GeoJSON.GeoJSON = {
        type: 'FeatureCollection',
        features: source.map(feature => featureToGeoJSON(feature, worldCoordinateHelper))
    };

    return geojson;
}

/**
 * Converts a single internal feature to GeoJSON format.
 */
export function featureToGeoJSON(feature: GeoJSONVTInternalFeature, worldCoordinateHelper: WorldCoordinateHelper = mercatorWorldCoordinateHelper): GeoJSON.Feature {
    const geojsonFeature: GeoJSON.Feature = {
        type: 'Feature',
        geometry: geometryToGeoJSON(feature, worldCoordinateHelper),
        properties: feature.tags
    };
    if (feature.id != null) {
        geojsonFeature.id = feature.id;
    }

    return geojsonFeature;
}

/**
 * Converts a single internal feature geometry to GeoJSON format.
 */
function geometryToGeoJSON(feature: GeoJSONVTInternalFeature, worldCoordinateHelper: WorldCoordinateHelper): GeoJSON.Geometry {
    const {type, geometry} = feature;

    switch (type) {
        case 'Point':
            return {
                type: type,
                coordinates: unprojectPoint(geometry[0], geometry[1], worldCoordinateHelper)
            };
        case 'MultiPoint':
            return {
                type: type,
                coordinates: unprojectPoints(geometry, worldCoordinateHelper)
            };
        case 'LineString':
            return {
                type: type,
                coordinates: unprojectPoints(geometry.points, worldCoordinateHelper)
            };
        case 'MultiLineString':
        case 'Polygon':
            return {
                type: type,
                coordinates: geometry.map(ring => unprojectPoints(ring.points, worldCoordinateHelper))
            };
        case 'MultiPolygon':
            return {
                type: type,
                coordinates: geometry.map(polygon =>
                    polygon.map(ring => unprojectPoints(ring.points, worldCoordinateHelper))
                )
            };
    }
}

export function unprojectPoints(coords: number[] | Float64Array, worldCoordinateHelper: WorldCoordinateHelper = mercatorWorldCoordinateHelper): GeoJSON.Position[] {
    const result: GeoJSON.Position[] = [];

    for (let i = 0; i < coords.length; i += 3) {
        result.push(unprojectPoint(coords[i], coords[i + 1], worldCoordinateHelper));
    }

    return result;
}

function unprojectPoint(x: number, y: number, worldCoordinateHelper: WorldCoordinateHelper): GeoJSON.Position {
    return [worldCoordinateHelper.unprojectX(x), worldCoordinateHelper.unprojectY(y)];
}
