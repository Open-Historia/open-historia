/*! Open Historia — the major updates' own banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Each major update's banners may have a look of their own (notes.js says how
// one is added). A theme is named here with two things:
//
//   Page     its banners, given { banner, update }: loaded only when one of
//            them is shown (the notice draws the way between pages)
//   chrome   how that way between them is dressed (UpdateNotice.jsx reads it
//            at once): { button, arrow, dot: { on, off, radius }, skip }, each
//            a style laid over the plain one; or (banner) => that, for a theme
//            that dresses each banner in its own palette (chronicleChrome.js). "everything to do with it should
//            be themed" (the owner, 2026-10-15): nothing of a theme's notice is
//            the game's own blue.
//
// A banner naming a theme that is not here is shown in the decorated default
// (UpdateNotice.jsx DefaultBanner), its way between pages in its palette.

import { lazy } from "react";

import { AIR_RAID_CHROME } from "./airRaidChrome.js";
import { CHRONICLE_CHROME } from "./chronicleChrome.js";
import { ESPIONAGE_2_CHROME } from "./espionage2Chrome.js";
import { MUSIC_CHROME } from "./musicChrome.js";
import { ROSTRA_CHROME } from "./rostraChrome.js";
import { SEASONS_CHROME } from "./seasonsChrome.js";
import { SWARMS_CHROME } from "./swarmsChrome.js";
import { WARS_AND_FRONTS_2_CHROME } from "./warsAndFronts2Chrome.js";

export const THEMES = Object.freeze({
  rostra: { Page: lazy(() => import("./Rostra.jsx")), chrome: ROSTRA_CHROME },
  airRaid: { Page: lazy(() => import("./AirRaid.jsx")), chrome: AIR_RAID_CHROME },
  espionage2: { Page: lazy(() => import("./Espionage2.jsx")), chrome: ESPIONAGE_2_CHROME },
  swarms: { Page: lazy(() => import("./Swarms.jsx")), chrome: SWARMS_CHROME },
  warsAndFronts2: { Page: lazy(() => import("./WarsAndFronts2.jsx")), chrome: WARS_AND_FRONTS_2_CHROME },
  seasonsAndWeather: { Page: lazy(() => import("./SeasonsAndWeather.jsx")), chrome: SEASONS_CHROME },
  music: { Page: lazy(() => import("./Music.jsx")), chrome: MUSIC_CHROME },
  chronicle: { Page: lazy(() => import("./Chronicle.jsx")), chrome: CHRONICLE_CHROME },
});
