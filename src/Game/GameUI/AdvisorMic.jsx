/*! Open Historia — the microphone on the Advisor's input bar © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Press, speak, and the message sends itself three seconds after the player
// stops talking; press again to stop without sending. What is heard appears in
// the input box as it comes, after whatever was typed there already, and the
// send goes through the Advisor's own Send (onSend → handleSend), so every
// guard that holds the Send button back holds this back too.
//
// The recogniser is the platform's or one that runs on the device
// (src/runtime/speechInput.js); none of them costs an AI request. In the
// desktop app on Windows and macOS the system's own is asked first, and when it
// cannot listen the same press goes on with the on-device model. That model is
// downloaded once, after the player has seen its size and said yes, and the
// prompt says why the system's was not used when it was tried.

import React, { useEffect, useRef, useState } from "react";
import { resolveChatLanguage } from "../../runtime/i18n.js";
import { SPEECH_ENGINES, formatModelSize } from "../../runtime/speechEngines.js";
import { downloadSpeechModel, speechEngineFor, speechModelFor, speechModelReady, startSpeech } from "../../runtime/speechInput.js";

const joinText = (before, heard) => [String(before || "").replace(/\s+$/, ""), String(heard || "").trim()].filter(Boolean).join(" ");

const MicIcon = ({ listening }) => (
  <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill={listening ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" />
  </svg>
);

// phase: idle | asking (the download prompt) | downloading | loading |
// listening | finishing
const AdvisorMic = ({ disabled, hidden = false, input, onInput, onSend, threadKey }) => {
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState("");
  // Why the system's recogniser did not listen on this press (speechEngines.js
  // systemFallbackReason), for the download prompt.
  const [fallback, setFallback] = useState(null);
  const sessionRef = useRef(null);
  const baseRef = useRef("");
  const inputRef = useRef(input);
  const turnRef = useRef(0);
  const callbacksRef = useRef({ onInput, onSend });
  useEffect(() => { inputRef.current = input; }, [input]);
  useEffect(() => { callbacksRef.current = { onInput, onSend }; }, [onInput, onSend]);

  const language = resolveChatLanguage();
  const engine = speechEngineFor(language);
  // The on-device engine: this one, or the one a press falls back to when the
  // system's recogniser cannot listen.
  const onDeviceEngine = engine === SPEECH_ENGINES.SYSTEM ? speechEngineFor(language, { skipSystem: true }) : engine;
  const model = onDeviceEngine ? speechModelFor(onDeviceEngine) : null;
  const modelName = model?.name || "";
  const size = model ? formatModelSize(model.bytes) : "";

  // Another conversation, or the panel going away, ends the turn and drops
  // whatever it would still have written: that box is not this one any more.
  useEffect(() => () => {
    turnRef.current += 1;
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, [threadKey]);

  useEffect(() => {
    if (!problem) return undefined;
    const timer = setTimeout(() => setProblem(""), 8000);
    return () => clearTimeout(timer);
  }, [problem]);

  const showProblem = (code) => {
    setProblem(code || "failed");
  };

  // The on-device engine's half of a press: the download prompt the first
  // time, else straight to listening.
  const pressOnDevice = async () => {
    if (!onDeviceEngine) {
      showProblem("failed");
      return;
    }
    if (model && !(await speechModelReady(onDeviceEngine).catch(() => false))) {
      setProblem("");
      setPhase("asking");
      return;
    }
    listen(onDeviceEngine);
  };

  const listen = (chosen) => {
    turnRef.current += 1;
    const turn = turnRef.current;
    const current = () => turn === turnRef.current;
    baseRef.current = inputRef.current || "";
    setProblem("");
    setPhase("listening");
    sessionRef.current = startSpeech({
      engine: chosen,
      language,
      onState: (state) => { if (current()) setPhase(state); },
      onPartial: (text) => { if (current()) callbacksRef.current.onInput(joinText(baseRef.current, text)); },
      onFinal: (text, { send }) => {
        if (!current()) return;
        sessionRef.current = null;
        setPhase("idle");
        const full = joinText(baseRef.current, text);
        if (text) callbacksRef.current.onInput(full);
        if (send) callbacksRef.current.onSend(full);
      },
      onError: (error) => {
        if (!current()) return;
        // The system's recogniser could not listen: the same press goes on
        // with the on-device model.
        if (error?.code === "system") {
          setFallback(error.fallback || null);
          pressOnDevice();
          return;
        }
        showProblem(error?.code);
      },
    });
  };

  const press = async () => {
    if (phase === "listening" || phase === "loading" || phase === "finishing") {
      sessionRef.current?.stop();
      return;
    }
    if (phase === "asking") {
      setPhase("idle");
      return;
    }
    if (phase !== "idle" || disabled) return;
    setFallback(null);
    if (engine === SPEECH_ENGINES.SYSTEM) {
      listen(engine);
      return;
    }
    pressOnDevice();
  };

  const download = async () => {
    setPhase("downloading");
    setProgress(0);
    try {
      await downloadSpeechModel(onDeviceEngine, ({ loaded, total }) => setProgress(total ? Math.floor((loaded / total) * 100) : 0));
      listen(onDeviceEngine);
    } catch (error) {
      setPhase("idle");
      showProblem(error?.code || "model");
    }
  };

  // Hidden where nothing can listen: no recogniser on this platform and no
  // model for this language.
  if (!engine) return null;

  const active = phase === "listening" || phase === "loading" || phase === "finishing";
  const label = active ? "Stop listening" : "Speak to the advisor";
  // Typed words take its place: the microphone is for an empty box.
  const showButton = !(hidden && phase === "idle");

  return (
    <div className="oh-advisor-mic-wrap">
      {phase === "asking" && model && (
        <div className="oh-advisor-mic-note" role="dialog" aria-label="Download the speech model">
          {fallback === "privacy" ? (
            <p>Windows' own speech recognition is off: it needs Online speech recognition turned on in Settings → Privacy & security → Speech.</p>
          ) : fallback === "denied" ? (
            <p>macOS has not allowed this app to use its speech recognition.</p>
          ) : fallback === "language" ? (
            <p>Your system's speech recognition does not have this language.</p>
          ) : fallback === "failed" ? (
            <p>Your system's speech recognition did not start.</p>
          ) : null}
          <p>Speech is recognised on this device. It needs a one-time download of the {modelName} model ({size}).</p>
          <div className="oh-advisor-mic-actions">
            <button type="button" className="oh-advisor-mic-button" onClick={() => setPhase("idle")}>Cancel</button>
            <button type="button" className="oh-advisor-mic-button oh-advisor-mic-button-primary" onClick={download}>Download</button>
          </div>
        </div>
      )}
      {phase === "downloading" && (
        <div className="oh-advisor-mic-note" role="status">
          <p>Downloading the speech model… {progress}%</p>
          <div className="oh-advisor-mic-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        </div>
      )}
      {phase === "loading" && (
        <div className="oh-advisor-mic-note" role="status"><p>Loading the speech model…</p></div>
      )}
      {phase === "listening" && (
        <div className="oh-advisor-mic-note" role="status"><p>Listening. It sends after 3 seconds of silence.</p></div>
      )}
      {phase === "finishing" && (
        <div className="oh-advisor-mic-note" role="status"><p>Writing down what you said…</p></div>
      )}
      {phase === "idle" && problem && (
        <div className="oh-advisor-mic-note oh-advisor-mic-note-problem" role="alert">
          {problem === "permission" ? (
            <p>The microphone was not allowed.</p>
          ) : problem === "browser" ? (
            <p>This browser's speech recognition is not working. Press the microphone again to use one that runs on this device.</p>
          ) : problem === "model" ? (
            <p>The speech model could not be downloaded or loaded.</p>
          ) : (
            <p>Speech recognition stopped working.</p>
          )}
        </div>
      )}
      {showButton && <button
        type="button"
        className="oh-advisor-mic"
        data-listening={active ? "true" : undefined}
        aria-pressed={active}
        aria-label={label}
        title={label}
        onClick={press}
        disabled={!active && phase !== "asking" && (disabled || phase === "downloading")}
      >
        <MicIcon listening={active} />
      </button>}
    </div>
  );
};

export default AdvisorMic;
