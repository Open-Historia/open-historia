/*! Open Historia — the microphone, for the game's own page only © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Advisor's microphone (src/runtime/speechInput.js) records through
// getUserMedia and runs the speech model on this machine. Electron grants
// every permission a page asks for unless a handler says otherwise, so this
// says otherwise for exactly one: the microphone goes to the game's own origin
// (http://localhost:<port>) and to nothing else it might show, a camera to
// nobody. Every other permission is answered as before.
//
// macOS also asks the player, once, through its own prompt (the reason it
// shows is NSMicrophoneUsageDescription in the builder configs); a "no" there
// is the answer the page gets.

const sameOrigin = (url, origin) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

const audioOnly = (types) => Array.isArray(types) && types.length > 0 && types.every((type) => type === "audio");

const systemAllows = async ({ platform, systemPreferences }) => {
  if (platform !== "darwin" || !systemPreferences?.askForMediaAccess) return true;
  try {
    if (systemPreferences.getMediaAccessStatus?.("microphone") === "granted") return true;
    return Boolean(await systemPreferences.askForMediaAccess("microphone"));
  } catch {
    return false;
  }
};

// origin() is read on every request: the port is only known once the server is up.
const installMicrophonePermission = (session, { origin, platform = process.platform, systemPreferences } = {}) => {
  session.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    if (permission !== "media") {
      callback(true);
      return;
    }
    const requesting = details.requestingUrl || webContents?.getURL?.() || "";
    if (!sameOrigin(requesting, origin()) || !audioOnly(details.mediaTypes)) {
      callback(false);
      return;
    }
    systemAllows({ platform, systemPreferences }).then(callback, () => callback(false));
  });
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details = {}) => {
    if (permission !== "media") return true;
    if (!sameOrigin(requestingOrigin || details.securityOrigin || "", origin())) return false;
    return details.mediaType !== "video";
  });
};

module.exports = { installMicrophonePermission };
