/*! Open Historia — speech to text for the Advisor's microphone © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One way in for every platform (speechEngines.js picks the recogniser):
//
//   speechEngineFor(language, { skipSystem })
//                                    the engine, or null to hide the microphone
//   speechModelFor(engine)           { name, bytes } for an on-device engine
//   speechModelReady(engine)         whether its model is downloaded already
//   downloadSpeechModel(engine, fn)  downloads it, fn({ loaded, total })
//   startSpeech({ engine, language, onPartial, onFinal, onState, onError })
//                                    → { stop() }; engine defaults to
//                                    speechEngineFor(language)
//
// onPartial(text) shows what has been heard so far; onFinal(text, { send })
// ends the turn, with send true when it ended on three seconds of silence and
// false when the player stopped it or never spoke. onState is "loading" (a
// model is coming off storage), "listening" or "finishing" (the last
// transcription). Errors carry a code: "permission" (the microphone was
// refused), "browser" (the browser's recogniser failed; the next press uses the
// on-device model), "system" (the system's recogniser could not start; the
// error's `fallback` is why, systemFallbackReason, and the press goes on with
// speechEngineFor(language, { skipSystem: true })), "model" (the model would
// not download or load), "failed". No engine here spends an AI request.

import { isNativeBuild, capacitor, nativePlugin } from "./native/bridge.js";
import { ON_DEVICE_MODELS, SPEECH_ENGINES, modelBytes, pickSpeechEngine, speechLocale, systemFallbackReason, systemSpeechPlatform } from "./speechEngines.js";
import { createSilenceWatch } from "./speechSilence.js";
import { microphoneAvailable } from "./speechCapture.js";

const speechError = (code, cause) => Object.assign(new Error(code), { code, cause });

const isElectron = () => typeof navigator !== "undefined" && /\bElectron\//.test(navigator.userAgent || "");

const browserRecognizer = () =>
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition || null : null;

// Set when the browser's recogniser fails in a way that will not mend itself
// this session (no service behind it, the browser refusing it, the language not
// offered); from then on the on-device model is used.
let browserBroken = false;

const nativeRecognizer = () => {
  const bridge = capacitor();
  if (!bridge) return false;
  if (typeof bridge.isPluginAvailable === "function") return Boolean(bridge.isPluginAvailable("SpeechRecognition"));
  return Boolean(bridge.Plugins?.SpeechRecognition);
};

const onDeviceAvailable = () =>
  !isNativeBuild()
  && typeof Worker !== "undefined"
  && typeof WebAssembly !== "undefined"
  && microphoneAvailable();

// Set when the desktop app turns out to have no program for the system's
// recogniser (a Linux build, or one made without a compiler): from then on
// presses go straight to Whisper. Every other failure is tried again on the
// next press, so a player who turns Windows' online speech recognition on, or
// allows it in macOS's settings, gets the system's at once.
let systemAbsent = false;

// skipSystem: the engine a press falls back to when the system's recogniser
// could not listen.
export const speechEngineFor = (language, { skipSystem = false } = {}) => pickSpeechEngine({
  language,
  native: isNativeBuild(),
  nativeRecognizer: isNativeBuild() && nativeRecognizer(),
  browserRecognizer: Boolean(browserRecognizer()),
  electron: isElectron(),
  systemRecognizer: !isNativeBuild() && !systemAbsent && systemSpeechPlatform(typeof navigator !== "undefined" ? navigator.userAgent : ""),
  skipSystem,
  browserBroken,
  onDevice: onDeviceAvailable(),
});

export const speechModelFor = (engine) =>
  ON_DEVICE_MODELS[engine] ? { name: ON_DEVICE_MODELS[engine].name, bytes: modelBytes(engine) } : null;

// The on-device half, loaded on first use. The Android build never calls it
// (the literal below is true there) and swaps the module for an empty one
// (vite.config.ts dropOnDeviceSpeech), so the worker and runtime behind it
// stay out of the APK.
const onDevice = () => {
  if (import.meta.env.VITE_OH_NATIVE) return Promise.reject(speechError("failed"));
  return import("./speechOnDevice.js");
};

export const speechModelReady = async (engine) => {
  if (!ON_DEVICE_MODELS[engine]) return true;
  return (await onDevice()).modelReady(engine);
};

export const downloadSpeechModel = async (engine, onProgress) =>
  (await onDevice()).downloadModel(engine, onProgress);

const joinText = (...parts) => parts.map((part) => String(part || "").trim()).filter(Boolean).join(" ");

// A turn ends one way, once.
const turnEnder = ({ onFinal, cleanup }) => {
  let ended = false;
  return (text, send) => {
    if (ended) return;
    ended = true;
    cleanup();
    const final = String(text || "").trim();
    onFinal?.(final, { send: Boolean(send && final) });
  };
};

// The browser's own recogniser. Its results already mark speech, so the
// silence rule runs on their timing: each result is "heard".
const startBrowser = ({ language, onPartial, onFinal, onState, onError }) => {
  const Recognition = browserRecognizer();
  const recognition = new Recognition();
  recognition.lang = speechLocale(language);
  recognition.continuous = true;
  recognition.interimResults = true;
  let committed = "";
  let current = "";
  let active = true;
  const watch = createSilenceWatch({ onVerdict: (verdict) => end(joinText(committed, current), verdict === "send") });
  const end = turnEnder({
    onFinal,
    cleanup: () => {
      active = false;
      watch.stop();
      try { recognition.abort(); } catch { /* not running */ }
    },
  });
  recognition.onresult = (event) => {
    let text = "";
    for (let i = 0; i < event.results.length; i += 1) text = joinText(text, event.results[i][0]?.transcript);
    current = text;
    watch.heard();
    onPartial?.(joinText(committed, current));
  };
  recognition.onerror = (event) => {
    const code = event?.error;
    if (code === "not-allowed") {
      end(joinText(committed, current), false);
      onError?.(speechError("permission", code));
    } else if (code === "network" || code === "service-not-allowed" || code === "language-not-supported") {
      browserBroken = true;
      end(joinText(committed, current), false);
      onError?.(speechError("browser", code));
    }
    // no-speech and aborted end the session; onend starts the next.
  };
  // Browsers end a continuous session on their own (Chrome after a pause or a
  // minute); the turn is not over until the silence rule says so.
  recognition.onend = () => {
    if (!active) return;
    committed = joinText(committed, current);
    current = "";
    try { recognition.start(); } catch { end(committed, watch.spoke); }
  };
  try {
    recognition.start();
  } catch (error) {
    end("", false);
    onError?.(speechError("failed", error));
    return { stop() {} };
  }
  onState?.("listening");
  return { stop: () => end(joinText(committed, current), false) };
};

// Android's recogniser, through @capacitor-community/speech-recognition. It
// stops by itself a second or two after the player pauses, so a pause shorter
// than the three seconds starts it again and what it heard is kept.
const startAndroid = ({ language, onPartial, onFinal, onState, onError }) => {
  const plugin = nativePlugin("SpeechRecognition");
  let committed = "";
  let current = "";
  let active = true;
  let lastEventAt = Date.now();
  let checking = false;
  let poll = null;
  const watch = createSilenceWatch({ onVerdict: (verdict) => end(joinText(committed, current), verdict === "send") });
  const end = turnEnder({
    onFinal,
    cleanup: () => {
      active = false;
      watch.stop();
      clearInterval(poll);
      Promise.resolve(plugin.stop()).catch(() => {});
      Promise.resolve(plugin.removeAllListeners()).catch(() => {});
    },
  });
  const options = { language: speechLocale(language), maxResults: 1, partialResults: true, popup: false };
  const begin = () => Promise.resolve(plugin.start(options)).catch(() => {});
  (async () => {
    try {
      let permission = await plugin.checkPermissions();
      if (permission?.speechRecognition !== "granted") permission = await plugin.requestPermissions();
      if (permission?.speechRecognition !== "granted") {
        end("", false);
        onError?.(speechError("permission"));
        return;
      }
      if (!active) return;
      await plugin.addListener("partialResults", (data) => {
        const text = Array.isArray(data?.matches) ? data.matches[0] : "";
        if (!text) return;
        current = text;
        lastEventAt = Date.now();
        watch.heard();
        onPartial?.(joinText(committed, current));
      });
      await plugin.addListener("listeningState", () => { lastEventAt = Date.now(); });
      if (!active) return;
      await begin();
      onState?.("listening");
      poll = setInterval(async () => {
        if (!active || checking) return;
        checking = true;
        try {
          const { listening } = await plugin.isListening();
          // Its final result arrives just after it stops; give it a moment.
          if (active && !listening && Date.now() - lastEventAt > 700) {
            committed = joinText(committed, current);
            current = "";
            lastEventAt = Date.now();
            await begin();
          }
        } catch { /* the next tick tries again */ } finally {
          checking = false;
        }
      }, 300);
    } catch (error) {
      end(joinText(committed, current), false);
      onError?.(speechError("failed", error));
    }
  })();
  return { stop: () => end(joinText(committed, current), false) };
};

// The system's own recogniser, in the desktop app: the game's server starts
// its program for the turn and passes on what it writes, one JSON line per
// event (electron/speechSystem.cjs). Letting go of the request stops it. Its
// hypotheses mark speech for the silence rule; a finished phrase only counts
// when no hypothesis came before it, as it arrives a moment after the player
// stopped and would otherwise stretch the three seconds.
const startSystem = ({ language, onPartial, onFinal, onState, onError }) => {
  const controller = new AbortController();
  let committed = "";
  let current = "";
  let ready = false;
  let active = true;
  let watch = null;
  const text = () => joinText(committed, current);
  const end = turnEnder({
    onFinal,
    cleanup: () => {
      active = false;
      watch?.stop();
      controller.abort();
    },
  });
  const fail = (code) => {
    if (!active) return;
    const spoke = Boolean(text());
    if (code === "microphone") {
      end(text(), false);
      onError?.(speechError("permission", code));
      return;
    }
    if (ready && spoke) {
      // It stopped part way: what was heard stays in the box.
      end(text(), false);
      onError?.(speechError("failed", code));
      return;
    }
    const reason = systemFallbackReason(code);
    if (reason === "absent") systemAbsent = true;
    end("", false);
    onError?.(Object.assign(speechError("system", code), { fallback: reason }));
  };
  const handle = (event) => {
    if (!active || !event) return;
    if (event.type === "ready") {
      ready = true;
      watch = createSilenceWatch({ onVerdict: (verdict) => end(text(), verdict === "send") });
      onState?.("listening");
    } else if (event.type === "partial" && ready) {
      current = String(event.text || "");
      watch.heard();
      onPartial?.(text());
    } else if (event.type === "final" && ready) {
      if (!current) watch.heard();
      committed = joinText(committed, event.text);
      current = "";
      onPartial?.(text());
    } else if (event.type === "error") {
      fail(event.code);
    } else if (event.type === "end") {
      // It ended by itself, with no error: what was heard stays, unsent.
      if (ready) end(text(), false);
      else fail("failed");
    }
  };
  (async () => {
    let response;
    try {
      response = await fetch("/api/desktop/speech/listen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: speechLocale(language) }),
        signal: controller.signal,
      });
    } catch {
      fail("failed");
      return;
    }
    // A server from before the system's recogniser has no such route.
    if (!response.ok || !response.body) {
      fail(response.status === 404 ? "unavailable" : "failed");
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try { handle(JSON.parse(line)); } catch { /* not a line of its */ }
        }
      }
    } catch {
      // Aborted by stop(), or the server went away.
    }
    handle({ type: "end" });
  })();
  return { stop: () => end(text(), false) };
};

// The on-device model starts once its module is in; a stop pressed before
// that ends the turn without opening the microphone.
const startOnDeviceTurn = (handlers) => {
  let session = null;
  let stopped = false;
  onDevice()
    .then(({ startOnDevice }) => {
      if (stopped) {
        handlers.onFinal?.("", { send: false });
        return;
      }
      session = startOnDevice(handlers);
    })
    .catch((error) => {
      handlers.onFinal?.("", { send: false });
      handlers.onError?.(error?.code ? error : speechError("failed", error));
    });
  return {
    stop() {
      stopped = true;
      session?.stop();
    },
  };
};

export const startSpeech = ({ engine: chosen, language, onPartial, onFinal, onState, onError } = {}) => {
  const engine = chosen || speechEngineFor(language);
  const handlers = { language, onPartial, onFinal, onState, onError };
  if (engine === SPEECH_ENGINES.ANDROID) return startAndroid(handlers);
  if (engine === SPEECH_ENGINES.BROWSER) return startBrowser(handlers);
  if (engine === SPEECH_ENGINES.SYSTEM) return startSystem(handlers);
  if (engine === SPEECH_ENGINES.WHISPER) return startOnDeviceTurn({ engine, ...handlers });
  onError?.(speechError("failed"));
  return { stop() {} };
};

export { SPEECH_ENGINES };
