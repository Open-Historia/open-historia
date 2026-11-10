/*! Open Historia — counting who plays, and in which application © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The visit counters (Google Analytics and Umami) are loaded by one file,
// public/consent.js, and only after the player has said yes to being counted.
// The website's own pages carry that file as a tag. The game adds it here
// instead, so that each load says WHICH application it is: "make it track the
// application so how many people are playing in the main, and beta apps
// individually." In Umami that is the Tag filter.
//
// The page cannot tell by itself. The stable desktop app and the beta serve
// the same files from the same localhost address, and so does the server somebody starts from the zip; only the server knows which it is
// inside (server/appKind.js, GET /api/app-kind).
//
// What is not counted, and so is never asked either:
//   * the Android app. It loads no analytics (docs/mobile.md): main.jsx does not
//     call this there, so its build carries none of it.
//   * a development run.
//   * a page that is not this computer's own: a phone playing over the local
//     network, or a server somebody hosts at an address of their own. The address
//     would go to the counters with the count, and it is theirs.
//   * a server started with OH_VISIT_COUNT=0.
//
// In the applications the page's query and fragment are left out of what is sent
// (consent.js does that for every tag but the website's).

// The file that asks and then loads the counters, beside the page.
export const VISIT_GATE_FILE = "consent.js";
// How a page knows the gate is already on it.
export const VISIT_GATE_MARK = "data-oh-consent";
// Where the gate's "Privacy policy" link goes: the page every build serves at its root.
export const VISIT_PRIVACY_URL = "/privacy/";

export const VISIT_TAGS = Object.freeze({
  website: "website",
  stable: "desktop-main",
  beta: "desktop-beta",
  local: "self-hosted",
});

// What the gate says. It is drawn by consent.js, which holds the same words for
// the pages that are not the game; they are written here so that the language
// packs carry them (visitCount.test.js keeps the two alike).
export const VISIT_CONSENT_LABELS = Object.freeze({
  title: "Count your visit?",
  what: "Open Historia would like to count visits with Google Analytics and Umami, to see how many people play and which version they use.",
  how: "Google Analytics sets cookies. Nothing is loaded unless you say yes, and you can change your answer at any time.",
  no: "No, thanks",
  yes: "Yes, count my visits",
  policy: "Privacy policy",
});

// The desktop builds, by the channel electron/channel.cjs reads.
const DESKTOP_TAGS = Object.freeze({ stable: VISIT_TAGS.stable, beta: VISIT_TAGS.beta });

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

// The gate's own tag, as consent.js reads it from its element. `base` is where
// the build is served from ("/" in the applications, "/play/" on the website).
export const visitGateAttributes = (tag, base = "/") => ({
  src: `${String(base || "/").replace(/\/*$/, "/")}${VISIT_GATE_FILE}`,
  [VISIT_GATE_MARK]: "",
  "data-tag": tag,
  "data-privacy": VISIT_PRIVACY_URL,
});

const askKind = async (fetchImpl) => {
  try {
    const response = await fetchImpl("/api/app-kind", { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
};

// Adds the gate to the page, once. It asks the player, and loads the counters
// only on a yes. Returns the tag a yes is counted under ("" where nothing is
// counted, and then nothing is added and nobody is asked).
// Never throws, and a gate that cannot be loaded is nothing at all.
export const countVisit = async ({
  env = {},
  doc = typeof document === "undefined" ? null : document,
  hostname = typeof window === "undefined" ? "" : window.location.hostname,
  fetchImpl = typeof fetch === "undefined" ? null : (...args) => fetch(...args),
} = {}) => {
  try {
    if (!doc?.head || doc.querySelector?.(`script[${VISIT_GATE_MARK}]`)) return "";
    const kind = visitNeedsKind(env, hostname) && fetchImpl ? await askKind(fetchImpl) : null;
    const tag = visitTagOf({ env, kind, hostname });
    if (!tag) return "";
    const script = doc.createElement("script");
    script.defer = true;
    for (const [name, value] of Object.entries(visitGateAttributes(tag, env.BASE_URL))) script.setAttribute(name, value);
    script.onerror = () => script.remove?.();
    doc.head.appendChild(script);
    return tag;
  } catch {
    return "";
  }
};
