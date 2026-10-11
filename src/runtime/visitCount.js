/*! Open Historia — counting who plays, and in which application © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The website's pages carry Umami's tag as it is given out (a cookieless visit
// counter). The game loads it here instead, so that each load says WHICH
// application it is: "make it track the application so how many people are
// playing in the main, and beta apps individually." In Umami that is the Tag
// filter.
//
// The page cannot tell by itself. The stable desktop app, the beta and the
// multiplayer build serve the same files from the same localhost address, and so
// does the server somebody starts from the zip; only the server knows which it is
// inside (server/appKind.js, GET /api/app-kind).
//
// What is not counted:
//   * the Android app. It loads no analytics (docs/mobile.md): main.jsx does not
//     call this there, so its build carries none of it.
//   * a development run.
//   * a page that is not this computer's own: a phone playing over the local
//     network, or a server somebody hosts at an address of their own. The address
//     would go to Umami with the count, and it is theirs.
//
// In the applications the page's query and fragment are left out of what is sent.
//
// WHO IS PLAYING NOW. "Umami says there are 15 active users right now. However
// the website says there are 35 people connected to the node." Umami calls a
// visitor active who sent it something in the last five minutes, and the game
// sent it one thing: the visit, when the page loaded. Somebody playing for an
// hour was active for the first five minutes of it. So while the game is on
// screen it says so again every VISIT_BEAT_MS, as an event named
// VISIT_BEAT_EVENT, under the same tag. Not while the page is hidden: a tab
// left open behind others is nobody playing (the node counts those, which is
// one reason its figure stays the higher; visitors whose browser blocks the
// counter are the other).
//
// Each of these is an event on the Umami plan's monthly count: fifteen for an
// hour of play at four minutes. The interval is the one figure to change.

export const VISIT_SCRIPT_URL = "https://cloud.umami.is/script.js";
export const VISIT_WEBSITE_ID = "452a6cce-d389-4c2d-bc09-e221194c93a2";
// Inside Umami's five minutes, with room for a timer that fires late.
export const VISIT_BEAT_MS = 4 * 60 * 1000;
export const VISIT_BEAT_EVENT = "playing";

export const VISIT_TAGS = Object.freeze({
  website: "website",
  stable: "desktop-main",
  beta: "desktop-beta",
  multiplayer: "desktop-multiplayer",
  local: "self-hosted",
});

// The desktop builds, by the channel electron/channel.cjs reads.
const DESKTOP_TAGS = Object.freeze({ stable: VISIT_TAGS.stable, beta: VISIT_TAGS.beta, multiplayer: VISIT_TAGS.multiplayer });

const isThisComputer =(hostname) => /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i.test(String(hostname ?? "").trim());

// Whether this build has to ask its server which application it is.
export const visitNeedsKind = (env = {}, hostname = "") =>
  !env.VITE_OH_NATIVE && !env.DEV && !env.VITE_OH_WEB && isThisComputer(hostname);

// The tag a load is counted under, or "" when it is not counted.
// `kind`: the reply of GET /api/app-kind, { app: "desktop", channel } | { app: "local" }.
export const visitTagOf = ({ env = {}, kind = null, hostname = "" } = {}) => {
  // Checked first: the Android build is a web build too (VITE_OH_WEB is set).
  if (env.VITE_OH_NATIVE || env.DEV) return "";
  if (env.VITE_OH_WEB) return VISIT_TAGS.website;
  if (!isThisComputer(hostname)) return "";
  if (kind?.app === "desktop") return DESKTOP_TAGS[kind.channel] ?? VISIT_TAGS.stable;
  if (kind?.app === "local") return VISIT_TAGS.local;
  return "";
};

// The tag's attributes, as Umami's script reads them from its own element.
export const visitScriptAttributes = (tag) => ({
  src: VISIT_SCRIPT_URL,
  "data-website-id": VISIT_WEBSITE_ID,
  "data-tag": tag,
  ...(tag === VISIT_TAGS.website ? {} : { "data-exclude-search": "true", "data-exclude-hash": "true" }),
});

const askKind = async (fetchImpl) => {
  try {
    const response = await fetchImpl("/api/app-kind", { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
};

// Says the game is still being played, every `every` ms while its page is on
// screen, and once on coming back to a page that was hidden longer than that.
// The first is said one interval after the visit itself, which the counter
// sends when it loads. Returns a function that stops it; null where there is
// no page to watch. A counter that never loaded (offline, blocked) has no
// `umami` to tell, and nothing is sent.
export const startVisitBeat = ({ doc = null, win = null, every = VISIT_BEAT_MS, now = () => Date.now() } = {}) => {
  if (!doc || !win || typeof win.setInterval !== "function") return null;
  let last = now();
  const beat = () => {
    if (doc.visibilityState === "hidden" || now() - last < every) return;
    const track = win.umami?.track;
    if (typeof track !== "function") return;
    last = now();
    try {
      track.call(win.umami, VISIT_BEAT_EVENT);
    } catch {
      /* the counter is nothing the game depends on */
    }
  };
  // (Asked a little more often than it is said, so that a timer the browser held back does not skip a turn.)
  const timer = win.setInterval(beat, Math.max(1000, Math.round(every / 4)));
  doc.addEventListener?.("visibilitychange", beat);
  return () => {
    win.clearInterval?.(timer);
    doc.removeEventListener?.("visibilitychange", beat);
  };
};

// Adds the counter to the page, once. Returns the tag it was counted under ("" for none).
// Never throws, and a counter that cannot be loaded (offline, blocked) is nothing at all.
export const countVisit = async ({
  env = {},
  doc = typeof document === "undefined" ? null : document,
  win = typeof window === "undefined" ? null : window,
  hostname = win?.location?.hostname ?? "",
  fetchImpl = typeof fetch === "undefined" ? null : (...args) => fetch(...args),
} = {}) => {
  try {
    if (!doc?.head || doc.querySelector?.("script[data-website-id]")) return "";
    const kind = visitNeedsKind(env, hostname) && fetchImpl ? await askKind(fetchImpl) : null;
    const tag = visitTagOf({ env, kind, hostname });
    if (!tag) return "";
    const script = doc.createElement("script");
    script.defer = true;
    for (const [name, value] of Object.entries(visitScriptAttributes(tag))) script.setAttribute(name, value);
    script.onerror = () => script.remove?.();
    doc.head.appendChild(script);
    startVisitBeat({ doc, win });
    return tag;
  } catch {
    return "";
  }
};
