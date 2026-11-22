/*!
 * Open Historia Map Editor — shortcuts bound to the one native OlMap tool owner.
 * Do not capture shortcuts while the author is typing or making a sketch.
 */
import { TOOLS } from "./editorToolCatalog.js";

const byKey = new Map(TOOLS.map((tool) => [tool.hotkey.toLowerCase(), tool.id]));

export const toolForHotkey = (event, { sketching = false, modalOpen = false } = {}) => {
  if (!event || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
      event.isComposing || event.repeat || sketching || modalOpen) return null;
  const active = event.target;
  if (active?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName || "") ||
      active?.closest?.('[contenteditable="true"],[role="textbox"]')) return null;
  return byKey.get(String(event.key || "").toLowerCase()) || null;
};
