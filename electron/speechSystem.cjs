/*! Open Historia — the system's own speech recognition, for the Advisor's microphone © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In the desktop app the Advisor's microphone first asks the operating system
// to listen: Windows.Media.SpeechRecognition on Windows, SFSpeechRecognizer on
// macOS. Each is reached through a small program built with the app
// (scripts/build-speech-helpers.mjs; sources in electron/speech/), started for
// one turn and stopped at its end, writing one JSON line per event (see the
// header of electron/speech/windows.cs). No native Node module is involved.
//
// The page reaches this through the game's own server (POST
// /api/desktop/speech/listen in server/server.js, globalThis.__ohSystemSpeech),
// as the display mode does. Where there is no program (Linux, a build made
// without a compiler, a file the antivirus took), or it says it cannot listen,
// the page uses Whisper on the device instead (src/runtime/speechInput.js).

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const childProcess = require("node:child_process");

const HELPERS = Object.freeze({
  win32: "oh-speech-windows.exe",
  darwin: "oh-speech-macos",
});

// The program sits in app.asar.unpacked when the app runs from its archive:
// nothing can be started from inside an archive.
const unpacked = (file) => file.replace(`app.asar${nodePath.sep}`, `app.asar.unpacked${nodePath.sep}`);

const helperPath = ({ platform = process.platform, dir = __dirname, fs = nodeFs } = {}) => {
  const name = HELPERS[platform];
  if (!name) return null;
  const file = unpacked(nodePath.join(dir, "speech", name));
  try {
    if (!fs.statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  // An update made of chunks (payloadUpdate.cjs) writes files without their
  // modes; the macOS program has to be executable.
  if (platform !== "win32") {
    try { fs.chmodSync(file, 0o755); } catch { /* read-only install: it kept its mode */ }
  }
  return file;
};

// A language tag the programs take: "en-US", "fil-PH". Anything else is
// refused here rather than handed to a command line.
const cleanLanguage = (value) => {
  const tag = String(value || "").trim();
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(tag) ? tag : null;
};

const parseLine = (line) => {
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" && typeof value.type === "string" ? value : null;
  } catch {
    return null;
  }
};

// The longest a turn may hold the system's recogniser, whatever the page does:
// the page's own rule ends a turn within a minute (speechSilence.js).
const LONGEST_SESSION_MS = 3 * 60 * 1000;

const createSystemSpeech = ({
  platform = process.platform,
  dir = __dirname,
  fs = nodeFs,
  spawn = childProcess.spawn,
  log = () => {},
  longestMs = LONGEST_SESSION_MS,
} = {}) => {
  let current = null;

  // One turn: onEvent gets every line the program writes, then exactly one
  // { type: "end" }. stop() ends it early; the program is killed if it does not
  // go within two seconds.
  const listen = ({ language, onEvent }) => {
    let ended = false;
    const finish = (event) => {
      if (ended) return;
      if (event) onEvent?.(event);
      ended = true;
      onEvent?.({ type: "end" });
    };
    const file = helperPath({ platform, dir, fs });
    const tag = cleanLanguage(language);
    if (!file || !tag) {
      finish({ type: "error", code: file ? "language" : "unavailable" });
      return { stop() {} };
    }
    current?.stop();
    let child;
    try {
      child = spawn(file, ["listen", tag], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      log("warn", "speech.spawn", String(error?.message || error));
      finish({ type: "error", code: "unavailable" });
      return { stop() {} };
    }
    let buffer = "";
    let killTimer = null;
    const longest = setTimeout(() => session.stop(), longestMs);
    longest.unref?.();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const event = parseLine(buffer.slice(0, newline).trim());
        buffer = buffer.slice(newline + 1);
        if (!event) continue;
        if (event.type === "end") finish();
        else if (!ended) onEvent?.(event);
      }
    });
    child.stderr.on("data", (chunk) => log("warn", "speech.stderr", String(chunk).slice(0, 500)));
    child.on("error", (error) => {
      log("warn", "speech.helper", String(error?.message || error));
      finish({ type: "error", code: "unavailable" });
    });
    child.on("close", (code) => {
      clearTimeout(longest);
      clearTimeout(killTimer);
      if (current === session) current = null;
      finish(code ? { type: "error", code: "failed" } : null);
    });
    child.stdin.on("error", () => { /* it went first */ });
    const session = {
      stop() {
        if (killTimer || child.exitCode != null) return;
        try { child.stdin.end("stop\n"); } catch { /* gone */ }
        killTimer = setTimeout(() => {
          try { child.kill(); } catch { /* gone */ }
        }, 2000);
        killTimer.unref?.();
      },
    };
    current = session;
    return session;
  };

  return {
    available: () => Boolean(helperPath({ platform, dir, fs })),
    listen,
    stopAll: () => current?.stop(),
  };
};

module.exports = { createSystemSpeech, helperPath, cleanLanguage, HELPERS };
