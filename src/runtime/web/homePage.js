/*! Open Historia — web-mode home / landing page © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The website's entry screen: it automatically connects the player to the best
// available content node (lowest latency + free capacity), lets them sign in
// (magic link), and enters the game. Injected as a full-screen overlay over the
// (already-mounted) game — web build only, never in the local download.

import { connectBestNode } from "./nodeConnect.js";
import { isSignedIn, getEmail, signOut, signInWithGoogle, googleClientId } from "./account.js";
import { accountConfigured } from "./account.js";

const ENTERED_KEY = "oh:entered";

const css = `
.oh-home{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(1200px 600px at 50% -10%,rgba(124,58,237,.25),transparent),#0b0e16;
  font:15px/1.5 system-ui,sans-serif;color:#e6e8ee;padding:20px;overflow:auto}
.oh-home-card{width:100%;max-width:440px;background:rgba(23,26,34,.82);border:1px solid #262b36;border-radius:18px;
  padding:30px 28px;box-shadow:0 30px 90px rgba(0,0,0,.55);backdrop-filter:blur(8px)}
.oh-home-logo{font-size:26px;font-weight:800;letter-spacing:-.01em;margin:0 0 2px}
.oh-home-tag{color:#9aa2b1;margin:0 0 20px;font-size:13.5px}
.oh-home-conn{display:flex;align-items:center;gap:9px;background:#0f1117;border:1px solid #262b36;border-radius:10px;padding:10px 12px;margin-bottom:18px;font-size:13px}
.oh-home-dot{width:9px;height:9px;border-radius:50%;background:#f0b429;flex:0 0 auto;animation:ohpulse 1.2s ease-in-out infinite}
.oh-home-dot.ok{background:#3ddc84;animation:none}.oh-home-dot.origin{background:#9ab0ff;animation:none}
@keyframes ohpulse{0%,100%{opacity:.4}50%{opacity:1}}
.oh-home-conn b{color:#e6e8ee;font-weight:600}.oh-home-conn .mut{color:#9aa2b1}
.oh-home h4{margin:0 0 8px;font-size:14px;color:#c7ccd6}
.oh-home input{width:100%;box-sizing:border-box;background:#0f1117;border:1px solid #262b36;color:#e6e8ee;border-radius:9px;padding:10px 12px;margin-bottom:8px;font:inherit}
.oh-home .btn{width:100%;font:inherit;cursor:pointer;border:1px solid #262b36;background:#1d212b;color:#e6e8ee;border-radius:9px;padding:10px 12px}
.oh-home .btn.primary{background:#7c3aed;border-color:#7c3aed;font-weight:600;font-size:15.5px;padding:12px}
.oh-home .btn.primary:hover{background:#6d28d9}
.oh-home .row{display:flex;gap:8px}.oh-home .row .btn{width:auto;flex:1}
.oh-home .msg{color:#9aa2b1;font-size:12.5px;margin:8px 0 0}.oh-home .msg a{color:#9ab0ff;word-break:break-all}
.oh-home .sep{height:1px;background:#262b36;margin:18px 0}
`;

const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); for (const k of kids) if (k != null) n.append(k); return n; };

let overlay, dotEl, connEl;

const renderConnection = (c) => {
  if (!c) { dotEl.className = "oh-home-dot"; connEl.textContent = "Finding the best server…"; return; }
  if (c.origin) {
    dotEl.className = "oh-home-dot origin";
    connEl.replaceChildren(el("span", {}, el("b", { textContent: "Connected via origin server" }), " ", el("span", { className: "mut", textContent: "— no community node online right now" })));
    return;
  }
  dotEl.className = "oh-home-dot ok";
  const label = (c.region ? c.region + " · " : "") + `${c.latency} ms · ${c.users}/${c.max} players`;
  // Show the anonymous node ID, never the operator's name — keeps hosters private.
  connEl.replaceChildren(el("span", {}, el("b", { textContent: "Connected to " + (c.id || "a node") }), " ", el("span", { className: "mut", textContent: "— " + label })));
};

const enter = () => { try { sessionStorage.setItem(ENTERED_KEY, "1"); } catch { /* private mode */ } overlay?.remove(); overlay = null; };

// Load Google Identity Services once; resolves with window.google.
let gisPromise = null;
const loadGis = () => {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const s = el("script", { src: "https://accounts.google.com/gsi/client", async: true, defer: true });
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error("Couldn't load Google sign-in — check your connection."));
    document.head.append(s);
  });
  return gisPromise;
};

const accountSection = async () => {
  const box = el("div");
  if (!accountConfigured() || !googleClientId()) return box; // sign-in not wired for this build
  box.append(el("h4", { textContent: "Save your games across devices" }));
  if (await isSignedIn()) {
    box.append(
      el("div", { className: "msg", textContent: `Signed in as ${(await getEmail()) || "your account"} · games sync automatically.` }),
      el("button", { className: "btn", textContent: "Sign out", style: "margin-top:8px", onclick: async () => { await signOut(); refreshAccount(box); } }),
    );
  } else {
    // Google renders its own branded button into `mount`; on success we get an ID
    // token, hand it to the registry, and swap the section to the signed-in view.
    const mount = el("div", { style: "display:flex;justify-content:center;min-height:44px" });
    const msg = el("div", { className: "msg" });
    box.append(mount, msg);
    loadGis().then((google) => {
      google.accounts.id.initialize({
        client_id: googleClientId(),
        callback: async (resp) => {
          msg.textContent = "Signing you in…";
          try { await signInWithGoogle(resp.credential); refreshAccount(box); }
          catch (e) { msg.textContent = e.message; }
        },
      });
      google.accounts.id.renderButton(mount, { theme: "filled_blue", size: "large", text: "continue_with", shape: "pill" });
    }).catch((e) => { msg.textContent = e.message; });
  }
  return box;
};

const refreshAccount = async (box) => { const fresh = await accountSection(); box.replaceWith(fresh); };

export const showHomePage = () => {
  if (typeof document === "undefined" || document.getElementById("oh-home-root")) return;
  document.head.append(el("style", { textContent: css }));

  dotEl = el("span", { className: "oh-home-dot" });
  connEl = el("span", { textContent: "Finding the best server…" });
  const acctBox = el("div"); // filled async so the overlay appears instantly
  const play = el("button", { className: "btn primary", textContent: "Enter Open Historia", onclick: enter });

  const card = el("div", { className: "oh-home-card" },
    el("div", { className: "oh-home-logo", textContent: "Open Historia" }),
    el("p", { className: "oh-home-tag", textContent: "An open, community-hosted alternative to Pax Historia." }),
    el("div", { className: "oh-home-conn" }, dotEl, connEl),
    acctBox,
    el("div", { className: "sep" }),
    play,
  );
  overlay = el("div", { className: "oh-home", id: "oh-home-root" }, card);
  document.body.append(overlay); // up immediately — no flash of the game behind

  // Fill the login + connect to the best node in the background.
  accountSection().then((section) => acctBox.replaceWith(section)).catch(() => {});
  connectBestNode().then(renderConnection).catch(() => renderConnection({ origin: true }));
};

// Whether the home page should be shown this load (skipped once the player has
// entered this tab session).
export const shouldShowHome = () => {
  try { return sessionStorage.getItem(ENTERED_KEY) !== "1"; } catch { return true; }
};
