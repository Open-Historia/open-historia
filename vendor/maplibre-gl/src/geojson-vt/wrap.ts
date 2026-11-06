
import {AxisType, clip} from './clip';
import type { GeoJSONVTInternalFeature, GeoJSONVTOptions, SliceArray, SliceFixedArray } from './definitions';
import {createFeature, optimizeLineMemory} from './feature';

export function wrap(features: GeoJSONVTInternalFeature[], options: GeoJSONVTOptions): GeoJSONVTInternalFeature[] {
    if (!options.wrap) return features;

    const buffer = options.buffer / options.extent;
    let merged = features;

    const left  = clip(features, 1, -1 - buffer, buffer,     AxisType.X, -1, 2, options); // left world copy
    const right = clip(features, 1,  1 - buffer, 2 + buffer, AxisType.X, -1, 2, options); // right world copy

    if (!left && !right) return merged;

    merged = clip(features, 1, -buffer, 1 + buffer, AxisType.X, -1, 2, options) || []; // center world copy

    if (left) merged = shiftFeatureCoords(left, 1).concat(merged); // merge left into center
    if (right) merged = merged.concat(shiftFeatureCoords(right, -1)); // merge right into center

    return merged;
}

function shiftFeatureCoords(features: GeoJSONVTInternalFeature[], offset: number): GeoJSONVTInternalFeature[] {
    const newFeatures = [];

    for (const feature of features) {
        switch (feature.type) {
            case 'Point':
            case 'MultiPoint': {
                const newGeometry = shiftPointCoords(feature.geometry, offset);

                newFeatures.push(createFeature(feature.id, feature.type, newGeometry, feature.tags));
                continue;
            }

            case 'LineString': {
                const newGeometry = shiftLineCoords(feature.geometry, offset);

                newFeatures.push(createFeature(feature.id, feature.type, newGeometry, feature.tags));
                continue;
            }

            case 'MultiLineString':
            case 'Polygon': {
                const newGeometry: SliceFixedArray[] = [];
                for (const line of feature.geometry) {
                    newGeometry.push(shiftLineCoords(line, offset));
                }

                newFeatures.push(createFeature(feature.id, feature.type, newGeometry, feature.tags));
                continue;
            }

            case 'MultiPolygon': {
                const newGeometry: SliceFixedArray[][] = [];
                for (const polygon of feature.geometry) {
                    const newPolygon: SliceFixedArray[] = [];
                    for (const line of polygon) {
                        newPolygon.push(shiftLineCoords(line, offset));
                    }
                    newGeometry.push(newPolygon);
                }

                newFeatures.push(createFeature(feature.id, feature.type, newGeometry, feature.tags));
                continue;
            }
        }
    }

    return newFeatures;
}

function shiftPointCoords(coords: number[], offset: number): number[] {
    const newCoords: number[] = [];

    for (let i = 0; i < coords.length; i += 3) {
        newCoords.push(coords[i] + offset, coords[i + 1], coords[i + 2]);
    }

    return newCoords;
}

function shiftLineCoords(line: SliceArray | SliceFixedArray, offset: number): SliceFixedArray {
    const newLine: SliceArray = {
        points: [],
        size: line.size
    };

    if (line.start !== undefined) {
        newLine.start = line.start;
        newLine.end = line.end;
    }

    for (let i = 0; i < line.points.length; i += 3) {
        newLine.points.push(line.points[i] + offset, line.points[i + 1], line.points[i + 2]);
    }

    optimizeLineMemory(newLine);

    return newLine;
}
