/*! Open Historia — clipboard write with a legacy fallback © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// One copy-to-clipboard for every "paste this into a bug report" button.
//
// navigator.clipboard needs a SECURE CONTEXT. The packaged desktop app has one
// and so does the hosted site, but a browser reaching the game over plain http on
// the LAN does not — and LAN play is a first-class, in-game setting now
// (Settings → Network → "Let other devices connect"), so that is a supported
// setup rather than an edge case. On those origins navigator.clipboard is simply
// absent and the button would fail every time.
//
// Hence the execCommand fallback: deprecated, but it is the only thing that works
// on an insecure origin and it is exactly the case these buttons exist for. The
// desktop build also binds no developer tools (no F12, no menu entry), so a
// failed copy leaves the player with no way at all to get the text out.
//
// Lifted out of GameUI/advisor.jsx, which had the only copy — time.jsx's
// "Copy debugging message" called navigator.clipboard bare and so was broken on
// exactly the setup the LAN toggle enables.
export const copyToClipboard = async (text) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }

  try {
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(scratch);
    return ok;
  } catch {
    return false;
  }
};

export default copyToClipboard;
