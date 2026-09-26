/*! Open Historia — the Capacitor bridge, reached without depending on it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Android app is the web bundle inside a Capacitor WebView, and Capacitor
// injects `window.Capacitor` before the bundle runs. Its plugins are reached
// through that global rather than through the @capacitor/* JS packages, so the
// root package.json stays free of them and the website bundle is byte-for-byte
// what it was: only mobile/package.json knows which plugins the app carries.
//
// Everything native is behind the compile-time VITE_OH_NATIVE flag (vite.config.ts,
// `--mode android`), so none of this reaches the website or the desktop.

// A compile-time literal under Vite; under `node --test` there is no
// import.meta.env at all, and the guard makes that read as "not native".
export const isNativeBuild = () => {
  try { return Boolean(import.meta.env.VITE_OH_NATIVE); } catch { return false; }
};

// The injected bridge, or null in a browser.
export const capacitor = () => (typeof window !== "undefined" ? window.Capacitor ?? null : null);

// A plugin by name: registered ones sit on Capacitor.Plugins; one the JS side has
// not registered yet is registered on demand, which is how a plugin that only
// mobile/ depends on becomes callable from here.
export const nativePlugin = (name) => {
  const bridge = capacitor();
  if (!bridge) return null;
  const registered = bridge.Plugins?.[name];
  if (registered) return registered;
  if (typeof bridge.registerPlugin === "function") {
    try { return bridge.registerPlugin(name); } catch { return null; }
  }
  return null;
};

// True only inside the app: a native build running with the bridge present.
export const nativeReady = () => isNativeBuild() && Boolean(capacitor());
