/*! Open Historia — the card that moves a player to the app's new id © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the handover build shows over the game at every launch (appMove.js has
// the why): install the new app, then move the games to it. And what the new
// app says once, after games arrived. Plain DOM, drawn by web/index.js as the
// game starts, so its text is looked up in the player's shipped pack the way the
// boot screen's is (bootTexts.js).

import { bootTranslate, bootTranslated } from "../web/bootTexts.js";
import { canInstallUpdates, cancelUpdateDownload, installUpdate } from "./appInstaller.js";
import { appMoveInfo, gamesWereMoved, moveGamesToApp, openApp } from "./appMove.js";

// Every word the card and the notice say; the string catalog reads this table.
export const APP_MOVE_TEXTS = Object.freeze({
  title: "Open Historia has a new app",
  intro: "This app gets no more updates. Install the new one, then move your games and settings to it. Nothing here is deleted.",
  install: "Install the new app",
  downloading: "Downloading the new app…",
  installFailed: "The new app could not be downloaded. Check your connection and try again.",
  other: "Another copy of the new app is on this phone, signed by someone else. Uninstall it, then install the new app from here.",
  ready: "The new app is installed. Move your games and settings to it. Nothing here is deleted.",
  move: "Move my games",
  moving: "Moving your games…",
  moveFailed: "The games could not be moved. Try again.",
  moved: "Your games are in the new app. Once you have checked them there, you can uninstall this one.",
  open: "Open the new app",
  moveAgain: "Move again",
  later: "Not now",
  close: "Close",
  arrived: "Your games and settings from the old app are here.",
  arriveFailed: "The games from the old app could not be read. Move them again from the old app.",
});

const say = (key) => bootTranslate(APP_MOVE_TEXTS[key]);

// The new app's APK when its feed cannot be read: the release's contractual
// asset names (android-apk.yml, android-apk-beta.yml).
const RELEASES = "https://github.com/Open-Historia/open-historia/releases/download";
export const fallbackAppApk = (track) => (track === "beta"
  ? `${RELEASES}/android-beta/open-historia-beta.apk`
  : `${RELEASES}/android/open-historia.apk`);

// The new app's APK, from its own feed (web/router.js `of=app`).
export const newAppApk = async (track, fetcher = fetch) => {
  try {
    const response = await fetcher(`/api/app-update?track=${encodeURIComponent(track)}&of=app`, { cache: "no-store" });
    const feed = response.ok ? await response.json() : null;
    if (typeof feed?.apk === "string" && /^https:\/\//.test(feed.apk)) return feed.apk;
  } catch { /* the release's own name, below */ }
  return fallbackAppApk(track);
};

const CARD_ID = "oh-app-move";
const css = `
#${CARD_ID}{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:20px;
  background:rgba(9,9,11,.82);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
#${CARD_ID} *{box-sizing:border-box}
#${CARD_ID} .oh-am-box{width:100%;max-width:440px;background:#1d1d20;color:#f6f6f7;border:1px solid rgba(240,240,242,.29);
  border-radius:12px;padding:20px;box-shadow:0 .75rem 2rem rgba(0,0,0,.5)}
#${CARD_ID} h2{margin:0 0 10px;font-size:1.1rem;font-weight:700}
#${CARD_ID} p{margin:0 0 6px;font-size:.92rem;line-height:1.5;color:rgba(246,246,247,.78)}
#${CARD_ID} .oh-am-bar{height:4px;border-radius:2px;background:rgba(246,246,247,.14);overflow:hidden;margin:12px 0 4px}
#${CARD_ID} .oh-am-bar i{display:block;height:100%;width:0;background:#2bc1f3;transition:width .2s}
#${CARD_ID} .oh-am-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
#${CARD_ID} button{flex:1 1 140px;min-height:44px;border-radius:9px;border:1px solid rgba(240,240,242,.29);background:transparent;
  color:#f6f6f7;font:inherit;font-size:.9rem;font-weight:700;cursor:pointer;padding:10px 14px}
#${CARD_ID} button.oh-am-main{background:#2bc1f3;border-color:#2bc1f3;color:#0b1418}
#${CARD_ID} button:disabled{opacity:.5;cursor:default}
`;

const make = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const kid of kids) if (kid != null) node.append(kid);
  return node;
};

// The card's screen for where the player is: "install", "other", "ready",
// "moved", "downloading" or "moving".
export const cardStage = (info, moved) => {
  if (info?.target === "other") return "other";
  if (info?.target !== "same") return "install";
  return moved ? "moved" : "ready";
};

// The handover build's card. Resolves at once; the card stays until it is
// closed, and comes back at the next launch.
export const showHandoverCard = ({ db, track = "stable", storage = localStorage } = {}) => {
  if (typeof document === "undefined" || document.getElementById(CARD_ID)) return;
  const style = make("style", { textContent: css });
  const root = make("div", { id: CARD_ID });
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  if (bootTranslated()) root.setAttribute("data-no-translate", "");
  const box = make("div", { className: "oh-am-box" });
  root.append(box);
  document.head.append(style);
  document.body.append(root);

  let busy = false;
  let cancelled = false;
  let error = "";
  const close = () => {
    document.removeEventListener("visibilitychange", onVisible);
    root.remove();
    style.remove();
  };
  const button = (key, onClick, main = false) => {
    const node = make("button", { type: "button", className: main ? "oh-am-main" : "", textContent: say(key) });
    node.addEventListener("click", onClick);
    return node;
  };

  const draw = (stage, progress = null) => {
    const bar = progress == null ? null : make("div", { className: "oh-am-bar" }, make("i"));
    const text = { install: "intro", other: "other", ready: "ready", moved: "moved", downloading: "downloading", moving: "moving" }[stage];
    const acts = make("div", { className: "oh-am-acts" });
    if (stage === "install") acts.append(button("install", install, true), button("later", close));
    if (stage === "downloading") acts.append(button("later", () => { cancelled = true; cancelUpdateDownload(); }));
    if (stage === "other") acts.append(button("close", close));
    if (stage === "ready") acts.append(button("move", move, true), button("later", close));
    if (stage === "moved") acts.append(button("open", () => { openApp().catch(() => {}); }, true), button("moveAgain", move), button("close", close));
    const errorLine = error ? make("p", { textContent: say(error) }) : null;
    if (errorLine) errorLine.style.color = "#f3a32b";
    box.replaceChildren(...[make("h2", { textContent: say("title") }), make("p", { textContent: say(text) }), errorLine, bar, acts].filter(Boolean));
    if (bar) bar.firstChild.style.width = `${Math.round(progress * 100)}%`;
  };

  const refresh = async () => {
    if (busy) return;
    const info = await appMoveInfo(true);
    if (!info?.moveTo) { close(); return; }
    draw(cardStage(info, gamesWereMoved(storage)));
  };

  // Android's installer is its own screen: back from it, ask again.
  const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
  document.addEventListener("visibilitychange", onVisible);

  async function install() {
    if (busy) return;
    if (!canInstallUpdates()) { error = "installFailed"; refresh(); return; }
    busy = true;
    cancelled = false;
    error = "";
    draw("downloading", 0);
    try {
      // build 0: never the update this app may have kept for itself.
      await installUpdate(await newAppApk(track), { build: 0, onProgress: (percent) => draw("downloading", percent / 100) });
    } catch {
      error = cancelled ? "" : "installFailed";
    }
    busy = false;
    refresh();
  }

  async function move() {
    if (busy) return;
    busy = true;
    error = "";
    draw("moving", 0);
    try {
      await moveGamesToApp({ db, storage, onProgress: (share) => draw("moving", share) });
    } catch (failure) {
      console.warn("The games were not moved to the new app:", failure);
      error = "moveFailed";
    }
    busy = false;
    refresh();
  }

  refresh();
};

// The new app, once, after games arrived (appMove.js takeMoveNotice).
export const showArrivalNotice = (notice) => {
  if (!notice || typeof document === "undefined" || !document.body) return;
  const note = make("div", { textContent: say(notice === "failed" ? "arriveFailed" : "arrived") });
  note.setAttribute("role", "status");
  if (bootTranslated()) note.setAttribute("data-no-translate", "");
  Object.assign(note.style, {
    position: "fixed", left: "50%", top: "calc(env(safe-area-inset-top, 0px) + 1rem)", transform: "translateX(-50%)", zIndex: "2147483000",
    maxWidth: "min(32rem, calc(100vw - 2rem))", padding: "0.75rem 1rem", borderRadius: "12px",
    background: "#1d1d20", color: "#f6f6f7", border: "1px solid rgba(240,240,242,0.29)",
    font: "400 0.9rem/1.45 system-ui, 'Segoe UI', sans-serif", boxShadow: "0 0.75rem 2rem rgba(0,0,0,0.5)",
  });
  note.addEventListener("click", () => note.remove());
  document.body.append(note);
  setTimeout(() => note.remove(), 12000);
};
