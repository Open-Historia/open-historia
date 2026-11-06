/**
 * The space positions are given in, see `coordinates` in {@link GeoJSONVTOptions}.
 * @experimental
 */
export type GeoJSONVTCoordinatesType = 'lngLat' | 'unitSquare';

export type GeoJSONVTOptions = {
    /**
     * Max zoom to preserve detail on
     * @default 14
     */
    maxZoom?: number;
    /**
     * Max zoom in the tile index
     * @default 3
     */
    indexMaxZoom?: number;
    /**
     * Max number of points per tile in the tile index
     * @default 100000
     */
    indexMaxPoints?: number;
    /**
     * Points kept in tiles cut on demand, before the ones asked for longest ago are given back
     * @default 3000000
     */
    drilledMaxPoints?: number;
    /**
     * Simplification tolerance (higher means simpler)
     * @default 3
     */
    tolerance?: number;
    /**
     * Tile extent
     * @default 4096
     */
    extent?: number;
    /**
     * Tile buffer on each side
     * @default 64
     */
    buffer?: number;
    /**
     * Whether to calculate line metrics
     * @default false
     */
    lineMetrics?: boolean;
    /**
     * Name of a feature property to be promoted to feature.id
     */
    promoteId?: string | null;
    /**
     * Whether to generate feature ids. Cannot be used with promoteId
     * @default false
     */
    generateId?: boolean;
    /**
     * Whether geojson can be updated (with caveat of a stored simplified copy)
     * @default false
     */
    updateable?: boolean;
    /**
     * Logging level (0, 1 or 2)
     * @default 0
     */
    debug?: number;
    /**
     * The space the positions are in. `'lngLat'` is longitude and latitude, which web mercator puts in the square from 0
     * to 1 that tile 0/0/0 covers, with latitudes beyond ~85.05 degrees clamped onto its top and bottom. `'unitSquare'`
     * is x and y in that square already, y growing downward, taken as they are, for data in another projection.
     * `getData` and the cluster methods return positions in the same space.
     * @experimental
     * @default 'lngLat'
     */
    coordinates?: GeoJSONVTCoordinatesType;
    /**
     * Whether the world wraps around the antimeridian. With `true`, features near the left or right edge are copied
     * across it, and the tiles at either edge include what lies past it. With `false`, the world is the square and ends
     * at its edges. Features are cut at the tile buffer around it, points outside it are left out of the clusters, and
     * `getTile` returns `null` outside it. `geoJSONToTile` doesn't wrap unless this is `true`.
     * @experimental
     * @default true
     */
    wrap?: boolean;
    /**
     * Enable Supercluster for point features. Each position of a MultiPoint feature is clustered as a point of its own.
     * Other geometry types are left out.
     * @default false
     */
    cluster?: boolean;
    /**
     * Options for the Supercluster point clustering algorithm. `coordinates` and `wrap` come from the options above.
     * @see {@link SuperclusterOptions}
     */
    clusterOptions?: Omit<SuperclusterOptions, 'coordinates' | 'wrap'>;
};

export type GeoJSONToTileOptions = GeoJSONVTOptions & {
    /**
     * Whether to wrap features around the antimeridian, see `wrap` in {@link GeoJSONVTOptions}.
     * @default false
     */
    wrap?: boolean;
    /**
     * Whether to clip features to the tile boundary
     * @default false
     */
    clip?: boolean;
};

export type SliceArray = { points: number[]; start?: number; end?: number; size?: number };

export type SliceFixedArray = { points: number[] | Float64Array; start?: number; end?: number; size?: number };

export type PartialGeoJSONVTFeature = {
    id?: number | string | undefined;
    tags: GeoJSON.GeoJsonProperties;
    minX?: number;
    minY?: number;
    maxX?: number;
    maxY?: number;
}

export type GeoJSONVTInternalPointFeature = PartialGeoJSONVTFeature & {
    type: 'Point';
    geometry: number[];
};

export type GeoJSONVTInternalMultiPointFeature = PartialGeoJSONVTFeature & {
    type: 'MultiPoint';
    geometry: number[];
};

export type GeoJSONVTInternalLineStringFeature = PartialGeoJSONVTFeature & {
    type: 'LineString';
    geometry: SliceFixedArray;
};

export type GeoJSONVTInternalMultiLineStringFeature = PartialGeoJSONVTFeature & {
    type: 'MultiLineString';
    geometry: SliceFixedArray[];
};

export type GeoJSONVTInternalPolygonFeature = PartialGeoJSONVTFeature & {
    type: 'Polygon';
    geometry: SliceFixedArray[];
};

export type GeoJSONVTInternalMultiPolygonFeature = PartialGeoJSONVTFeature & {
    type: 'MultiPolygon';
    geometry: SliceFixedArray[][];
};

export type GeoJSONVTInternalFeature =
    | GeoJSONVTInternalPointFeature
    | GeoJSONVTInternalMultiPointFeature
    | GeoJSONVTInternalLineStringFeature
    | GeoJSONVTInternalMultiLineStringFeature
    | GeoJSONVTInternalPolygonFeature
    | GeoJSONVTInternalMultiPolygonFeature;

/**
 * The geojson properies related to a cluster.
 */
export type ClusterProperties = {
    cluster: true;
    cluster_id: number;
    point_count: number;
    point_count_abbreviated: string | number;
    [key: string]: unknown;
};

/**
 * A geojson point with cluster properties, see {@link ClusterProperties}.
 */
export type ClusterFeature = GeoJSON.Feature<GeoJSON.Point, ClusterProperties>;

/**
 * A geojson point that is either a regular point or a cluster, which is a point with cluster properties.
 * See {@link ClusterFeature} for more information
 */
export type ClusterOrPointFeature = ClusterFeature | GeoJSON.Feature<GeoJSON.Point>;

export type GeoJSONVTInternalTileFeaturePoint = {
    id? : number | string | undefined;
    type: 1;
    tags: GeoJSON.GeoJsonProperties | null;
    geometry: number[];
}

export type GeoJSONVTInternalTileFeatureNonPoint = {
    id? : number | string | undefined;
    type: 2 | 3;
    tags: GeoJSON.GeoJsonProperties | null;
    geometry: number[][];
}
export type GeoJSONVTInternalTileFeature = GeoJSONVTInternalTileFeaturePoint | GeoJSONVTInternalTileFeatureNonPoint;

export type GeoJSONVTInternalTile = {
    transformed: boolean;
    features: GeoJSONVTInternalTileFeature[];
    source: GeoJSONVTInternalFeature[] | null;
    x: number;
    y: number;
    z: number;
    minX?: number;
    minY?: number;
    maxX?: number;
    maxY?: number;
    numPoints?: number;
    numSimplified?: number;
    numFeatures?: number;
}

export type GeoJSONVTFeaturePoint = {
    id? : number | string | undefined;
    type: 1;
    tags: GeoJSON.GeoJsonProperties | null;
    geometry: [number, number][]
}

export type GeoJSONVTFeatureNonPoint = {
    id? : number | string | undefined;
    type: 2 | 3;
    tags: GeoJSON.GeoJsonProperties | null;
    geometry: [number, number][][]
}

export type GeoJSONVTFeature = GeoJSONVTFeaturePoint | GeoJSONVTFeatureNonPoint;

export type GeoJSONVTTile = GeoJSONVTInternalTile & {
    transformed: true;
    features: GeoJSONVTFeature[]
}

export interface GeoJSONVTTileIndex {
    initialize(features: GeoJSONVTInternalFeature[]): void;
    updateIndex(source: GeoJSONVTInternalFeature[], affected: GeoJSONVTInternalFeature[], options: GeoJSONVTOptions): void;
    getClusterExpansionZoom(clusterId: number): number | null;
    getChildren(clusterId: number): ClusterOrPointFeature[] | null;
    getLeaves(clusterId: number, limit?: number, offset?: number): GeoJSON.Feature<GeoJSON.Point>[] | null
    getTile(z: number, x: number, y: number): GeoJSONVTTile | null
}

export type SuperclusterOptions = {
    /**
     * Min zoom to generate clusters on. A value above 30 is limited to 30.
     * @default 0
     */
    minZoom?: number;
    /**
     * Max zoom level to cluster the points on. A value above 30 is limited to 30.
     * @default 16
     */
    maxZoom?: number;
    /**
     * Minimum points to form a cluster
     * @default 2
     */
    minPoints?: number;
    /**
     * Cluster radius in pixels
     * @default 40
     */
    radius?: number;
    /**
     * Tile extent (radius is calculated relative to it)
     * @default 512
     */
    extent?: number;
    /**
     * Size of the KD-tree leaf node, affects performance
     * @default 64
     */
    nodeSize?: number;
    /**
     * Whether to log timing info
     * @default false
     */
    log?: boolean;
    /**
     * Whether to generate numeric ids for input features (in vector tiles). Each position of a MultiPoint feature
     * gets an id of its own.
     * @default false
     */
    generateId?: boolean;
    /**
     * A reduce function for calculating custom cluster properties
     * @default null
     */
    reduce?: ((accumulated: Record<string, unknown>, props: Record<string, unknown>) => void) | null;
    /**
     * Properties to use for individual points when running the reducer
     * @default props => props
     */
    map?: (props: GeoJSON.GeoJsonProperties) => Record<string, unknown>;
    /**
     * The space the points are in, see `coordinates` in {@link GeoJSONVTOptions}. The bounding box of `getClusters` is
     * in the same space.
     * @experimental
     * @default 'lngLat'
     */
    coordinates?: GeoJSONVTCoordinatesType;
    /**
     * Whether the world wraps around the antimeridian, see `wrap` in {@link GeoJSONVTOptions}. With `false`, points
     * outside the square are left out of the clusters, the tiles at an edge get no points from the opposite one, and
     * `getTile` returns `null` outside the square.
     * @experimental
     * @default true
     */
    wrap?: boolean;
};