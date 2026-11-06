import Point from '@mapbox/point-geometry';
import {compareTileId, type OverscaledTileID} from './tile_id.ts';

import type {LayerFeatureStates} from '../source/source_state.ts';
import type {Tile} from './tile.ts';
import type {Style} from '../style/style.ts';

// A tile's state as a number: the second and fifth letters are different in every state.
const stateCode = (state: string): number => state.charCodeAt(1) * 128 + state.charCodeAt(4);

export class InViewTiles {
    private _tiles: Record<string, Tile> = {};
    // Lists are kept until the set changes. Replaced, never edited, so a loop over one can remove tiles.
    private _list: Tile[] = null;
    private _ids: string[] = null;
    private _revision = 0;

    private _changed(): void {
        this._list = null;
        this._ids = null;
        this._revision++;
    }

    /** Changes when a tile comes, goes, changes state or takes new data: what is drawn and retained hangs on these. */
    public signature(): number {
        let hash = this._revision;
        for (const tile of this.getAllTiles()) {
            hash = (Math.imul(hash, 31) + stateCode(tile.state) + tile.dataRevision * 8192 + (tile.holdingForSymbolFade() ? 1 : 0)) | 0;
        }
        return hash;
    }

    public handleWrapJump(wrapDelta: number): void {
        const tiles: Record<string, Tile> = {};
        for (const id in this._tiles) {
            const tile = this._tiles[id];
            tile.tileID = tile.tileID.unwrapTo(tile.tileID.wrap + wrapDelta);
            tiles[tile.tileID.key] = tile;
        }
        this._tiles = tiles;
        this._changed();
    }

    public setFeatureState(featuresChanged: LayerFeatureStates, style: Style, revision: number): void {
        for (const id in this._tiles) {
            const tile = this._tiles[id];
            tile.setFeatureState(featuresChanged, style, revision);
        }
    }

    public getAllTiles(): Tile[] {
        return this._list ??= Object.values(this._tiles);
    }

    public getAllIds(sorted = false): string[] {
        if (sorted) {
            return Object.values(this._tiles).map(tile => tile.tileID).sort(compareTileId).map(id => id.key);
        }
        return this._ids ??= Object.keys(this._tiles);
    }

    public getTileById(key: string): Tile | undefined {
        return this._tiles[key];
    }

    public setTile(key: string, tile: Tile): void {
        this._tiles[key] = tile;
        this._changed();
    }

    public deleteTileById(key: string): void {
        delete this._tiles[key];
        this._changed();
    }

    /**
     * Get a currently loaded tile.
     * - a cached tile is not a loaded tile
     * @returns the tile if it's in view and had data, null otherwise.
     */
    public getLoadedTile(tileID: OverscaledTileID): Tile | null {
        const tile = this.getTileById(tileID.key);
        if (tile?.hasData()) {
            return tile;
        }
        return null;
    }

    public isIdRenderable(id: string, symbolLayer: boolean = false): boolean {
        return this.getTileById(id)?.isRenderable(symbolLayer);
    }

    public getRenderableIds(bearingInRadians: number = 0, symbolLayer?: boolean): string[] {
        const renderables: Tile[] = [];
        for (const id of this.getAllIds()) {
            if (this.isIdRenderable(id, symbolLayer)) {
                renderables.push(this.getTileById(id));
            }
        }
        if (symbolLayer) {
            return renderables.sort((a_: Tile, b_: Tile) => {
                const a = a_.tileID;
                const b = b_.tileID;
                const rotatedA = (new Point(a.canonical.x, a.canonical.y))._rotate(-bearingInRadians);
                const rotatedB = (new Point(b.canonical.x, b.canonical.y))._rotate(-bearingInRadians);
                return a.overscaledZ - b.overscaledZ || rotatedB.y - rotatedA.y || rotatedB.x - rotatedA.x;
            }).map(tile => tile.tileID.key);
        }
        return renderables.map(tile => tile.tileID).sort(compareTileId).map(id => id.key);
    }
}