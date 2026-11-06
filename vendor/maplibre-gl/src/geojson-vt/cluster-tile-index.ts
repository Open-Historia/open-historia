import KDBush from 'kdbush';
import {getWorldCoordinateHelper, type WorldCoordinateHelper} from './world-coordinate-helper';
import {featureToGeoJSON} from './deconvert';
import type {ClusterFeature, ClusterOrPointFeature, ClusterProperties, GeoJSONVTTileIndex, GeoJSONVTFeature, GeoJSONVTInternalFeature, GeoJSONVTInternalPointFeature, GeoJSONVTOptions, GeoJSONVTTile, SuperclusterOptions} from './definitions';

type ClusterFeatureInternal = GeoJSONVTInternalPointFeature & {
    tags: ClusterProperties;
};

type ClusterOrPointFeatureInternal = ClusterFeatureInternal | GeoJSONVTInternalPointFeature;

/** @internal */
export type KDBushWithData = KDBush & {
    /**
     * The projected x and y of each point or cluster, as integers, see `encode`.
     */
    flatCoords: Int32Array;
    /**
     * The other values of each point or cluster, at the `OFFSET_` positions.
     */
    flatData: Int32Array;
};

export const defaultClusterOptions: Required<SuperclusterOptions> = {
    minZoom: 0,
    maxZoom: 16,
    minPoints: 2,
    radius: 40,
    extent: 512,
    nodeSize: 64,
    log: false,
    generateId: false,
    reduce: null,
    map: (props) => props as Record<string, unknown>,
    coordinates: 'lngLat',
    wrap: true
};

/**
 * The highest zoom level to cluster on. A cluster id keeps its zoom level in five bits.
 */
const MAX_ZOOM = 30;

/**
 * Projected coordinates, which are 0 to 1 inside the world, are stored as integers with this many steps per world,
 * so that they take half the memory of doubles. One step is ~4 cm at the equator.
 */
const SCALE = 0x40000000;

/**
 * The largest value a 32-bit integer holds.
 */
const MAX_INTEGER = 0x7fffffff;

/**
 * A projected coordinate in steps from the center of the world, see `SCALE`.
 */
function encode(coord: number): number {
    return (coord - 0.5) * SCALE;
}

function decode(value: number): number {
    return value / SCALE + 0.5;
}

/**
 * Whether a projected coordinate fits in a 32-bit integer. One that is more than two worlds from the center of the
 * world does not, and neither does one that is not a number.
 */
function fitsInteger(coord: number): boolean {
    return Math.abs(encode(coord)) < MAX_INTEGER;
}

const OFFSET_ZOOM = 0;
const OFFSET_ID = 1;
const OFFSET_PARENT = 2;
const OFFSET_NUM = 3;
const OFFSET_PROP = 4;

/**
 * This class allow clustering of geojson points.
 */
export class ClusterTileIndex implements GeoJSONVTTileIndex {
    options: Required<SuperclusterOptions>;
    /**
     * A tree per zoom level. A zoom level where no clusters form shares the tree of the zoom level above it.
     */
    trees: KDBushWithData[];
    stride: number;
    clusterProps: Record<string, unknown>[];
    points: GeoJSONVTInternalPointFeature[];
    private worldCoordinateHelper: WorldCoordinateHelper;

    constructor(options?: SuperclusterOptions) {
        this.options = createOptions(options);
        this.worldCoordinateHelper = getWorldCoordinateHelper(this.options.coordinates);
        this.trees = new Array(this.options.maxZoom + 1);
        this.stride = this.options.reduce ? 5 : 4;
        this.clusterProps = [];
        this.points = [];
    }

    /**
     * Loads GeoJSON Point and MultiPoint features and builds the internal clustering index.
     * Each position of a MultiPoint is clustered as a point of its own, with the id and properties of its feature.
     * @param points - GeoJSON Point and MultiPoint features to cluster.
     */
    load(points: GeoJSON.Feature<GeoJSON.Point | GeoJSON.MultiPoint>[]): void {
        const features: GeoJSONVTInternalPointFeature[] = [];
        
        // Convert GeoJSON point features to GeoJSONVT internal point features
        for (const point of points) {
            if (!point.geometry) {
                continue;
            }

            const positions = point.geometry.type === 'MultiPoint' ? point.geometry.coordinates : [point.geometry.coordinates];
            for (const [lng, lat] of positions) {
                const [x, y] = [this.worldCoordinateHelper.projectX(lng), this.worldCoordinateHelper.projectY(lat)];
                if (!this.options.wrap && !isInWorld([x, y])) continue;

                const feature: GeoJSONVTInternalPointFeature = {
                    id: point.id,
                    type: 'Point',
                    geometry: [x, y],
                    tags: point.properties
                };

                features.push(feature);
            }
        }
        
        this.createIndex(features);
    }

    /**
     * @internal
     * Loads internal GeoJSONVT point features from a data source and builds the clustering index.
     * Each position of a MultiPoint feature becomes a point of its own, with the id and properties of its feature.
     * @param features - {@link GeoJSONVTInternalFeature} data source features to filter and cluster.
     */
    initialize(features: GeoJSONVTInternalFeature[]): void {
        const points: GeoJSONVTInternalPointFeature[] = [];

        for (const feature of features) {
            if (feature.type === 'Point') {
                if (!this.options.wrap && !isInWorld(feature.geometry)) continue;
                points.push(feature);
                continue;
            }
            if (feature.type !== 'MultiPoint') continue;

            for (let i = 0; i < feature.geometry.length; i += 3) {
                const geometry = [feature.geometry[i], feature.geometry[i + 1]];
                if (!this.options.wrap && !isInWorld(geometry)) continue;
                points.push({id: feature.id, type: 'Point', geometry, tags: feature.tags});
            }
        }

        this.createIndex(points);
    }

    /**
     * @internal
     * Updates the cluster data by rebuilding.
     * @param features 
     */
    updateIndex(features: GeoJSONVTInternalFeature[], _affected: GeoJSONVTInternalFeature[], options: GeoJSONVTOptions) {
        this.options = createOptions({...options.clusterOptions, coordinates: this.options.coordinates, wrap: this.options.wrap});
        this.initialize(features);
    }

    /**
     * Builds a tree per zoom level from the points. A point whose position does not fit in an integer is left out,
     * see `fitsInteger`.
     */
    private createIndex(points: GeoJSONVTInternalPointFeature[]): void {
        const {log, minZoom, maxZoom} = this.options;

        // start over, since the options can have changed since the last build
        this.trees = new Array(maxZoom + 1);
        this.stride = this.options.reduce ? 5 : 4;
        this.clusterProps = [];

        if (log) console.time('total time');

        const timerId = `prepare ${points.length} points`;
        if (log) console.time(timerId);

        this.points = points;

        const stride = this.stride;
        const notProcessed = maxZoom + 1;

        // generate a cluster object for each point and index input points into a KD-tree
        const coords = new Int32Array(points.length * 2);
        const data = new Int32Array(points.length * stride);
        let numItems = 0;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (!p?.geometry || !fitsInteger(p.geometry[0]) || !fitsInteger(p.geometry[1])) continue;

            // store internal point/cluster data in flat numeric arrays for performance
            coords[numItems * 2] = Math.round(encode(p.geometry[0])); // projected point coordinates
            coords[numItems * 2 + 1] = Math.round(encode(p.geometry[1]));
            const k = numItems * stride;
            data[k + OFFSET_ZOOM] = notProcessed; // the last zoom the point was processed at
            data[k + OFFSET_ID] = i; // index of the source feature in the original input array
            data[k + OFFSET_PARENT] = -1; // parent cluster id
            data[k + OFFSET_NUM] = 1; // number of points in a cluster
            numItems++;
        }
        let tree = this.trees[maxZoom + 1] = this.createTree(coords, data, numItems);

        if (log) console.timeEnd(timerId);

        // cluster points on max zoom, then cluster the results on previous zoom, etc.;
        // results in a cluster hierarchy across zoom levels
        const nextCoords = new Int32Array(numItems * 2);
        const nextData = new Int32Array(numItems * stride);
        for (let z = maxZoom; z >= minZoom; z--) {
            const now = Date.now();

            const nextNumItems = this.cluster(tree, z, nextCoords, nextData);

            if (!this.isSameAsTree(tree, nextData, nextNumItems)) {
                // create a new set of clusters for the zoom and index them with a KD-tree
                tree = this.createTree(nextCoords.slice(0, nextNumItems * 2), nextData.slice(0, nextNumItems * stride), nextNumItems);
            }
            this.trees[z] = tree;

            if (log) console.log('z%d: %d clusters in %dms', z, tree.numItems, Date.now() - now);
        }

        if (log) console.timeEnd('total time');
    }

    /**
     * Returns clusters and/or points within a bounding box at a given zoom level.
     * @param bbox - Bounding box in `[westLng, southLat, eastLng, northLat]` order, or `[minX, minY, maxX, maxY]` in the unit square with `coordinates: 'unitSquare'`.
     * In a world that wraps, the box can reach across the antimeridian. In one that doesn't, only its part inside the world counts.
     * @param zoom - Zoom level to query.
     */
    public getClusters(bbox: [number, number, number, number], zoom: number): ClusterOrPointFeature[] {
        const clusterInternal =
            !this.options.wrap ? this.getClustersInWorld(bbox, zoom) :
                this.options.coordinates === 'unitSquare' ? this.getClustersAcrossEdge(bbox, zoom) :
                    this.getClustersInternal(bbox, zoom);
        return clusterInternal.map((f) => featureToGeoJSON(f, this.worldCoordinateHelper) as ClusterOrPointFeature);
    }

    /**
     * The clusters and points in the part of a box inside a world that ends at its edges.
     */
    private getClustersInWorld(bbox: [number, number, number, number], zoom: number): ClusterOrPointFeatureInternal[] {
        const lngLat = this.options.coordinates !== 'unitSquare';
        const y1 = this.worldCoordinateHelper.projectY(lngLat ? Math.max(-90, Math.min(90, bbox[1])) : bbox[1]);
        const y2 = this.worldCoordinateHelper.projectY(lngLat ? Math.max(-90, Math.min(90, bbox[3])) : bbox[3]);
        const minX = Math.max(0, this.worldCoordinateHelper.projectX(bbox[0]));
        const maxX = Math.min(1, this.worldCoordinateHelper.projectX(bbox[2]));
        if (minX > maxX) return [];
        return this.getClustersInRange([minX, Math.min(y1, y2), maxX, Math.max(y1, y2)], zoom);
    }

    /**
     * The clusters and points in a box of a unit square that wraps, where the box can reach across its left or right edge.
     */
    private getClustersAcrossEdge([minX, minY, maxX, maxY]: [number, number, number, number], zoom: number): ClusterOrPointFeatureInternal[] {
        if (maxX < minX) maxX += 1;
        if (maxX - minX >= 1) return this.getClustersInRange([0, minY, 1, maxY], zoom);
        const shift = Math.floor(minX);
        const west = minX - shift;
        const east = maxX - shift;
        if (east <= 1) return this.getClustersInRange([west, minY, east, maxY], zoom);
        return this.getClustersInRange([west, minY, 1, maxY], zoom).concat(this.getClustersInRange([0, minY, east - 1, maxY], zoom));
    }

    private getClustersInternal(bbox: [number, number, number, number], zoom: number): ClusterOrPointFeatureInternal[] {
        let minLng = ((bbox[0] + 180) % 360 + 360) % 360 - 180;
        const minLat = Math.max(-90, Math.min(90, bbox[1]));
        let maxLng = bbox[2] === 180 ? 180 : ((bbox[2] + 180) % 360 + 360) % 360 - 180;
        const maxLat = Math.max(-90, Math.min(90, bbox[3]));

        if (bbox[2] - bbox[0] >= 360) {
            minLng = -180;
            maxLng = 180;
        } else if (minLng > maxLng) {
            const easternHem = this.getClustersInternal([minLng, minLat, 180, maxLat], zoom);
            const westernHem = this.getClustersInternal([-180, minLat, maxLng, maxLat], zoom);
            return easternHem.concat(westernHem);
        }

        return this.getClustersInRange([this.worldCoordinateHelper.projectX(minLng), this.worldCoordinateHelper.projectY(maxLat), this.worldCoordinateHelper.projectX(maxLng), this.worldCoordinateHelper.projectY(minLat)], zoom);
    }

    /**
     * The clusters and points in a box of the internal coordinates, `[minX, minY, maxX, maxY]`.
     */
    private getClustersInRange([minX, minY, maxX, maxY]: [number, number, number, number], zoom: number): ClusterOrPointFeatureInternal[] {
        const tree = this.trees[this.limitZoom(zoom)];
        const ids = tree.range(encode(minX), encode(minY), encode(maxX), encode(maxY));
        const coords = tree.flatCoords;
        const data = tree.flatData;
        const clusters: ClusterOrPointFeatureInternal[] = [];
        for (const id of ids) {
            const k = this.stride * id;
            clusters.push(data[k + OFFSET_NUM] > 1 ? getClusterFeature(coords, id, data, k, this.clusterProps) : this.points[data[k + OFFSET_ID]]);
        }
        return clusters;
    }

    /**
     * Returns the immediate children (clusters or points) of a cluster as GeoJSON.
     * @param clusterId - The target cluster id.
     */
    getChildren(clusterId: number): ClusterOrPointFeature[] {
        const originId = this.getOriginId(clusterId);
        const originZoom = this.getOriginZoom(clusterId);
        const clusterError = new Error('No cluster with the specified id: ' + clusterId);

        const tree = this.trees[originZoom];
        if (!tree) throw clusterError;

        const coords = tree.flatCoords;
        const data = tree.flatData;
        if (originId >= tree.numItems) throw clusterError;

        const r = this.options.radius / (this.options.extent * Math.pow(2, originZoom - 1)) * SCALE;
        const x = coords[originId * 2];
        const y = coords[originId * 2 + 1];
        const ids = tree.within(x, y, r);
        const children: ClusterOrPointFeature[] = [];
        for (const id of ids) {
            const k = id * this.stride;
            if (data[k + OFFSET_PARENT] === clusterId) {
                children.push(data[k + OFFSET_NUM] > 1 ? getClusterGeoJSON(coords, id, data, k, this.clusterProps, this.worldCoordinateHelper) : featureToGeoJSON(this.points[data[k + OFFSET_ID]], this.worldCoordinateHelper) as GeoJSON.Feature<GeoJSON.Point>);
            }
        }

        if (children.length === 0) throw clusterError;

        return children;
    }

    /**
     * Returns leaf point features under a cluster, paginated by `limit` and `offset`.
     * @param clusterId - The target cluster id.
     * @param limit - Maximum number of points to return (defaults to `10`).
     * @param offset - Number of points to skip before collecting results (defaults to `0`).
     */
    getLeaves(clusterId: number, limit?: number, offset?: number): GeoJSON.Feature<GeoJSON.Point>[] {
        limit = limit || 10;
        offset = offset || 0;

        const leaves: GeoJSON.Feature<GeoJSON.Point>[] = [];
        this.appendLeaves(leaves, clusterId, limit, offset, 0);

        return leaves;
    }

    /**
     * Generates a vector-tile-like representation of a single tile.
     * @param z - Tile zoom.
     * @param x - Tile x coordinate.
     * @param y - Tile y coordinate.
     */
    getTile(z: number, x: number, y: number): GeoJSONVTTile | null {
        const tree = this.trees[this.limitZoom(z)];
        if (!tree) {
            return null;
        }
        const z2 = Math.pow(2, z);
        if (!this.options.wrap && (x < 0 || x >= z2 || y < 0 || y >= z2)) return null;
        const {extent, radius} = this.options;
        const p = radius / extent;
        const top = encode((y - p) / z2);
        const bottom = encode((y + 1 + p) / z2);

        const tile: GeoJSONVTTile = {
            transformed: true,
            features: [],
            source: null,
            x: x,
            y: y,
            z: z
        };

        this.addTileFeatures(
            tree.range(encode((x - p) / z2), top, encode((x + 1 + p) / z2), bottom),
            tree, x, y, z2, tile);

        if (this.options.wrap && x === 0) {
            this.addTileFeatures(
                tree.range(encode(1 - p / z2), top, encode(1), bottom),
                tree, z2, y, z2, tile);
        }
        if (this.options.wrap && x === z2 - 1) {
            this.addTileFeatures(
                tree.range(encode(0), top, encode(p / z2), bottom),
                tree, -1, y, z2, tile);
        }

        return tile;
    }

    /**
     * Returns the zoom level at which a cluster expands into multiple children.
     * @param clusterId - The target cluster id.
     */
    getClusterExpansionZoom(clusterId: number): number {
        return this.getOriginZoom(clusterId);
    }

    private appendLeaves(result: GeoJSON.Feature<GeoJSON.Point>[], clusterId: number, limit: number, offset: number, skipped: number): number {
        const children = this.getChildren(clusterId);

        for (const child of children) {
            const props = child.properties as ClusterProperties | null;

            if (props?.cluster) {
                if (skipped + props.point_count <= offset) {
                    // skip the whole cluster
                    skipped += props.point_count;
                } else {
                    // enter the cluster
                    skipped = this.appendLeaves(result, props.cluster_id, limit, offset, skipped);
                    // exit the cluster
                }
            } else if (skipped < offset) {
                // skip a single point
                skipped++;
            } else {
                // add a single point
                result.push(child as GeoJSON.Feature<GeoJSON.Point>);
            }
            if (result.length === limit) break;
        }

        return skipped;
    }

    private createTree(coords: Int32Array, data: Int32Array, numItems: number): KDBushWithData {
        const tree = new KDBush(numItems, this.options.nodeSize, Int32Array) as unknown as KDBushWithData;
        for (let i = 0; i < numItems; i++) tree.add(coords[i * 2], coords[i * 2 + 1]);
        tree.finish();
        tree.flatCoords = coords;
        tree.flatData = data;
        tree.data = null; // clear original data to free memory as it isn't used later on.
        return tree;
    }

    /**
     * Whether clustering a tree left all its points and clusters as they were, in the same order.
     */
    private isSameAsTree(tree: KDBushWithData, nextData: Int32Array, nextNumItems: number): boolean {
        if (nextNumItems !== tree.numItems) return false;

        const data = tree.flatData;
        for (let k = OFFSET_ID; k < nextNumItems * this.stride; k += this.stride) {
            if (nextData[k] !== data[k]) return false;
        }
        return true;
    }

    private addTileFeatures(ids: number[], tree: KDBushWithData, x: number, y: number, z2: number, tile: GeoJSONVTTile): void {
        const coords = tree.flatCoords;
        const data = tree.flatData;
        for (const i of ids) {
            const k = i * this.stride;
            const isCluster = data[k + OFFSET_NUM] > 1;

            let tags: GeoJSON.GeoJsonProperties | ClusterProperties;
            let px: number;
            let py: number;
            if (isCluster) {
                tags = getClusterProperties(data, k, this.clusterProps);
                px = decode(coords[i * 2]);
                py = decode(coords[i * 2 + 1]);
            } else {
                const p = this.points[data[k + OFFSET_ID]];
                tags = p.tags;
                [px, py] = p.geometry;
            }

            const f: GeoJSONVTFeature = {
                type: 1,
                geometry: [[
                    Math.round(this.options.extent * (px * z2 - x)),
                    Math.round(this.options.extent * (py * z2 - y))
                ]],
                tags
            };

            // assign id
            let id: number | string | undefined;
            if (isCluster || this.options.generateId) {
                // optionally generate id for points
                id = data[k + OFFSET_ID];
            } else {
                // keep id if already assigned
                id = this.points[data[k + OFFSET_ID]].id as number | string | undefined;
            }

            if (id !== undefined) f.id = id;

            tile.features.push(f);
        }
    }

    private limitZoom(z: number): number {
        return Math.max(this.options.minZoom, Math.min(Math.floor(+z), this.options.maxZoom + 1));
    }

    /**
     * Clusters the points of a tree on a zoom level, writing the result to `nextCoords` and `nextData`.
     * @returns the number of points and clusters written
     */
    private cluster(tree: KDBushWithData, zoom: number, nextCoords: Int32Array, nextData: Int32Array): number {
        const {radius, extent, reduce, minPoints, maxZoom} = this.options;
        const r = radius / (extent * Math.pow(2, zoom)) * SCALE;
        const notProcessed = maxZoom + 1;
        const coords = tree.flatCoords;
        const data = tree.flatData;
        const stride = this.stride;
        const neighborIds = new Uint32Array(tree.numItems);
        let nextNumItems = 0;

        // loop through each point
        for (let index = 0; index < tree.numItems; index++) {
            const i = index * stride;
            // if we've already visited the point at this zoom level, skip it
            if (data[i + OFFSET_ZOOM] <= zoom) continue;
            data[i + OFFSET_ZOOM] = zoom;

            // find all nearby points
            const x = coords[index * 2];
            const y = coords[index * 2 + 1];
            const numNeighbors = tree.withinInto(x, y, r, neighborIds);

            const numPointsOrigin = data[i + OFFSET_NUM];
            let numPoints = numPointsOrigin;

            // count the number of points in a potential cluster
            for (let n = 0; n < numNeighbors; n++) {
                const k = neighborIds[n] * stride;
                // filter out neighbors that are already processed
                if (data[k + OFFSET_ZOOM] > zoom) numPoints += data[k + OFFSET_NUM];
            }

            // if there were neighbors to merge, and there are enough points to form a cluster
            if (numPoints > numPointsOrigin && numPoints >= minPoints) {
                let wx = x * numPointsOrigin;
                let wy = y * numPointsOrigin;

                let clusterProperties: Record<string, unknown> | undefined;
                let clusterPropIndex = -1;

                // encode both zoom and point index on which the cluster originated -- offset by total length of features
                const id = (index << 5) + (zoom + 1) + this.points.length;

                for (let n = 0; n < numNeighbors; n++) {
                    const neighborIndex = neighborIds[n];
                    const k = neighborIndex * stride;

                    if (data[k + OFFSET_ZOOM] <= zoom) continue;
                    data[k + OFFSET_ZOOM] = zoom; // save the zoom (so it doesn't get processed twice)

                    const numPoints2 = data[k + OFFSET_NUM];
                    wx += coords[neighborIndex * 2] * numPoints2; // accumulate coordinates for calculating weighted center
                    wy += coords[neighborIndex * 2 + 1] * numPoints2;

                    data[k + OFFSET_PARENT] = id;

                    if (reduce) {
                        if (!clusterProperties) {
                            clusterProperties = this.map(data, i, true);
                            clusterPropIndex = this.clusterProps.length;
                            this.clusterProps.push(clusterProperties);
                        }
                        reduce(clusterProperties, this.map(data, k));
                    }
                }

                data[i + OFFSET_PARENT] = id;
                nextCoords[nextNumItems * 2] = Math.round(wx / numPoints);
                nextCoords[nextNumItems * 2 + 1] = Math.round(wy / numPoints);
                const next = nextNumItems * stride;
                nextData[next + OFFSET_ZOOM] = notProcessed;
                nextData[next + OFFSET_ID] = id;
                nextData[next + OFFSET_PARENT] = -1;
                nextData[next + OFFSET_NUM] = numPoints;
                if (reduce) nextData[next + OFFSET_PROP] = clusterPropIndex;
                nextNumItems++;

            } else { // left points as unclustered
                nextCoords[nextNumItems * 2] = x;
                nextCoords[nextNumItems * 2 + 1] = y;
                for (let j = 0; j < stride; j++) nextData[nextNumItems * stride + j] = data[i + j];
                nextNumItems++;

                if (numPoints > 1) {
                    for (let n = 0; n < numNeighbors; n++) {
                        const neighborIndex = neighborIds[n];
                        const k = neighborIndex * stride;
                        if (data[k + OFFSET_ZOOM] <= zoom) continue;
                        data[k + OFFSET_ZOOM] = zoom;
                        nextCoords[nextNumItems * 2] = coords[neighborIndex * 2];
                        nextCoords[nextNumItems * 2 + 1] = coords[neighborIndex * 2 + 1];
                        for (let j = 0; j < stride; j++) nextData[nextNumItems * stride + j] = data[k + j];
                        nextNumItems++;
                    }
                }
            }
        }

        return nextNumItems;
    }

    // get index of the point from which the cluster originated
    private getOriginId(clusterId: number): number {
        return (clusterId - this.points.length) >> 5;
    }

    // get zoom of the point from which the cluster originated
    private getOriginZoom(clusterId: number): number {
        return (clusterId - this.points.length) % 32;
    }

    private map(data: Int32Array, i: number, clone?: boolean): Record<string, unknown> {
        if (data[i + OFFSET_NUM] > 1) {
            const props = this.clusterProps[data[i + OFFSET_PROP]];
            return clone ? Object.assign({}, props) : props;
        }
        const original = this.points[data[i + OFFSET_ID]].tags;
        const result = this.options.map(original);
        return clone && result === original ? Object.assign({}, result) : result;
    }
}

function createOptions(options?: SuperclusterOptions): Required<SuperclusterOptions> {
    const result = Object.assign(Object.create(defaultClusterOptions), options) as Required<SuperclusterOptions>;
    result.minZoom = Math.min(result.minZoom, MAX_ZOOM);
    result.maxZoom = Math.min(result.maxZoom, MAX_ZOOM);
    return result;
}

function getClusterFeature(coords: Int32Array, index: number, data: Int32Array, i: number, clusterProps: Record<string, unknown>[]): ClusterFeatureInternal {
    return {
        id: data[i + OFFSET_ID],
        type: 'Point',
        tags: getClusterProperties(data, i, clusterProps),
        geometry: [decode(coords[index * 2]), decode(coords[index * 2 + 1])]
    };
}

function getClusterGeoJSON(coords: Int32Array, index: number, data: Int32Array, i: number, clusterProps: Record<string, unknown>[], worldCoordinateHelper: WorldCoordinateHelper): ClusterFeature {
    return {
        type: 'Feature',
        id: data[i + OFFSET_ID],
        properties: getClusterProperties(data, i, clusterProps),
        geometry: {
            type: 'Point',
            coordinates: [worldCoordinateHelper.unprojectX(decode(coords[index * 2])), worldCoordinateHelper.unprojectY(decode(coords[index * 2 + 1]))]
        }
    };
}

function getClusterProperties(data: Int32Array, i: number, clusterProps: Record<string, unknown>[]): ClusterProperties {
    const count = data[i + OFFSET_NUM];
    const abbrev =
        count >= 10000 ? `${Math.round(count / 1000)  }k` :
        count >= 1000 ? `${Math.round(count / 100) / 10  }k` : count;
    const propIndex = data[i + OFFSET_PROP];
    const properties = propIndex === -1 ? {} : Object.assign({}, clusterProps[propIndex]);

    return Object.assign(properties, {
        cluster: true as const,
        cluster_id: data[i + OFFSET_ID],
        point_count: count,
        point_count_abbreviated: abbrev
    });
}

function isInWorld(geometry: number[]): boolean {
    return geometry[0] >= 0 && geometry[0] <= 1 && geometry[1] >= 0 && geometry[1] <= 1;
}
