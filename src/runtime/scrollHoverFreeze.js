/*! Open Historia — hover held still while a list scrolls © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "while scrolling, sometimes some ui elements trail behind for some reason creating a really wierd effect" (the
// owner, 2026-11-05). A wheel scroll moves a list under a cursor that stays where it is, so every row and button
// that passes under it took its hover look and eased back out of it (styles.css gives controls a 160 ms
// transition): a smear of half-lit rows following the scroll. While an element scrolls, and for a moment after,
// what is inside it takes no pointer (styles.css [data-oh-scrolling]); the element itself still does, so the wheel
// keeps scrolling it. Only a scroll the wheel (or a trackpad) just made counts: a list that scrolls itself, as the
// Advisor and the chats do while an answer streams in, keeps taking clicks.

export const SCROLL_SETTLE_MS = 150;
export const WHEEL_RECENT_MS = 250;
export const SCROLLING_ATTRIBUTE = "data-oh-scrolling";

// The listeners, on their own for the tests: a scroll that follows a wheel within WHEEL_RECENT_MS marks what scrolled,
// and the mark goes once it has been still for SCROLL_SETTLE_MS. `timers` stands in for setTimeout/clearTimeout, `now`
// for the clock.
export const createScrollHoverFreeze = ({ settleMs = SCROLL_SETTLE_MS, timers = globalThis, now = () => Date.now() } = {}) => {
  const pending = new Map();
  let wheelAt = -Infinity;
  const onWheel = () => { wheelAt = now(); };
  const onScroll = (event) => {
    const target = event?.target;
    // The page itself scrolling (document) has no attribute to carry; its rows are the window's.
    const element = target?.nodeType === 1 ? target : target?.scrollingElement ?? null;
    if (!element?.setAttribute) return;
    // A glide the wheel started goes on after its last wheel event: it stays marked while it moves.
    if (now() - wheelAt > WHEEL_RECENT_MS && !pending.has(element)) return;
    if (pending.has(element)) timers.clearTimeout(pending.get(element));
    else element.setAttribute(SCROLLING_ATTRIBUTE, "");
    pending.set(element, timers.setTimeout(() => {
      pending.delete(element);
      element.removeAttribute(SCROLLING_ATTRIBUTE);
    }, settleMs));
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
