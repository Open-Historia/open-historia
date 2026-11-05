/*! Open Historia — the music update: its banner behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make a banner for the music update with large floating musical notes that
// are interactive and music themed" (the owner, 2026-10-15). A concert hall's
// dark, gold and cream, a serif hand; across the top a stage where a staff
// waves and large notes float. Each note is a key: touched, it rings out its
// pitch (a music box: a sine and its octave, gone in a second and a half), a
// ring spreads from it and it jumps. The pitches are a pentatonic scale, so
// anything played on them sounds well. Sound only with Sound effects on
// (Settings); with Reduce motion the notes keep still and still play.
//
// Flat shapes only: nothing is a gradient, nothing purple.

import React, { useRef, useState } from "react";

import { soundEffectsEnabled } from "../../../../runtime/vaultSounds.js";
import { Brackets, FeatureCards, ICONS, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import { MUSIC_CREAM, MUSIC_GOLD, MUSIC_INK, MUSIC_SERIF } from "./musicChrome.js";

const CREAM_SOFT = "rgba(243,233,210,0.72)";
const STAGE = "#161a22";

// C major's pentatonic, two octaves up from C5.
const PITCHES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98];

// One music-box note.
let audio = null;
const ring = (frequency) => {
  if (!soundEffectsEnabled()) return;
  try {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    audio = audio ?? new Context();
    if (audio.state === "suspended") audio.resume?.();
    const now = audio.currentTime;
    const level = audio.createGain();
    level.gain.setValueAtTime(0.0001, now);
    level.gain.linearRampToValueAtTime(0.16, now + 0.008);
    level.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
    level.connect(audio.destination);
    const tone = audio.createOscillator();
    tone.type = "sine";
    tone.frequency.value = frequency;
    tone.connect(level);
    const octave = audio.createOscillator();
    const octaveLevel = audio.createGain();
    octave.type = "triangle";
    octave.frequency.value = frequency * 2;
    octaveLevel.gain.value = 0.22;
    octave.connect(octaveLevel);
    octaveLevel.connect(level);
    tone.start(now);
    octave.start(now);
    tone.stop(now + 1.6);
    octave.stop(now + 1.6);
  } catch {
    // No sound to be had: the note still jumps.
  }
};

// The notes, drawn in a 60 by 80 box.
const NOTE_SHAPES = {
  quarter: (fill) => (
    <>
      <ellipse cx="20" cy="64" fill={fill} rx="13" ry="9" transform="rotate(-22 20 64)" />
      <rect fill={fill} height="56" rx="1.5" width="4.5" x="29.5" y="9" />
    </>
  ),
  eighth: (fill) => (
    <>
      <ellipse cx="20" cy="64" fill={fill} rx="13" ry="9" transform="rotate(-22 20 64)" />
      <rect fill={fill} height="56" rx="1.5" width="4.5" x="29.5" y="9" />
      <path d="M33 9 C41 15 52 21 48 40 C46 30 40 26 33 24 Z" fill={fill} />
    </>
  ),
  beamed: (fill) => (
    <>
      <ellipse cx="11" cy="68" fill={fill} rx="10" ry="7" transform="rotate(-22 11 68)" />
      <ellipse cx="45" cy="60" fill={fill} rx="10" ry="7" transform="rotate(-22 45 60)" />
      <rect fill={fill} height="54" width="4" x="18" y="14" />
      <rect fill={fill} height="54" width="4" x="52" y="6" />
      <path d="M18 14 L56 6 L56 14 L18 22 Z" fill={fill} />
    </>
  ),
  sixteenths: (fill) => (
    <>
      <ellipse cx="11" cy="68" fill={fill} rx="10" ry="7" transform="rotate(-22 11 68)" />
      <ellipse cx="45" cy="60" fill={fill} rx="10" ry="7" transform="rotate(-22 45 60)" />
      <rect fill={fill} height="54" width="4" x="18" y="14" />
      <rect fill={fill} height="54" width="4" x="52" y="6" />
      <path d="M18 14 L56 6 L56 12 L18 20 Z M18 26 L56 18 L56 24 L18 32 Z" fill={fill} />
    </>
  ),
};

// Where each note floats on the stage (per cent across, per cent down), how large, its shape, colour and pace.
const NOTES = [
  { x: 6, y: 18, size: 96, shape: "eighth", gold: true, beat: 4200, tilt: -8 },
  { x: 19, y: 48, size: 66, shape: "quarter", gold: false, beat: 3600, tilt: 6 },
  { x: 31, y: 10, size: 84, shape: "beamed", gold: false, beat: 5000, tilt: -4 },
  { x: 44, y: 44, size: 108, shape: "sixteenths", gold: true, beat: 4600, tilt: 7 },
  { x: 58, y: 8, size: 70, shape: "eighth", gold: false, beat: 3900, tilt: -10 },
  { x: 68, y: 46, size: 90, shape: "quarter", gold: true, beat: 4400, tilt: 5 },
  { x: 80, y: 14, size: 100, shape: "beamed", gold: true, beat: 5200, tilt: -6 },
  { x: 90, y: 50, size: 62, shape: "eighth", gold: false, beat: 3400, tilt: 9 },
  { x: 54, y: 66, size: 56, shape: "quarter", gold: false, beat: 3700, tilt: -5 },
];

// A note on the stage: floating, and a key to be played.
const FloatingNote = ({ note, pitch, still, narrow }) => {
  const [struck, setStruck] = useState(0);
  const [lit, setLit] = useState(false);
  const fill = note.gold ? MUSIC_GOLD : MUSIC_CREAM;
  const size = narrow ? Math.round(note.size * 0.62) : note.size;
  const play = () => {
    ring(pitch);
    setStruck((count) => count + 1);
  };
  return (
    <div
      style={{
        left: `${note.x}%`,
        position: "absolute",
        top: `${note.y}%`,
        "--oh-upd-tilt": `${note.tilt}deg`,
        ...(still ? { transform: `rotate(${note.tilt}deg)` } : forever(still, "ohUpdBob", note.beat, -note.beat * (note.x / 100), "cubic-bezier(0.45, 0, 0.55, 1)")),
      }}
    >
      <button
        aria-label="Play a note"
        className="oh-tap"
        onBlur={() => setLit(false)}
        onFocus={() => setLit(true)}
        onPointerDown={play}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); play(); } }}
        onPointerEnter={() => setLit(true)}
        onPointerLeave={() => setLit(false)}
        style={{ background: "none", border: "none", cursor: "pointer", display: "block", padding: 0, position: "relative", touchAction: "manipulation" }}
        type="button"
      >
        {struck > 0 && !still && (
          <span
            aria-hidden="true"
            key={struck}
            style={{ border: `2px solid ${fill}`, borderRadius: "50%", height: size, left: 0, pointerEvents: "none", position: "absolute", top: 0, width: size, ...motion(still, "ohUpdRing", 900, 0, "cubic-bezier(0.2, 0.7, 0.2, 1)") }}
          />
        )}
        <svg
          aria-hidden="true"
          height={size}
          key={`n${struck}`}
          style={{ display: "block", filter: lit ? `drop-shadow(0 0 6px ${fill})` : "none", transform: lit ? "scale(1.12)" : "none", transition: "transform 160ms cubic-bezier(0.2, 0.7, 0.2, 1)", ...(struck > 0 ? motion(still, "ohUpdStrike", 420, 0, "cubic-bezier(0.2, 0.7, 0.2, 1)") : null) }}
          viewBox="0 0 60 80"
          width={Math.round(size * 0.75)}
        >
          {NOTE_SHAPES[note.shape](fill)}
        </svg>
      </button>
    </div>
  );
};

// The staff across the stage, its five lines waving a little.
const Staff = ({ still }) => (
  <svg aria-hidden="true" preserveAspectRatio="none" style={{ height: "100%", inset: 0, position: "absolute", width: "100%" }} viewBox="0 0 800 200">
    {[0, 1, 2, 3, 4].map((line) => (
      <path
        d={`M-40 ${70 + line * 16} C140 ${40 + line * 16} 300 ${110 + line * 16} 420 ${76 + line * 16} S700 ${44 + line * 16} 860 ${84 + line * 16}`}
        fill="none"
        key={line}
        stroke={MUSIC_GOLD}
        strokeWidth="1.4"
        opacity="0.28"
        style={still ? null : forever(still, "ohUpdSway", 6000 + line * 400, line * 200, "cubic-bezier(0.45, 0, 0.55, 1)")}
      />
    ))}
  </svg>
);

const Music = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const keys = useRef(NOTES.map((_, at) => PITCHES[at % PITCHES.length]));
  return (
    <Plate surface={{ background: MUSIC_INK, border: `1px solid rgba(226,176,74,0.35)`, borderRadius: "16px" }}>
      <Brackets colour={MUSIC_GOLD} inset="0.7rem" length="1.6rem" thickness={1.5} />
      <Reveal delay={150} style={{ background: STAGE, borderBottom: `1px solid rgba(226,176,74,0.25)`, height: narrow ? "11rem" : "clamp(12rem, 26vw, 16rem)", overflow: "hidden", position: "relative" }}>
        <Staff still={still} />
        {NOTES.map((note, at) => <FloatingNote key={at} narrow={narrow} note={note} pitch={keys.current[at]} still={still} />)}
        <div style={{ bottom: "0.55rem", color: CREAM_SOFT, fontFamily: MUSIC_SERIF, fontSize: "0.78rem", fontStyle: "italic", pointerEvents: "none", position: "absolute", right: "0.9rem" }}>Touch the notes</div>
      </Reveal>
      <div style={{ padding: narrow ? "1.2rem 1.1rem 1.3rem" : "1.5rem 2rem 1.7rem" }}>
        <Reveal delay={300}>
          <div style={{ color: MUSIC_GOLD, fontFamily: MUSIC_SERIF, fontSize: "0.78rem", fontVariant: "small-caps", letterSpacing: "0.16em" }}>
            Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
          </div>
          <div style={{ color: MUSIC_CREAM, fontFamily: MUSIC_SERIF, fontSize: narrow ? "2.2rem" : "clamp(2.4rem, 6vw, 3.4rem)", fontStyle: "italic", lineHeight: 1.05, marginTop: "0.2rem" }}>{banner.title}</div>
          {banner.subtitle && <div style={{ color: MUSIC_GOLD, fontFamily: MUSIC_SERIF, fontSize: "1.05rem", fontStyle: "italic", marginTop: "0.2rem" }}>{banner.subtitle}</div>}
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: CREAM_SOFT, fontFamily: MUSIC_SERIF, fontSize: "1rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={MUSIC_GOLD}>
          <span style={{ color: MUSIC_GOLD, display: "inline-flex" }}>{ICONS.note(18)}</span>
        </Rule>
        <FeatureCards
          accent={MUSIC_GOLD}
          caps={false}
          card={{ background: "rgba(243,233,210,0.04)", border: "1px solid rgba(226,176,74,0.2)", borderRadius: "12px" }}
          delay={520}
          font={MUSIC_SERIF}
          sections={banner.sections ?? []}
          soft={CREAM_SOFT}
        />
      </div>
    </Plate>
  );
};

export default Music;
