/*! Open Historia — hover held still while a list scrolls © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "while scrolling, sometimes some ui elements trail behind for some reason creating a really wierd effect" (the
// owner, 2026-11-05). A wheel scroll moves a list under a cursor that stays where it is, so every row and button
// that passes under it took its hover look and eased back out of it (styles.css gives controls a 160 ms
// transition): a smear of half-lit rows following the scroll. While an element scrolls, and for a moment after,
// what is inside it takes no pointer (styles.css [data-oh-scrolling]); the element itself still does, so the wheel
// keeps scrolling it. Only a scroll the wheel (or a trackpad) just made over that element counts: a list that
// scrolls itself, as the Advisor and the chats do while an answer streams in, keeps taking clicks, and so does one
// that scrolls while the wheel turns somewhere else (the map).
//
// Three limits keep the freeze from outliving the wheel:
// - an element is marked only when the wheel's target is inside it (the wheel over the map marks no chat);
// - a glide the wheel started keeps its mark only for GLIDE_MAX_MS after the last wheel over it, so a log the
//   Advisor keeps scrolling as it streams lets go soon after the player stops wheeling it;
// - the scrollers nested inside a marked one keep taking the wheel (styles.css [data-oh-scroll-inner]): with
//   everything inside blocked, the wheel would land on the outer panel and scroll it instead of the inner list
//   under the cursor. Their own rows still take no hover.

export const SCROLL_SETTLE_MS = 150;
export const WHEEL_RECENT_MS = 250;
export const GLIDE_MAX_MS = 1500;
export const SCROLLING_ATTRIBUTE = "data-oh-scrolling";
export const INNER_SCROLLER_ATTRIBUTE = "data-oh-scroll-inner";
export const INNER_SCAN_LIMIT = 4000;

const SCROLLABLE_OVERFLOW = /(auto|scroll|overlay)/;

// The elements inside `element` that scroll on their own (overflow auto/scroll with more content than room). A
// bounded walk, run once when an element is first marked, before the mark is set (so it forces no extra style pass).
export const innerScrollersOf = (element, { limit = INNER_SCAN_LIMIT, view = globalThis } = {}) => {
  const found = [];
  const all = element?.getElementsByTagName?.("*");
  if (!all || typeof view?.getComputedStyle !== "function") return found;
  const count = Math.min(all.length, limit);
  for (let i = 0; i < count; i += 1) {
    const inner = all[i];
    const tall = inner.scrollHeight > inner.clientHeight + 1;
    const wide = inner.scrollWidth > inner.clientWidth + 1;
    if (!tall && !wide) continue;
    const style = view.getComputedStyle(inner);
    if ((tall && SCROLLABLE_OVERFLOW.test(style.overflowY)) || (wide && SCROLLABLE_OVERFLOW.test(style.overflowX))) found.push(inner);
  }
  return found;
};

const holds = (element, target) => {
  if (!target || typeof element?.contains !== "function") return false;
  try { return element.contains(target); } catch { return false; }
};

// The listeners, on their own for the tests: a scroll that follows a wheel over the scrolling element within
// WHEEL_RECENT_MS marks it; it stays marked while it keeps moving, up to GLIDE_MAX_MS after the last wheel over it,
// and the mark goes once it has been still for SCROLL_SETTLE_MS. `timers` stands in for setTimeout/clearTimeout,
// `now` for the clock, `innerScrollers` for the DOM walk above.
export const createScrollHoverFreeze = ({
  settleMs = SCROLL_SETTLE_MS,
  glideMaxMs = GLIDE_MAX_MS,
  timers = globalThis,
  now = () => Date.now(),
  innerScrollers = innerScrollersOf,
} = {}) => {
  // element -> { timer, wheelAt (the last wheel over it), inner (its nested scrollers, kept wheelable) }
  const pending = new Map();
  // nested scroller -> how many marked elements hold it open
  const innerHolds = new Map();
  let wheelAt = -Infinity;
  let wheelTarget = null;
  const onWheel = (event) => {
    wheelAt = now();
    wheelTarget = event?.target ?? null;
  };
  const release = (element, entry) => {
    pending.delete(element);
    element.removeAttribute(SCROLLING_ATTRIBUTE);
    for (const inner of entry.inner) {
      const left = (innerHolds.get(inner) ?? 1) - 1;
      if (left > 0) innerHolds.set(inner, left);
      else { innerHolds.delete(inner); inner.removeAttribute?.(INNER_SCROLLER_ATTRIBUTE); }
    }
  };
  const onScroll = (event) => {
    const target = event?.target;
    // The page itself scrolling (document) has no attribute to carry; its rows are the window's.
    const element = target?.nodeType === 1 ? target : target?.scrollingElement ?? null;
    if (!element?.setAttribute) return;
    const at = now();
    const wheeledHere = at - wheelAt <= WHEEL_RECENT_MS && holds(element, wheelTarget);
    let entry = pending.get(element);
    if (!entry) {
      if (!wheeledHere) return;
      let inner = [];
      try { inner = [...(innerScrollers(element) ?? [])].filter((one) => one !== element); } catch { inner = []; }
      entry = { timer: null, wheelAt, inner };
      for (const one of inner) {
        innerHolds.set(one, (innerHolds.get(one) ?? 0) + 1);
        one.setAttribute?.(INNER_SCROLLER_ATTRIBUTE, "");
      }
      element.setAttribute(SCROLLING_ATTRIBUTE, "");
      pending.set(element, entry);
    } else if (wheeledHere) {
      entry.wheelAt = wheelAt;
    } else if (at - entry.wheelAt >= glideMaxMs) {
      // Still moving long after the wheel left it: something else scrolls it now. Let the mark run out.
      return;
    }
    // A glide the wheel started goes on after its last wheel event: it stays marked while it moves.
    if (entry.timer != null) timers.clearTimeout(entry.timer);
    const settled = entry;
    entry.timer = timers.setTimeout(() => {
      if (pending.get(element) === settled) release(element, settled);
    }, settleMs);
  };
  return { onScroll, onWheel };
};

// Once, at start: a scroll anywhere in the page (scroll does not bubble, so heard on the way down).
export const installScrollHoverFreeze = (root = globalThis.document) => {
  if (!root?.addEventListener) return () => {};
  const { onScroll, onWheel } = createScrollHoverFreeze();
  root.addEventListener("wheel", onWheel, { capture: true, passive: true });
  root.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    root.removeEventListener("wheel", onWheel, { capture: true });
    root.removeEventListener("scroll", onScroll, { capture: true });
  };
};
