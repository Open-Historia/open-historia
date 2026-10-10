import test from "node:test";
import assert from "node:assert/strict";

import { advancePoliticalBackgroundBatchInWorker } from "./politicalBackgroundClient.js";

test("a crashed political worker is rebuilt on the next request; an unconstructible one stays off", async () => {
  const originalWorker = globalThis.Worker;
  const built = [];
  try {
    globalThis.Worker = class FakeWorker {
      constructor() {
        built.push(this);
        this.crashes = built.length === 1;
      }

      postMessage({ id, payload }) {
        queueMicrotask(() => {
          if (this.crashes || payload?.crash) this.onerror?.({ message: "worker blew up" });
          else this.onmessage?.({ data: { id, result: { echoed: payload.value } } });
        });
      }

      terminate() {
        this.terminated = true;
      }
    };

    await assert.rejects(advancePoliticalBackgroundBatchInWorker({ value: 1 }), /worker blew up/);
    assert.equal(built[0].terminated, true);

    assert.deepEqual(await advancePoliticalBackgroundBatchInWorker({ value: 2 }), { echoed: 2 });
    assert.deepEqual(await advancePoliticalBackgroundBatchInWorker({ value: 3 }), { echoed: 3 });
    assert.equal(built.length, 2, "a healthy worker is reused");

    await assert.rejects(advancePoliticalBackgroundBatchInWorker({ crash: true }), /worker blew up/);

    let constructions = 0;
    globalThis.Worker = class ThrowingWorker {
      constructor() {
        constructions += 1;
        throw new Error("no module workers here");
      }
    };
    assert.deepEqual(await advancePoliticalBackgroundBatchInWorker({ value: 4 }), { skipped: true, reason: "worker-unavailable" });
    assert.deepEqual(await advancePoliticalBackgroundBatchInWorker({ value: 5 }), { skipped: true, reason: "worker-unavailable" });
    assert.equal(constructions, 1);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});
