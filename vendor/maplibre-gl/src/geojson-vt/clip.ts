
import {createFeature, optimizeLineMemory} from './feature';
import type { GeoJSONVTInternalFeature, GeoJSONVTInternalLineStringFeature, GeoJSONVTInternalMultiLineStringFeature, GeoJSONVTInternalMultiPointFeature, GeoJSONVTInternalMultiPolygonFeature, GeoJSONVTInternalPointFeature, GeoJSONVTInternalPolygonFeature, GeoJSONVTOptions, SliceArray, SliceFixedArray } from './definitions';

export const enum AxisType {
    X = 0,
    Y = 1
}

/** 
 * clip features between two vertical or horizontal axis-parallel lines:
 *     |        |
 *  ___|___     |     /
 * /   |   \____|____/
 *     |        |
 *
 * @param features - the features to clip
 * @param scale - the scale to divide start and end inputs
 * @param start - the start of the clip range
 * @param end - the end of the clip range
 * @param axis - which axis to clip against
 * @param minAll - the minimum for all features in the relevant axis
 * @param maxAll - the maximum for all features in the relevant axis
 */
export function clip(features: GeoJSONVTInternalFeature[], scale: number, start: number, end: number, axis: AxisType, minAll: number, maxAll: number, options: GeoJSONVTOptions): GeoJSONVTInternalFeature[] | null {
    start /= scale;
    end /= scale;

    if (minAll >= start && maxAll < end) { // trivial accept
        return features;
    }

    if (maxAll < start || minAll >= end) { // trivial reject
        return null;
    }

    const clipped: GeoJSONVTInternalFeature[] = [];

    for (const feature of features) {
        const min = axis === AxisType.X ? feature.minX : feature.minY;
        const max = axis === AxisType.X ? feature.maxX : feature.maxY;

        if (min >= start && max < end) { // trivial accept
            clipped.push(feature);
            continue;
        }

        if (max < start || min >= end) { // trivial reject
            continue;
        }

        switch (feature.type) {
            case 'Point':
            case 'MultiPoint': {
                clipPointFeature(feature, clipped, start, end, axis);
                continue;
            }

            case 'LineString': {
                clipLineStringFeature(feature, clipped, start, end, axis, options);
                continue;
            }

            case 'MultiLineString': {
                clipMultiLineStringFeature(feature, clipped, start, end, axis);
                continue;
            }

            case 'Polygon': {
                clipPolygonFeature(feature, clipped, start, end, axis);
                continue;
            }

            case 'MultiPolygon': {
                clipMultiPolygonFeature(feature, clipped, start, end, axis);
                continue;
            }
        }
    }

    if (!clipped.length) return null;

    return clipped;
}

function clipPointFeature(feature: GeoJSONVTInternalPointFeature | GeoJSONVTInternalMultiPointFeature, clipped: GeoJSONVTInternalFeature[], start: number, end: number, axis: AxisType) {
    const geom: number[] = [];

    clipPoints(feature.geometry, geom, start, end, axis);
    if (!geom.length) return;

    const type = geom.length === 3 ? 'Point' : 'MultiPoint';
    clipped.push(createFeature(feature.id, type, geom, feature.tags));
}

function clipLineStringFeature(feature: GeoJSONVTInternalLineStringFeature, clipped: GeoJSONVTInternalFeature[], start: number, end: number, axis: AxisType, options: GeoJSONVTOptions) {
    const geom: SliceArray[] = [];

    clipLine(feature.geometry, geom, start, end, axis, false, options.lineMetrics);
    if (!geom.length) return;

    if (options.lineMetrics) {
        for (const line of geom) {
            clipped.push(createFeature(feature.id, 'LineString', line, feature.tags));
        }
        return;
    }

    if (geom.length > 1) {
        clipped.push(createFeature(feature.id, 'MultiLineString', geom, feature.tags));
        return;
    }

    clipped.push(createFeature(feature.id, 'LineString', geom[0], feature.tags));
}

function clipMultiLineStringFeature(feature: GeoJSONVTInternalMultiLineStringFeature, clipped: GeoJSONVTInternalFeature[], start: number, end: number, axis: AxisType) {
    const geom: SliceArray[] = [];

    clipLines(feature.geometry, geom, start, end, axis, false);
    if (!geom.length) return;

    if (geom.length === 1) {
        clipped.push(createFeature(feature.id, 'LineString', geom[0], feature.tags));
        return;
    }

    clipped.push(createFeature(feature.id,'MultiLineString', geom, feature.tags));
}

function clipPolygonFeature(feature: GeoJSONVTInternalPolygonFeature, clipped: GeoJSONVTInternalFeature[], start: number, end: number, axis: AxisType) {
    const geom: SliceArray[] = [];

    clipLines(feature.geometry, geom, start, end, axis, true);
    if (!geom.length) return;

    clipped.push(createFeature(feature.id, 'Polygon', geom, feature.tags));
}

function clipMultiPolygonFeature(feature: GeoJSONVTInternalMultiPolygonFeature, clipped: GeoJSONVTInternalFeature[], start: number, end: number, axis: AxisType) {
    const geom: SliceArray[][] = [];

    for (const polygon of feature.geometry) {
        const newPolygon: SliceArray[] = [];

        clipLines(polygon, newPolygon, start, end, axis, true);
        if (!newPolygon.length) continue;

        geom.push(newPolygon);
    }
    if (!geom.length) return;

    clipped.push(createFeature(feature.id, 'MultiPolygon', geom, feature.tags));
}

function clipPoints(geom: number[], newGeom: number[], start: number, end: number, axis: AxisType) {
    for (let i = 0; i < geom.length; i += 3) {
        const a = geom[i + axis];

        if (a >= start && a <= end) {
            addPoint(newGeom, geom[i], geom[i + 1], geom[i + 2]);
        }
    }
}

function clipLine(geom: SliceFixedArray, newGeom: SliceArray[], start: number, end: number, axis: AxisType, isPolygon: boolean, trackMetrics: boolean) {

    let slice = newSlice(geom);
    const intersect = axis === AxisType.X ? intersectX : intersectY;
    let len = geom.start;
    let segLen, t;

    for (let i = 0; i < geom.points.length - 3; i += 3) {
        const ax = geom.points[i];
        const ay = geom.points[i + 1];
        const az = geom.points[i + 2];
        const bx = geom.points[i + 3];
        const by = geom.points[i + 4];
        const a = axis === AxisType.X ? ax : ay;
        const b = axis === AxisType.X ? bx : by;
        let exited = false;

        if (trackMetrics) segLen = Math.sqrt(Math.pow(ax - bx, 2) + Math.pow(ay - by, 2));

        if (a < start) {
            // ---|-->  | (line enters the clip region from the left)
            if (b >= start) {
                t = intersect(slice, ax, ay, bx, by, start);
                if (trackMetrics) slice.start = len + segLen * t;
            }
        } else if (a > end) {
            // |  <--|--- (line enters the clip region from the right)
            if (b <= end) {
                t = intersect(slice, ax, ay, bx, by, end);
                if (trackMetrics) slice.start = len + segLen * t;
            }
        } else {
            addPoint(slice.points, ax, ay, az);
        }

        if (b < start && a >= start) {
            // <--|---  | or <--|-----|--- (line exits the clip region on the left)
            t = intersect(slice, ax, ay, bx, by, start);
            exited = true;
        }

        if (b > end && a <= end) {
            // |  ---|--> or ---|-----|--> (line exits the clip region on the right)
            t = intersect(slice, ax, ay, bx, by, end);
            exited = true;
        }

        if (!isPolygon && exited) {
            if (trackMetrics) slice.end = len + segLen * t;
            newGeom.push(slice);
            slice = newSlice(geom);
        }

        if (trackMetrics) len += segLen;
    }

    // add the last point
    let last = geom.points.length - 3;
    const ax = geom.points[last];
    const ay = geom.points[last + 1];
    const az = geom.points[last + 2];
    const a = axis === AxisType.X ? ax : ay;
    if (a >= start && a <= end) addPoint(slice.points, ax, ay, az);

    // close the polygon if its endpoints are not the same after clipping
    last = slice.points.length - 3;
    if (isPolygon && last >= 3 && (slice.points[last] !== slice.points[0] || slice.points[last + 1] !== slice.points[1])) {
        addPoint(slice.points, slice.points[0], slice.points[1], slice.points[2]);
    }

    // add the final slice
    if (slice.points.length) {
        optimizeLineMemory(slice);
        newGeom.push(slice);
    }
}

function newSlice(line: SliceFixedArray): SliceArray {
    return {
        points: [],
        size: line.size,
        start: line.start,
        end: line.end
    };
}

function clipLines(geom: SliceFixedArray[], newGeom: SliceArray[], start: number, end: number, axis: AxisType, isPolygon: boolean) {
    for (const line of geom) {
        clipLine(line, newGeom, start, end, axis, isPolygon, false);
    }
}

function addPoint(out: number[], x: number, y: number, z: number) {
    out.push(x, y, z);
}

function intersectX(out: SliceArray, ax: number, ay: number, bx: number, by: number, x: number) {
    const t = (x - ax) / (bx - ax);
    addPoint(out.points, x, ay + (by - ay) * t, 1);
    return t;
}

function intersectY(out: SliceArray, ax: number, ay: number, bx: number, by: number, y: number) {
    const t = (y - ay) / (by - ay);
    addPoint(out.points, ax + (bx - ax) * t, y, 1);
    return t;
}
