/*! Open Historia — web-mode account widget © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// A small self-contained sign-in / sync-status control injected into the page
// (web build only — never touches the game's React tree or the local download).
// Email → magic link → signed in → games/scenarios sync (account.js + sync.js).

import { accountConfigured, isSignedIn, getEmail, requestMagicLink, signOut } from "./account.js";
import { syncNow, startSync, stopSync } from "./sync.js";

const css = `
.oh-acct{position:fixed;top:10px;right:10px;z-index:99998;font:13px/1.4 system-ui,sans-serif}
.oh-acct-btn{display:flex;align-items:center;gap:6px;background:rgba(15,17,23,.82);color:#e6e8ee;border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:5px 11px;cursor:pointer;backdrop-filter:blur(6px);max-width:220px}
.oh-acct-btn:hover{border-color:rgba(255,255,255,.3)}
.oh-acct-dot{width:8px;height:8px;border-radius:50%;background:#6b7280;flex:0 0 auto}
.oh-acct-dot.ok{background:#3ddc84}.oh-acct-dot.syncing{background:#f0b429}.oh-acct-dot.error{background:#f0506e}
.oh-acct-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oh-acct-panel{position:absolute;top:38px;right:0;width:270px;background:#171a22;border:1px solid #262b36;border-radius:12px;padding:14px;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.oh-acct-panel h4{margin:0 0 4px;font-size:14px;color:#e6e8ee}
.oh-acct-panel p{margin:0 0 10px;color:#9aa2b1;font-size:12px}
.oh-acct-panel input{width:100%;box-sizing:border-box;background:#0f1117;border:1px solid #262b36;color:#e6e8ee;border-radius:8px;padding:8px 10px;margin-bottom:8px}
.oh-acct-panel button{width:100%;font:inherit;cursor:pointer;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:8px;padding:8px 10px}
.oh-acct-panel button.ghost{background:transparent;border-color:#262b36;color:#e6e8ee;margin-top:6px}
.oh-acct-msg{color:#9aa2b1;font-size:12px;margin-top:8px}
.oh-acct-msg a{color:#9ab0ff;word-break:break-all}
`;

let root, btn, dot, label, panel, syncState = "idle", syncError = null;

const el = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const k of kids) node.append(k);
  return node;
};

const setStatus = async () => {
  const signedIn = await isSignedIn();
  dot.className = "oh-acct-dot" + (syncState === "ok" ? " ok" : syncState === "syncing" ? " syncing" : syncState === "error" ? " error" : "");
  dot.title = syncState === "error" ? ("Sync error: " + (syncError || "unknown") + " — click for details")
    : syncState === "syncing" ? "Syncing…" : syncState === "ok" ? "Synced" : "";
  if (!signedIn) { label.textContent = "Sign in to sync"; }
  else {
    const email = (await getEmail()) || "account";
    label.textContent = syncState === "syncing" ? "Syncing…" : email;
  }
};

const closePanel = () => { if (panel) { panel.remove(); panel = null; } };

const openPanel = async () => {
  if (panel) { closePanel(); return; }
  const signedIn = await isSignedIn();
  panel = el("div", { className: "oh-acct-panel" });

  if (!signedIn) {
    const input = el("input", { type: "email", placeholder: "you@example.com", autocomplete: "email" });
    const send = el("button", { textContent: "Email me a sign-in link" });
    const msg = el("div", { className: "oh-acct-msg" });
    send.onclick = async () => {
      const email = input.value.trim();
      if (!email) return;
      send.disabled = true; send.textContent = "Sending…";
      try {
        const res = await requestMagicLink(email);
        msg.textContent = res.sent === false
          ? "Email isn't set up on this server yet — the site owner needs to finish email configuration."
          : "Check your email for the sign-in link — and check your spam folder if you don't see it.";
      } catch (e) { msg.textContent = e.message; }
      send.disabled = false; send.textContent = "Email me a sign-in link";
    };
    input.onkeydown = (e) => { if (e.key === "Enter") send.click(); };
    panel.append(
      el("h4", { textContent: "Sync your games" }),
      el("p", { textContent: "Sign in with your email to save your games and get them on any device. Your saves are encrypted before they leave this browser." }),
      input, send, msg,
    );
  } else {
    const now = el("button", { textContent: "Sync now" });
    now.onclick = async () => { closePanel(); await syncNow(); };
    const out = el("button", { className: "ghost", textContent: "Sign out" });
    out.onclick = async () => { stopSync(); await signOut(); closePanel(); syncState = "idle"; await setStatus(); };
    panel.append(
      el("h4", { textContent: (await getEmail()) || "Signed in" }),
      el("p", { textContent: "Your games and scenarios sync automatically, encrypted end-to-end." }),
    );
    if (syncError) panel.append(el("p", { className: "oh-acct-msg", style: "color:#f0506e", textContent: "Last sync issue: " + syncError }));
    panel.append(now, out);
  }
  root.append(panel);
};

export const initAccountWidget = () => {
  if (!accountConfigured() || typeof document === "undefined" || document.getElementById("oh-acct-root")) return;
  document.head.append(el("style", { textContent: css }));
  dot = el("span", { className: "oh-acct-dot" });
  label = el("span", { className: "oh-acct-label", textContent: "Sign in to sync" });
  btn = el("button", { className: "oh-acct-btn" }, dot, label);
  btn.onclick = openPanel;
  root = el("div", { className: "oh-acct", id: "oh-acct-root" }, btn);
  document.body.append(root);

  window.addEventListener("oh:sync", (e) => {
    syncState = e.detail?.state || syncState;
    if (e.detail?.state === "error") syncError = e.detail.error || "sync failed";
    else if (e.detail?.state === "ok") syncError = null;
    setStatus();
  });
  document.addEventListener("click", (e) => { if (root && !root.contains(e.target)) closePanel(); });
  setStatus();
  // Kick off background sync if already signed in.
  isSignedIn().then((yes) => { if (yes) startSync(); });
};
