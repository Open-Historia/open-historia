/*! Open Historia — Deploy Aircraft: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// As the air raid's banner is dressed (AirRaid.jsx): a night sky over a city
// under the searchlights, a pale moon, and the amber of flak for what is
// pressed.

export const AIR_RAID_NIGHT = "#0c1420";
export const AIR_RAID_MOON = "#e9e3cf";
export const AIR_RAID_MOON_SOFT = "rgba(233,227,207,0.74)";
export const AIR_RAID_FLAK = "#e9a23b";
export const AIR_RAID_FACE = "\"Bahnschrift Condensed\", \"Bahnschrift\", \"DIN Condensed\", \"Oswald\", \"Arial Narrow\", sans-serif";

export const AIR_RAID_CHROME = Object.freeze({
  button: {
    background: AIR_RAID_FLAK,
    border: `1px solid ${AIR_RAID_FLAK}`,
    borderRadius: "3px",
    color: AIR_RAID_NIGHT,
    fontFamily: AIR_RAID_FACE,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  arrow: {
    background: "rgba(233,227,207,0.06)",
    border: `1px solid ${AIR_RAID_MOON}`,
    color: AIR_RAID_MOON,
  },
  dot: { on: AIR_RAID_FLAK, off: "rgba(233,227,207,0.3)" },
  skip: { color: AIR_RAID_MOON, fontFamily: AIR_RAID_FACE, letterSpacing: "0.06em" },
});
