/*! Open Historia — Android boot screen © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The Android app is this same web bundle packaged with Capacitor, and it used to
// inherit the WEBSITE's entry screen: a marketing card — badge, tagline, "a
// community-hosted alternative to Pax Historia" — with an "Enter Open Historia"
// button that had to be pressed before the game appeared. On a phone that reads as
// a website in a shell, and it made the player confirm something they had already
// confirmed by tapping the app icon.
//
// This replaces it there (and only there). The app connects to a content node on
// its own while a boot screen is up, then goes straight into the game. The website
// keeps its home page — a browser tab genuinely is arriving from nowhere and has a
// download to offer; an installed app does not.
//
// Deliberately free of imports, including Vite's `import.meta.env`, so it stays
// loadable outside a bundler and its policy can be tested. The connection itself
// is handed in by index.js rather than imported: nodeConnect.js reads
// import.meta.env at module scope and cannot be loaded by `node --test`.

const BOOT_ID = "oh-native-boot";

// Long enough that a fast connection does not flash the screen and vanish, short
// enough that it never feels like a wait. Measured from first paint, not from the
// connection starting, so seeding time counts toward it.
export const MIN_VISIBLE_MS = 500;

// The boot screen must never be the reason a player cannot reach their games. A
// node probe already has its own 4s timeout, but the directory fetch in front of
// it does not, and a captive portal can hang a request indefinitely. Past this the
// screen comes down regardless; the connection keeps going and simply settles
// behind the game, which is what the heartbeat does for the rest of the session.
export const CONNECT_DEADLINE_MS = 8000;

// Capacitor injects window.Capacitor before the bundle runs. Same signal router.js
// uses to pick native HTTP, and homePage.js to skip the browser-only demo notice.
export const isNativeApp = () => typeof window !== "undefined" && Boolean(window.Capacitor);

// The one line under the wordmark. `null` is "still working"; everything else is a
// settled connection, including the origin fallback, which is a real answer and not
// an error — the game is perfectly playable on it.
export const bootStatusText = (connection) => {
  if (!connection) return "Finding the closest community node…";
  if (connection.origin) return "Connected to the main server";
  const parts = [connection.id || "a community node"];
  if (connection.region) parts.push(connection.region);
  if (Number.isFinite(connection.latency)) parts.push(`${connection.latency} ms`);
  return `Connected · ${parts.join(" · ")}`;
};

// #0b1020 is the <meta name="theme-color"> and the launcher background behind
// drawable/splash.png, so the native splash hands over to this with no seam — the
// player sees one continuous screen from tap to game.
const css = `
#${BOOT_ID}{
  position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:22px;padding:32px;
  background:#0b1020;color:#e8eaf2;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  opacity:1;transition:opacity 260ms ease;
  -webkit-font-smoothing:antialiased;
}
#${BOOT_ID}.oh-boot-out{opacity:0}
#${BOOT_ID} .oh-boot-mark{
  font-size:clamp(22px,7vw,34px);letter-spacing:.16em;text-transform:uppercase;
  font-weight:600;text-align:center;line-height:1.25;
}
#${BOOT_ID} .oh-boot-mark b{font-weight:700;color:#c9a227}
#${BOOT_ID} .oh-boot-track{
  width:min(240px,62vw);height:2px;border-radius:2px;overflow:hidden;
  background:rgba(232,234,242,.14);
}
#${BOOT_ID} .oh-boot-track i{
  display:block;height:100%;width:40%;border-radius:2px;background:#c9a227;
  animation:oh-boot-slide 1.15s ease-in-out infinite;
}
@keyframes oh-boot-slide{
  0%{transform:translateX(-105%)}
  100%{transform:translateX(255%)}
}
#${BOOT_ID} .oh-boot-status{
  font-size:13px;color:rgba(232,234,242,.62);text-align:center;min-height:1.4em;
}
/* A player who has asked for less motion still needs to see that it is working,
   so the bar becomes a steady half-width rule rather than disappearing. */
@media (prefers-reduced-motion:reduce){
  #${BOOT_ID} .oh-boot-track i{animation:none;width:100%}
  #${BOOT_ID}{transition:none}
}
`;

// Paints the boot screen immediately and returns a handle. Synchronous on purpose:
// it is called before the library is seeded so the phone shows something within a
// frame of the WebView loading, rather than a white gap where the native splash was.
export const showNativeBoot = () => {
  if (typeof document === "undefined") return { settle: () => {} };
  const existing = document.getElementById(BOOT_ID);
  if (existing) return { settle: () => {} }; // already up; do not stack two

  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);

  const status = document.createElement("div");
  status.className = "oh-boot-status";
  status.textContent = bootStatusText(null);

  const track = document.createElement("div");
  track.className = "oh-boot-track";
  track.append(document.createElement("i"));

  const mark = document.createElement("div");
  mark.className = "oh-boot-mark";
  mark.append("Open ", Object.assign(document.createElement("b"), { textContent: "Historia" }));

  const root = document.createElement("div");
  root.id = BOOT_ID;
  // The game mounts behind this, so tell a screen reader the screen is busy
  // rather than letting it announce a half-built interface.
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.append(mark, track, status);
  document.body.append(root);

  const shownAt = Date.now();
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    root.classList.add("oh-boot-out");
    // Matches the CSS transition. A timer rather than transitionend, which never
    // fires if the element is hidden or motion is reduced.
    setTimeout(() => { root.remove(); style.remove(); }, 280);
  };

  // Nothing below is allowed to leave the screen up for ever.
  const deadline = setTimeout(remove, CONNECT_DEADLINE_MS);

  return {
    // Called once with the settled connection (or null if it failed outright).
    settle: (connection) => {
      clearTimeout(deadline);
      if (removed) return; // the deadline already let the player through
      status.textContent = bootStatusText(connection);
      const waited = Date.now() - shownAt;
      setTimeout(remove, Math.max(0, MIN_VISIBLE_MS - waited));
    },
  };
};
