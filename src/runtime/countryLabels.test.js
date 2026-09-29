import test from "node:test";
import assert from "node:assert/strict";
import Pbf from "pbf";

import { PMTILES_ARCHIVES, primePmtilesArchive } from "./assets.js";
import { loadCountryLabelCollections, warmCountryLabelCollections } from "./countryLabels.js";

// --- A one-tile countries.pmtiles, built in memory --------------------------

// A z0 vector tile whose "countries" layer holds one square per country.
const countriesTile = (countries, layerName = "countries") => {
  const pbf = new Pbf();
  pbf.writeMessage(3, (_layer, out) => {
    out.writeVarintField(15, 2);
    out.writeStringField(1, layerName);
    const keys = ["GID_0", "Country"];
    const values = countries.flatMap(({ code, name }) => [code, name]);
    countries.forEach(({ square: [x0, y0, x1, y1] }, index) => {
      out.writeMessage(2, (_feature, message) => {
        message.writeVarintField(1, index + 1);
        message.writePackedVarint(2, [0, index * 2, 1, index * 2 + 1]);
        message.writeVarintField(3, 3);
        const zigzag = (value) => (value << 1) ^ (value >> 31);
        message.writePackedVarint(4, [
          9, zigzag(x0), zigzag(y0),
          (3 << 3) | 2, zigzag(x1 - x0), 0, 0, zigzag(y1 - y0), zigzag(x0 - x1), 0,
          15,
        ]);
      });
    });
    for (const key of keys) out.writeStringField(3, key);
    for (const value of values) out.writeMessage(4, (text, message) => message.writeStringField(1, text), value);
    out.writeVarintField(5, 4096);
  });
  return pbf.finish();
};

const varints = (numbers) => {
  const bytes = [];
  for (let value of numbers) {
    while (value >= 0x80) {
      bytes.push((value & 0x7f) | 0x80);
      value = Math.floor(value / 128);
    }
    bytes.push(value);
  }
  return bytes;
};

// PMTiles v3: header, a root directory with the single z0 tile, empty metadata.
const pmtilesArchive = (tile) => {
  const directory = Uint8Array.from(varints([1, 0, 1, tile.byteLength, 1]));
  const metadata = new TextEncoder().encode("{}");
  const headerLength = 127;
  const directoryOffset = headerLength;
  const metadataOffset = directoryOffset + directory.byteLength;
  const tileOffset = metadataOffset + metadata.byteLength;
  const bytes = new Uint8Array(tileOffset + tile.byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PMTiles"), 0);
  bytes[7] = 3;
  const u64 = (offset, value) => view.setBigUint64(offset, BigInt(value), true);
  u64(8, directoryOffset);
  u64(16, directory.byteLength);
  u64(24, metadataOffset);
  u64(32, metadata.byteLength);
  u64(40, tileOffset);
  u64(48, 0);
  u64(56, tileOffset);
  u64(64, tile.byteLength);
  u64(72, 1);
  u64(80, 1);
  u64(88, 1);
  bytes[96] = 1; // clustered
  bytes[97] = 1; // internal compression: none
  bytes[98] = 1; // tile compression: none
  bytes[99] = 1; // tile type: mvt
  bytes[100] = 0;
  bytes[101] = 0;
  view.setInt32(102, -1800000000, true);
  view.setInt32(106, -850000000, true);
  view.setInt32(110, 1800000000, true);
  view.setInt32(114, 850000000, true);
  bytes.set(directory, directoryOffset);
  bytes.set(metadata, metadataOffset);
  bytes.set(tile, tileOffset);
  return bytes.buffer;
};

const ATLANTIS = { code: "AAA", name: "Atlantis", square: [600, 1200, 1400, 2000] };
const BORDURIA = { code: "BBB", name: "Borduria", square: [2400, 1200, 3200, 2000] };

let archiveSerial = 0;
const useArchive = (tile) => {
  archiveSerial += 1;
  const url = `memory://countries-${archiveSerial}.pmtiles`;
  primePmtilesArchive(url, pmtilesArchive(tile));
  PMTILES_ARCHIVES.countries = url;
  return url;
};

// --- The runtime cache, as the browser's Cache API ---------------------------

const runtimeCache = () => {
  const stored = new Map();
  const cache = {
    served: null,
    puts: [],
    async match(url) {
      if (cache.served != null && url.includes("country-labels")) return new Response(cache.served);
      return stored.has(url) ? new Response(stored.get(url)) : undefined;
    },
    async put(url, response) {
      cache.puts.push(url);
      stored.set(url, await response.text());
    },
  };
  return cache;
};

const labelNames = (collections) => collections.pointLabelData.features
  .map((feature) => feature.properties.name)
  .sort();

let cache = null;
test.beforeEach(() => {
  cache = runtimeCache();
  globalThis.caches = { open: async () => cache };
});
test.after(() => {
  delete globalThis.caches;
});

// First: while nothing has been memoised the warm reports the bare cache name.
test("an empty build is served but neither memoised nor persisted", async (t) => {
  t.mock.method(console, "warn", () => {});
  useArchive(countriesTile([ATLANTIS], "not-countries"));

  const first = await loadCountryLabelCollections();
  assert.equal(first.pointLabelData.features.length, 0);
  assert.deepEqual(cache.puts, []);
  const warmed = await warmCountryLabelCollections();
  assert.equal(warmed.url, "country-labels-v3", "nothing was memoised under a key");
  assert.deepEqual(cache.puts, [], "and the second attempt rebuilt without persisting either");
});

test("stock country labels are built from the z0 tile and persisted", async () => {
  const url = useArchive(countriesTile([ATLANTIS, BORDURIA]));

  const built = await loadCountryLabelCollections();
  assert.deepEqual(labelNames(built), ["ATLANTIS", "BORDURIA"]);
  assert.equal(cache.puts.length, 1);
  assert.ok(cache.puts[0].includes(encodeURIComponent(encodeURIComponent(url))), "the key names the archive");
  assert.equal(await loadCountryLabelCollections(), built, "a second call is served from memory");
  assert.equal(cache.puts.length, 1);
});

test("each owner set caches under its own key", async () => {
  useArchive(countriesTile([ATLANTIS, BORDURIA]));

  const all = await warmCountryLabelCollections();
  const atlantisOnly = await warmCountryLabelCollections({ ownedCodes: new Set(["AAA"]) });
  const bordurianOnly = await warmCountryLabelCollections({ ownedCodes: new Set(["BBB"]) });
  assert.equal(new Set([all.url, atlantisOnly.url, bordurianOnly.url]).size, 3);
  assert.deepEqual(labelNames(await loadCountryLabelCollections({ ownedCodes: new Set(["BBB"]) })), ["BORDURIA"]);
  assert.equal(cache.puts.length, 3);
});

test("a cached payload that is not a label collection is rebuilt", async () => {
  useArchive(countriesTile([ATLANTIS]));
  cache.served = JSON.stringify({ pointLabelData: { type: "FeatureCollection" } });

  const rebuilt = await loadCountryLabelCollections();
  assert.deepEqual(labelNames(rebuilt), ["ATLANTIS"]);
  assert.equal(cache.puts.length, 1, "the rebuilt labels replace the bad entry");
});
