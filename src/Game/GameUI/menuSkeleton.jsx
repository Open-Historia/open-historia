/*! Open Historia — the main menu's skeletons © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What a page of the main menu shows while what it lists is on its way: the
// outlines of its cards, standing where the cards will be, with a glimmer
// passing over them, and no "Loading" written anywhere on the screen. "when
// loading a menu page, it shouldnt say loading, it should show outlines of
// where all the games/scenarios go with a glimmer animation (like youtube
// loading does)" (the owner, 2026-10-14).
//
// Each outline has the corners, the least height, the padding and the parts of
// the card it stands for: the Games and the Scenarios tabs' cards (GameCard and
// ScenarioCard in libraryBar.jsx) and the Community tab's (ScenarioCard in
// communityHub.jsx, as its browse grid lays it out). The library's outlines
// are handed to its LibraryCollection as children, so they sit in its own grid
// (or a phone's shelf); the other pages' outlines carry their page's grid.
//
// The glimmer is .oh-skeleton in styles.css: a flat band of light carried
// across each card. No gradient (noGradients.test.js), and under reduced
// motion no band at all: the outlines stand still.
//
// Outlines are aria-hidden. What a screen reader is told meanwhile is the
// page's own words, read and not seen (.oh-visually-hidden, role="status").

// The outlines' greys: a card's ground and edge, and the shapes on it (a line
// of text, a button, a picture). Flat, like every surface of the menu.
const GROUND = "rgba(255,255,255,0.03)";
const EDGE = "1px solid rgba(255,255,255,0.08)";
const INK = "rgba(255,255,255,0.07)";

// One shape: a line of text (`radius` "6px"), a pill (the default), a field,
// a picture.
const Shape = ({ height = "0.8rem", radius = "999px", style = null, width = "100%" }) => (
  <div style={{ background: INK, borderRadius: radius, height, maxWidth: "100%", width, ...style }} />
);

// A screen reader's line, unseen.
const Unseen = ({ children }) => <span className="oh-visually-hidden">{children}</span>;

const libraryCard = ({ minHeight, width }) => ({
  background: GROUND,
  border: EDGE,
  borderRadius: "24px",
  flex: `0 0 ${width}`,
  minHeight,
});
const libraryCardBody = { display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", padding: "1.2rem" };

// A game's card: the pill and the scenario's name with the ⋮ in the corner;
// the game's name, where and when it is, and what it is about; its counts,
// Play and Archive.
export const GameCardSkeleton = ({ width = "100%" }) => (
  <div aria-hidden="true" className="oh-skeleton" style={libraryCard({ minHeight: "22rem", width })}>
    <div style={libraryCardBody}>
      <div>
        <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
          <div style={{ alignItems: "center", display: "flex", flex: 1, gap: "0.5rem", minWidth: 0 }}>
            <Shape height="1.65rem" style={{ flexShrink: 0 }} width="6.2rem" />
            <Shape height="0.76rem" radius="6px" width="38%" />
          </div>
          <Shape height="2.2rem" style={{ flexShrink: 0 }} width="2.2rem" />
        </div>
        <div style={{ marginTop: "2rem" }}>
          <Shape height="1.5rem" radius="7px" width="62%" />
          <Shape height="0.92rem" radius="6px" style={{ marginTop: "0.75rem" }} width="80%" />
          <Shape height="0.84rem" radius="6px" style={{ marginTop: "0.85rem" }} width="94%" />
          <Shape height="0.84rem" radius="6px" style={{ marginTop: "0.45rem" }} width="68%" />
        </div>
      </div>
      <div style={{ marginTop: "1.5rem" }}>
        <Shape height="0.8rem" radius="6px" style={{ marginBottom: "0.9rem" }} width="56%" />
        <Shape height="2.2rem" />
        <Shape height="2.2rem" style={{ marginTop: "0.55rem" }} />
      </div>
    </div>
  </div>
);

// A scenario's card: the pill and its count of games; its title and what it
// is about; its subtitle, New Game and Edit, and Clone Scenario under them.
export const ScenarioCardSkeleton = ({ width = "100%" }) => (
  <div aria-hidden="true" className="oh-skeleton" style={libraryCard({ minHeight: "22rem", width })}>
    <div style={libraryCardBody}>
      <div>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
          <Shape height="1.65rem" width="6.6rem" />
          <Shape height="0.74rem" radius="6px" width="3.8rem" />
        </div>
        <div style={{ marginTop: "4rem" }}>
          <Shape height="2rem" radius="8px" width="72%" />
          <Shape height="0.92rem" radius="6px" style={{ marginTop: "0.9rem" }} width="88%" />
          <Shape height="0.92rem" radius="6px" style={{ marginTop: "0.42rem" }} width="80%" />
          <Shape height="0.92rem" radius="6px" style={{ marginTop: "0.42rem" }} width="52%" />
        </div>
      </div>
      <div style={{ marginTop: "1.5rem" }}>
        <Shape height="0.8rem" radius="6px" style={{ marginBottom: "0.9rem" }} width="64%" />
        <div style={{ display: "flex", gap: "0.55rem" }}>
          <Shape height="2.2rem" style={{ flex: 1 }} width="auto" />
          <Shape height="2.2rem" style={{ flex: 1 }} width="auto" />
        </div>
        <Shape height="2.2rem" style={{ marginTop: "0.55rem" }} />
      </div>
    </div>
  </div>
);

// `count` outlines of the Games tab's cards (kind "game") or the Scenarios
// tab's ("scenario"), for a LibraryCollection to lay out as its own children;
// `width` is a card's width on a phone's shelf (SHELF_CARD_WIDTH).
export const MenuCardSkeletons = ({ count, kind, width }) => {
  const Card = kind === "scenario" ? ScenarioCardSkeleton : GameCardSkeleton;
  return Array.from({ length: count }, (_, index) => <Card key={index} width={width} />);
};

// A post's card in the Community tab's browse grid: its cover (16:9), the
// author's picture with the title and the byline beside it, the description,
// and the counts with the two pills.
export const CommunityCardSkeleton = () => (
  <div
    aria-hidden="true"
    className="oh-skeleton"
    style={{ background: GROUND, border: EDGE, borderRadius: "16px", display: "flex", flexDirection: "column", gap: "0.55rem", minWidth: 0, padding: "0.9rem", width: "100%" }}
  >
    <Shape height="auto" radius="10px" style={{ aspectRatio: "16 / 9" }} />
    <div style={{ alignItems: "center", display: "flex", gap: "0.55rem" }}>
      <Shape height="1.6rem" radius="50%" style={{ flexShrink: 0 }} width="1.6rem" />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "0.32rem", minWidth: 0 }}>
        <Shape height="0.95rem" radius="6px" width="72%" />
        <Shape height="0.7rem" radius="6px" width="46%" />
      </div>
    </div>
    <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "0.42rem" }}>
      <Shape height="0.8rem" radius="6px" width="96%" />
      <Shape height="0.8rem" radius="6px" width="70%" />
    </div>
    <div style={{ alignItems: "center", display: "flex", gap: "0.5rem" }}>
      <Shape height="0.76rem" radius="6px" style={{ flexShrink: 0 }} width="2rem" />
      <Shape height="0.76rem" radius="6px" style={{ flexShrink: 0 }} width="2rem" />
      <Shape height="0.76rem" radius="6px" style={{ flexShrink: 0 }} width="2rem" />
      <div style={{ flex: 1 }} />
      <Shape height="1.8rem" style={{ flexShrink: 0 }} width="4.6rem" />
      <Shape height="1.8rem" style={{ flexShrink: 0 }} width="4.2rem" />
    </div>
  </div>
);

// The widths of the Community tab's controls: the search field, Refresh,
// Publish to Hub, Open Hub, Join the Discord.
const COMMUNITY_CONTROLS = ["12rem", "4.6rem", "8.4rem", "6.4rem", "9rem"];

// The Community tab while the hub's list of scenarios is on its way: its
// browse grid's outlines (`gridTemplate`: communityHub.jsx's
// COMMUNITY_GRID_TEMPLATE) and, while the tab's own code is still on its way
// too (`withHeader`), the help, the controls and the licence line above them.
export const CommunitySkeleton = ({ count = 8, gridTemplate, label, withHeader = false }) => (
  <div role="status">
    <Unseen>{label}</Unseen>
    <div aria-hidden="true">
      {withHeader && (
        <>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem 1rem", marginBottom: "0.9rem" }}>
            <div style={{ flex: "1 1 20rem", minWidth: 0 }}>
              <Shape height="0.78rem" radius="6px" width="92%" />
              <Shape height="0.78rem" radius="6px" style={{ marginTop: "0.42rem" }} width="58%" />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end", marginLeft: "auto" }}>
              {COMMUNITY_CONTROLS.map((width, index) => <Shape key={index} height="2rem" width={width} />)}
            </div>
          </div>
          <Shape height="0.76rem" radius="6px" style={{ marginBottom: "0.7rem" }} width="16rem" />
        </>
      )}
      <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: gridTemplate, paddingBottom: "0.35rem" }}>
        {Array.from({ length: count }, (_, index) => <CommunityCardSkeleton key={index} />)}
      </div>
    </div>
  </div>
);
