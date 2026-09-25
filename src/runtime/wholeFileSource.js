/*! Open Historia — map archives read whole on Android © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A pmtiles Source that never sends a Range request: it loads the archive once,
// whole, and answers every read by slicing that one buffer.
//
// Why: the Android app's archives ride inside the APK and are served by
// Capacitor's local server, which answers `Range: bytes=a-b` with a 206, the
// right Content-Range and Content-Length — and a body that runs from byte a to
// the END of the file. Measured on Android 15 (WebView 124): a 16 KB read at
// byte 5,000,000 of the 21 MB regions archive returned 16,106,005 bytes, and a
// read at byte 0 returned the whole file. pmtiles hands such a body to the
// decompressor as one tile, gzip stops at the junk after it, and the read fails
// as "TypeError: Failed to fetch". Every read made before the full archive had
// warmed failed that way: the country labels, the country index, the stock
// outlines on the timeline and every city tile, with up to 21 MB allocated per
// read.
//
// Loading the file whole is what the warm (warmPmtilesArchive) does anyway —
// from the APK in well under a second — so the reads wait for it and share its
// buffer: one copy in memory, no ranges on the wire.
//
// Pure and import-free so `node --test` can hold it to exact bytes.

export class WholeFileSource {
  // load(url) resolves to the archive's bytes (an ArrayBuffer or a Uint8Array).
  // Called on every read, so it must hand back the one buffer rather than
  // fetch again; warmPmtilesArchive dedupes in-flight loads and keeps the
  // result.
  constructor(url, load) {
    this.url = url;
    this.load = load;
  }

  getKey() {
    return this.url;
  }

  async getBytes(offset, length) {
    const buffer = await this.load(this.url);
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const start = Math.min(bytes.byteLength, Math.max(0, Number(offset) || 0));
    const end = Math.min(bytes.byteLength, start + Math.max(0, Number(length) || 0));
    return { data: bytes.slice(start, end).buffer };
  }
}
