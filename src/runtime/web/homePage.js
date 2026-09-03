/*! Open Historia — web-mode home / connect screen © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The website's entry screen: it automatically connects the player to the best
// available content node (lowest latency + free capacity), lets them sign in
// (Google), and enters the game. Styled to match the project's GitHub Pages site
// — a classical parchment / Roman aesthetic (Cinzel + EB Garamond, marble cards,
// bronze & gold, a colonnade down each side) — with detailed live connection
// stats. Injected as a full-screen overlay over the (already-mounted) game; web
// build only, never in the local download.

import { connectBestNode } from "./nodeConnect.js";

const ENTERED_KEY = "oh:entered";
const FONTS_HREF = "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap";

// Design tokens + layout, scoped under .oh-home so nothing leaks into the game.
const css = `
.oh-home{
  --parch:#e9dcc0;--parch2:#e2d2b1;--marble:#f6efdc;--marble2:#fbf6e9;
  --ink:#2c2216;--sepia:#6c5a3c;--sepia2:#87754f;
  --line:rgba(74,54,24,.18);--line2:rgba(74,54,24,.30);
  --bronze:#9a6b2f;--gold:#b8860b;--red:#8a2331;--red-d:#6d1a25;--green:#4c7a3d;
  --grad-gold:linear-gradient(100deg,#7c4f18 0%,#b8860b 52%,#8f6a22 100%);
  --shadow:0 18px 42px -22px rgba(60,40,14,.55);--radius:14px;
  --serif:'EB Garamond',Georgia,'Times New Roman',serif;
  --display:'Cinzel',Georgia,'Times New Roman',serif;
  position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
  padding:26px 20px;overflow:auto;color:var(--ink);font-family:var(--serif);font-size:17px;line-height:1.6;
  -webkit-font-smoothing:antialiased;
  background:
    radial-gradient(1200px 540px at 50% -12%, rgba(184,134,11,.14), transparent 60%),
    radial-gradient(1000px 560px at 100% 2%, rgba(138,35,49,.07), transparent 55%),
    repeating-linear-gradient(112deg, rgba(120,90,40,.03) 0 2px, transparent 2px 7px),
    var(--parch);
}
.oh-home *{box-sizing:border-box}
.oh-home a{color:var(--bronze);text-decoration:none;border-bottom:1px solid rgba(154,107,47,.35)}
.oh-home a:hover{color:var(--ink)}

/* colonnade down both sides (wide screens only) */
.oh-colonnade{display:none}
@media(min-width:1120px){.oh-colonnade{display:block}}
.oh-col{position:absolute;top:0;bottom:0;width:72px;z-index:1;pointer-events:none;display:flex;flex-direction:column;box-shadow:0 0 30px rgba(52,36,12,.14)}
.oh-col.l{left:0}.oh-col.r{right:0}
.oh-col .cap{position:relative;height:56px;flex:none}
.oh-col .abacus{position:absolute;top:0;left:-7px;right:-7px;height:14px;border-radius:2px;border:1px solid var(--line2);background:linear-gradient(90deg,#b3a37e,#f7f0d8 50%,#b3a37e);box-shadow:0 3px 7px rgba(52,36,12,.28)}
.oh-col .echinus{position:absolute;left:2px;right:2px;top:14px;bottom:0;border-bottom:1px solid var(--line2);background:linear-gradient(90deg,#a2926c,#f2ead0 50%,#a2926c);clip-path:polygon(0 0,100% 0,83% 100%,17% 100%)}
.oh-col .shaft{flex:1;margin:0 8px;position:relative;border-left:1px solid var(--line);border-right:1px solid var(--line);
  background:linear-gradient(90deg, rgba(58,40,16,.34) 0%, rgba(255,250,235,.14) 24%, rgba(255,253,244,.6) 50%, rgba(255,250,235,.12) 76%, rgba(58,40,16,.38) 100%),
  repeating-linear-gradient(90deg, #c8bb96 0 2px, #efe7cd 2px 9px, #c8bb96 9px 11px)}
.oh-col .base{position:relative;height:52px;flex:none}
.oh-col .torus{position:absolute;left:2px;right:2px;top:0;bottom:14px;background:linear-gradient(90deg,#a2926c,#f2ead0 50%,#a2926c);clip-path:polygon(17% 0,83% 0,100% 100%,0 100%)}
.oh-col .plinth{position:absolute;bottom:0;left:-7px;right:-7px;height:14px;border-radius:2px;border:1px solid var(--line2);background:linear-gradient(90deg,#b3a37e,#f7f0d8 50%,#b3a37e);box-shadow:0 -2px 6px rgba(52,36,12,.22)}

/* card */
.oh-card{position:relative;z-index:2;width:100%;max-width:480px;background:var(--marble);border:1px solid var(--line2);
  border-radius:calc(var(--radius) + 4px);padding:34px 32px 26px;box-shadow:var(--shadow);text-align:center}
.oh-card::before{content:"";position:absolute;inset:-2px;border-radius:calc(var(--radius) + 6px);background:var(--grad-gold);opacity:.45;filter:blur(3px);z-index:-1}
.oh-badge{display:inline-flex;align-items:center;gap:7px;padding:6px 15px;border:1px solid var(--line2);border-radius:999px;
  font-size:.82rem;color:var(--sepia);background:var(--marble2)}
.oh-badge b{color:var(--red);font-weight:600}
.oh-logo{font-family:var(--display);font-weight:800;font-size:2.35rem;letter-spacing:.02em;line-height:1.05;margin:18px 0 0;color:var(--ink)}
.oh-grad{background:var(--grad-gold);-webkit-background-clip:text;background-clip:text;color:transparent}
.oh-tag{color:var(--sepia);font-size:1.04rem;margin:12px auto 0;max-width:400px}
.oh-rule{width:110px;height:2px;margin:20px auto;background:linear-gradient(90deg,transparent,var(--bronze),transparent)}

/* connection panel */
.oh-conn{background:var(--marble2);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px;text-align:left;box-shadow:inset 0 1px 0 rgba(255,255,255,.5)}
.oh-conn-head{display:flex;align-items:center;gap:10px;font-family:var(--display);font-weight:600;font-size:1.06rem;color:var(--ink)}
.oh-conn-title b{color:var(--bronze);font-weight:700;font-family:ui-monospace,Consolas,monospace;font-size:.94em}
.oh-dot{width:11px;height:11px;border-radius:50%;flex:0 0 auto;background:var(--gold);box-shadow:0 0 0 3px rgba(184,134,11,.18);animation:ohpulse 1.15s ease-in-out infinite}
.oh-dot.ok{background:var(--green);box-shadow:0 0 0 3px rgba(76,122,61,.2);animation:none}
.oh-dot.origin{background:var(--bronze);box-shadow:0 0 0 3px rgba(154,107,47,.2);animation:none}
@keyframes ohpulse{0%,100%{opacity:.35}50%{opacity:1}}
.oh-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:14px}
.oh-stat{background:var(--marble);border:1px solid var(--line);border-radius:9px;padding:9px 10px}
.oh-stat-k{font-family:var(--display);font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:var(--sepia2)}
.oh-stat-v{font-size:1.12rem;font-weight:600;color:var(--ink);margin-top:2px}
.oh-bar{height:7px;margin-top:11px;background:var(--parch);border:1px solid var(--line);border-radius:99px;overflow:hidden}
.oh-bar>i{display:block;height:100%;background:var(--grad-gold);width:0;transition:width .5s ease}
.oh-conn-sub{color:var(--sepia);font-size:.92rem;margin-top:12px;font-style:italic}

/* account + buttons */
.oh-acct{margin-top:20px;text-align:left}
.oh-h4{font-family:var(--display);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--bronze);margin:0 0 10px;text-align:center}
.oh-gbtn{display:flex;justify-content:center;min-height:44px}
.oh-msg{color:var(--sepia);font-size:.9rem;margin:9px 0 0;text-align:center}
.oh-btn{width:100%;font-family:var(--display);font-size:.9rem;letter-spacing:.06em;text-transform:uppercase;font-weight:700;
  cursor:pointer;border-radius:11px;padding:14px 20px;border:1px solid transparent;transition:transform .12s ease,box-shadow .2s,background .2s}
.oh-btn:hover{transform:translateY(-2px)}
.oh-btn:disabled{cursor:not-allowed;opacity:.45;filter:grayscale(.85);transform:none;box-shadow:none}
.oh-btn:disabled:hover{transform:none}
.oh-btn.ghost{background:var(--marble2);border-color:var(--line2);color:var(--ink)}
.oh-btn.ghost:hover{background:var(--marble)}
.oh-btn.primary{background:linear-gradient(180deg,#98283a,var(--red-d));color:#f7eccf;border-color:rgba(255,222,160,.4);box-shadow:0 12px 30px -12px rgba(110,26,37,.7);font-size:1rem;padding:15px}
.oh-btn.primary:hover{background:linear-gradient(180deg,#a12b3e,#7a1e2b)}
.oh-foot{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px;margin-top:20px;font-family:var(--display);font-size:.78rem;letter-spacing:.05em;color:var(--sepia2)}
.oh-foot a{border:0;color:var(--sepia2)}.oh-foot a:hover{color:var(--ink)}
.oh-trust{margin-top:14px;font-size:.82rem;color:var(--sepia2);font-style:italic}.oh-demo{margin:14px 0 0;padding:11px 13px;border:1px solid var(--line2);border-left:3px solid var(--bronze);border-radius:8px;background:rgba(154,107,47,.07);text-align:left}.oh-demo b{color:var(--ink)}.oh-demo-t{color:var(--ink);font-size:.92rem;font-weight:600;margin-bottom:3px}.oh-demo-b{color:var(--sepia);font-size:.85rem;line-height:1.45}.oh-demo-b a{color:var(--bronze);text-decoration:underline}.oh-modal{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(26,18,8,.66);backdrop-filter:blur(3px)}.oh-modal-box{max-width:520px;width:100%;background:var(--marble);border:1px solid var(--line2);border-top:4px solid var(--bronze);border-radius:12px;padding:24px 24px 20px;box-shadow:var(--shadow);text-align:left}.oh-modal-h{color:var(--ink);font-size:1.28rem;font-weight:700;margin:0 0 10px}.oh-modal-p{color:var(--sepia);font-size:.95rem;line-height:1.55;margin:0 0 11px}.oh-modal-p b{color:var(--ink)}.oh-modal-p a{color:var(--bronze);text-decoration:underline}.oh-modal-acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.oh-modal-acts .oh-btn{flex:1 1 190px;margin:0;width:auto;display:flex;align-items:center;justify-content:center;text-align:center;text-decoration:none}
`;

const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); for (const k of kids) if (k != null) n.append(k); return n; };
const colonnade = () => {
  const column = (side) => el("div", { className: "oh-col " + side },
    el("div", { className: "cap" }, el("span", { className: "abacus" }), el("span", { className: "echinus" })),
    el("div", { className: "shaft" }),
    el("div", { className: "base" }, el("span", { className: "torus" }), el("span", { className: "plinth" })));
  return el("div", { className: "oh-colonnade", "aria-hidden": "true" }, column("l"), column("r"));
};

let overlay, connPanel, playBtn;

const statCell = (label, value) => el("div", { className: "oh-stat" },
  el("div", { className: "oh-stat-k", textContent: label }),
  el("div", { className: "oh-stat-v", textContent: value }));

const renderConnection = (c) => {
  // Entering before a node is picked would start the game with no map source
  // resolved, so the button stays disabled until the connection settles — either
  // on a community node or on the origin fallback, both of which are playable.
  if (playBtn) playBtn.disabled = !c;
  if (!connPanel) return;
  if (!c) {
    connPanel.replaceChildren(
      el("div", { className: "oh-conn-head" }, el("span", { className: "oh-dot" }), el("span", { className: "oh-conn-title", textContent: "Finding the nearest node…" })),
      el("div", { className: "oh-conn-sub", textContent: "Locating the fastest community server with free capacity." }),
    );
    return;
  }
  if (c.origin) {
    connPanel.replaceChildren(
      el("div", { className: "oh-conn-head" }, el("span", { className: "oh-dot origin" }), el("span", { className: "oh-conn-title", textContent: "Connected via the origin" })),
      el("div", { className: "oh-conn-sub", textContent: "No community node is online right now — the world map streams from the project origin. You can play normally." }),
    );
    return;
  }
  const pct = Math.min(100, Math.round((c.users / Math.max(1, c.max)) * 100));
  connPanel.replaceChildren(
    // Anonymous node id only — never the operator's name — keeps hosters private.
    el("div", { className: "oh-conn-head" }, el("span", { className: "oh-dot ok" }),
      el("span", { className: "oh-conn-title" }, "Connected to ", el("b", { textContent: c.id || "a node" }))),
    el("div", { className: "oh-stats" },
      statCell("Region", c.region || "—"),
      statCell("Players", `${c.users}/${c.max}`)),
    el("div", { className: "oh-bar" }, el("i", { style: `width:${pct}%` })),
    el("div", { className: "oh-conn-sub", textContent: "The world map streams from this verified community node — every byte checksum-checked." }),
  );
};

const enter = () => { try { sessionStorage.setItem(ENTERED_KEY, "1"); } catch { /* private mode */ } overlay?.remove(); overlay = null; };

// Shown in front of the Enter button rather than beside it: the same words on
// the card were next to a large primary button and went unread. Dismissing it is
// the only way through, and it is remembered for the tab session so a player who
// has read it is not asked again.
const DEMO_ACK_KEY = "oh:demo-ack";

// The Android app is this same bundle packaged with Capacitor, so it inherits a
// notice written for the WEBSITE: "this is a demo, get the desktop app, expect
// lag". None of that is true there — the app IS the real thing, it keeps its own
// games and its own copy of the map, and there is no desktop app to send an
// Android player to. Capacitor injects window.Capacitor before the bundle runs,
// which is the same signal the API router uses to pick native HTTP.
const isNativeApp = () => typeof window !== "undefined" && Boolean(window.Capacitor);
const demoAcknowledged = () => {
  try { return sessionStorage.getItem(DEMO_ACK_KEY) === "1"; } catch { return false; }
};

const showDemoNotice = (onContinue) => {
  if (isNativeApp() || demoAcknowledged()) return onContinue();

  const close = () => {
    try { sessionStorage.setItem(DEMO_ACK_KEY, "1"); } catch { /* private mode */ }
    document.removeEventListener("keydown", onKey);
    modal.remove();
    onContinue();
  };
  // Esc continues rather than cancelling: there is nothing to cancel, and a
  // dialog that traps someone who pressed Esc is worse than one that lets go.
  const onKey = (event) => { if (event.key === "Escape") close(); };

  const go = el("button", { className: "oh-btn primary", textContent: "Play the demo anyway", onclick: close });
  const modal = el("div", { className: "oh-modal" },
    el("div", { className: "oh-modal-box" },
      el("h2", { className: "oh-modal-h", id: "oh-demo-h", textContent: "This is a demo of the game" }),
      el("p", { className: "oh-modal-p" },
        "Open Historia is meant to be played in the ",
        el("b", { textContent: "desktop app" }),
        ", which runs the world map from your own machine.",
      ),
      el("p", { className: "oh-modal-p" },
        "The browser version streams every map tile over the network, so expect ",
        el("b", { textContent: "noticeable lag" }),
        " — especially when zooming or panning. It is here to try the game, not to be the best way to play it.",
      ),
      el("p", { className: "oh-modal-p", textContent: "Either way, your games are saved on this device." }),
      el("div", { className: "oh-modal-acts" },
        el("a", { className: "oh-btn ghost", href: "https://github.com/Open-Historia/open-historia/releases/tag/desktop-stable", target: "_blank", rel: "noopener", textContent: "Get the desktop app" }),
        go,
      ),
    ),
  );
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "oh-demo-h");
  document.addEventListener("keydown", onKey);
  document.body.append(modal);
  go.focus();
};

export const showHomePage = () => {
  if (typeof document === "undefined" || document.getElementById("oh-home-root")) return;
  if (!document.getElementById("oh-home-fonts")) {
    document.head.append(el("link", { id: "oh-home-fonts", rel: "stylesheet", href: FONTS_HREF }));
  }
  document.head.append(el("style", { textContent: css }));

  connPanel = el("div", { className: "oh-conn" });
  renderConnection(null); // initial "finding…" state
  // Starts disabled: renderConnection enables it once a node (or the origin
  // fallback) is settled, so nobody can enter a half-connected session.
  const play = el("button", { className: "oh-btn primary", textContent: "⚔  Enter Open Historia", onclick: () => showDemoNotice(enter) });
  play.disabled = true;
  playBtn = play;
  const foot = el("div", { className: "oh-foot" },
    el("a", { href: "https://github.com/Open-Historia/open-historia", target: "_blank", rel: "noopener", textContent: "GitHub" }),
    el("a", { href: "https://discord.gg/QaqAK7fQAg", target: "_blank", rel: "noopener", textContent: "Discord" }),
    el("a", { href: "https://github.com/Open-Historia/open-historia-node", target: "_blank", rel: "noopener", textContent: "Host a node" }),
  );

  const card = el("div", { className: "oh-card" },
    el("span", { className: "oh-badge" }, "🏛️ Free & open source · community-hosted alternative to ", el("b", { textContent: "Pax Historia" })),
    el("h1", { className: "oh-logo" }, "Open ", el("span", { className: "oh-grad", textContent: "Historia" })),
    el("p", { className: "oh-tag", textContent: "An AI-driven alternate-history strategy game. Lead any nation on a living world map and reshape history." }),
    el("div", { className: "oh-rule" }),
    connPanel,
    el("div", { className: "oh-rule" }),
    play,
    el("div", { className: "oh-trust", textContent: "Trust is in the checksum and the project signature — never in the node itself." }),
    foot,
  );
  overlay = el("div", { className: "oh-home", id: "oh-home-root" }, colonnade(), card);
  document.body.append(overlay); // up immediately — no flash of the game behind

  // Connect to the best node in the background.
  connectBestNode().then(renderConnection).catch(() => renderConnection({ origin: true }));
};

// Whether the home page should be shown this load (skipped once the player has
// entered this tab session).
export const shouldShowHome = () => {
  try { return sessionStorage.getItem(ENTERED_KEY) !== "1"; } catch { return true; }
};
