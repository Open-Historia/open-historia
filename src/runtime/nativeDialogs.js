/*! Open Historia — the browser's own dialogs, in the player's language © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The interface asks with window.confirm() and tells with window.alert() in
// some eighty places (deleting a map, discarding an institution's edits, a
// Workshop import that failed). Those boxes are drawn by the browser, not the
// page, so the DOM translator (translator.js) never saw them: their text was
// in the catalog and the packs, and still showed in English in every language.
// Each one's message is now looked up first, exactly or by pattern
// (`Delete {{count}} selected features?`), and, failing that, line by line,
// for a message built of sentences the packs hold one by one.

const translateParts = (message, translate) => {
  const parts = message.split(/(\n\s*\n|\n)/);
  if (parts.length < 2) return message;
  let changed = false;
  const out = parts.map((part, index) => {
    if (index % 2 === 1 || !part.trim()) return part;
    const translated = translate(part);
    if (typeof translated !== "string" || translated === part) return part;
    changed = true;
    return translated;
  });
  return changed ? out.join("") : message;
};

// `translate`: the English → the player's language, or the English back
// (translator.js translateNow).
export const translateDialogText = (message, translate) => {
  if (typeof message !== "string" || !message.trim() || typeof translate !== "function") return message;
  const whole = translate(message);
  if (typeof whole === "string" && whole !== message && whole.trim()) return whole;
  return translateParts(message, translate);
};

// Wraps the target's alert, confirm and prompt, once. A prompt's default value
// is the player's or the game's data, and is left alone.
export const installNativeDialogTranslation = (target, translate) => {
  if (!target || typeof translate !== "function" || target.__ohDialogsTranslated) return false;
  for (const name of ["alert", "confirm", "prompt"]) {
    const original = target[name];
    if (typeof original !== "function") continue;
    target[name] = (message, ...rest) => original.call(target, translateDialogText(message, translate), ...rest);
  }
  target.__ohDialogsTranslated = true;
  return true;
};
