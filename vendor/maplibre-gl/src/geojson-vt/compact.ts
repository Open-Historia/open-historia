import type {GeoJSONVTInternalTile} from './definitions';

let scratch = new Int32Array(1 << 16);

/**
 * A tile's feature in tile coordinates, as one typed array: 4 bytes a point where a point of its own array took 32 to
 * 64, and a tile lives as long as its source. Rounded exactly as `transformTile` rounds. `geometry` makes the plain
 * rings each time it is read: the wrapper that encodes a tile is its only reader.
 */
export class CompactFeature {
    id?: number | string;
    type: 1 | 2 | 3;
    tags: GeoJSON.GeoJsonProperties | null;
    coords: Int16Array | Int32Array;
    ends: Uint32Array;

    constructor(type: 1 | 2 | 3, tags: GeoJSON.GeoJsonProperties | null, rings: number[][], z2: number, tx: number, ty: number, extent: number) {
        this.type = type;
        this.tags = tags;
        let length = 0;
        for (const ring of rings) length += ring.length;
        if (scratch.length < length) scratch = new Int32Array(length * 2);
        const ends = new Uint32Array(rings.length);
        let at = 0;
        let fits = true;
        for (let r = 0; r < rings.length; r++) {
            const ring = rings[r];
            for (let i = 0; i < ring.length; i += 2) {
                const x = Math.round(extent * (ring[i] * z2 - tx));
                const y = Math.round(extent * (ring[i + 1] * z2 - ty));
                scratch[at++] = x;
                scratch[at++] = y;
                if (x > 32767 || x < -32768 || y > 32767 || y < -32768) fits = false;
            }
            ends[r] = at;
        }
        this.coords = fits ? new Int16Array(scratch.subarray(0, at)) : scratch.slice(0, at);
        this.ends = ends;
    }

    get geometry(): [number, number][] | [number, number][][] {
        const {coords, ends} = this;
        const rings: [number, number][][] = [];
        let at = 0;
        for (const end of ends) {
            const ring: [number, number][] = [];
            for (; at < end; at += 2) ring.push([coords[at], coords[at + 1]]);
            rings.push(ring);
        }
        return this.type === 1 ? rings[0] : rings;
    }
}

/** Puts a new tile's features in tile coordinates, so `transformTile` has nothing left to do. */
export function compactTile<T extends GeoJSONVTInternalTile>(tile: T, extent: number): T {
    const z2 = 1 << tile.z;
    tile.features = tile.features.map((feature) => {
        const rings = feature.type === 1 ? [feature.geometry as number[]] : feature.geometry as number[][];
        const compact = new CompactFeature(feature.type, feature.tags, rings, z2, tile.x, tile.y, extent);
        if ('id' in feature) compact.id = feature.id;
        return compact;
    }) as unknown as T['features'];
    tile.transformed = true;
    return tile;
}
