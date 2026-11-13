import path from "node:path";
import { fileURLToPath } from "node:url";
import { whisperRunnerFor } from "../onDevice.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sidecarDir = path.resolve(here, "..");

const joinText = (...parts) => parts.map((part) => String(part || "").trim()).filter(Boolean).join(" ");

const pcmFrom = (base64) => {
  const bytes = Buffer.from(String(base64 || ""), "base64");
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length >> 1);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] / 32768;
  return out;
};

export const register = (ctx) => {
  const { engine, emit, clean, cacheDir, standIn } = ctx;
  const engines = engine.speechEngines;
  const silence = engine.speechSilence;
  const piecesKit = engine.speechPieces;
  const WHISPER = engines.SPEECH_ENGINES.WHISPER;
  const SYSTEM = engines.SPEECH_ENGINES.SYSTEM;
  const whisper = whisperRunnerFor({ cacheDir, engines, standIn });
  const androidSpeech = process.platform === "android" && process.env.OH_ANDROID_SPEECH === "1";
  const relays = new Map();
  let nextRelay = 0;
  const relayedSpeech = {
    listen: ({ language, onEvent }) => {
      nextRelay += 1;
      const relay = nextRelay;
      relays.set(relay, onEvent);
      emit("speech.system", { relay, action: "start", language });
      return {
        stop: () => {
          if (relays.delete(relay)) emit("speech.system", { relay, action: "stop" });
        },
      };
    },
  };
  const system = androidSpeech ? relayedSpeech : engine.speechSystem.createSystemSpeech({
    dir: process.env.OH_SPEECH_HELPER_DIR || sidecarDir,
    log: (level, event, message) => process.stderr.write(`[speech] ${level} ${event} ${message}\n`),
  });
  const systemPlatform = process.platform === "win32" || process.platform === "darwin" || androidSpeech;
  let systemAbsent = process.env.OH_SYSTEM_SPEECH === "0";

  const engineFor = (language, { skipSystem = false, microphone = true } = {}) => engines.pickSpeechEngine({
    language,
    electron: true,
    systemRecognizer: systemPlatform && !systemAbsent,
    skipSystem,
    onDevice: microphone,
  });

  const modelInfo = (chosen) => {
    const model = engines.ON_DEVICE_MODELS[chosen];
    return model ? { name: model.name, bytes: engines.modelBytes(chosen), size: engines.formatModelSize(engines.modelBytes(chosen)) } : null;
  };

  const sessions = new Map();
  const cancelled = new Set();
  let nextSession = 0;

  const speechError = (code, extra = {}) => ({ type: "error", code, ...extra });

  const startOnDevice = (id, language) => {
    const send = (event) => emit("speech.event", { session: id, ...event });
    const vad = silence.createEnergyVad();
    const whisperCode = engines.whisperLanguage(language);
    let active = true;
    let finishing = false;

    const reader = piecesKit.createPieceReader({
      read: (audio) => whisper.transcribe(audio, whisperCode).catch(() => ""),
      onText: (text) => {
        if (active) send({ type: "partial", text });
      },
    });
    const cutter = piecesKit.createPieceCutter({ onPiece: (audio) => reader.add(audio) });
    const watch = silence.createSilenceWatch({ onVerdict: (verdict) => finish(verdict === "send") });

    const closeMic = () => {
      active = false;
      watch.stop();
      send({ type: "microphone", open: false });
    };

    const done = () => sessions.delete(id);

    const finish = async (sendIt) => {
      if (finishing) return;
      finishing = true;
      const spoke = watch.spoke;
      closeMic();
      if (!spoke) {
        done();
        send({ type: "final", text: "", send: false });
        return;
      }
      send({ type: "state", state: "finishing" });
      cutter.flush();
      const final = await reader.done();
      done();
      send({ type: "final", text: final, send: Boolean(sendIt && final) });
    };

    const fail = (code) => {
      if (finishing) return;
      finishing = true;
      closeMic();
      done();
      send({ type: "final", text: reader.text, send: false });
      send(speechError(code));
    };

    const hear = (block) => {
      if (!active) return;
      const speech = vad(silence.rmsLevel(block));
      if (speech) watch.heard();
      cutter.hear(block, speech);
    };

    const ready = whisper.loaded();
    send({ type: "state", state: ready ? "listening" : "loading" });
    send({ type: "microphone", open: true });
    if (!ready) {
      whisper.load().then(() => {
        if (active && !finishing) send({ type: "state", state: "listening" });
      }, () => fail("model"));
    }

    return {
      engine: WHISPER,
      hear,
      stop: () => finish(false),
      fail,
    };
  };

  const startSystem = (id, language) => {
    const send = (event) => emit("speech.event", { session: id, ...event });
    let committed = "";
    let current = "";
    let ready = false;
    let active = true;
    let watch = null;
    let listening = null;
    let ended = false;
    const text = () => joinText(committed, current);
    const end = (final, sendIt) => {
      if (ended) return;
      ended = true;
      active = false;
      watch?.stop();
      listening?.stop();
      sessions.delete(id);
      const value = String(final || "").trim();
      send({ type: "final", text: value, send: Boolean(sendIt && value) });
    };
    const fail = (code) => {
      if (!active) return;
      const spoke = Boolean(text());
      if (code === "microphone") {
        end(text(), false);
        send(speechError("permission"));
        return;
      }
      if (ready && spoke) {
        end(text(), false);
        send(speechError("failed"));
        return;
      }
      const reason = engines.systemFallbackReason(code);
      if (reason === "absent") systemAbsent = true;
      end("", false);
      send(speechError("system", { fallback: reason }));
    };
    const handle = (event) => {
      if (!active || !event) return;
      if (event.type === "ready") {
        ready = true;
        watch = silence.createSilenceWatch({ onVerdict: (verdict) => end(text(), verdict === "send") });
        send({ type: "state", state: "listening" });
      } else if (event.type === "partial" && ready) {
        current = String(event.text || "");
        watch.heard();
        send({ type: "partial", text: text() });
      } else if (event.type === "final" && ready) {
        if (!current) watch.heard();
        committed = joinText(committed, event.text);
        current = "";
        send({ type: "partial", text: text() });
      } else if (event.type === "error") {
        fail(event.code);
      } else if (event.type === "end") {
        if (ready) end(text(), false);
        else fail("failed");
      }
    };
    queueMicrotask(() => {
      if (!active) return;
      listening = system.listen({ language: engines.speechLocale(language), onEvent: handle });
    });
    return {
      engine: SYSTEM,
      hear: () => {},
      stop: () => end(text(), false),
      fail: (code) => fail(code),
    };
  };

  const downloading = { work: null };

  return {
    "speech.engine": async ({ language = "", microphone = true } = {}) => {
      language = clean(language) || clean(engine.shellI18n.resolveChatLanguage()) || "en";
      const chosen = engineFor(language, { microphone });
      const onDevice = chosen === SYSTEM ? engineFor(language, { skipSystem: true, microphone }) : chosen;
      return {
        language,
        engine: chosen ?? "",
        onDevice: onDevice ?? "",
        model: onDevice ? modelInfo(onDevice) : null,
      };
    },
    "speech.ready": async ({ engine: chosen = WHISPER } = {}) => ({ ready: chosen !== WHISPER || whisper.cached() }),
    "speech.download": async () => {
      if (!downloading.work) {
        downloading.work = (async () => {
          await whisper.download(({ loaded, total }) => emit("speech.progress", { loaded, total, percent: total ? Math.floor((loaded / total) * 100) : 0 }));
          await whisper.load();
          return { ok: true };
        })().catch((error) => ({ ok: false, code: "model", error: clean(error?.message) }));
        void downloading.work.finally(() => {
          downloading.work = null;
        });
      }
      return downloading.work;
    },
    "speech.start": async ({ engine: chosen = "", language = "en" } = {}) => {
      nextSession += 1;
      const id = nextSession;
      for (const session of sessions.values()) session.stop();
      setImmediate(() => {
        if (cancelled.delete(id)) {
          emit("speech.event", { session: id, type: "final", text: "", send: false });
          return;
        }
        if (chosen === SYSTEM) sessions.set(id, startSystem(id, language));
        else if (chosen === WHISPER) sessions.set(id, startOnDevice(id, language));
        else emit("speech.event", { session: id, ...speechError("failed") });
      });
      return { session: id, engine: chosen };
    },
    "speech.audio": async ({ session = 0, pcm = "" } = {}) => {
      const target = sessions.get(Number(session));
      if (!target) return { open: false };
      const block = pcmFrom(pcm);
      if (block.length) target.hear(block);
      return { open: true };
    },
    "speech.stop": async ({ session = 0 } = {}) => {
      const target = sessions.get(Number(session));
      if (target) target.stop();
      else if (Number(session) === nextSession) cancelled.add(nextSession);
      return true;
    },
    "speech.fail": async ({ session = 0, code = "failed" } = {}) => {
      sessions.get(Number(session))?.fail(clean(code) || "failed");
      return true;
    },
    "speech.systemEvent": async ({ relay = 0, event = null } = {}) => {
      const listener = relays.get(Number(relay));
      if (!listener || !event || typeof event !== "object") return false;
      if (event.type === "error" || event.type === "end") relays.delete(Number(relay));
      listener({ type: clean(event.type), text: String(event.text ?? ""), code: clean(event.code) });
      return true;
    },
    "speech.forget": async () => {
      await whisper.forget();
      return { ready: false };
    },
  };
};
