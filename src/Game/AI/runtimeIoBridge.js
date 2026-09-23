/*! Open Historia — a worker's runtime I/O, answered by the page © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// On the website and in the Android app there is no server: every /api/* call
// is answered by a patch on the page's window.fetch (runtime/web/router.js). A
// Web Worker has its own fetch, which that patch never touches, so a worker
// that reads or writes runtime JSON gets a 404 from the static host — which is
// exactly what happened to the Country Stats worker, and why it fell back to
// the main thread on every hosted build.
//
// This is the bridge: the worker posts an `io` message, the page performs the
// fetch it was asked for with ITS fetch and posts an `io-result` back, and the
// worker sees a response with the same `ok`/`status`/`text()`/`json()` it would
// have had. The desktop, whose server answers a worker's fetch directly, never
// switches it on.
//
// Import-free and free of DOM, so both halves run under `node --test`.

export const IO_REQUEST = "io";
export const IO_RESULT = "io-result";
export const IO_CONFIG = "config";

// The worker's half. `post` sends a message to the page.
export const createWorkerIoClient = (post) => {
  let nextId = 1;
  const pending = new Map();
  return {
    fetch: (url, init = {}) => new Promise((resolve, reject) => {
      const ioId = nextId;
      nextId += 1;
      pending.set(ioId, { resolve, reject });
      try {
        post({
          type: IO_REQUEST,
          ioId,
          url: String(url),
          method: String(init.method || "GET"),
          headers: init.headers && typeof init.headers === "object" ? { ...init.headers } : {},
          body: init.body == null ? null : String(init.body),
        });
      } catch (error) {
        pending.delete(ioId);
        reject(error);
      }
    }),
    // True when the message was an answer to one of ours (handled), false to
    // let the caller route it elsewhere.
    handle: (message) => {
      if (!message || message.type !== IO_RESULT) return false;
      const entry = pending.get(message.ioId);
      if (!entry) return true;
      pending.delete(message.ioId);
      if (message.failed) {
        entry.reject(new TypeError(String(message.text || "The page could not perform the request.")));
        return true;
      }
      const status = Number(message.status) || 0;
      const text = String(message.text ?? "");
      entry.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: async () => text,
        json: async () => (text ? JSON.parse(text) : null),
      });
      return true;
    },
    pendingCount: () => pending.size,
  };
};

// The page's half: performs one `io` message with the given fetch and returns
// the `io-result` to post back, or null for any other message.
export const serveWorkerIo = async (message, fetchImpl) => {
  if (!message || message.type !== IO_REQUEST) return null;
  try {
    const response = await fetchImpl(message.url, {
      method: message.method || "GET",
      headers: message.headers || {},
      ...(message.body == null ? {} : { body: message.body }),
      cache: "no-store",
      credentials: "same-origin",
    });
    return { type: IO_RESULT, ioId: message.ioId, status: response.status, text: await response.text() };
  } catch (error) {
    return { type: IO_RESULT, ioId: message.ioId, failed: true, text: String(error?.message || error) };
  }
};
