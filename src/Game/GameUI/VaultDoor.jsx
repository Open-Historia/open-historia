/*! Open Historia — the vault door the app opens on © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the player meets when the app has started: a vault door, shut, with the
// Open Historia mark as its wheel. The owner's words (2026-10-13): "it should
// slightly shake and make a sound effect when it shakes to show the user it
// should be clicked; when it is clicked the logo should spin to unlock the
// vault and the vault doors open ... a triangular door where there is a door
// that pulls away at the top, and 2 that pull away diagonally down to display
// the main menu. give the vault door sound effects for everything".
//
// So the door is three leaves that meet in the middle, on a seam shaped like a
// Y: one leaf above, which is drawn up, and two below, which are drawn down
// and outward. The main menu is already behind them. The sounds are made by
// runtime/vaultSounds.js.
//
// The steel is brushed: two pictures of it made by vaultMetal.js (the owner,
// on seeing the door in flat colour: "looks good, but give the metal
// texture"), one turned in circles for the door and its wheel, one brushed
// straight for the wall. Over them the rings, plates and bolts are flat
// colour with a lit edge and a shaded one, the light coming from the upper
// left. Nothing here is a gradient.
//
// The door is thick. As its leaves part, each one's inner sides come into
// view, seen from in front of the middle of the screen: the far edge of a side
// lags behind its near edge, so the steel has depth, and its lit bevel, its
// groove, the sockets of its locking bolts and the joint where the round door
// meets the wall all run back toward the middle. Each leaf casts its shadow on
// the menu behind it. (The owner, 2026-10-14: "the vault doors currently look
// thin and 2d when they open"; "make a paralax effect on an inner visible side
// of the vault doors to make it very realistic".) The leaves are moved and the
// sides drawn frame by frame, together, so that they never drift apart.
//
// With Reduce motion on (the game's switch or the system's) nothing shakes or
// slides: the door is still, and a click fades it away.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reduceMotionEnabled } from "../../runtime/mapSettings.js";
import { makeVaultSounds } from "../../runtime/vaultSounds.js";
import { seeded, vaultMetal } from "./vaultMetal.js";
import { VAULT_DEPTH, VAULT_EASE, VAULT_LEAVES, VAULT_TIMING, leafOffset, sideLight, vaultSides } from "./vaultPlan.js";

export { VAULT_LEAVES, VAULT_TIMING };

const STEEL = Object.freeze({ wall: "#202327", plate: "#2b2f35", door: "#343941", ring: "#40464f", edge: "#15171a", light: "#5b626c", bolt: "#7b838d", lit: "#d5dce6" });

const STYLES = `
@keyframes oh-vault-shake {
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  15% { transform: translate(-3px, 1px) rotate(-1.6deg); }
  30% { transform: translate(3px, -1px) rotate(1.6deg); }
  45% { transform: translate(-2px, 1px) rotate(-1.1deg); }
  60% { transform: translate(2px, 0) rotate(0.9deg); }
  80% { transform: translate(-1px, 0) rotate(-0.4deg); }
}
.oh-vault-knob { appearance: none; background: none; border: 0; padding: 0; cursor: pointer; border-radius: 50%; outline-offset: 6px; position: relative; }
.oh-vault-knob:focus-visible { outline: 2px solid #d4d4d8; }
.oh-vault-knob:disabled { cursor: default; }
`;

// An arc of a circle, clockwise from one angle to another (degrees; 0 is to
// the right, 90 is down).
const arc = (cx, cy, r, from, to) => {
  const point = (degrees) => [cx + Math.cos((degrees * Math.PI) / 180) * r, cy + Math.sin((degrees * Math.PI) / 180) * r];
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

// The edge of something round, lit from the upper left: a step UP toward the
// middle catches the light on its upper left and is shaded on its lower
// right; a step down, the other way about.
const Bevel = ({ cx = 0, cy = 0, r, width = 3, raised = true }) => (
  <g fill="none" strokeWidth={width} strokeLinecap="round">
    <path d={arc(cx, cy, r, 150, 300)} stroke={raised ? STEEL.lit : "#000"} opacity={raised ? 0.34 : 0.42} />
    <path d={arc(cx, cy, r, 330, 480)} stroke={raised ? "#000" : STEEL.lit} opacity={raised ? 0.42 : 0.26} />
  </g>
);

// A bolt head: its shadow on the plate, its seat, the head, and the light on it.
const Bolt = ({ x, y, r = 9 }) => (
  <g>
    <circle cx={x + r * 0.3} cy={y + r * 0.45} r={r * 1.45} fill="#000" opacity="0.35" />
    <circle cx={x} cy={y} r={r * 1.45} fill={STEEL.edge} />
    <circle cx={x} cy={y} r={r} fill={STEEL.bolt} />
    <circle cx={x + r * 0.2} cy={y + r * 0.25} r={r * 0.72} fill="#000" opacity="0.22" />
    <circle cx={x - r * 0.3} cy={y - r * 0.32} r={r * 0.3} fill={STEEL.lit} opacity="0.7" />
  </g>
);

const WALL_COLUMNS = [0, 200, 400, 600, 800, 1000, 1200, 1400];
const WALL_ROWS = [0, 250, 500, 750];

// The face of the door, the same on every leaf: each leaf shows its own part
// of it. Drawn once over the whole screen and cut by the leaf's shape. The
// wall's own steel is the leaf's background (a picture that repeats does so
// without seams there), and its plates are drawn to cover the screen
// whatever its shape; the round door is as wide as the screen's SHORTER side
// allows, so that it is whole on a phone held upright as on a monitor.
const DoorFace = ({ metal }) => {
  const bolts = useMemo(() => Array.from({ length: 28 }, (_, index) => {
    const angle = (index / 28) * Math.PI * 2;
    return [800 + Math.cos(angle) * 395, 500 + Math.sin(angle) * 395];
  }), []);
  const studs = useMemo(() => Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2 + Math.PI / 12;
    return [800 + Math.cos(angle) * 326, 500 + Math.sin(angle) * 326];
  }), []);
  return (
    <>
    <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true" style={{ display: "block" }}>
      {/* The wall's plates: a dark joint with the light on its lower lip, and a rivet in each corner. */}
      {WALL_COLUMNS.map((x) => (
        <g key={`v${x}`}>
          <rect x={x} y="0" width="3" height="1000" fill={STEEL.edge} />
          <rect x={x + 3} y="0" width="1.5" height="1000" fill={STEEL.lit} opacity="0.1" />
        </g>
      ))}
      {WALL_ROWS.map((y) => (
        <g key={`h${y}`}>
          <rect x="0" y={y} width="1600" height="3" fill={STEEL.edge} />
          <rect x="0" y={y + 3} width="1600" height="1.5" fill={STEEL.lit} opacity="0.1" />
        </g>
      ))}
      {WALL_COLUMNS.flatMap((x) => WALL_ROWS.flatMap((y) => [[x + 18, y + 20], [x + 186, y + 20], [x + 18, y + 234], [x + 186, y + 234]])).map(([x, y]) => (
        <g key={`r${x}-${y}`}>
          <circle cx={x + 1} cy={y + 1.5} r="4.5" fill="#000" opacity="0.4" />
          <circle cx={x} cy={y} r="3.5" fill={STEEL.ring} />
          <circle cx={x - 1} cy={y - 1} r="1.1" fill={STEEL.lit} opacity="0.55" />
        </g>
      ))}
    </svg>
    {/* The round door: its shadow on the wall, its frame, and the turned steel. */}
    <svg viewBox="300 0 1000 1000" aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", width: "100vmin", height: "100vmin", transform: "translate(-50%, -50%)", display: "block" }}>
      <circle cx="807" cy="512" r="447" fill="#000" opacity="0.45" />
      <circle cx="800" cy="500" r="440" fill={STEEL.edge} />
      {metal.disc ? (
        <>
          <clipPath id="oh-vault-face"><circle cx="800" cy="500" r="428" /></clipPath>
          <image href={metal.disc} x="372" y="72" width="856" height="856" clipPath="url(#oh-vault-face)" preserveAspectRatio="none" />
          {/* The rim the bolts sit in is the darkest; the middle plate is set in. */}
          <circle cx="800" cy="500" r="395" fill="none" stroke="#000" strokeWidth="66" opacity="0.34" />
          <circle cx="800" cy="500" r="290" fill="#000" opacity="0.26" />
        </>
      ) : (
        <>
          <circle cx="800" cy="500" r="428" fill={STEEL.plate} />
          <circle cx="800" cy="500" r="362" fill={STEEL.door} />
          <circle cx="800" cy="500" r="290" fill={STEEL.plate} />
        </>
      )}
      <Bevel cx={800} cy={500} r={425} width={4} raised={false} />
      <circle cx="800" cy="500" r="362" fill="none" stroke={STEEL.edge} strokeWidth="6" />
      <Bevel cx={800} cy={500} r={357} width={4} />
      <circle cx="800" cy="500" r="290" fill="none" stroke={STEEL.edge} strokeWidth="6" />
      <Bevel cx={800} cy={500} r={285} width={3.5} raised={false} />
      {bolts.map(([x, y], index) => <Bolt key={`b${index}`} x={x} y={y} />)}
      {studs.map(([x, y], index) => <Bolt key={`s${index}`} x={x} y={y} r={5.5} />)}
    </svg>
    </>
  );
};

// The wheel: the mark itself, nearly the whole of it (the owner, 2026-10-13:
// "the open historia logo should be much bigger and be almost the size of the
// entire center thing"), in a steel rim with three handles standing out from
// it. It is what is clicked, and it is the mark that turns.
const Wheel = ({ logo, metal }) => (
  <svg viewBox="-150 -150 300 300" width="100%" height="100%" aria-hidden="true" style={{ display: "block" }}>
    {[0, 120, 240].map((turn) => (
      <g key={turn} transform={`rotate(${turn})`}>
        <rect x="-9" y="-138" width="18" height="36" rx="6" fill={STEEL.light} stroke={STEEL.edge} strokeWidth="3" />
        <rect x="-5.5" y="-130" width="3" height="16" rx="1.5" fill={STEEL.lit} opacity="0.45" />
        <circle cy="-136" r="12" fill={STEEL.bolt} stroke={STEEL.edge} strokeWidth="3" />
        <circle cx="-3.2" cy="-139.4" r="3.4" fill={STEEL.lit} opacity="0.6" />
      </g>
    ))}
    <circle r="118" fill={STEEL.edge} />
    {metal.disc ? (
      <>
        <clipPath id="oh-vault-wheel"><circle r="112" /></clipPath>
        <image href={metal.disc} x="-112" y="-112" width="224" height="224" clipPath="url(#oh-vault-wheel)" preserveAspectRatio="none" />
        <circle r="112" fill={STEEL.lit} opacity="0.1" />
      </>
    ) : (
      <circle r="112" fill={STEEL.ring} />
    )}
    <Bevel r={110} width={3} />
    <circle r="104" fill={STEEL.edge} />
    <clipPath id="oh-vault-hub"><circle r="100" /></clipPath>
    <image href={logo} x="-100" y="-100" width="200" height="200" clipPath="url(#oh-vault-hub)" preserveAspectRatio="xMidYMid slice" />
    <circle r="100" fill="none" stroke={STEEL.light} strokeWidth="3" />
    <Bevel r={102.5} width={2} raised={false} />
  </svg>
);

// The wheel's shadow on the door: its outline, rim and handles, in one flat
// dark. It TURNS with the wheel, so the handles' shadows go round as the
// handles do, but it is drawn apart from the wheel and moved down and to the
// right by whoever draws it, outside the turning: a shadow falls the same way
// however the thing that casts it is turned. (Drawn inside the wheel it went
// round with it, and fell upward half the time.) It is drawn beside the
// button, not in it, so that it does not shake when the wheel does (the
// owner: "the shadow is attached to the object making it shake aswell").
const WheelShadow = () => (
  <svg viewBox="-150 -150 300 300" width="100%" height="100%" aria-hidden="true" style={{ display: "block", opacity: 0.42 }}>
    <circle r="120" fill="#000" />
    {[0, 120, 240].map((turn) => (
      <g key={turn} transform={`rotate(${turn})`} fill="#000">
        <rect x="-10.5" y="-139.5" width="21" height="39" rx="7" />
        <circle cy="-136" r="13.5" />
      </g>
    ))}
  </svg>
);

// ---- the leaves' depth, drawn on a canvas under them -------------------------------

// The brushing on a side: fine lines along it, the same ones every time.
const SIDE_BRUSH = (() => {
  const random = seeded(1931);
  return Array.from({ length: 54 }, () => ({ at: random(), light: random() < 0.5, alpha: 0.025 + random() * 0.07 }));
})();

const lerp = ([ax, ay], [bx, by], share) => [ax + (bx - ax) * share, ay + (by - ay) * share];

// A point on a side: `along` it from its middle end (0) to its outer end (1),
// and `deep` into it from its front (0) to its back (1).
const sidePoint = (side, along, deep) => lerp(lerp(side.front[0], side.front[1], along), lerp(side.back[0], side.back[1], along), deep);

const quad = (context, side, from, to, deepFrom = 0, deepTo = 1) => {
  context.beginPath();
  context.moveTo(...sidePoint(side, from, deepFrom));
  context.lineTo(...sidePoint(side, to, deepFrom));
  context.lineTo(...sidePoint(side, to, deepTo));
  context.lineTo(...sidePoint(side, from, deepTo));
  context.closePath();
};

// The socket of a locking bolt, a round hole in the side with the bolt's end
// drawn back into it: a circle on the side, so an ellipse as seen. `radius` is
// its size along the side, in pixels; across, it is foreshortened as the side is.
const drawSocket = (context, side, along, light, radius) => {
  const length = Math.hypot(side.front[1][0] - side.front[0][0], side.front[1][1] - side.front[0][1]);
  if (!(length > 0)) return;
  const unit = [(side.front[1][0] - side.front[0][0]) / length, (side.front[1][1] - side.front[0][1]) / length];
  const ellipse = (deep, scale) => {
    const centre = sidePoint(side, along, deep);
    const across = sidePoint(side, along, deep + VAULT_DEPTH.socketRadius * scale);
    context.save();
    context.transform(unit[0] * radius * scale, unit[1] * radius * scale, across[0] - centre[0], across[1] - centre[1], centre[0], centre[1]);
    context.beginPath();
    context.arc(0, 0, 1, 0, Math.PI * 2);
    context.restore();
  };
  // The hole, its rim catching the light on the far side, the bolt's end set back in it.
  ellipse(0.42, 1.12);
  context.fillStyle = `rgba(214, 220, 230, ${0.1 + 0.22 * light})`;
  context.fill();
  ellipse(0.42, 1);
  context.fillStyle = "rgba(6, 7, 9, 0.9)";
  context.fill();
  ellipse(0.47, 0.74);
  context.fillStyle = `rgb(${Math.round(46 + 40 * light)}, ${Math.round(50 + 42 * light)}, ${Math.round(57 + 44 * light)})`;
  context.fill();
  ellipse(0.44, 0.34);
  context.fillStyle = `rgba(214, 220, 230, ${0.08 + 0.2 * light})`;
  context.fill();
};

// One side of a leaf: steel brushed along it, lit by which way it faces; the
// bevel of its front edge catching the light; a groove along it; where the
// round door ends and the wall begins; the sockets of the locking bolts; and
// its far edge in shadow.
const drawSide = (context, side, width, height) => {
  const light = sideLight(side.facing);
  const short = Math.min(width, height);
  const length = Math.hypot(side.front[1][0] - side.front[0][0], side.front[1][1] - side.front[0][1]);
  if (!(length > 0)) return;
  // How far along the side the round door reaches: the steel beyond is the wall's.
  const doorEnds = Math.min(1, (VAULT_DEPTH.door * short) / length);
  context.save();
  quad(context, side, 0, 1);
  context.clip();
  // The steel: the door's lighter, the wall's darker.
  const tone = (base) => Math.round(base * (0.55 + 0.75 * light));
  context.fillStyle = `rgb(${tone(52)}, ${tone(57)}, ${tone(65)})`;
  quad(context, side, 0, doorEnds);
  context.fill();
  if (doorEnds < 1) {
    context.fillStyle = `rgb(${tone(40)}, ${tone(44)}, ${tone(50)})`;
    quad(context, side, doorEnds, 1);
    context.fill();
  }
  // Brushed along the side: lines of the same depth run back toward the middle.
  context.lineWidth = 1;
  for (const line of SIDE_BRUSH) {
    context.strokeStyle = line.light ? `rgba(230, 236, 245, ${line.alpha * (0.5 + light)})` : `rgba(0, 0, 0, ${line.alpha * 1.4})`;
    context.beginPath();
    context.moveTo(...sidePoint(side, 0, line.at));
    context.lineTo(...sidePoint(side, 1, line.at));
    context.stroke();
  }
  // The groove that runs along the side, and the light on its lower lip.
  context.fillStyle = "rgba(0, 0, 0, 0.42)";
  quad(context, side, 0, 1, 0.64, 0.7);
  context.fill();
  context.fillStyle = `rgba(214, 220, 230, ${0.05 + 0.14 * light})`;
  quad(context, side, 0, 1, 0.7, 0.72);
  context.fill();
  // The joint where the round door meets the wall, running back to the middle.
  if (doorEnds < 1) {
    context.strokeStyle = "rgba(0, 0, 0, 0.7)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(...sidePoint(side, doorEnds, 0));
    context.lineTo(...sidePoint(side, doorEnds, 1));
    context.stroke();
    context.strokeStyle = `rgba(214, 220, 230, ${0.06 + 0.14 * light})`;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(...sidePoint(side, Math.min(1, doorEnds + 2.5 / length), 0));
    context.lineTo(...sidePoint(side, Math.min(1, doorEnds + 2.5 / length), 1));
    context.stroke();
  }
  // The locking bolts' sockets, along the round door's part of the side.
  const radius = VAULT_DEPTH.socketRadius * VAULT_DEPTH.thickness * short;
  for (const at of VAULT_DEPTH.sockets) {
    const along = (at * short) / length;
    if (along * length > radius && along < doorEnds) drawSocket(context, side, along, light, radius);
  }
  // The front edge's bevel catches the light; the far edge is in shadow.
  context.fillStyle = `rgba(222, 228, 238, ${0.18 + 0.42 * light})`;
  quad(context, side, 0, 1, 0, 0.035);
  context.fill();
  context.fillStyle = "rgba(0, 0, 0, 0.5)";
  quad(context, side, 0, 1, 0.9, 1);
  context.fill();
  context.restore();
};

// A leaf's shadow on the menu behind it: its shape, moved down and to the
// right (the light is at the upper left), in a few soft steps.
const drawShadow = (context, leaf, progress, width, height) => {
  const [dx, dy] = leafOffset(leaf, progress, width, height);
  const corners = [...leaf.shape.matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)].map((match) => [(Number(match[1]) / 100) * width + dx, (Number(match[2]) / 100) * height + dy]);
  const reach = Math.min(width, height) * 0.03 * Math.min(1, progress * 4);
  for (const step of [1, 0.66, 0.33]) {
    context.beginPath();
    corners.forEach(([x, y], index) => context[index ? "lineTo" : "moveTo"](x + reach * step, y + reach * 1.5 * step));
    context.closePath();
    context.fillStyle = "rgba(0, 0, 0, 0.16)";
    context.fill();
  }
};

// Everything under the leaves at one moment of their going: their shadows,
// then their sides (a leaf's own face is always in front of every side).
const drawDepth = (canvas, progress) => {
  const context = canvas?.getContext?.("2d");
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const pixelsWide = Math.round(width * ratio);
  const pixelsHigh = Math.round(height * ratio);
  if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
    canvas.width = pixelsWide;
    canvas.height = pixelsHigh;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!(progress > 0)) return;
  for (const leaf of VAULT_LEAVES) drawShadow(context, leaf, progress, width, height);
  for (const leaf of VAULT_LEAVES) for (const side of vaultSides(leaf, progress, width, height)) drawSide(context, side, width, height);
};

// `onOpening`: the wheel has been turned and the leaves start to move (the
// menu's music may begin). `onOpened`: the door is gone.
export const VaultDoor = ({ onOpening = null, onOpened = null, logo = `${import.meta.env?.BASE_URL ?? "/"}logo.png`, sounds: givenSounds = null }) => {
  // closed → spinning → opening → gone
  const [stage, setStage] = useState("closed");
  const [shaking, setShaking] = useState(false);
  // Counts the touches that were not on the wheel: each starts the wait again.
  const [touches, setTouches] = useState(0);
  const still = useMemo(() => reduceMotionEnabled(), []);
  const metal = useMemo(() => vaultMetal(), []);
  const soundsRef = useRef(null);
  if (!soundsRef.current) soundsRef.current = givenSounds ?? makeVaultSounds();
  const timers = useRef([]);
  const later = useCallback((fn, ms) => { timers.current.push(setTimeout(fn, ms)); }, []);
  const leavesRef = useRef([]);
  const depthRef = useRef(null);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    if (!givenSounds) soundsRef.current?.dispose();
  }, [givenSounds]);

  // Shut and left alone, it shudders: that is the invitation. Not at once:
  // after VAULT_TIMING.firstShake without a touch, and then every
  // VAULT_TIMING.shakeEvery. A touch starts the wait from the beginning.
  useEffect(() => {
    if (stage !== "closed" || still) return undefined;
    let stop = null;
    let again = null;
    const shudder = () => {
      setShaking(true);
      soundsRef.current?.rattle();
      stop = setTimeout(() => setShaking(false), VAULT_TIMING.shake);
    };
    const first = setTimeout(() => {
      shudder();
      again = setInterval(shudder, VAULT_TIMING.shakeEvery);
    }, VAULT_TIMING.firstShake);
    return () => { clearTimeout(first); clearInterval(again); clearTimeout(stop); setShaking(false); };
  }, [stage, still, touches]);

  // The leaves going, frame by frame: each moved by its share of the way, and
  // their sides and shadows drawn for that same moment, so that the two never
  // drift apart.
  useEffect(() => {
    if (stage !== "opening" || still) return undefined;
    let frame = 0;
    let started = 0;
    const step = (now) => {
      if (!started) started = now;
      const gone = Math.min(1, (now - started) / VAULT_TIMING.open);
      const progress = VAULT_EASE(gone);
      const width = depthRef.current?.clientWidth || globalThis.innerWidth || 0;
      const height = depthRef.current?.clientHeight || globalThis.innerHeight || 0;
      VAULT_LEAVES.forEach((leaf, index) => {
        const element = leavesRef.current[index];
        if (!element) return;
        const [x, y] = leafOffset(leaf, progress, width, height);
        element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      });
      drawDepth(depthRef.current, progress);
      if (gone < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [stage, still]);

  const open = () => {
    if (stage !== "closed") return;
    setShaking(false);
    const voice = soundsRef.current;
    if (still) {
      // No turning and no sliding: the bolts are heard, and the door fades.
      voice?.unlock();
      setStage("opening");
      onOpening?.();
      later(() => { setStage("gone"); onOpened?.(); }, VAULT_TIMING.fade);
      return;
    }
    setStage("spinning");
    voice?.spin(VAULT_TIMING.spin / 1000);
    later(() => voice?.unlock(), VAULT_TIMING.spin);
    later(() => {
      setStage("opening");
      voice?.open(VAULT_TIMING.open / 1000);
      onOpening?.();
    }, VAULT_TIMING.spin + VAULT_TIMING.bolts);
    later(() => { setStage("gone"); onOpened?.(); }, VAULT_TIMING.spin + VAULT_TIMING.bolts + VAULT_TIMING.open + 120);
  };

  if (stage === "gone") return null;
  const opening = stage === "opening";
  const turned = stage !== "closed";
  return (
    <div
      data-oh-vault={stage}
      onPointerDown={() => { if (stage === "closed") setTouches((count) => count + 1); }}
      style={{
        position: "fixed", inset: 0, zIndex: 2147482000, overflow: "hidden",
        // Still, the whole door fades; moving, each leaf leaves by itself.
        opacity: still && opening ? 0 : 1,
        transition: still ? `opacity ${VAULT_TIMING.fade}ms cubic-bezier(0.25, 0.1, 0.25, 1)` : "none",
        pointerEvents: opening ? "none" : "auto",
      }}
    >
      <style>{STYLES}</style>
      {/* Under the leaves: their sides and shadows as they part (drawDepth). */}
      <canvas ref={depthRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
      {VAULT_LEAVES.map((leaf, index) => (
        <div
          key={leaf.name}
          ref={(element) => { leavesRef.current[index] = element; }}
          data-oh-vault-leaf={leaf.name}
          style={{
            position: "absolute", inset: 0,
            backgroundColor: STEEL.wall,
            backgroundImage: metal.plate ? `url(${metal.plate})` : "none",
            backgroundSize: "256px 256px",
            clipPath: leaf.shape,
            WebkitClipPath: leaf.shape,
            // Moved frame by frame as the door opens (the effect above), with
            // its sides: not by a transition, which the sides could not follow.
            willChange: "transform",
          }}
        >
          <DoorFace metal={metal} />
        </div>
      ))}
      {/* The seams, until the leaves part. */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: opening ? 0 : 1, transition: "opacity 120ms linear", pointerEvents: "none" }}>
        {[[0, 15], [100, 15], [50, 100]].map(([x, y]) => (
          <line key={`${x}-${y}`} x1="50" y1="50" x2={x} y2={y} stroke={STEEL.edge} strokeWidth="5" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {/* The wheel, in the middle, over the seams. Its bolts draw back as the leaves start. */}
      <div style={{ position: "absolute", left: "50%", top: "50%", width: "56vmin", height: "56vmin", transform: `translate(-50%, -50%) scale(${opening ? 0.6 : 1})`, opacity: opening ? 0 : 1, transition: still ? "none" : "transform 260ms cubic-bezier(0.42, 0, 1, 1), opacity 260ms cubic-bezier(0.42, 0, 1, 1)" }}>
        {/* The shadow: moved down and to the right here, and turned inside that.
            Beside the button, not in it: the button is what shakes, and the
            shadow lies still on the door while it does. */}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", transform: "translate(1.3%, 2.4%)" }}>
          <div style={{ width: "100%", height: "100%", transform: `rotate(${turned && !still ? 540 : 0}deg)`, transition: still ? "none" : `transform ${VAULT_TIMING.spin}ms cubic-bezier(0.5, 0, 0.2, 1)` }}>
            <WheelShadow />
          </div>
        </div>
        <button
          type="button"
          className="oh-vault-knob"
          aria-label="Open"
          autoFocus
          disabled={stage !== "closed"}
          onClick={open}
          style={{ width: "100%", height: "100%", animation: shaking ? `oh-vault-shake ${VAULT_TIMING.shake}ms cubic-bezier(0.42, 0, 0.58, 1)` : "none" }}
        >
          <div style={{ position: "relative", width: "100%", height: "100%", transform: `rotate(${turned && !still ? 540 : 0}deg)`, transition: still ? "none" : `transform ${VAULT_TIMING.spin}ms cubic-bezier(0.5, 0, 0.2, 1)` }}>
            <Wheel logo={logo} metal={metal} />
          </div>
        </button>
      </div>
    </div>
  );
};

export default VaultDoor;
