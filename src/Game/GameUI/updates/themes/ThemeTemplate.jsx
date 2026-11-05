/*! Open Historia — a major update's banner: the template to copy © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Copy this file to <Name>.jsx, name it in themes/index.js (with its chrome:
// warsAndFronts2Chrome.js is one), and set the banners' `theme` to that name
// (notes.js). Everything a banner says comes
// from the banner, so the words stay in one place; what is here is how it
// looks. A theme may draw several kinds of page, told apart by `banner.scene`
// (WarsAndFronts2.jsx draws two). The notice around it (UpdateNotice.jsx)
// draws the arrows between pages and the button: a theme draws only its page.
//
// The kit (updateKit.jsx) has the Plate, Brackets, the Emblem, Rules,
// FeatureCards, ICONS, Reveal, NoticeButton and the keyframes they use; a
// theme adds its own surface (a colour, or a made picture: the war theme's
// steel is roughMetal.js) and its own picture (an <svg> of flat shapes, its
// parts moving with `motion(still, ...)` or `forever(still, ...)`). Nothing
// may be a gradient (noGradients.test.js), and nothing purple. Look at it with
// ?updateNotice=<the update's id>.
//
// This file is named nowhere: it is shown nowhere.

import React from "react";

import { ACCENT, Brackets, Emblem, FeatureCards, Plate, Reveal, Rule, noticeDate, useStill } from "../updateKit.jsx";

const ThemeTemplate = ({ banner, update }) => {
  const still = useStill();
  return (
    <Plate surface={{ background: "#14202a" }}>
      <Brackets colour={ACCENT} />
      <div style={{ padding: "2rem" }}>
        <Reveal delay={150} style={{ alignItems: "center", display: "flex", gap: "1rem" }}>
          <Emblem colour={ACCENT} delay={200} />
          <div>
            <div style={{ color: ACCENT, letterSpacing: "0.2em", textTransform: "uppercase" }}>{noticeDate(update.date)}</div>
            <div style={{ color: "#f4f4f5", fontSize: "2.4rem", fontWeight: 900 }}>{banner.title}</div>
          </div>
        </Reveal>
        {/* The theme's own picture goes here: an <svg>, its parts moving unless `still`. */}
        <div data-still={still ? "" : undefined} />
        <Rule colour={ACCENT} />
        <FeatureCards accent={ACCENT} delay={400} sections={banner.sections ?? []} />
      </div>
    </Plate>
  );
};

export default ThemeTemplate;
