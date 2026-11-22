/*! Open Historia — Map Editor V2 update, the cartographer's drafting-room chrome © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Flat brass and ink, not the application's usual blue. Theme lives only
// inside the update notice, not the editor or its user-selectable UI theme.
export const ATLAS = Object.freeze({
  desk: "#151c1e",
  stage: "#1d292b",
  paper: "#e8dcc2",
  paperSoft: "#f4e9d3",
  ink: "#213332",
  brass: "#dfb775",
  cream: "#f4ecd9",
  muted: "rgba(244,236,217,0.68)",
  line: "rgba(223,183,117,0.32)",
  green: "#47746a",
  water: "#9bb6b0",
  ochre: "#cfa672",
  navy: "#375d63",
});

export const MAP_EDITOR_V2_CHROME = Object.freeze({
  button: {
    background: ATLAS.brass,
    border: `1px solid ${ATLAS.brass}`,
    borderRadius: "3px",
    boxShadow: "3px 3px 0 #0b1112",
    color: ATLAS.ink,
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontWeight: 800,
    letterSpacing: "0.02em",
  },
  arrow: {
    background: ATLAS.stage,
    border: `1px solid ${ATLAS.line}`,
    borderRadius: "3px",
    color: ATLAS.brass,
  },
  dot: { on: ATLAS.brass, off: "rgba(223,183,117,0.24)", radius: "1px" },
  skip: { color: ATLAS.muted, fontFamily: "Georgia, 'Times New Roman', serif" },
});
