import { AxisType, clip } from "./clip";
import { compactTile } from "./compact";
import { createTile } from "./tile";
import { transformTile } from "./transform";
import type { GeoJSONVTInternalFeature, GeoJSONVTOptions, ClusterOrPointFeature, GeoJSONVTTileIndex, GeoJSONVTInternalTile, GeoJSONVTTile } from "./definitions";

export class TileIndex implements GeoJSONVTTileIndex {

    private tileCoords: {z: number, x: number, y: number, id: number}[];
    private total: number = 0;

    /** @internal */
    public tiles: {[key: string]: GeoJSONVTInternalTile};
    /** @internal */
    public stats: {[key: string]: number} = {};
    /** Tiles cut on demand, least recently asked for first, and what they hold: these can be cut again. */
    private drilled = new Map<number, GeoJSONVTInternalTile>();
    private drilledPoints = 0;

    constructor(private options: GeoJSONVTOptions) {
        this.tiles = {};
        this.tileCoords = [];
        this.stats = {};
        this.total = 0;
    }

    initialize(features: GeoJSONVTInternalFeature[]): void {
        // start slicing from the top tile down
        this.splitTile(this.clipToWorld(features), 0, 0, 0);

        if (this.options.debug) {
            if (features.length) console.log('features: %d, points: %d', this.tiles[0].numFeatures, this.tiles[0].numPoints);
            console.timeEnd('generate tiles');
            console.log('tiles generated:', this.total, JSON.stringify(this.stats));
        }
    }

    /** {@inheritdoc} */
    updateIndex(source: GeoJSONVTInternalFeature[], affected: GeoJSONVTInternalFeature[], options: GeoJSONVTOptions): void {
        if (options.debug > 1) {
            console.log('invalidating tiles');
            console.time('invalidating');
        }

        this.invalidateTiles(affected);

        if (options.debug > 1) console.timeEnd('invalidating');

        // re-generate root tile with updated feature set
        const [z, x, y] = [0, 0, 0];
        const rootSource = this.clipToWorld(source);
        const rootTile = compactTile(createTile(rootSource, z, x, y, options), options.extent);
        rootTile.source = rootSource;

        // update tile index with new root tile - ready for getTile calls
        const id = toID(z, x, y);
        this.tiles[id] = rootTile;
        this.tileCoords.push({z, x, y, id});

        if (options.debug) {
            const key = `z${z}`;
            this.stats[key] = (this.stats[key] || 0) + 1;
            this.total++;
        }
    }

    /** {@inheritdoc} */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getClusterExpansionZoom(_clusterId: number): number | null {
        return null;
    }

    /** {@inheritdoc} */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getChildren(_clusterId: number): ClusterOrPointFeature[] | null {
        return null;
    }

    /** {@inheritdoc} */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getLeaves(_clusterId: number, _limit?: number, _offset?: number): GeoJSON.Feature<GeoJSON.Point>[] | null {
        return null;
    }

    /** {@inheritdoc} */
    getTile(z: number, x: number, y: number): GeoJSONVTTile | null {
        const {extent, debug} = this.options;
        
        const z2 = 1 << z;
        if (!this.options.wrap && (x < 0 || x >= z2)) return null; // a row outside the world has no tile either
        x = (x + z2) & (z2 - 1); // wrap tile x coordinate

        const id = toID(z, x, y);
        if (this.tiles[id]) {
            this.touch(id);
            return transformTile(this.tiles[id], extent);
        }

        if (debug > 1) console.log('drilling down to z%d-%d-%d', z, x, y);

        let z0 = z;
        let x0 = x;
        let y0 = y;
        let parent;

        while (!parent && z0 > 0) {
            z0--;
            x0 = x0 >> 1;
            y0 = y0 >> 1;
            parent = this.tiles[toID(z0, x0, y0)];
        }

        if (!parent?.source) return null;

        // if we found a parent tile containing the original geometry, we can drill down from it
        if (debug > 1) {
            console.log('found parent tile z%d-%d-%d', z0, x0, y0);
            console.time('drilling down');
        }
        this.splitTile(parent.source, z0, x0, y0, z, x, y);
        if (debug > 1) console.timeEnd('drilling down');

        const tile = this.tiles[id];
        if (!tile) return null;

        this.touch(id);
        this.forget();
        return transformTile(tile, extent);
    }

    private touch(id: number): void {
        const tile = this.drilled.get(id);
        if (!tile) return;
        this.drilled.delete(id);
        this.drilled.set(id, tile);
    }

    /** Gives back the tiles asked for longest ago. A tile's source is kept by every tile above it, so it is cut again when asked for. */
    private forget(): void {
        for (const [id, tile] of this.drilled) {
            if (this.drilledPoints <= this.options.drilledMaxPoints) return;
            this.drilled.delete(id);
            this.drilledPoints -= weight(tile);
            delete this.tiles[id];
        }
    }

    /**
     * The features the top tile starts from. A world that wraps keeps them all left and right, where wrapping already
     * put them inside, and one that doesn't only what lies inside the world square and its buffer. Positions in the
     * unit square are also cut above and below in a world that wraps, where lng/lat is clamped already. The index keeps
     * the rest, so an update can still move a feature in from outside.
     */
    private clipToWorld(features: GeoJSONVTInternalFeature[]): GeoJSONVTInternalFeature[] {
        const {wrap, coordinates} = this.options;
        if (wrap && coordinates !== 'unitSquare') return features;
        const buffer = this.options.buffer / this.options.extent;
        const inX = wrap ? features : clip(features, 1, -buffer, 1 + buffer, AxisType.X, -Infinity, Infinity, this.options) || [];
        return clip(inX, 1, -buffer, 1 + buffer, AxisType.Y, -Infinity, Infinity, this.options) || [];
    }

    /**
     * splits features from a parent tile to sub-tiles.
     * z, x, and y are the coordinates of the parent tile
     * cz, cx, and cy are the coordinates of the target tile
     * 
     * If no target tile is specified, splitting stops when we reach the maximum
     * zoom or the number of points is low as specified in the options.
     * @internal
     * @param features - features to split
     * @param z - tile zoom level
     * @param x - tile x coordinate
     * @param y - tile y coordinate
     * @param cz - target tile zoom level
     * @param cx - target tile x coordinate
     * @param cy - target tile y coordinate
     */
    private splitTile(features: GeoJSONVTInternalFeature[], z: number, x: number, y: number, cz?: number, cx?: number, cy?: number) {

        const stack = [features, z, x, y];
        const options = this.options;
        const debug = options.debug;

        // avoid recursion by using a processing queue
        while (stack.length) {
            y = stack.pop() as number;
            x = stack.pop() as number;
            z = stack.pop() as number;
            features = stack.pop() as GeoJSONVTInternalFeature[];

            const z2 = 1 << z;
            const id = toID(z, x, y);
            let tile = this.tiles[id];

            if (!tile) {
                if (debug > 1) console.time('creation');

                tile = this.tiles[id] = compactTile(createTile(features, z, x, y, options), options.extent);
                if (cz == null) {
                    this.tileCoords.push({z, x, y, id});
                } else {
                    this.drilled.set(id, tile);
                    this.drilledPoints += weight(tile);
                }

                if (debug) {
                    if (debug > 1) {
                        console.log('tile z%d-%d-%d (features: %d, points: %d, simplified: %d)',
                            z, x, y, tile.numFeatures, tile.numPoints, tile.numSimplified);
                        console.timeEnd('creation');
                    }
                    const key = `z${z}`;
                    this.stats[key] = (this.stats[key] || 0) + 1;
                    this.total++;
                }
            }

            // save reference to original geometry in tile so that we can drill down later if we stop now
            tile.source = features;

            // if it's the first-pass tiling
            if (cz == null) {
                // stop tiling if we reached max zoom, or if the tile is too simple
                if (z === options.indexMaxZoom || tile.numPoints <= options.indexMaxPoints) continue;
            // if a drilldown to a specific tile
            } else if (z === options.maxZoom || z === cz) {
                // stop tiling if we reached base zoom or our target tile zoom
                continue;
            } else if (cz != null) {
                // stop tiling if it's not an ancestor of the target tile
                const zoomSteps = cz - z;
                if (x !== cx >> zoomSteps || y !== cy >> zoomSteps) continue;
            }

            // if we slice further down, no need to keep source geometry; a drilled tile keeps it, as it can be forgotten
            if (cz == null) tile.source = null;

            if (!features.length) continue;

            if (debug > 1) console.time('clipping');

            // values we'll use for clipping
            const k1 = 0.5 * options.buffer / options.extent;
            const k2 = 0.5 - k1;
            const k3 = 0.5 + k1;
            const k4 = 1 + k1;

            let tl = null;
            let bl = null;
            let tr = null;
            let br = null;

            const left  = clip(features, z2, x - k1, x + k3, AxisType.X, tile.minX, tile.maxX, options);
            const right = clip(features, z2, x + k2, x + k4, AxisType.X, tile.minX, tile.maxX, options);

            if (left) {
                tl = clip(left, z2, y - k1, y + k3, AxisType.Y, tile.minY, tile.maxY, options);
                bl = clip(left, z2, y + k2, y + k4, AxisType.Y, tile.minY, tile.maxY, options);
            }

            if (right) {
                tr = clip(right, z2, y - k1, y + k3, AxisType.Y, tile.minY, tile.maxY, options);
                br = clip(right, z2, y + k2, y + k4, AxisType.Y, tile.minY, tile.maxY, options);
            }

            if (debug > 1) console.timeEnd('clipping');

            stack.push(tl || [], z + 1, x * 2,     y * 2);
            stack.push(bl || [], z + 1, x * 2,     y * 2 + 1);
            stack.push(tr || [], z + 1, x * 2 + 1, y * 2);
            stack.push(br || [], z + 1, x * 2 + 1, y * 2 + 1);
        }
    }

    /**
     * Invalidates (removes) tiles affected by the provided features
     * @internal
     * @param features 
     */
    private invalidateTiles(features: GeoJSONVTInternalFeature[]) {
        if (!features.length) return;
        const options = this.options;
        const {debug} = options;

        // calculate bounding box of all features for trivial reject
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        for (const feature of features) {
            minX = Math.min(minX, feature.minX);
            maxX = Math.max(maxX, feature.maxX);
            minY = Math.min(minY, feature.minY);
            maxY = Math.max(maxY, feature.maxY);
        }

        // tile buffer clipping value - not halved as in splitTile above because checking against tile's own extent
        const k1 = options.buffer / options.extent;

        // track removed tile ids for o(1) lookup
        const removedLookup = new Set();

        // iterate through existing tiles and remove ones that are affected by features
        for (const id in this.tiles) {
            const tile = this.tiles[id];

            // calculate tile bounds including buffer
            const z2 = 1 << tile.z;
            const tileMinX = (tile.x     - k1) / z2;
            const tileMaxX = (tile.x + 1 + k1) / z2;
            const tileMinY = (tile.y     - k1) / z2;
            const tileMaxY = (tile.y + 1 + k1) / z2;

            // trivial reject if feature bounds don't intersect tile
            if (maxX < tileMinX || minX >= tileMaxX ||
                maxY < tileMinY || minY >= tileMaxY) {
                continue;
            }

            // check if any feature intersects with the tile
            let intersects = false;
            for (const feature of features) {
                if (feature.maxX >= tileMinX && feature.minX < tileMaxX &&
                    feature.maxY >= tileMinY && feature.minY < tileMaxY) {
                    intersects = true;
                    break;
                }
            }
            if (!intersects) continue;

            if (debug) {
                if (debug > 1) {
                    console.log('invalidate tile z%d-%d-%d (features: %d, points: %d, simplified: %d)',
                        tile.z, tile.x, tile.y, tile.numFeatures, tile.numPoints, tile.numSimplified);
                }
                const key = `z${tile.z}`;
                this.stats[key] = (this.stats[key] || 0) - 1;
                this.total--;
            }

            if (this.drilled.delete(id)) this.drilledPoints -= weight(tile);
            delete this.tiles[id];
            removedLookup.add(id);
        }

        // remove tile coords that are no longer in the index
        if (removedLookup.size) {
            this.tileCoords = this.tileCoords.filter(c => !removedLookup.has(c.id));
        }
    }
}

// Empty tiles cost something too, so they are not kept for ever.
function weight(tile: GeoJSONVTInternalTile): number {
    return tile.numPoints + 64;
}

function toID(z: number, x: number, y: number): number {
    return (((1 << z) * y + x) * 32) + z;
}