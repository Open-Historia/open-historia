/*! Open Historia — a page's credential to write a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// While a game is shared, the server takes a write to it only from the host's
// engine window (server/oneWriter.js). The desktop app mints a credential when
// it opens that window and hands it over in the window's address
// (electron/main.cjs: engine.html#credential=…). The window takes it out of its
// address at once, and puts it on every write it makes to its own server's
// /api, including those its workers ask it to make (the Country Stats worker's,
// through runtimeIoBridge.js, which the page switches on when it holds one).
//
// Every other page has none, and nothing changes for it.

export const ENGINE_CREDENTIAL_HEADER = "X-OH-Engine";

let credential = "";

export const hasWriteCredential = () => Boolean(credential);

// The credential in this page's address (#credential=…), taken out of it so it
// is in no log or report that names the page's address. Kept for this tab alone
// (sessionStorage, which no other tab or window reads), so the engine window
// that reloads itself is still the engine window.
const KEPT = "oh:engine-credential";
export const credentialFromAddress = (location = globalThis.location, history = globalThis.history, storage = globalThis.sessionStorage) => {
  const match = /(?:^#|&)credential=([A-Za-z0-9_-]{16,128})(?:&|$)/.exec(String(location?.hash || ""));
  if (!match) {
    try {
      return /^[A-Za-z0-9_-]{16,128}$/.test(String(storage?.getItem?.(KEPT) || "")) ? storage.getItem(KEPT) : "";
    } catch {
      return "";
    }
  }
  try {
    history?.replaceState?.(history.state ?? null, "", `${location.pathname}${location.search}`);
  } catch {
    // the address keeps it; the page still writes with it
  }
  try {
    storage?.setItem?.(KEPT, match[1]);
  } catch {
    // a reload of this window then writes nothing, refused by the server
  }
  return match[1];
};

const methodOf = (input, init) => String(init?.method ?? (typeof input === "object" && input ? input.method : "") ?? "GET").toUpperCase() || "GET";

// Puts the credential on every write this page makes to its own server's /api.
// Once per page; false when there is nothing to put on, or it is on already.
export const installWriteCredential = (value, { target = globalThis } = {}) => {
  const given = String(value || "").trim();
  if (!given || credential || typeof target?.fetch !== "function") return false;
  credential = given;
  const original = target.fetch.bind(target);
  target.fetch = (input, init) => {
    const method = methodOf(input, init);
    if (method === "GET" || method === "HEAD") return original(input, init);
    let url;
    try {
      url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input?.url ?? "", target.location?.href ?? "http://localhost/");
    } catch {
      return original(input, init);
    }
    if ((target.location?.origin && url.origin !== target.location.origin) || !url.pathname.startsWith("/api/")) return original(input, init);
    const headers = new Headers(init?.headers ?? (typeof input === "object" && input ? input.headers : undefined));
    headers.set(ENGINE_CREDENTIAL_HEADER, credential);
    return original(input, { ...(init ?? {}), headers });
  };
  return true;
};
