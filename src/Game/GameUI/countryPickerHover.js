/*! Open Historia — which country the new-game picker's map highlights © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/GameUI/countryPickerHover.test.js
//
// The new-game picker (CountryPickerMap.jsx) draws one country highlighted on
// its map. That was the country under the pointer on the map and nothing else.
// Pointing at a country's row in the list under the map highlights it too, so
// the names can be read down with the map showing where each one is. Three
// things can point at a country, then: the pointer on the map, the pointer on
// a row, and the keyboard focus on a row.
//
// Whichever of them pointed last has the highlight.
//
//  - The pointer moving on the map takes it back at once, and the map's own
//    hover is then what it always was: the country under the pointer, or none
//    over the sea and over land nobody can play, whatever row has the focus.
//  - The focus moving down the list wins over a pointer left resting on the
//    map or on another row. Otherwise the keyboard would only work with the
//    mouse parked out of the way.
//  - A row that is left hands the highlight to the other row still pointed at
//    (the focus sits on one while the pointer passed over another, or the
//    other way round), and otherwise to nothing. Never back to the map: the
//    map does not hear the pointer leave it, so what it last had under the
//    pointer is stale by then.
//
// A country is its owner code, compared exactly, never a display name: the
// `code` of a list row is the string a region on the map carries as its owner,
// the same one the picker already uses to tell which regions can be played. A
// row whose country holds no region (a landless polity) matches none, and
// nothing lights.
//
// Import-free, with the repaint passed in, so the rules are tested under node.

// The other thing that can point at a row.
const OTHER_ROW_POINTER = { pointer: "focus", focus: "pointer" };

// `repaint()` is called once for each change of the highlighted country and
// never otherwise. In the picker it is the map's region layer being told it
// changed (one re-rasterise), which is all a hover on the map itself costs.
export const createPickerHover = (repaint = () => {}) => {
  // What each of the three points at now: an owner code, or null for nothing.
  const at = { map: null, pointer: null, focus: null };
  // Which of them pointed last.
  let last = "map";
  let code = null;

  const settle = () => {
    const next = last === "map" ? at.map : at[last] ?? at[OTHER_ROW_POINTER[last]];
    if (next === code) return;
    code = next;
    repaint();
  };
  const point = (by, nextCode) => {
    at[by] = nextCode || null;
    last = by;
    settle();
  };
  // Only the row that is pointed at can be left: a leave that arrives for any
  // other row is old news and must not put out the row pointed at since.
  const leave = (by, rowCode) => {
    if (!rowCode || at[by] !== rowCode) return;
    at[by] = null;
    settle();
  };

  return {
    // The country the map draws highlighted, or null.
    get code() { return code; },
    // The pointer moved on the map: over this playable country, or over none.
    overMap: (mapCode) => point("map", mapCode),
    // The pointer came onto a row of the list, or left it.
    enterRow: (rowCode) => point("pointer", rowCode),
    leaveRow: (rowCode) => leave("pointer", rowCode),
    // The keyboard focus came onto a row, or left it.
    focusRow: (rowCode) => point("focus", rowCode),
    blurRow: (rowCode) => leave("focus", rowCode),
    // The rows the list shows now. A row taken away while it is pointed at (a
    // search narrowing the list under a resting pointer) is sent no leave and
    // no blur, and its country would stay lit with nothing pointing at it.
    rowsShown: (codes) => {
      const shown = new Set(codes);
      for (const by of ["pointer", "focus"]) {
        if (at[by] !== null && !shown.has(at[by])) at[by] = null;
      }
      settle();
    },
  };
};
