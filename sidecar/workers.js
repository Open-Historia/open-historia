import fs from "node:fs";
import path from "node:path";
import { Worker as NodeWorker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const WORKER_ENTRIES = Object.freeze({
  "countryStatsWorker.js": "../../src/Game/AI/countryStatsWorker.js",
  "worldDirectorWorker.js": "../../src/Game/AI/worldDirectorWorker.js",
  "politicalBackgroundWorker.js": "../../src/runtime/politicalBackgroundWorker.js",
  "frontWorker.js": "../../src/Game/AI/frontWorker.js",
  "rehearserWorker.js": "../../src/Game/AI/rehearserWorker.js",
});

const nameOf = (url) => {
  const text = url instanceof URL ? url.href : String(url ?? "");
  try {
    return path.posix.basename(new URL(text, "file:///").pathname);
  } catch {
    return path.posix.basename(text);
  }
};

export const installWorkerShim = ({ origin, distDir = path.join(here, "dist", "workers") }) => {
  class ShimWorker extends EventTarget {
    #worker;

    constructor(url, options = {}) {
      super();
      this.onmessage = null;
      this.onerror = null;
      this.onmessageerror = null;
      const name = nameOf(url);
      const bundle = path.join(distDir, name.replace(/\.js$/, ".mjs"));
      if (!WORKER_ENTRIES[name] || !fs.existsSync(bundle)) {
        throw new Error(`The native engine has no build of the ${name} worker.`);
      }
      this.#worker = new NodeWorker(path.join(here, "workerHost.mjs"), {
        workerData: { entry: bundle, origin, distDir },
        name: String(options?.name ?? name),
        stdout: true,
        stderr: true,
      });
      this.#worker.stdout.on("data", (chunk) => process.stderr.write(chunk));
      this.#worker.stderr.on("data", (chunk) => process.stderr.write(chunk));
      this.#worker.on("message", (data) => {
        const event = new MessageEvent("message", { data });
        if (typeof this.onmessage === "function") this.onmessage(event);
        this.dispatchEvent(event);
      });
      this.#worker.on("error", (error) => {
        const event = new Event("error");
        event.message = String(error?.message ?? error);
        event.error = error;
        if (typeof this.onerror === "function") this.onerror(event);
        this.dispatchEvent(event);
      });
      this.#worker.unref();
    }

    postMessage(data, transfer = undefined) {
      const list = Array.isArray(transfer) ? transfer : Array.isArray(transfer?.transfer) ? transfer.transfer : undefined;
      this.#worker.postMessage(data, list);
    }

    terminate() {
      void this.#worker.terminate();
    }
  }

  globalThis.Worker = ShimWorker;
};
