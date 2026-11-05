/*! Open Historia — a worker a staff's plans are fought in © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One of the cores the war's run (frontWorker.js) sends its staff's plans to:
// "do the multi-core rehearsals too" (the owner, 2026-10-16). It is sent the
// battle as it stands and the plans to fight on copies of it, one at a time,
// and answers each with how the battle came out
// (runtime/fronts/mind/rehearsers.js answerRehearsal).

import { answerRehearsal } from "../../runtime/fronts/mind/rehearsers.js";

const state = { look: null };

self.onmessage = (event) => {
  const reply = answerRehearsal(state, event?.data);
  if (reply) self.postMessage(reply);
};
