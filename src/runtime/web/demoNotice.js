/*! Open Historia — the website's demo notice © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the website shows over the game when it opens: this is a demo, the
// desktop app is the way to play, and the browser version lags. Web build
// only, never in the local download or the Android app. The site's own Play
// the demo button leads here, so there is no entry screen in front of it any
// more: the notice comes up over the already-mounted game, and dismissing it
// is the way in.

// Cinzel + EB Garamond from the bundle, as the loading screen has them
// (StartupScreen.jsx): no Google Fonts stylesheet, which would tell Google
// about every visit before the visitor had pressed anything.
import "../../assets/fonts/fonts.css";
import { isNativeApp } from "./nativeBoot.js";
import { bootText, bootTranslated } from "./bootTexts.js";

// Scoped under .oh-demo-modal so nothing leaks into the game.
const css = `
.oh-demo-modal{
  --marble:#1a1a1f;--marble2:#212128;--ink:#ece4d2;--sepia:#a4987f;--line2:rgba(233,220,192,.26);--bronze:#c9932f;--gold-l:#dcb954;
  --serif:'EB Garamond',Georgia,'Times New Roman',serif;--display:'Cinzel',Georgia,'Times New Roman',serif;
  position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;
  background:rgba(9,9,11,.88);backdrop-filter:blur(4px);font-family:var(--serif);-webkit-font-smoothing:antialiased}
.oh-demo-modal *{box-sizing:border-box}
.oh-demo-box{max-width:520px;width:100%;background:var(--marble);border:1px solid var(--line2);border-top:4px solid var(--bronze);border-radius:12px;padding:24px 24px 20px;box-shadow:0 18px 42px -22px rgba(0,0,0,.8);text-align:left}
.oh-demo-h{color:var(--ink);font-size:1.28rem;font-weight:700;margin:0 0 10px;font-family:var(--display);letter-spacing:.02em}
.oh-demo-p{color:var(--sepia);font-size:.95rem;line-height:1.55;margin:0 0 11px}
.oh-demo-acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.oh-demo-btn{flex:1 1 190px;display:flex;align-items:center;justify-content:center;text-align:center;text-decoration:none;font-family:var(--display);font-size:.9rem;letter-spacing:.06em;text-transform:uppercase;font-weight:700;
  cursor:pointer;border-radius:11px;padding:14px 20px;border:1px solid transparent;transition:transform .12s ease,background .2s}
.oh-demo-btn:hover{transform:translateY(-2px)}
.oh-demo-btn:focus-visible{outline:2px solid var(--gold-l);outline-offset:3px}
.oh-demo-btn.ghost{background:var(--marble);border-color:var(--line2);color:var(--ink)}
.oh-demo-btn.ghost:hover{background:var(--marble2)}
.oh-demo-btn.primary{background:#892333;color:#f7eccf;border-color:rgba(255,222,160,.4);box-shadow:0 12px 30px -12px rgba(0,0,0,.85);font-size:1rem}
.oh-demo-btn.primary:hover{background:#962839}
`;

const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); for (const k of kids) if (k != null) n.append(k); return n; };

// Remembered for the tab session, so a reload does not ask again.
const DEMO_ACK_KEY = "oh:demo-ack";

const demoAcknowledged = () => {
  try { return sessionStorage.getItem(DEMO_ACK_KEY) === "1"; } catch { return false; }
};

// The Android app is this same bundle packaged with Capacitor: the app IS the
// real thing, keeps its own games and its own copy of the map, and has no
// desktop app to send its player to, so it never shows this.
export const shouldShowDemoNotice = () => !isNativeApp() && !demoAcknowledged();

export const showDemoNotice = () => {
  if (typeof document === "undefined" || !shouldShowDemoNotice() || document.getElementById("oh-demo-root")) return;
  document.head.append(el("style", { textContent: css }));

  const close = () => {
    try { sessionStorage.setItem(DEMO_ACK_KEY, "1"); } catch { /* private mode */ }
    document.removeEventListener("keydown", onKey);
    modal.remove();
  };
  // Esc continues rather than cancelling: there is nothing to cancel, and a
  // dialog that traps someone who pressed Esc is worse than one that lets go.
  const onKey = (event) => { if (event.key === "Escape") close(); };

  const go = el("button", { className: "oh-demo-btn primary", type: "button", textContent: bootText("demoPlay"), onclick: close });
  const modal = el("div", { className: "oh-demo-modal", id: "oh-demo-root" },
    el("div", { className: "oh-demo-box" },
      el("h2", { className: "oh-demo-h", id: "oh-demo-h", textContent: bootText("demoTitle") }),
      // Whole sentences, each looked up whole: no emphasis inside them.
      el("p", { className: "oh-demo-p", textContent: bootText("demoDesktop") }),
      el("p", { className: "oh-demo-p", textContent: bootText("demoLag") }),
      el("p", { className: "oh-demo-p", textContent: bootText("demoSaved") }),
      el("div", { className: "oh-demo-acts" },
        el("a", { className: "oh-demo-btn ghost", href: "https://github.com/Open-Historia/open-historia/releases/tag/desktop-stable", target: "_blank", rel: "noopener", textContent: bootText("demoGetApp") }),
        go,
      ),
    ),
  );
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "oh-demo-h");
  // Already in the player's language (index.js loaded the pack before this).
  if (bootTranslated()) modal.setAttribute("data-no-translate", "");
  document.addEventListener("keydown", onKey);
  document.body.append(modal); // up at once: the game mounts behind it
  go.focus();
};
