/*! Open Historia — the map's trackpad and mouse controls: two fingers on a trackpad zoom, and with Shift held turn and tilt the map; a mouse wheel zooms © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so you can do all the map controls with 2 fingers on a trackpad, and
// make it so mouse you can just right click to do them"; "make it so on track
// pad, a one finger click and drag pans but 2 finger drag turns tilts and
// rotates" (the owner, 2026-10-27); then "add camera controls (press shift to
// tilt or turn) to beta" (2026-11-02), as the native app already has them: a
// two-finger scroll zooms, and only with Shift held turns and tilts.
//
// The map's controls (World.jsx sets MapLibre's handlers):
//
//   mouse      a left drag pans, the wheel zooms (Shift: finer, MapLibre's own),
//              and a right-button drag turns the map (sideways) and tilts it
//              (up and down): MapLibre's own dragRotate with pitchWithRotate;
//   trackpad   a click and drag pans (it is a left drag), a pinch zooms, a
//              two-finger scroll zooms, and a two-finger scroll with Shift held
//              turns and tilts the map, both at once: this file;
//   keyboard   the arrows pan, + and - zoom, Shift with the arrows turns and
//              tilts (MapLibre's keyboard handler, as before);
//   touch      as before: a drag pans, a pinch zooms, a twist turns.
//
// A trackpad's two-finger drag reaches the page as wheel events, the very
// events a mouse wheel sends, and MapLibre zooms on both. So the wheel events
// are sorted before MapLibre sees them, by a listener on the map's canvas
// container in the capture phase (it runs before MapLibre's own listener on
// that element, and stopping the event there keeps it from MapLibre):
//
//   - a pinch comes as wheel events with ctrlKey set: it goes on to MapLibre,
//     which zooms, as before;
//   - a mouse wheel's events go on to MapLibre, which zooms, as before;
//   - a trackpad's scroll without Shift goes on to MapLibre, which zooms at a
//     trackpad's rate;
//   - a trackpad's scroll with Shift held is kept from MapLibre and turns and
//     tilts the map.
//
// Telling the two apart is MapLibre's own test (ScrollZoomHandler.wheel in
// maplibre-gl/src/ui/handler/scroll_zoom.ts), the one that already chose its
// zoom rate for each, so a scroll is a mouse wheel's exactly when MapLibre took
// it for one:
//
//   - a step that is a whole multiple of 4.000244140625 px is a mouse wheel's
//     (what macOS browsers send for a notch);
//   - a step under 4 px is a trackpad's;
//   - the first step after 400 ms of quiet is held for up to 40 ms. If nothing
//     follows, it was a lone notch of a mouse wheel. If a step follows in time,
//     a fast pace (ms between the two times px under 200) is a trackpad's and
//     a slow one a mouse wheel's;
//   - a scroll stays what it was found to be until one of the first two rules
//     says otherwise, or it pauses for 400 ms.
//
// Two departures, both because MapLibre reads deltaY alone and this needs both
// axes. The test reads the larger of the two: a trackpad's sideways scroll has
// no deltaY at all, and a mouse wheel has no deltaX, so for a mouse wheel it is
// MapLibre's number. And a held step that a later step settles goes the way
// that one is settled (MapLibre zooms it as a wheel's after its 40 ms even when
// the step after it was a trackpad's).
//
// A notch found to be a mouse wheel's is handed to MapLibre as a copy whose
// deltaY is rounded to a whole multiple of 4.000244140625 px (100 px becomes
// 100.006): MapLibre counts that as a wheel's at once, so it zooms by what it
// would have, without a second 40 ms wait and without guessing again from a
// stream it now sees only part of. Anything that goes wrong on the way leaves
// the event to MapLibre, which zooms on it: the map falls back to what it did
// before, never to a map that does nothing.
//
// Known limit, MapLibre's too: a "smooth scrolling" mouse wheel that sends
// many small steps quickly looks like a trackpad, so it turns the map; it
// zoomed at a trackpad's rate before.

// MapLibre's numbers (scroll_zoom.ts).
export const WHEEL_ZOOM_DELTA = 4.000244140625;
const LINE_PX = 40;
const TRACKPAD_STEP_UNDER_PX = 4;
const NEW_SCROLL_MS = 400;
export const LONE_EVENT_MS = 40;
const TRACKPAD_PACE_UNDER = 200;

// How far a trackpad's two-finger scroll turns and tilts the map, in degrees a
// pixel. A right-button drag is MapLibre's 0.8° (turn) and 0.5° (tilt) a pixel
// of mouse; a trackpad's scroll adds up quickly, and macOS carries it on after
// the fingers lift, so less, and its tilt less again, so the 60° of tilt is a
// deliberate stroke.
export const TURN_DEGREES_PER_PX = 0.5;
export const TILT_DEGREES_PER_PX = 0.3;
// A step is at most a quarter turn: easeTo takes the short way round, so a goal
// half a turn ahead of the map would be reached by turning back.
const MOST_TURN_STEP = 90;

// Each step of a turn is an ease of this long, which smooths the steps of a
// scroll into one movement: the map is where the step sends it 60% of the way
// through (120 ms), and the rest holds the move open for the next step, as
// MapLibre's wheel zoom waits 200 ms before its zoomend. A step that comes
// while one is easing carries on from where the last was going, under the same
// easeId, so a whole scroll is one movestart and one moveend, also on a slow
// machine whose steps land 100 ms or more apart.
const TURN_EASE_MS = 200;
const TURN_EASE_ID = "oh-trackpad-turn";
const TURN_SETTLED_AT = 0.6;
const easeOut = (t) => {
  const k = Math.min(1, t / TURN_SETTLED_AT);
  return k * (2 - k);
};
const atOnce = () => 1;

// The copies handed to MapLibre's zoom, which the sorting lets by.
const SORTED = new WeakSet();

// A wheel event's scroll in pixels, read as MapLibre reads deltaY: a line is
// 40 px, and a page (DOM_DELTA_PAGE, which no browser sends for a wheel or a
// trackpad) is taken as it comes.
export const wheelPixels = (event) => {
  const scale = event?.deltaMode === 1 ? LINE_PX : 1;
  const x = Number(event?.deltaX) * scale;
  const y = Number(event?.deltaY) * scale;
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
};

// The nearest whole number of macOS wheel notches to `px`: what MapLibre counts
// as a mouse wheel's step without waiting.
export const asMouseWheel = (px) => Math.round(px / WHEEL_ZOOM_DELTA) * WHEEL_ZOOM_DELTA;

// MapLibre's sorting, kept apart from the DOM so it can be tested with times
// of its own. `sort` takes a step ({ x, y } px, at `time` ms) and says what it
// is: "wheel" (a mouse wheel's: zoom), "trackpad" (turn and tilt), or "wait"
// (the first step of a scroll that cannot be told yet: held until the next
// step, or until `expire`). A step that settles a held one carries its scroll
// too, so x and y are what is to be zoomed or turned.
export const createWheelSorter = () => {
  let kind = null;
  let lastAt = -Infinity;
  let held = null;
  const settle = (verdict, x, y) => {
    if (held) {
      x += held.x;
      y += held.y;
      held = null;
    }
    return { verdict, x, y };
  };
  return {
    sort({ x, y }, time) {
      const lead = Math.abs(y) >= Math.abs(x) ? y : x;
      const since = time - lastAt;
      lastAt = time;
      if (lead !== 0 && lead % WHEEL_ZOOM_DELTA === 0) {
        kind = "wheel";
      } else if (lead !== 0 && Math.abs(lead) < TRACKPAD_STEP_UNDER_PX) {
        kind = "trackpad";
      } else if (since > NEW_SCROLL_MS) {
        kind = null;
        held = { x, y, at: time };
        return { verdict: "wait", x: 0, y: 0 };
      } else if (!kind) {
        kind = Math.abs(since * lead) < TRACKPAD_PACE_UNDER ? "trackpad" : "wheel";
      }
      return settle(kind, x, y);
    },
    // The held step, as a mouse wheel's, once its 40 ms are up: from the timer
    // (no time: at once), or from the next step when the timer has not run yet
    // though its time has passed (a busy page runs timers late).
    expire(time) {
      if (!held) return null;
      if (time !== undefined && time - held.at < LONE_EVENT_MS) return null;
      kind = "wheel";
      return settle("wheel", 0, 0);
    },
    holding: () => Boolean(held),
  };
};

// The turn and tilt of a trackpad's two-finger scroll of x, y px. Content
// follows the fingers on the default setting of macOS and of Windows, so
// fingers that move right scroll the page left (deltaX < 0) and fingers that
// move up scroll it down (deltaY > 0). The map goes as a right-button drag the
// same way takes it: right turns it as Shift+Right does (the bearing grows),
// up tilts it as Shift+Up does.
export const trackpadTurn = ({ x, y }) => ({
  // (|| 0: no -0 for a scroll with no sideways part.)
  bearing: Math.max(-MOST_TURN_STEP, Math.min(MOST_TURN_STEP, -x * TURN_DEGREES_PER_PX)) || 0,
  pitch: y * TILT_DEGREES_PER_PX || 0,
});

const newWheel = (init) => new WheelEvent("wheel", init);
const newMouse = (type, init) => new MouseEvent(type, init);

const pointerInit = (event) => ({
  bubbles: true,
  cancelable: true,
  clientX: event.clientX,
  clientY: event.clientY,
  screenX: event.screenX,
  screenY: event.screenY,
  ctrlKey: event.ctrlKey,
  shiftKey: event.shiftKey,
  altKey: event.altKey,
  metaKey: event.metaKey,
  button: event.button,
  buttons: event.buttons,
});

// Sorts the map's wheel events (above) until the returned function is called.
// `still()` is the Reduce motion switch in force (mapSettings.js
// reduceMotionEnabled): with it on, each step of a turn is taken at once, not
// eased. The rest of the options are for the tests.
export const attachMapGestures = (map, {
  still = () => false,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  setTimer = (run, ms) => setTimeout(run, ms),
  clearTimer = (id) => clearTimeout(id),
  makeWheel = newWheel,
} = {}) => {
  const container = map?.getCanvasContainer?.();
  if (!container?.addEventListener) return () => {};
  const sorter = createWheelSorter();
  let held = null;
  let timer = 0;
  let goal = null;

  // A mouse wheel's scroll of x, y px, about where `event` happened, to
  // MapLibre's zoom. Shift turns a mouse wheel's scroll sideways in some
  // browsers (deltaX, no deltaY): it still zooms, by whichever way it came.
  const zoom = (event, x, y) => {
    const by = event?.shiftKey && Math.abs(x) > Math.abs(y) ? x : y;
    const copy = makeWheel({ ...pointerInit(event), deltaX: 0, deltaY: asMouseWheel(by), deltaZ: 0, deltaMode: 0 });
    SORTED.add(copy);
    map.getCanvas().dispatchEvent(copy);
  };

  const turn = (x, y) => {
    const step = trackpadTurn({ x, y });
    if (!step.bearing && !step.pitch) return;
    // Carrying on from the goal of a step still easing, or else from where the
    // map is. Any moveend lets the goal go: the turn's ease ran its course, or a
    // drag, a jump or another camera move stopped it (MapLibre ends a move it
    // interrupts, except one ease by another of the same easeId). Read from the
    // map mid-ease instead, a step would lose what the last had still to turn.
    if (!(goal && map.isEasing?.())) {
      goal = { bearing: map.getBearing(), pitch: map.getPitch(), still: Boolean(still()) };
    }
    goal.bearing += step.bearing;
    goal.pitch = Math.max(map.getMinPitch(), Math.min(map.getMaxPitch(), goal.pitch + step.pitch));
    // essential: MapLibre would cut the ease to nothing when the system asks
    // for reduced motion, and every step would then start and end a move of
    // its own. Reduce motion is answered by the easing instead (still).
    map.easeTo({
      bearing: goal.bearing,
      pitch: goal.pitch,
      duration: TURN_EASE_MS,
      easing: goal.still ? atOnce : easeOut,
      easeId: TURN_EASE_ID,
      essential: true,
    });
  };

  const letGo = () => {
    if (timer) clearTimer(timer);
    timer = 0;
    held = null;
  };
  const expire = () => {
    timer = 0;
    const late = sorter.expire();
    const event = held;
    held = null;
    if (!late || !event || map._removed) return;
    try {
      zoom(event, late.x, late.y);
    } catch {
      // That one notch is lost; the next is sorted afresh.
    }
  };

  const onWheel = (event) => {
    if (SORTED.has(event)) return;
    if (event.ctrlKey) return;
    // Off with MapLibre's own: a map that cannot be turned by a drag, or does
    // not zoom on the wheel, is left to do what it does with a wheel event.
    if (!map.scrollZoom?.isEnabled?.() || !map.dragRotate?.isEnabled?.()) return;
    try {
      const time = now();
      const late = sorter.expire(time);
      if (late && held) {
        const notch = held;
        letGo();
        zoom(notch, late.x, late.y);
      }
      const act = sorter.sort(wheelPixels(event), time);
      if (act.verdict === "wait") {
        letGo();
        held = event;
        timer = setTimer(expire, LONE_EVENT_MS);
      } else {
        letGo();
        // Without Shift a trackpad's scroll is MapLibre's to zoom, at its own
        // trackpad rate: this step goes on to it untouched (a held first step
        // it settles is a few pixels, and is let go).
        if (act.verdict === "trackpad" && !event.shiftKey) return;
        if (act.verdict === "trackpad") turn(act.x, act.y);
        else zoom(event, act.x, act.y);
      }
    } catch {
      // MapLibre has this one: it zooms on it, as before.
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const moved = () => {
    goal = null;
  };

  container.addEventListener("wheel", onWheel, { capture: true, passive: false });
  map.on?.("moveend", moved);
  return () => {
    container.removeEventListener("wheel", onWheel, { capture: true });
    map.off?.("moveend", moved);
    letGo();
  };
};

// The War Room's sheet lies over the map while a tool is in hand and takes the
// pointer (WarRoomTools.jsx). Its wheel events and right-button presses are
// handed to the map under it as copies, so the map's controls go on working
// there: the wheel zooms, or turns and tilts, as anywhere on the map, and a
// right-button drag turns and tilts it. (The drag's moves need no copies:
// MapLibre follows them on the document.) False when nothing could be handed on.
export const passToMap = (map, event, { makeWheel = newWheel, makeMouse = newMouse } = {}) => {
  try {
    const canvas = map?.getCanvas?.();
    if (!canvas?.dispatchEvent || !event) return false;
    const init = pointerInit(event);
    const copy = event.type === "wheel"
      ? makeWheel({ ...init, deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode })
      : makeMouse(event.type, init);
    canvas.dispatchEvent(copy);
    return true;
  } catch {
    return false;
  }
};
