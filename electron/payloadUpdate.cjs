/*! Open Historia — an update made of the chunks that changed © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The app's own files (everything inside app.asar) can be replaced without
// running an installer: a newer set is put together in the player's data
// folder, from the files already here and the chunks of the release that are
// not (electron/payloadChunks.cjs), and the next start runs from it
// (electron/payloadBoot.cjs). The installer is still what replaces the
// Electron runtime itself, and what a release that needs a newer runtime falls
// back to.
//
// Nothing here touches the running app's files. The new set is built in a
// folder of its own, every file in it is checked against the manifest's hash,
// and only a complete, checked folder is ever pointed at. A download that
// stops halfway leaves the chunks it got for the next attempt and nothing
// else.
//
// Every dependency is handed in (the file system, fetch, where things are), so
// the whole of it runs under node's test runner against a local server
// (server/payloadUpdate.test.js).

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { chunkAssetName, chunksOfFile, planUpdate, readHead, readManifest, sha256 } = require("./payloadChunks.cjs");
const { CURRENT_FILE, MANIFEST_FILE, compareBuilds, readState, sameShell, writeJsonAtomically } = require("./payloadBoot.cjs");

const CHUNK_ATTEMPTS = 3;
const CHUNKS_AT_ONCE = 4;
const HEAD_BYTES_LIMIT = 64 * 1024;
const MANIFEST_BYTES_LIMIT = 16 * 1024 * 1024;
const QUIET_LIMIT_MS = 45_000;

const abortError = () => {
  const error = new Error("The update was cancelled.");
  error.name = "AbortError";
  return error;
};
const throwIfAborted = (signal) => {
  if (signal?.aborted) throw abortError();
};

// Every file under `root`, as paths relative to it with forward slashes.
const listFiles = (root, fs = nodeFs) => {
  const found = [];
  const walk = (folder, prefix) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(nodePath.join(folder, entry.name), relative);
      else if (entry.isFile()) found.push(relative);
    }
  };
  walk(root, "");
  return found.sort();
};

// What the app already holds, for planUpdate: each file by its hash, and each
// chunk its large files are made of by where it can be read.
const indexLocal = (root, { fs = nodeFs, signal = null, onFile = null } = {}) => {
  const files = new Map();
  const chunks = new Map();
  const names = listFiles(root, fs);
  names.forEach((relative, index) => {
    throwIfAborted(signal);
    const file = nodePath.join(root, relative);
    let data;
    try {
      data = fs.readFileSync(file);
    } catch {
      return; // unreadable: then it is simply not something to reuse
    }
    files.set(sha256(data), file);
    for (const chunk of chunksOfFile(data)) {
      if (!chunks.has(chunk.id)) chunks.set(chunk.id, { file, offset: chunk.offset, size: chunk.size });
    }
    onFile?.(index + 1, names.length);
  });
  return { files, chunks };
};

const readSlice = (fs, file, offset, size) => {
  const data = Buffer.alloc(size);
  const handle = fs.openSync(file, "r");
  try {
    let read = 0;
    while (read < size) {
      const got = fs.readSync(handle, data, read, size - read, offset + read);
      if (got <= 0) break;
      read += got;
    }
    if (read !== size) throw new Error(`${file} is shorter than it was a moment ago`);
  } finally {
    fs.closeSync(handle);
  }
  return data;
};

// One response body, read whole, given up on after QUIET_LIMIT_MS without a
// byte: a connection that stalls must not hold the update for ever.
const readBody = async (response, { limit, signal, quietMs = QUIET_LIMIT_MS, onBytes = null }) => {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const whole = Buffer.from(await response.arrayBuffer());
    if (whole.length > limit) throw new Error("the download is larger than it should be");
    onBytes?.(whole.length);
    return whole;
  }
  const pieces = [];
  let total = 0;
  let timer = null;
  let stalled = false;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      reader.cancel().catch(() => {});
    }, quietMs);
  };
  try {
    arm();
    for (;;) {
      const { done, value } = await reader.read();
      if (stalled) throw new Error("the download stopped arriving");
      throwIfAborted(signal);
      if (done) break;
      total += value.length;
      if (total > limit) {
        reader.cancel().catch(() => {});
        throw new Error("the download is larger than it should be");
      }
      pieces.push(Buffer.from(value));
      onBytes?.(value.length);
      arm();
    }
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(pieces, total);
};

// feed:          the folder a release publishes its manifest and chunks in, as a
//                URL ending in "/"
// manifestName:  this platform's manifest there
// payloadDir:    <the player's data folder>/app-payload
// currentRoot:   where the running app's files are (app.asar, or a folder under
//                payloadDir)
// currentBuild:  the running app's build id
// shell:         { electron, protocol } of the installed runtime (payloadBoot.cjs)
const createPayloadUpdater = ({
  feed,
  manifestName,
  payloadDir,
  currentRoot,
  currentBuild,
  shell,
  fs = nodeFs,
  fetchImpl = globalThis.fetch,
  log = () => {},
  quietMs = QUIET_LIMIT_MS,
  retryDelayMs = 800,
}) => {
  const cacheDir = nodePath.join(payloadDir, "chunks");
  const stagingDir = nodePath.join(payloadDir, "staging");
  const urlOf = (name) => new URL(name, feed).href;

  const get = async (name, { signal, limit, onBytes }) => {
    const controller = new AbortController();
    const relay = () => controller.abort();
    signal?.addEventListener("abort", relay, { once: true });
    // Until the first byte, as well: a server that accepts the connection and
    // says nothing.
    const firstByte = setTimeout(() => controller.abort(), quietMs);
    try {
      const response = await fetchImpl(urlOf(name), { signal: controller.signal, redirect: "follow", cache: "no-store" });
      clearTimeout(firstByte);
      if (!response.ok) {
        const error = new Error(`${name}: the server answered ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await readBody(response, { limit, signal, quietMs, onBytes });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (error?.name === "AbortError") throw new Error(`${name}: the server did not answer`);
      throw error;
    } finally {
      clearTimeout(firstByte);
      signal?.removeEventListener("abort", relay);
    }
  };

  // Whether a newer set of files is published that this app can take in.
  //   -> { state: "none" }                           nothing newer
  //      { state: "available", manifest, build }     newer, and it runs on this runtime
  //      { state: "installer", build, reason }       newer, but it needs the installer
  // A feed that cannot be read, or a manifest that cannot be trusted, throws.
  const check = async ({ signal = null } = {}) => {
    // The head first: a few hundred bytes, which is all a start that finds
    // nothing newer ever fetches.
    let published;
    try {
      published = JSON.parse((await get(manifestName, { signal, limit: HEAD_BYTES_LIMIT })).toString("utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("the update's head is not JSON");
      throw error;
    }
    const build = String(published?.build ?? "");
    if (!build || compareBuilds(build, currentBuild) <= 0) return { state: "none", build };
    // A format this app does not read is a newer release's way of saying so.
    const { head, error: headError } = readHead(published);
    if (!head) {
      if (/format/.test(headError)) return { state: "installer", build, reason: headError };
      throw new Error(headError);
    }
    if (!sameShell(head.shell, shell)) return { state: "installer", build, reason: "it is built for another version of the runtime" };
    if (readState(payloadDir, fs).badBuilds.includes(build)) {
      return { state: "installer", build, reason: "this app could not start from it before" };
    }
    // Then the manifest the head names, which has to be the bytes it names.
    const text = await get(head.manifest.name, { signal, limit: Math.min(head.manifest.size, MANIFEST_BYTES_LIMIT) });
    if (text.length !== head.manifest.size || sha256(text) !== head.manifest.sha256) throw new Error("the update's manifest is not the one its head names");
    const { manifest, error } = readManifest(JSON.parse(text.toString("utf8")));
    if (!manifest) throw new Error(`the update's manifest cannot be used: ${error}`);
    if (String(manifest.build) !== build || !sameShell(manifest.shell, shell)) throw new Error("the update's manifest describes another build than its head");
    return { state: "available", manifest, build };
  };

  const chunkFile = (id) => nodePath.join(cacheDir, id);
  const haveChunk = (id, size) => {
    try {
      const data = fs.readFileSync(chunkFile(id));
      return data.length === size && sha256(data) === id;
    } catch {
      return false;
    }
  };

  const fetchChunk = async (id, size, { signal, onBytes }) => {
    let last = null;
    for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal);
      let counted = 0;
      try {
        const data = await get(chunkAssetName(id), {
          signal,
          limit: size,
          onBytes: (bytes) => {
            counted += bytes;
            onBytes(bytes);
          },
        });
        if (data.length !== size || sha256(data) !== id) throw new Error(`${chunkAssetName(id)} is not the chunk the manifest names`);
        const partial = `${chunkFile(id)}.part`;
        fs.writeFileSync(partial, data);
        fs.renameSync(partial, chunkFile(id));
        return;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        last = error;
        // What this attempt counted is taken back, so the bar does not run past the end.
        if (counted) onBytes(-counted);
        log("warn", `chunk ${chunkAssetName(id)} attempt ${attempt} of ${CHUNK_ATTEMPTS} failed: ${error?.message || error}`);
        // A file that is not there will not be there on a second asking.
        if (error?.status === 404) break;
        if (attempt < CHUNK_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
    throw new Error(`The update could not be downloaded: ${last?.message || "a chunk failed"}`);
  };

  // Put the manifest's files together under payloadDir/<build> and point the
  // next start at them.
  //   onProgress({ phase, percent, fetchBytes, fetchedBytes })
  //   -> { root, build, fetchedBytes, reusedBytes, totalBytes }
  const apply = async (manifest, { signal = null, onProgress = () => {} } = {}) => {
    const build = String(manifest.build);
    const target = nodePath.join(payloadDir, build);
    fs.mkdirSync(cacheDir, { recursive: true });

    onProgress({ phase: "reading", percent: 0 });
    const local = indexLocal(currentRoot, { fs, signal });
    const plan = planUpdate(manifest, local);
    log("info", `update ${build}: ${plan.copy.length} file(s) kept, ${plan.build.length} to put together, ${plan.fetch.length} chunk(s) to fetch (${plan.fetchBytes} of ${plan.totalBytes} bytes)`);

    // The chunks, a few at a time. One already in the cache (an attempt that was
    // cancelled, or failed further on) is not fetched again.
    const wanted = plan.fetch.filter((id) => !haveChunk(id, manifest.chunks[id]));
    const cachedBytes = plan.fetchBytes - wanted.reduce((sum, id) => sum + manifest.chunks[id], 0);
    let fetchedBytes = cachedBytes;
    const report = () => onProgress({
      phase: "downloading",
      percent: plan.fetchBytes ? Math.max(0, Math.min(100, Math.floor((fetchedBytes / plan.fetchBytes) * 100))) : 100,
      fetchBytes: plan.fetchBytes,
      fetchedBytes,
    });
    report();
    let next = 0;
    let failure = null;
    const worker = async () => {
      while (next < wanted.length && !failure) {
        const id = wanted[next];
        next += 1;
        try {
          await fetchChunk(id, manifest.chunks[id], {
            signal,
            onBytes: (bytes) => {
              fetchedBytes += bytes;
              report();
            },
          });
        } catch (error) {
          failure = failure ?? error;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHUNKS_AT_ONCE, wanted.length) }, worker));
    if (failure) throw failure;
    throwIfAborted(signal);

    // The files, into a folder of their own. Each is checked against the
    // manifest before it is written, whether it was copied or put together.
    onProgress({ phase: "building", percent: 0 });
    fs.rmSync(stagingDir, { recursive: true, force: true });
    const put = (relative, data, expected) => {
      if (sha256(data) !== expected) throw new Error(`The update could not be put together: ${relative} is not what the release published.`);
      const file = nodePath.join(stagingDir, ...relative.split("/"));
      fs.mkdirSync(nodePath.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
    };
    const bySha = new Map(manifest.files.map((file) => [file.path, file.sha256]));
    const loaded = new Map();
    const chunkData = (id) => {
      // A pack is read once for all the small files in it; a large file's
      // chunks are each used once, so nothing is held for long.
      if (!loaded.has(id)) loaded.set(id, fs.readFileSync(chunkFile(id)));
      return loaded.get(id);
    };
    let done = 0;
    const total = plan.copy.length + plan.build.length;
    const step = () => {
      done += 1;
      if (done % 50 === 0 || done === total) onProgress({ phase: "building", percent: Math.floor((done / total) * 100) });
    };
    try {
      // A file kept from a set an earlier update made is linked, not copied: it
      // was read and hashed a moment ago, nothing ever writes to it, and the two
      // sets then share the one copy on disk. A file out of app.asar cannot be
      // linked, and is copied and checked like one that was put together.
      const linkable = (from) => from.startsWith(payloadDir + nodePath.sep);
      for (const file of plan.copy) {
        throwIfAborted(signal);
        const target = nodePath.join(stagingDir, ...file.path.split("/"));
        let linked = false;
        if (linkable(file.from)) {
          try {
            fs.mkdirSync(nodePath.dirname(target), { recursive: true });
            fs.linkSync(file.from, target);
            linked = true;
          } catch {
            linked = false; // another volume, or a file system without links
          }
        }
        if (!linked) put(file.path, fs.readFileSync(file.from), bySha.get(file.path));
        step();
      }
      for (const file of plan.build) {
        throwIfAborted(signal);
        const parts = file.parts.map((part) => (part.local
          ? readSlice(fs, part.local.file, part.local.offset, part.local.size)
          : chunkData(part.chunk).subarray(part.at, part.at + part.size)));
        put(file.path, Buffer.concat(parts, file.size), file.sha256);
        if (file.parts.length > 1) for (const part of file.parts) loaded.delete(part.chunk);
        step();
      }
      fs.writeFileSync(nodePath.join(stagingDir, MANIFEST_FILE), JSON.stringify(manifest));
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(stagingDir, target);
    } catch (error) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      throw error;
    }
    // Only now is anything pointed at it. Before this line a crash, a full
    // disk or a Cancel leaves the app exactly as it was.
    writeJsonAtomically(nodePath.join(payloadDir, CURRENT_FILE), { build, shell: manifest.shell, attempts: 0 }, fs);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    log("info", `update ${build}: ready in ${target}`);
    return { root: target, build, fetchedBytes: plan.fetchBytes - cachedBytes, reusedBytes: plan.reusedBytes, totalBytes: plan.totalBytes };
  };

  return { check, apply };
};

module.exports = { CHUNKS_AT_ONCE, CHUNK_ATTEMPTS, createPayloadUpdater, indexLocal, listFiles };
