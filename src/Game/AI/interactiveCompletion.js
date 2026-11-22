/*! Open Historia - authoritative interactive scene completion display. AGPL-3.0-or-later. */

// A resolved scene may produce a timeline array followed by espionage or other
// automatic turn events. Those events do not belong to the scene. The resolver
// returns the scene's own title; never infer it from events.at(-1).
export const sceneCompletionTitle = (result, fallbackTitle = "") =>
  (typeof result?.resolvedSceneTitle === "string" ? result.resolvedSceneTitle.trim() : "")
  || (typeof fallbackTitle === "string" ? fallbackTitle.trim() : "");
