/*! Open Historia — web-mode home screen © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The website's entry screen: the wordmark, what the game is, and the way in.
// Injected as a full-screen overlay over the (already-mounted) game; web build
// only, never in the local download. There is nothing to connect to first: the
// map is part of the site.

import { isNativeApp } from "./nativeBoot.js";
import { bootText, bootTranslated } from "./bootTexts.js";

const ENTERED_KEY = "oh:entered";
const FONTS_HREF = "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap";

// The project mark, in place of the classical-building emoji.
const MARK_SRC = "/icon-192.png";

// Design tokens + layout, scoped under .oh-home so nothing leaks into the game.
const css = `
.oh-home{
  --parch:#111113;--parch2:#17171a;--marble:#1a1a1f;--marble2:#212128;
  --ink:#ece4d2;--sepia:#a4987f;--sepia2:#877c66;
  --line:rgba(233,220,192,.14);--line2:rgba(233,220,192,.26);
  --bronze:#c9932f;--gold:#c9932f;--gold-l:#dcb954;--red:#a8394a;--red-d:#7a1e2b;--green:#5d9149;
  --grad-gold:linear-gradient(100deg,#a7761f 0%,#e0b44a 52%,#b98f2e 100%);
  --shadow:0 18px 42px -22px rgba(0,0,0,.8);--radius:14px;
  --serif:'EB Garamond',Georgia,'Times New Roman',serif;
  --display:'Cinzel',Georgia,'Times New Roman',serif;
  position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
  padding:26px 20px;overflow:auto;color:var(--ink);font-family:var(--serif);font-size:17px;line-height:1.6;
  -webkit-font-smoothing:antialiased;
  background:
  radial-gradient(1200px 540px at 50% -12%, rgba(201,147,47,.14), transparent 60%),
  radial-gradient(1000px 560px at 100% 2%, rgba(168,57,74,.08), transparent 55%),
  repeating-linear-gradient(112deg, rgba(233,220,192,.02) 0 2px, transparent 2px 7px),
  var(--parch);
}
.oh-home *{box-sizing:border-box}
.oh-home a{color:var(--bronze);text-decoration:none;border-bottom:1px solid rgba(201,147,47,.45)}
.oh-home a:hover{color:var(--ink)}

/* card */
.oh-card{position:relative;z-index:2;width:100%;max-width:480px;background:var(--marble);border:1px solid var(--line2);
  border-radius:calc(var(--radius) + 4px);padding:34px 32px 26px;text-align:center;
  /* On a dark ground a drop shadow does almost nothing, so the card is lifted by
   *   a faint gold ring and a lit top edge instead. */
  box-shadow:0 0 0 1px rgba(201,147,47,.22) inset,inset 0 1px 0 rgba(255,248,228,.06),var(--shadow)}
  /* One line, always. The mark is wider than the emoji it replaced, which pushed
   * this over the card's inner width and wrapped it. nowrap alone would overflow
   * on a narrow screen, so the size is viewport-tied and floors low enough to fit
   * a 320px phone. */
  .oh-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 13px;border:1px solid var(--line2);border-radius:999px;
    white-space:nowrap;max-width:100%;font-size:clamp(.56rem,2.4vw,.82rem);color:var(--sepia);background:var(--marble2)}
    .oh-badge-icon{width:1.15em;height:1.15em;border-radius:3px;display:block;flex:none;object-fit:contain}
    .oh-logo{font-family:var(--display);font-weight:800;font-size:2.35rem;letter-spacing:.02em;line-height:1.05;margin:18px 0 0;color:var(--ink)}
    .oh-grad{background:var(--grad-gold);-webkit-background-clip:text;background-clip:text;color:transparent}
    .oh-tag{color:var(--sepia);font-size:1.04rem;margin:12px auto 0;max-width:400px}
    .oh-rule{width:110px;height:2px;margin:20px auto;background:linear-gradient(90deg,transparent,var(--bronze),transparent)}

    /* connection panel */
    .oh-conn-sub{color:var(--sepia);font-size:.92rem;margin-top:12px;font-style:italic}

    /* buttons */
    .oh-btn{width:100%;font-family:var(--display);font-size:.9rem;letter-spacing:.06em;text-transform:uppercase;font-weight:700;
      cursor:pointer;border-radius:11px;padding:14px 20px;border:1px solid transparent;transition:transform .12s ease,box-shadow .2s,background .2s}
      .oh-btn:hover{transform:translateY(-2px)}
      .oh-btn:focus-visible{outline:2px solid var(--gold-l);outline-offset:3px}
      .oh-btn:disabled{cursor:not-allowed;opacity:.45;filter:grayscale(.85);transform:none;box-shadow:none}
      .oh-btn:disabled:hover{transform:none}
      .oh-btn.ghost{background:var(--marble);border-color:var(--line2);color:var(--ink)}
      .oh-btn.ghost:hover{background:var(--marble2)}
      .oh-btn.primary{background:linear-gradient(180deg,#98283a,var(--red-d));color:#f7eccf;border-color:rgba(255,222,160,.4);box-shadow:0 12px 30px -12px rgba(0,0,0,.85);font-size:1rem;padding:15px}
      .oh-btn.primary:hover{background:linear-gradient(180deg,#a12b3e,#7a1e2b)}
      .oh-foot{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px;margin-top:20px;font-family:var(--display);font-size:.78rem;letter-spacing:.05em;color:var(--sepia2)}
      .oh-foot a{border:0;color:var(--sepia2)}.oh-foot a:hover{color:var(--ink)}
      .oh-trust{margin-top:14px;font-size:.82rem;color:var(--sepia2);font-style:italic}
      .oh-demo{margin:14px 0 0;padding:11px 13px;border:1px solid var(--line2);border-left:3px solid var(--bronze);border-radius:8px;background:rgba(201,147,47,.10);text-align:left}
      .oh-demo b{color:var(--ink)}
      .oh-demo-t{color:var(--ink);font-size:.92rem;font-weight:600;margin-bottom:3px}
      .oh-demo-b{color:var(--sepia);font-size:.85rem;line-height:1.45}
      .oh-demo-b a{color:var(--bronze);text-decoration:underline}
      .oh-modal{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(9,9,11,.88);backdrop-filter:blur(4px)}
      .oh-modal-box{max-width:520px;width:100%;background:var(--marble);border:1px solid var(--line2);border-top:4px solid var(--bronze);border-radius:12px;padding:24px 24px 20px;box-shadow:var(--shadow);text-align:left}
      .oh-modal-h{color:var(--ink);font-size:1.28rem;font-weight:700;margin:0 0 10px;font-family:var(--display);letter-spacing:.02em}
      .oh-modal-p{color:var(--sepia);font-size:.95rem;line-height:1.55;margin:0 0 11px}
      .oh-modal-p a{color:var(--bronze);text-decoration:underline}
      .oh-modal-acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
      .oh-modal-acts .oh-btn{flex:1 1 190px;margin:0;width:auto;display:flex;align-items:center;justify-content:center;text-align:center;text-decoration:none}
      `;

      const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); for (const k of kids) if (k != null) n.append(k); return n; };

      let overlay;

// Remembered for the tab session, so a reload does not ask again. Exported
// because the Android app never shows this screen at all (nativeBoot.js, wired
// in index.js) and must not leave shouldShowHome() answering true behind it.
export const markEntered = () => { try { sessionStorage.setItem(ENTERED_KEY, "1"); } catch { /* private mode */ } };
const enter = () => { markEntered(); overlay?.remove(); overlay = null; };

      // Shown in front of the Enter button rather than beside it: the same words on
      // the card were next to a large primary button and went unread. Dismissing it is
      // the only way through, and it is remembered for the tab session so a player who
      // has read it is not asked again.
      const DEMO_ACK_KEY = "oh:demo-ack";

// The Android app is this same bundle packaged with Capacitor, so it inherits a
// notice written for the WEBSITE: "this is a demo, get the desktop app, expect
// lag". None of that is true there — the app IS the real thing, it keeps its own
// games and its own copy of the map, and there is no desktop app to send an
// Android player to. (In practice the app does not reach this screen at all any
// more — see nativeBoot.js — but the guard stays: it is what makes that true if
// the home page is ever shown there deliberately.)
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

        const go = el("button", { className: "oh-btn primary", textContent: bootText("demoPlay"), onclick: close });
        const modal = el("div", { className: "oh-modal" },
                         el("div", { className: "oh-modal-box" },
                            el("h2", { className: "oh-modal-h", id: "oh-demo-h", textContent: bootText("demoTitle") }),
                            // Whole sentences, each looked up whole: no emphasis inside them.
                            el("p", { className: "oh-modal-p", textContent: bootText("demoDesktop") }),
                            el("p", { className: "oh-modal-p", textContent: bootText("demoLag") }),
                            el("p", { className: "oh-modal-p", textContent: bootText("demoSaved") }),
                            el("div", { className: "oh-modal-acts" },
                               el("a", { className: "oh-btn ghost", href: "https://github.com/Open-Historia/open-historia/releases/tag/desktop-stable", target: "_blank", rel: "noopener", textContent: bootText("demoGetApp") }),
                               go,
                            ),
                         ),
        );
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-labelledby", "oh-demo-h");
        if (bootTranslated()) modal.setAttribute("data-no-translate", "");
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

        const play = el("button", { className: "oh-btn primary", textContent: `⚔  ${bootText("homeEnter")}`, onclick: () => showDemoNotice(enter) });
        const foot = el("div", { className: "oh-foot" },
                        el("a", { href: "https://github.com/Open-Historia/open-historia", target: "_blank", rel: "noopener", textContent: "GitHub" }),
                        el("a", { href: "https://discord.gg/QaqAK7fQAg", target: "_blank", rel: "noopener", textContent: "Discord" }),
                        // The site root's page: the game itself is under /play/.
                        el("a", { href: "/privacy/", target: "_blank", rel: "noopener", textContent: bootText("homePrivacy") }),
        );

        const card = el("div", { className: "oh-card" },
                        el("span", { className: "oh-badge" },
                           el("img", { className: "oh-badge-icon", src: MARK_SRC, alt: "", width: 16, height: 16 }),
                           bootText("homeBadge")),
                        el("h1", { className: "oh-logo" }, "Open ", el("span", { className: "oh-grad", textContent: "Historia" })),
                        el("p", { className: "oh-tag", textContent: bootText("homeTagline") }),
                        el("div", { className: "oh-rule" }),
                        play,
                        foot,
        );
        overlay = el("div", { className: "oh-home", id: "oh-home-root" }, card);
        // Already in the player's language (index.js loaded the pack before this).
        if (bootTranslated()) overlay.setAttribute("data-no-translate", "");
        document.body.append(overlay); // up immediately — no flash of the game behind

      };

      // Whether the home page should be shown this load (skipped once the player has
      // entered this tab session).
      export const shouldShowHome = () => {
        try { return sessionStorage.getItem(ENTERED_KEY) !== "1"; } catch { return true; }
      };
