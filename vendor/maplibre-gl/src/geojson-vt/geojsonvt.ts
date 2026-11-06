import {convertToInternal} from './convert';
import {convertToGeoJSON, featureToGeoJSON} from './deconvert';
import {getWorldCoordinateHelper, type WorldCoordinateHelper} from './world-coordinate-helper';
import {wrap} from './wrap';
import {applySourceDiff, type GeoJSONVTSourceDiff} from './difference';
import {ClusterTileIndex, defaultClusterOptions} from './cluster-tile-index';
import {TileIndex} from './tile-index';
import type {ClusterOrPointFeature, GeoJSONVTTileIndex, GeoJSONVTInternalFeature, GeoJSONVTOptions, GeoJSONVTTile} from './definitions';

export const defaultOptions: GeoJSONVTOptions = {
    maxZoom: 14,
    indexMaxZoom: 3,
    indexMaxPoints: 100000,
    drilledMaxPoints: 3000000,
    tolerance: 3,
    extent: 4096,
    buffer: 64,
    lineMetrics: false,
    promoteId: null,
    generateId: false,
    updateable: false,
    cluster: false,
    clusterOptions: defaultClusterOptions,
    debug: 0,
    coordinates: 'lngLat',
    wrap: true
};

/**
 * Main class for creating and managing a vector tile index from GeoJSON data.
 */
export class GeoJSONVT {
    private options: GeoJSONVTOptions;
    private worldCoordinateHelper: WorldCoordinateHelper;
    
    private source?: GeoJSONVTInternalFeature[];
    private unlocated?: Map<string | number, GeoJSON.Feature>;
    private tileIndex: GeoJSONVTTileIndex;

    constructor(data: GeoJSON.GeoJSON, options?: GeoJSONVTOptions) {
        options = this.options = Object.assign({}, defaultOptions, options);
        this.worldCoordinateHelper = getWorldCoordinateHelper(options.coordinates);

        const debug = options.debug;

        if (debug) console.time('preprocess data');

        if (options.maxZoom < 0 || options.maxZoom > 24) throw new Error('maxZoom should be in the 0-24 range');
        if (options.promoteId && options.generateId) throw new Error('promoteId and generateId cannot be used together.');

        // for updateable indexes, keep the properties of the features without coordinates, so that an update can give them some
        if (options.updateable) this.unlocated = new Map();

        // projects and adds simplification info
        let features = convertToInternal(data, options, this.unlocated);

        if (debug) {
            console.timeEnd('preprocess data');
            console.log('index: maxZoom: %d, maxPoints: %d', options.indexMaxZoom, options.indexMaxPoints);
            console.time('generate tiles');
        }

        // wraps features (ie extreme west and extreme east)
        features = wrap(features, options);

        // for updateable indexes, store a copy of the original simplified features
        if (options.updateable) {
            this.source = features;
        }

        this.initializeIndex(features, options);
    }

    private initializeIndex(features: GeoJSONVTInternalFeature[], options: GeoJSONVTOptions) {
        this.tileIndex = options.cluster ? new ClusterTileIndex({...options.clusterOptions, coordinates: options.coordinates, wrap: options.wrap}) : new TileIndex(options);
        if (!features.length) return;
        this.tileIndex.initialize(features);
    }

    /**
     * Given z, x, and y tile coordinates, returns the corresponding tile with geometries in tile coordinates, much like MVT data is stored.
     * @param z - tile zoom level
     * @param x - tile x coordinate
     * @param y - tile y coordinate
     * @returns the transformed tile or null if not found
     */
    getTile(z: number | string, x: number | string, y: number | string): GeoJSONVTTile | null {
        z = +z;
        x = +x;
        y = +y;

        if (z < 0 || z > 24) return null;

        return this.tileIndex.getTile(z, x, y);
    }

    /**
     * Updates the source data feature set using a {@link GeoJSONVTSourceDiff}
     * @param diff - the source diff object
     */
    updateData(diff: GeoJSONVTSourceDiff, filter?: (feature: GeoJSON.Feature) => boolean) {
        const options = this.options;

        if (!options.updateable) throw new Error('to update tile geojson `updateable` option must be set to true');

        // apply diff and collect affected features and updated source that will be used to invalidate tiles
        let {affected, source} = applySourceDiff(this.source, diff, options, this.unlocated);

        if (filter) {
            ({affected, source} = this.filterUpdate(source, affected, filter));
        }

        // nothing has changed
        if (!affected.length) return;

        // update source with new simplified feature set
        this.source = source;

        this.tileIndex.updateIndex(source, affected, options);
    }

    /**
     * Filter an update using a predicate function, the features an update emptied included, so that one the filter
     * rejects can't come back with a later update. A feature without a geometry at all isn't passed to the predicate.
     * Returns the affected and updated source features.
     */
    private filterUpdate(source: GeoJSONVTInternalFeature[], affected: GeoJSONVTInternalFeature[], predicate: (feature: GeoJSON.Feature) => boolean) {
        const removeIds = new Set();

        for (const feature of source) {
            if (feature.id == undefined) continue;
            if (predicate(featureToGeoJSON(feature, this.worldCoordinateHelper))) continue;
            affected.push(feature);
            removeIds.add(feature.id);
        }
        source = source.filter(feature => !removeIds.has(feature.id));

        for (const [id, feature] of this.unlocated ?? []) {
            if (feature.geometry && !predicate(feature)) this.unlocated.delete(id);
        }

        return {affected, source};
    }

    /**
     * Returns source data as GeoJSON - only available when `updateable` option is set to true.
     */
    getData(): GeoJSON.GeoJSON {
        if (!this.options.updateable) throw new Error('to retrieve data the `updateable` option must be set to true');
        return convertToGeoJSON(this.source, this.worldCoordinateHelper);
    }
    
    /**
     * Update supercluster options and regenerate the index.
     * @param cluster - whether to enable clustering
     * @param clusterOptions - {@link SuperclusterOptions} without `coordinates` and `wrap`, which come from the index options
     */
    updateClusterOptions(cluster: boolean, clusterOptions: GeoJSONVTOptions['clusterOptions']) {
        const wasCluster = this.options.cluster;
        this.options.cluster = cluster;
        this.options.clusterOptions = clusterOptions;

        if (wasCluster == cluster) {
            this.tileIndex.updateIndex(this.source, [], this.options);
            return;    
        }

        this.initializeIndex(this.source, this.options);
    }

    /**
     * Returns the zoom level at which a cluster expands into multiple children.
     * @param clusterId - The target cluster id.
     * @returns the expansion zoom or null in case of non-clustered source
     */
    getClusterExpansionZoom(clusterId: number): number | null {
        return this.tileIndex.getClusterExpansionZoom(clusterId);
    }

    /**
     * Returns the immediate children (clusters or points) of a cluster as GeoJSON.
     * @param clusterId - The target cluster id.
     * @returns the immediate children or null in case of non-clustered source
     */
    getClusterChildren(clusterId: number): ClusterOrPointFeature[] | null {
        return this.tileIndex.getChildren(clusterId);
    }

    /**
     * Returns leaf point features under a cluster, paginated by `limit` and `offset`.
     * @param clusterId - The target cluster id.
     * @param limit - Maximum number of points to return (defaults to `10`).
     * @param offset - Number of points to skip before collecting results (defaults to `0`).
     * @returns leaf point features under a cluster or null in case of non-clustered source
     */
    getClusterLeaves(clusterId: number, limit: number, offset: number): GeoJSON.Feature<GeoJSON.Point>[] | null {
        return this.tileIndex.getLeaves(clusterId, limit, offset);
    }
}
