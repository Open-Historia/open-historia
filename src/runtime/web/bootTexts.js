/*! Open Historia — first-screen text © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the website's home page, its demo notice and the Android boot screen say.
// Those screens are built with plain DOM calls before the game mounts, so the
// string extractor (scripts/i18n/) could not see their text and the shipped
// language packs never carried it: a player's first screen, and on Android the
// screen at every launch, was English whatever language they had chosen.
//
// The text lives here instead, in a constant the extractor reads (a *_TEXTS
// table), so the packs carry it. index.js loads the player's shipped pack
// before these screens paint (setBootTranslations) and each string is looked up
// whole, with the English as the fallback. Each value is one whole sentence or
// label; nothing is glued together from pieces.
//
// Deliberately free of imports, so nativeBoot.js stays loadable by `node --test`.

export const BOOT_TEXTS = Object.freeze({
  // The Android boot screen.
  bootFinding: "Finding the closest community node…",
  bootMainServer: "Connected to the main server",
  bootLocal: "Everything is on this device",
  bootPreparing: "Getting the world ready…",
  // The website's home page.
  homeBadge: "Free & open source · community-hosted alternative to Pax Historia",
  homeTagline: "An AI-driven alternate-history strategy game. Lead any nation on a living world map and reshape history.",
  homeFinding: "Finding the nearest node…",
  homeFindingDetail: "Locating the fastest community server with free capacity.",
  homeOrigin: "Connected via the origin",
  homeOriginDetail: "No community node is online right now — the world map streams from the project origin. You can play normally.",
  homeConnectedTo: "Connected to node",
  homeRegion: "Region",
  homePlayers: "Players",
  homeNodeDetail: "The world map streams from this verified community node — every byte checksum-checked.",
  homeEnter: "Enter Open Historia",
  homeTrust: "Trust is in the checksum and the project signature — never in the node itself.",
  homeHostNode: "Host a node",
  homePrivacy: "Privacy",
  // The website's demo notice.
  demoTitle: "This is a demo of the game",
  demoDesktop: "Open Historia is meant to be played in the desktop app, which runs the world map from your own machine.",
  demoLag: "The browser version streams every map tile over the network, so expect noticeable lag — especially when zooming or panning. It is here to try the game, not to be the best way to play it.",
  demoSaved: "Either way, your games are saved on this device.",
  demoGetApp: "Get the desktop app",
  demoPlay: "Play the demo anyway",
});

let translations = null;

// The player's shipped pack ({ English: translation }), or null/empty for English.
export const setBootTranslations = (pack) => {
  translations = pack && typeof pack === "object" && Object.keys(pack).length ? pack : null;
};

// Whether a pack is in use. The screens then mark themselves data-no-translate:
// the live translator (translator.js) would otherwise look the translated text
// up again and list it as missing.
export const bootTranslated = () => translations !== null;

export const bootText = (key) => {
  const english = BOOT_TEXTS[key] ?? key;
  const translated = translations?.[english];
  return typeof translated === "string" && translated.trim() ? translated : english;
};
