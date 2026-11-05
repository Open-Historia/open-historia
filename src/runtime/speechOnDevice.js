/*! Open Historia — the Advisor's microphone on an on-device model © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Parakeet or Whisper in a worker (speechWorker.js), fed by the microphone
// (speechCapture.js). Reached only through speechInput.js's dynamic import,
// which the Android build strips: the phone uses its own recogniser, and the
// worker, its two runtimes and their WebAssembly stay out of the APK.

import { ON_DEVICE_MODELS, SPEECH_ENGINES, whisperLanguage } from "./speechEngines.js";
import { createEnergyVad, createSilenceWatch, rmsLevel } from "./speechSilence.js";
import { openMicrophone } from "./speechCapture.js";

const speechError = (code, cause) => Object.assign(new Error(code), { code, cause });

// One worker per engine, kept while it is used and closed a few minutes after:
// a loaded Parakeet holds well over a gigabyte, which a player who spoke once
// an hour ago should not be paying for. The download stays; only the copy in
// memory goes.
const IDLE_CLOSE_MS = 3 * 60 * 1000;
const workers = new Map();
const readyEngines = new Set();

const workerFor = (engine) => {
  let entry = workers.get(engine);
  if (!entry) {
    // Written out in full, as Vite only bundles a worker from this exact form.
    const worker = new Worker(new URL("./speechWorker.js", import.meta.url), { type: "module", name: `openhistoria-speech-${engine}` });
    const created = { worker, listeners: new Set(), idle: null };
    worker.onmessage = (event) => {
      for (const listener of [...created.listeners]) listener(event.data || {});
    };
    worker.onerror = (event) => {
      for (const listener of [...created.listeners]) listener({ type: "error", message: String(event?.message || "The speech worker stopped.") });
    };
    workers.set(engine, created);
    entry = created;
  }
  clearTimeout(entry.idle);
  entry.idle = null;
  return entry;
};

const listen = (engine, listener) => {
  const entry = workerFor(engine);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size) return;
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => {
      if (entry.listeners.size || workers.get(engine) !== entry) return;
      entry.worker.terminate();
      workers.delete(engine);
      readyEngines.delete(engine);
    }, IDLE_CLOSE_MS);
  };
};

const send = (engine, message, transfer) => workers.get(engine)?.worker.postMessage({ ...message, engine }, transfer || []);

const downloadedEngines = new Set();

export const modelReady = (engine) => {
  if (!ON_DEVICE_MODELS[engine]) return Promise.resolve(true);
  if (downloadedEngines.has(engine)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const off = listen(engine, (message) => {
      if (message.type !== "status") return;
      off();
      if (message.cached) downloadedEngines.add(engine);
      resolve(Boolean(message.cached));
    });
    send(engine, { type: "status" });
  });
};

export const downloadModel = (engine, onProgress) => new Promise((resolve, reject) => {
  const off = listen(engine, (message) => {
    if (message.type === "progress") onProgress?.({ loaded: message.loaded, total: message.total });
    else if (message.type === "ready") {
      off();
      readyEngines.add(engine);
      downloadedEngines.add(engine);
      resolve();
    } else if (message.type === "error") {
      off();
      reject(speechError("model", message.message));
    }
  });
  send(engine, { type: "load" });
});

// The model reads every second it is handed, and on one thread (the game is not
// cross-origin isolated, so no more) a 10-second turn read whole takes several
// seconds; read again and again for the input box, it held the send up behind
// the last of those readings. So a turn is read in pieces: each stretch of
// speech is cut at the next pause in it and read once, and the text grows by a
// piece at a time. When the silence ends the turn only the last piece is left
// to read, a second or two at most.
//
// Blocks are a tenth of a second (speechCapture.js).
const PAUSE_BLOCKS = 7; // a pause this long ends a piece
const LEAD_IN_BLOCKS = 10; // kept before the first word of a piece
const TAIL_BLOCKS = 4; // kept after its last word
// The piece being spoken is also read now and then while the model is free, so
// a long sentence shows before it ends. Parakeet only: Whisper reads every call
// as a 30-second window, five or six seconds on one thread however short the
// piece, so a reading in progress would only hold the send up; its pieces show
// as they are read.
const PARTIAL_EVERY_MS = 1500;
const PARTIAL_ENGINES = new Set([SPEECH_ENGINES.PARAKEET]);
const PARTIAL_LONGEST_BLOCKS = 80;

export const startOnDevice = ({ engine, language, onPartial, onFinal, onState, onError }) => {
  const vad = createEnergyVad();
  const pending = new Map();
  const whisperCode = whisperLanguage(language);
  const pieces = []; // a promise of each finished piece's text, in order
  const done = []; // the texts that have arrived, by piece
  let blocks = []; // the piece being spoken (with its lead-in)
  let spokeInPiece = false;
  let lastSpeechBlock = -1;
  let mic = null;
  let active = true;
  let finishing = false;
  let busy = 0;
  let lastPartialAt = 0;
  let partialText = "";
  let nextId = 0;

  const shown = () => [...done.filter(Boolean), partialText].map((text) => String(text || "").trim()).filter(Boolean).join(" ");

  const answerAll = () => {
    for (const resolve of pending.values()) resolve({ text: "" });
    pending.clear();
  };

  const off = listen(engine, (message) => {
    if (message.type === "text") {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message);
    } else if (message.type === "ready") {
      readyEngines.add(engine);
      downloadedEngines.add(engine);
      if (active && !finishing) onState?.("listening");
    } else if (message.type === "error") {
      answerAll();
      fail(speechError("model", message.message));
    }
  });

  const join = (list) => {
    let length = 0;
    for (const block of list) length += block.length;
    const audio = new Float32Array(length);
    let offset = 0;
    for (const block of list) {
      audio.set(block, offset);
      offset += block.length;
    }
    return audio;
  };

  const transcribe = (list) => new Promise((resolve) => {
    const audio = join(list);
    nextId += 1;
    busy += 1;
    pending.set(nextId, (message) => {
      busy -= 1;
      resolve(String(message?.text || "").trim());
    });
    send(engine, { type: "transcribe", id: nextId, audio, language: whisperCode }, [audio.buffer]);
  });

  // The piece being spoken, up to just after its last word, goes to be read;
  // a new piece starts from what came after.
  const cutPiece = () => {
    if (!spokeInPiece) return;
    const at = pieces.length;
    const audio = blocks.slice(0, lastSpeechBlock + 1 + TAIL_BLOCKS);
    blocks = blocks.slice(lastSpeechBlock + 1);
    spokeInPiece = false;
    lastSpeechBlock = -1;
    pieces.push(transcribe(audio).then((text) => {
      done[at] = text;
      partialText = "";
      if (active) onPartial?.(shown());
      return text;
    }));
  };

  const watch = createSilenceWatch({ onVerdict: (verdict) => finish(verdict === "send") });

  const closeMic = () => {
    active = false;
    watch.stop();
    mic?.close();
    mic = null;
  };

  const finish = async (sendIt) => {
    if (finishing) return;
    finishing = true;
    const spoke = watch.spoke;
    closeMic();
    if (!spoke) {
      off();
      onFinal?.("", { send: false });
      return;
    }
    onState?.("finishing");
    cutPiece();
    const texts = await Promise.all(pieces);
    off();
    const final = texts.filter(Boolean).join(" ").trim();
    onFinal?.(final, { send: Boolean(sendIt && final) });
  };

  const fail = (error) => {
    if (finishing) return;
    finishing = true;
    closeMic();
    off();
    onFinal?.(shown(), { send: false });
    onError?.(error);
  };

  const onBlock = (block) => {
    if (!active) return;
    const speech = vad(rmsLevel(block));
    blocks.push(block);
    if (speech) {
      watch.heard();
      spokeInPiece = true;
      lastSpeechBlock = blocks.length - 1;
    } else if (!spokeInPiece && blocks.length > LEAD_IN_BLOCKS) {
      blocks.shift();
    }
    if (spokeInPiece && blocks.length - 1 - lastSpeechBlock >= PAUSE_BLOCKS) {
      cutPiece();
      return;
    }
    // A reading of the piece so far, only while the model has nothing else to
    // do and the piece is still short enough to read quickly.
    const now = Date.now();
    if (!PARTIAL_ENGINES.has(engine) || !speech || busy || !readyEngines.has(engine) || blocks.length > PARTIAL_LONGEST_BLOCKS) return;
    if (now - lastPartialAt < PARTIAL_EVERY_MS) return;
    lastPartialAt = now;
    const at = pieces.length;
    transcribe(blocks.slice()).then((text) => {
      if (!active || !text || pieces.length !== at) return;
      partialText = text;
      onPartial?.(shown());
    });
  };

  // Loading from storage takes a few seconds; the microphone opens meanwhile,
  // so what the player says while it loads is heard and read once it is up.
  onState?.(readyEngines.has(engine) ? "listening" : "loading");
  if (!readyEngines.has(engine)) send(engine, { type: "load" });
  openMicrophone({ onBlock })
    .then((opened) => {
      if (active) mic = opened;
      else opened.close();
    })
    .catch((error) => {
      const refused = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      fail(speechError(refused ? "permission" : "failed", error));
    });

  return { stop: () => finish(false) };
};
