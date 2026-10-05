/*! Open Historia — the Projects board's Tags menu: what its search shows and where its arrow keys go © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The pure half of the Tags menu on the Projects & Operations board
// (projects.jsx): the order it lists the tags in, which of them its search box
// leaves showing, and where an arrow key takes the focus across the columns
// they are drawn in. Free of React and of the DOM so node can test it; the
// panel hands in the tags, what was typed, and how many columns it measured.
//
// Run the tests: node --test src/Game/GameUI/projectTagMenu.test.js

// A search box earns its row once the list is longer than a glance takes in.
// Under this many tags the menu is the tags and the way to clear them.
export const TAG_SEARCH_FROM = 12;

// The order the menu lists the tags in: the ticked ones first, then the rest,
// each in the order it came in (most used first, runtime/projects.js
// collectProjectTags). Sixty tags are three screens of menu, and a filter set
// earlier should not have to be scrolled for before it can be taken off again.
// The panel asks once, with what was ticked as the menu opened, and keeps that
// order while it is open, so no tag moves from under the pointer as it is
// ticked.
export const tickedFirst = (tags, ticked) => {
  const list = Array.isArray(tags) ? tags : [];
  const chosen = new Set(Array.isArray(ticked) ? ticked : []);
  if (chosen.size === 0) return list;
  return [...list.filter((tag) => chosen.has(tag)), ...list.filter((tag) => !chosen.has(tag))];
};

// One spelling for a tag and for what is typed to find it. Case and accents are
// left out, and so is whatever separates the words: the vocabulary is open
// (runtime/countryTags.js), so one idea turns up as "anti-nato", "anti nato" and
// "Anti-NATO", and a player typing any of them means all three. Letters and
// digits of every script are kept, because the model writes tags in the
// language the game is played in. Lower case comes first: "İ" lowers to an "i"
// with a combining dot, which only goes if the marks are taken out afterwards.
const foldTag = (value) => String(value ?? "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/\p{M}+/gu, "")
  .replace(/[^\p{L}\p{N}]+/gu, "");

// The tags the search box leaves in the menu, in the order they came in.
// Nothing typed shows them all. A tag matches by its folded spelling or exactly
// as it is written; the second is what finds a tag made of signs the fold
// drops.
export const searchTags = (tags, query) => {
  const list = Array.isArray(tags) ? tags : [];
  const typed = String(query ?? "").trim().toLowerCase();
  if (!typed) return list;
  const needle = foldTag(typed);
  return list.filter((tag) => {
    const written = String(tag ?? "").toLowerCase();
    return written.includes(typed) || (needle !== "" && foldTag(written).includes(needle));
  });
};

// Where a key takes the focus from tag `index` of `count`, drawn `columns` to a
// row: the index to focus next, or null for a key the menu leaves alone. At an
// edge the answer is the index it was given. The key is still the menu's there,
// and saying so stops the list scrolling under a focus that did not move.
//
// `rtl`: the interface reads right to left (Arabic, Persian, Urdu), where the
// grid fills from the right and the tag after this one is on its LEFT.
export const stepTagFocus = ({ key, index, count, columns = 1, rtl = false } = {}) => {
  const total = Math.floor(Number(count)) || 0;
  const at = Math.floor(Number(index));
  if (total <= 0 || !(at >= 0 && at < total)) return null;
  const perRow = Math.max(1, Math.floor(Number(columns)) || 1);
  const last = total - 1;
  const forward = rtl ? "ArrowLeft" : "ArrowRight";
  const back = rtl ? "ArrowRight" : "ArrowLeft";
  if (key === forward) return Math.min(at + 1, last);
  if (key === back) return Math.max(at - 1, 0);
  // A short last row has nothing under the columns it does not reach. From the
  // row above, Down still goes somewhere: to the last tag.
  if (key === "ArrowDown") return Math.floor(at / perRow) < Math.floor(last / perRow) ? Math.min(at + perRow, last) : at;
  if (key === "ArrowUp") return at >= perRow ? at - perRow : at;
  if (key === "Home") return 0;
  if (key === "End") return last;
  return null;
};
