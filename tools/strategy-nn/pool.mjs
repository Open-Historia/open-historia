/*! Open Historia — the strategy network experiment: a pool of workers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// As many workers as asked for (worker.mjs), and a queue of tasks for them.

import { Worker } from "node:worker_threads";

export const createPool = (size) => {
  const idle = [];
  const waiting = [];
  const pending = new Map();
  let next = 1;
  const workers = Array.from({ length: size }, () => {
    const worker = new Worker(new URL("./worker.mjs", import.meta.url));
    worker.on("message", ({ id, results, error }) => {
      const task = pending.get(id);
      pending.delete(id);
      idle.push(worker);
      pump();
      if (error) task.reject(new Error(error));
      else task.resolve(results);
    });
    worker.on("error", (error) => {
      for (const task of pending.values()) task.reject(error);
      pending.clear();
    });
    idle.push(worker);
    return worker;
  });
  const pump = () => {
    while (idle.length > 0 && waiting.length > 0) {
      const worker = idle.pop();
      const task = waiting.shift();
      pending.set(task.message.id, task);
      worker.postMessage(task.message);
    }
  };
  return {
    size,
    // Fights what a task says; resolves to what worker.mjs answered.
    run: (message) => new Promise((resolve, reject) => {
      waiting.push({ message: { ...message, id: next++ }, resolve, reject });
      pump();
    }),
    close: () => Promise.all(workers.map((worker) => worker.terminate())),
  };
};

// One staff against another over many scenarios, split among the workers:
// { margin, won, drawn, played, games? } summed (and the games in the seeds' order, with `detail`).
export const playMatch = async (pool, a, b, seeds, { detail = false, chunk = 2, duels = false } = {}) => {
  const tasks = [];
  for (let at = 0; at < seeds.length; at += chunk) tasks.push(pool.run({ a, b, seeds: seeds.slice(at, at + chunk), detail, duels }));
  const parts = (await Promise.all(tasks)).flat();
  const chosen = {};
  for (const part of parts) for (const [name, count] of Object.entries(part.chosen ?? {})) chosen[name] = (chosen[name] ?? 0) + count;
  return {
    chosen,
    margin: parts.reduce((sum, part) => sum + part.margin, 0),
    won: parts.reduce((sum, part) => sum + part.won, 0),
    drawn: parts.reduce((sum, part) => sum + part.drawn, 0),
    played: parts.reduce((sum, part) => sum + part.played, 0),
    ...(detail ? { games: parts.flatMap((part) => part.games ?? []) } : {}),
  };
};
