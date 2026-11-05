/*! Open Historia — the real world's own climate zones and hard ground, for every scenario on the built-in basemaps © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Make the default climate zones on every existing scenario be very large
// realistic zones that cover areas that have similar weather usually. like
// alot of russia is really cold", "also add terrain traversability to
// realistic places all over the map. where it should be. the terrain
// traversability marker should not be visible ingame, it should only effect
// troops in the backend", and "all scenarios that use one of the built in
// ezri basemaps should get the default climate and terrain from the modern day
// scenario" (the owner, 2026-10-14).
//
// A scenario on the built-in basemaps (one that declares no map of its own:
// no world.background, so the Earth's own tiles are under it, as under Modern
// Day) is fought on the real world's climates and ground: these, wherever its
// author painted none of their own. A scenario with a map of its own (a
// picture, a drawn map, the plain sea of a flat sheet) is another world, and
// has only what its author painted.
//
//   WORLD_CLIMATE_ZONES   continent-wide zones, each with its own seasons,
//                         drawn as curves (fronts/climate.js curvedRings)
//   WORLD_TERRAIN_AREAS   the ground that is hard to cross: the great ranges,
//                         the marshes, the jungles, the sand seas and the
//                         roadless north, at a level of 3 to 9
//
// Clear skies are the commonest weather in every zone in nearly every season
// ("dont make it so there is always a weather condition, clear skies should be
// very common"): a season's cold, heat and slowness are felt on its clear days
// all the same, so a Siberian winter is no less a Siberian winter for them.
//
// A scenario's own zones stand in for all of these zones, and its own terrain
// for all of this terrain: an author who paints climates paints the whole of
// them. The Workshop can start an author from these (WarMapPanel.jsx).
//
// Pure, and loads in plain Node.

import { normalizeClimateZones, normalizeTerrainAreas } from "./warGeography.js";

// ---- seasons ---------------------------------------------------------------------------

// The four seasons by the northern months, and by the southern.
const NORTH = Object.freeze({ winter: ["12-01", "02-28"], spring: ["03-01", "05-31"], summer: ["06-01", "08-31"], autumn: ["09-01", "11-30"] });
const SOUTH = Object.freeze({ winter: ["06-01", "08-31"], spring: ["09-01", "11-30"], summer: ["12-01", "02-28"], autumn: ["03-01", "05-31"] });
const season = (name, [start, end], weather, effects = {}) => ({ name, start, end, weather, effects });
const fourSeasons = (dates, winter, spring, summer, autumn) => [
  season("Winter", dates.winter, ...winter),
  season("Spring", dates.spring, ...spring),
  season("Summer", dates.summer, ...summer),
  season("Autumn", dates.autumn, ...autumn),
];

// What a season does, beside its weather.
const DEEP_COLD = Object.freeze({ pace: 0.55, cold: 1.2, air: 0.55, freezes: true });
const COLD = Object.freeze({ pace: 0.75, cold: 0.7, air: 0.8, freezes: true });
const CHILL = Object.freeze({ cold: 0.3, freezes: true });
const THAW = Object.freeze({ pace: 0.6 });
const HOT = Object.freeze({ heat: 0.9, pace: 0.88 });
const WARM = Object.freeze({ heat: 0.35 });
const WET = Object.freeze({ pace: 0.85, air: 0.85 });
const MONSOON = Object.freeze({ pace: 0.72, air: 0.7 });

// A zone: its name, colour, outline ([lng, lat], drawn as a curve) and seasons.
const zone = (id, name, color, rings, seasons, blendKm = 520) => ({ id, name, color, blendKm, transitionDays: 20, rings: [rings], seasons, events: [] });

// ---- the climate zones ----------------------------------------------------------------

const ZONES = [
  zone("world-arctic-north", "The Arctic North", "#a8c4dc", [[-168, 66.5], [-160, 71.5], [-140, 70.5], [-125, 70], [-110, 68.5], [-97, 67], [-90, 64], [-82, 61], [-78, 59.5], [-71, 59], [-63, 60], [-57, 63], [-48, 60], [-40, 63.5], [-22, 70], [-18, 78], [-30, 83.5], [-70, 83.5], [-100, 81], [-125, 78], [-150, 74], [-168, 71]], [
    season("Polar winter", ["10-01", "04-30"], { clear: 5, frost: 3, snow: 3, blizzard: 1 }, DEEP_COLD),
    season("Thaw", ["05-01", "06-15"], { clear: 5, frost: 2, fog: 2, snow: 1, mud: 1 }, { pace: 0.75, cold: 0.4, freezes: true }),
    season("Polar summer", ["06-16", "08-31"], { clear: 6, fog: 2, rain: 2 }, { cold: 0.2 }),
    season("Freeze-up", ["09-01", "09-30"], { clear: 4, frost: 3, snow: 2, fog: 1 }, COLD),
  ]),
  zone("world-northern-forests", "The Northern Forests", "#8fb0a2", [[-166, 61], [-158, 64.5], [-163.27702, 69.58905], [-146.37618, 70.82433], [-134.87453, 70.33052], [-130.93171, 70.19918], [-125, 70], [-116.19873, 69.13247], [-100.78498, 67.44667], [-85.90533, 62.50224], [-82, 61], [-78, 59.5], [-65.63537, 57.97676], [-64, 55], [-56, 52], [-60, 47.5], [-68, 46], [-78, 46.5], [-89, 48], [-100, 50], [-113, 52.5], [-121, 47], [-131, 57.5], [-140, 59], [-152, 59], [-160, 59]], [
    season("Winter", ["11-01", "03-31"], { clear: 5, snow: 3, frost: 2, blizzard: 1 }, COLD),
    season("Thaw", ["04-01", "05-31"], { clear: 5, mud: 2, rain: 2, frost: 1 }, THAW),
    season("Summer", ["06-01", "08-31"], { clear: 7, rain: 2, storm: 1 }),
    season("Autumn", ["09-01", "10-31"], { clear: 5, rain: 2, fog: 1, frost: 1, snow: 1 }, { cold: 0.2 }),
  ]),
  zone("world-pacific-north-west", "The Pacific North-West", "#86aab0", [[-140, 60], [-132, 58], [-128, 54], [-124, 50.5], [-121, 47], [-121, 42.5], [-123.5, 39], [-125, 40], [-125, 45], [-127, 50], [-132, 55], [-138, 59.5]], fourSeasons(NORTH,
    [{ clear: 4, rain: 4, fog: 1, storm: 1 }, WET],
    [{ clear: 6, rain: 3, fog: 1 }],
    [{ clear: 8, fog: 1, heat: 1 }],
    [{ clear: 5, rain: 3, fog: 2 }],
  ), 360),
  zone("world-american-west", "The American West", "#c9b483", [[-121, 47], [-114, 50], [-104, 50], [-98, 49], [-97, 43], [-98, 37], [-100, 32], [-104, 29.5], [-110, 31.5], [-114, 32.5], [-117.5, 32.5], [-120.5, 34.5], [-122.5, 37.5], [-123.5, 39], [-121, 42.5]], fourSeasons(NORTH,
    [{ clear: 7, frost: 2, snow: 1 }, CHILL],
    [{ clear: 7, rain: 2, storm: 1 }],
    [{ clear: 7, heat: 3 }, WARM],
    [{ clear: 9, frost: 1 }],
  )),
  zone("world-american-north-east", "The American North-East", "#94b38c", [[-97, 43], [-98, 49], [-89, 48.5], [-82, 46.5], [-76, 45], [-71, 47], [-67, 47.5], [-64, 45.5], [-70, 41.5], [-74, 39.5], [-76, 37.5], [-82, 37], [-90, 37], [-98, 37]], fourSeasons(NORTH,
    [{ clear: 5, snow: 2, frost: 2, rain: 1 }, { pace: 0.85, cold: 0.4, freezes: true }],
    [{ clear: 6, rain: 3, mud: 1 }],
    [{ clear: 7, storm: 1, heat: 1, rain: 1 }, WARM],
    [{ clear: 7, rain: 2, fog: 1 }],
  )),
  zone("world-american-south", "The American South", "#a9bd7e", [[-104, 29.5], [-100, 32], [-98, 37], [-90, 37], [-82, 37], [-76, 37.5], [-75.5, 35], [-78, 33.5], [-81, 31.5], [-80, 27], [-80.5, 25], [-82, 27], [-84, 30], [-89, 30.2], [-94, 29.5], [-97, 27.5], [-99.5, 27]], fourSeasons(NORTH,
    [{ clear: 6, rain: 3, fog: 1 }],
    [{ clear: 6, rain: 2, storm: 2 }],
    [{ clear: 5, heat: 3, storm: 2 }, HOT],
    [{ clear: 7, rain: 2, storm: 1 }],
  )),
  zone("world-mexico-central-america", "Mexico & Central America", "#b9ad6e", [[-117.5, 32.5], [-114, 32.5], [-110, 31.5], [-104, 29.5], [-99.5, 27], [-97, 25], [-97, 21.5], [-91, 18.5], [-87, 21.5], [-80, 23.5], [-74, 21], [-64, 18.5], [-60, 14], [-62, 10.5], [-72, 11.5], [-77, 8.5], [-80, 7.5], [-84, 9], [-88, 13], [-94, 15.5], [-100, 16.5], [-105.5, 20], [-109, 23], [-112, 26.5], [-115, 29.5]], [
    season("Wet season", ["05-15", "10-31"], { clear: 4, rain: 4, storm: 2 }, WET),
    season("Dry season", ["11-01", "05-14"], { clear: 8, heat: 2 }, WARM),
  ]),
  zone("world-amazon", "The Amazon", "#5f9a6a", [[-79.5, 1], [-76, 6], [-70, 7.5], [-62, 8.5], [-56, 6], [-51, 4], [-49, 0], [-46, -2.5], [-47, -7], [-52, -10.5], [-60, -13.5], [-66, -13], [-72, -11], [-76, -7.5], [-78.5, -3]], [
    season("The rains", ["12-01", "05-31"], { clear: 3, rain: 5, storm: 2 }, MONSOON),
    season("Drier months", ["06-01", "11-30"], { clear: 6, rain: 3, storm: 1 }, { pace: 0.85 }),
  ]),
  zone("world-brazilian-highlands", "The Brazilian Highlands", "#a3ad73", [[-49, 0], [-44, -2], [-38, -4], [-35, -7], [-35.5, -11], [-39, -16], [-41, -22], [-44.5, -23.5], [-48.5, -26], [-53, -23.5], [-57.5, -21], [-60, -16], [-60, -13.5], [-52, -10.5], [-47, -7], [-46, -2.5]], [
    season("Wet season", ["10-15", "03-31"], { clear: 4, rain: 4, storm: 2 }, WET),
    season("Dry season", ["04-01", "10-14"], { clear: 9, heat: 1 }),
  ]),
  zone("world-andes", "The Andes", "#a7a9b1", [[-81, -4], [-78.5, -3], [-76, -7.5], [-72, -11], [-68.5, -14], [-66, -18], [-67, -21], [-69, -18], [-71, -17], [-75.5, -15], [-77.5, -12], [-79.5, -8]], [
    season("Dry cold", ["05-01", "09-30"], { clear: 7, frost: 3 }, { cold: 0.6, pace: 0.8, freezes: true }),
    season("Rainy season", ["12-01", "03-31"], { clear: 5, rain: 3, storm: 1, snow: 1 }, { pace: 0.85 }),
  ], 300),
  zone("world-southern-cone", "The Southern Cone", "#9cb08a", [[-71, -17], [-69, -18], [-66, -21], [-62, -22], [-58, -24], [-53, -26], [-48.5, -28], [-52, -33], [-56, -35.5], [-58, -38.5], [-62.5, -41], [-65, -46], [-67.5, -51], [-68.5, -55], [-73, -54], [-75.5, -49], [-74.5, -42], [-73.5, -36], [-71.5, -30], [-70.5, -23], [-70.5, -18.5]], fourSeasons(SOUTH,
    [{ clear: 6, rain: 2, frost: 2 }, CHILL],
    [{ clear: 7, rain: 3 }],
    [{ clear: 7, heat: 2, storm: 1 }, WARM],
    [{ clear: 6, rain: 3, fog: 1 }],
  )),
  zone("world-western-europe", "Western Europe", "#8fae94", [[-11, 51.5], [-10.5, 55], [-7, 58.8], [-2, 59.5], [3, 57.5], [8.5, 56.5], [10, 54.5], [12, 54.2], [14, 53], [14.5, 51], [12.5, 49.5], [9.5, 47.7], [7, 46], [4.5, 44.5], [0.5, 43.4], [-1.8, 43.4], [-5, 47.8], [-9.5, 50]], fourSeasons(NORTH,
    [{ clear: 4, rain: 3, fog: 2, frost: 1 }, { pace: 0.9 }],
    [{ clear: 6, rain: 3, fog: 1 }],
    [{ clear: 8, rain: 1, storm: 1 }],
    [{ clear: 5, rain: 3, fog: 2 }],
  ), 420),
  zone("world-mediterranean", "The Mediterranean", "#c7aa6c", [[-9.8, 43.5], [-9.5, 38.5], [-6.5, 36], [-2, 35.2], [3, 36.6], [10, 36.5], [11, 33], [15, 32.3], [20, 30.8], [25, 31.6], [30, 31.3], [34.2, 31.4], [35.5, 33.5], [36.5, 36.5], [34, 37], [30.5, 37.5], [26.5, 40.5], [24, 41.5], [20.5, 42], [16.5, 43.5], [13.5, 45.7], [10, 44.5], [7, 44], [4, 43.6], [0.5, 43.4], [-1.8, 43.4], [-6, 43.6]], fourSeasons(NORTH,
    [{ clear: 7, rain: 3 }],
    [{ clear: 9, rain: 1 }],
    [{ clear: 7, heat: 3 }, HOT],
    [{ clear: 8, rain: 2 }],
  ), 380),
  zone("world-eastern-europe", "Central & Eastern Europe", "#9ab4c4", [[12, 54.2], [14, 55], [18, 55], [21, 56.5], [24, 58.5], [28, 59.5], [33, 59.5], [40, 59], [48, 58.5], [55, 59.5], [60, 57.5], [59, 53.5], [55, 51.5], [50, 50], [47, 47.5], [44, 46], [40, 46.5], [37.5, 46.8], [34.5, 45.5], [32, 46.4], [29.6, 45.2], [28, 43.8], [24.5, 43.6], [22, 44.5], [19, 45], [16.5, 46.3], [13.5, 46.5], [12.5, 48.5], [14.5, 51], [14, 53]], [
    season("Winter", ["12-01", "02-28"], { clear: 5, snow: 2, frost: 2, blizzard: 1 }, COLD),
    season("The thaw", ["03-01", "04-30"], { clear: 4, mud: 4, rain: 2 }, THAW),
    season("Late spring", ["05-01", "05-31"], { clear: 7, rain: 2, storm: 1 }),
    season("Summer", ["06-01", "08-31"], { clear: 7, heat: 1, storm: 1, rain: 1 }, WARM),
    season("Early autumn", ["09-01", "09-20"], { clear: 8, rain: 1, fog: 1 }),
    season("Autumn rains", ["09-21", "11-15"], { clear: 4, rain: 3, mud: 2, fog: 1 }, { pace: 0.75 }),
    season("Early winter", ["11-16", "11-30"], { clear: 5, frost: 3, snow: 1, fog: 1 }, CHILL),
  ]),
  zone("world-scandinavia", "Scandinavia & the North", "#9fbfd2", [[4.5, 58], [5, 62], [9.5, 64.5], [14, 68.5], [19, 70.5], [26, 71.2], [33, 70], [42, 68.8], [52, 68.5], [62, 69.5], [66, 67], [62, 63], [60, 57.5], [55, 59.5], [48, 58.5], [40, 59], [33, 59.5], [28, 59.5], [24, 58.5], [21, 56.5], [18, 55.5], [14, 55.5], [11, 56], [8, 57.5]], [
    season("Winter", ["11-01", "03-31"], { clear: 5, snow: 3, frost: 1, blizzard: 1 }, { pace: 0.65, cold: 0.8, air: 0.7, freezes: true }),
    season("Spring", ["04-01", "05-31"], { clear: 6, frost: 2, mud: 1, rain: 1 }, { pace: 0.8, freezes: true }),
    season("Summer", ["06-01", "08-31"], { clear: 7, rain: 2, fog: 1 }),
    season("Autumn", ["09-01", "10-31"], { clear: 5, rain: 2, fog: 2, frost: 1 }, { cold: 0.2 }),
  ]),
  zone("world-siberia", "Siberia", "#b4cde4", [[60, 57.5], [62, 63], [66, 67], [68, 72.5], [78, 73.5], [90, 76], [104, 78], [120, 74], [135, 72], [150, 72], [165, 70.5], [179.5, 69], [179.5, 64], [172, 60], [163, 57], [160, 53], [155, 51], [143, 53.5], [140, 48.5], [134, 47.5], [128, 49.5], [120, 52.5], [113, 50], [104, 51], [96, 50.5], [88, 49.5], [82, 50.5], [76, 53.5], [70, 54.5], [62, 54]], [
    season("Siberian winter", ["10-15", "04-15"], { clear: 4, frost: 3, snow: 2, blizzard: 1 }, { pace: 0.55, cold: 1.3, air: 0.5, freezes: true }),
    season("Thaw", ["04-16", "05-31"], { clear: 4, mud: 4, frost: 2 }, { pace: 0.6, freezes: true }),
    season("Short summer", ["06-01", "08-31"], { clear: 7, rain: 2, storm: 1 }),
    season("Autumn", ["09-01", "10-14"], { clear: 5, frost: 2, snow: 2, rain: 1 }, { cold: 0.4 }),
  ], 600),
  zone("world-steppe", "The Central Asian Steppe", "#c8bc8c", [[44, 46], [47, 47.5], [50, 50], [55, 51.5], [59, 53.5], [62, 54], [70, 54.5], [76, 53.5], [82, 50.5], [88, 49.5], [96, 50.5], [104, 51], [113, 50], [120, 52.5], [126, 48], [121, 43.5], [114, 42], [106, 41.5], [97, 40.5], [90, 39], [80, 39.5], [74, 38.5], [68, 37.3], [62, 36.5], [56, 37.8], [53, 40], [50, 44]], [
    season("Winter", ["11-01", "03-15"], { clear: 6, frost: 2, snow: 2 }, { cold: 0.8, pace: 0.8, freezes: true }),
    season("Spring", ["03-16", "05-31"], { clear: 7, rain: 2, mud: 1 }),
    season("Summer", ["06-01", "08-31"], { clear: 7, heat: 3 }, HOT),
    season("Autumn", ["09-01", "10-31"], { clear: 9, frost: 1 }),
  ], 560),
  zone("world-middle-east", "The Middle East & Arabia", "#d4b276", [[34.2, 31.4], [35.5, 33.5], [36.5, 36.5], [40, 37.3], [44, 37.5], [48, 38.6], [53, 37.5], [56, 37.8], [62, 36.5], [64, 32], [62, 25.5], [57, 24.5], [56.5, 21], [59, 22], [55, 17], [52, 15.5], [45, 12.7], [43, 13.5], [42, 16.5], [39, 21.5], [36.5, 25.5], [34.5, 28], [33, 30]], [
    season("Winter", ["12-01", "02-28"], { clear: 8, rain: 2 }),
    season("Spring", ["03-01", "04-30"], { clear: 8, heat: 2 }),
    season("Summer", ["05-01", "09-30"], { clear: 6, heat: 4 }, HOT),
    season("Autumn", ["10-01", "11-30"], { clear: 9, heat: 1 }),
  ]),
  zone("world-sahara", "The Sahara", "#dcbc7c", [[-17, 27.5], [-16.5, 21], [-16.5, 17.5], [-12, 16.5], [-5, 16], [3, 16], [12, 16.5], [20, 16], [27, 16.5], [33, 18.5], [37, 22], [35, 25.5], [33.5, 28.5], [31.5, 30.6], [25, 30.2], [19, 30.2], [14, 31.5], [10, 32.5], [5, 33.5], [0, 33.8], [-5, 32.5], [-9, 30.5], [-13.5, 28]], [
    season("Cool season", ["11-01", "03-31"], { clear: 9, heat: 1 }),
    season("Hot season", ["04-01", "10-31"], { clear: 6, heat: 4 }, { heat: 1, pace: 0.85, wear: 0.01 }),
  ], 600),
  zone("world-sahel", "The Sahel & the Savanna", "#bdb36e", [[-17.5, 15], [-16, 12], [-12, 9], [-7, 7.5], [-2, 8.2], [4, 8.8], [10, 9.5], [16, 9], [22, 8.5], [27, 7], [32, 6], [36, 6.5], [40, 8.5], [44, 9.5], [51, 11.5], [48, 13], [43.5, 12.6], [41, 14], [38.5, 17], [36, 17.5], [33, 16.5], [27, 15.5], [20, 15.2], [12, 15.5], [3, 15], [-5, 15.2], [-12, 15.5]], [
    season("The rains", ["06-01", "09-30"], { clear: 4, rain: 4, storm: 2 }, WET),
    season("Dry season", ["10-01", "05-31"], { clear: 7, heat: 3 }, WARM),
  ]),
  zone("world-central-africa", "The Central African Forests", "#5f9467", [[-13, 9], [-8.5, 6.5], [-3, 5.2], [2, 6.4], [6, 4.4], [9.5, 3.5], [9, -1], [11.5, -5], [15, -6], [22, -6.5], [28, -5.5], [30.5, -2], [31, 2], [30, 4.5], [27, 5.5], [22, 5], [16, 4], [12, 5.5], [8, 7.2], [3, 7.5], [-3, 7.5], [-8, 8]], [
    season("Rains", ["01-01", "12-31"], { clear: 4, rain: 4, storm: 2 }, { pace: 0.8, air: 0.8 }),
  ]),
  zone("world-east-africa", "The East African Highlands", "#9db57c", [[30.5, -2], [31, 2], [34, 4.5], [38, 5.5], [41.5, 4], [42, -1.5], [40.5, -6], [39.5, -10.5], [35, -11.5], [31, -9], [29.5, -5]], [
    season("Long rains", ["03-15", "05-31"], { clear: 5, rain: 4, storm: 1 }, WET),
    season("Cool and dry", ["06-01", "09-30"], { clear: 9, fog: 1 }),
    season("Short rains", ["10-01", "12-15"], { clear: 6, rain: 3, storm: 1 }),
    season("Hot and dry", ["12-16", "03-14"], { clear: 8, heat: 2 }, WARM),
  ], 380),
  zone("world-southern-africa", "Southern Africa", "#b6b27e", [[11.5, -5], [15, -6], [22, -6.5], [28, -5.5], [29.5, -5], [31, -9], [35, -11.5], [39.5, -10.5], [40.5, -15.5], [35.5, -22], [33, -26], [32.5, -29], [28.5, -33], [24, -34.3], [19.5, -34.8], [18, -32], [16.5, -28.5], [14.5, -23], [12, -18], [11.8, -12], [12.3, -8]], [
    season("Rains", ["11-01", "03-31"], { clear: 5, rain: 3, storm: 2 }, WET),
    season("Autumn", ["04-01", "04-30"], { clear: 8, rain: 2 }),
    season("Dry winter", ["05-01", "08-31"], { clear: 8, frost: 2 }, { cold: 0.2 }),
    season("Hot and dry", ["09-01", "10-31"], { clear: 7, heat: 3 }, WARM),
  ]),
  zone("world-india", "The Indian Subcontinent", "#c2a86a", [[62, 25.5], [64, 30], [67, 33], [71.5, 34.5], [75, 35.5], [78.5, 34], [81, 30.5], [85, 28.4], [89, 27.5], [92.5, 27.8], [96.5, 28], [97, 25.5], [94.5, 22], [92.5, 21], [90, 21.8], [87, 21.3], [85.5, 19.5], [82.5, 16.5], [80.3, 13.5], [80.2, 9.5], [79.5, 5.8], [77.5, 7.8], [76, 10], [74, 14.5], [72.6, 19], [72.5, 21], [70, 21], [67, 24]], [
    season("Cool season", ["12-01", "02-28"], { clear: 8, fog: 2 }),
    season("Hot season", ["03-01", "05-31"], { clear: 6, heat: 4 }, HOT),
    season("Monsoon", ["06-01", "09-30"], { clear: 3, rain: 5, storm: 1, mud: 1 }, MONSOON),
    season("After the monsoon", ["10-01", "11-30"], { clear: 7, rain: 2, storm: 1 }),
  ]),
  zone("world-tibet", "Tibet & the High Mountains", "#c3cdd8", [[71.5, 34.5], [74, 37.5], [80, 39.5], [90, 39], [97, 40.5], [103, 36.5], [103, 31], [99, 28.5], [96.5, 28], [92.5, 27.8], [89, 27.5], [85, 28.4], [81, 30.5], [78.5, 34], [75, 35.5]], [
    season("Winter", ["10-15", "04-15"], { clear: 5, frost: 2, snow: 2, blizzard: 1 }, { pace: 0.6, cold: 0.9, air: 0.6, freezes: true }),
    season("Summer", ["04-16", "10-14"], { clear: 7, rain: 2, frost: 1 }, { cold: 0.3, pace: 0.8 }),
  ], 360),
  zone("world-east-asia", "East Asia", "#93ad86", [[103, 22.5], [108, 21.5], [112, 21.5], [116.5, 23], [120.5, 26.5], [122, 30.5], [121, 33], [120, 36.5], [122.5, 37.5], [125, 39.5], [129.5, 42.5], [131, 43], [134, 34], [139, 34.5], [141, 37.5], [141.5, 41.5], [145.5, 44], [142, 46], [139, 45], [135, 43.5], [131, 44], [134, 47.5], [128, 49.5], [121, 43.5], [114, 42], [106, 41.5], [103, 36.5], [103, 31], [100, 26]], fourSeasons(NORTH,
    [{ clear: 7, frost: 2, snow: 1 }, CHILL],
    [{ clear: 6, rain: 3, fog: 1 }],
    [{ clear: 4, rain: 3, storm: 2, heat: 1 }, { heat: 0.4, pace: 0.9 }],
    [{ clear: 8, rain: 2 }],
  )),
  zone("world-south-east-asia", "South-East Asia", "#6aa37a", [[92.5, 21], [94.5, 22], [97, 25.5], [100, 26], [103, 22.5], [108, 21.5], [110, 18], [109.5, 12], [106.5, 8.5], [104, 1.5], [110, 1], [117, 7], [119.5, 5], [122, 12], [120, 18.5], [123, 18.5], [126.5, 12], [126.5, 6], [131, 1], [141, -1.5], [150, -5], [151, -10.5], [142, -10], [134, -8.5], [125, -10.5], [116, -9], [106, -7.5], [100, -3], [96, 4], [98, 8], [97.5, 16], [94, 18]], [
    season("Wet season", ["05-01", "10-31"], { clear: 3, rain: 5, storm: 2 }, MONSOON),
    season("Dry season", ["11-01", "04-30"], { clear: 7, heat: 2, rain: 1 }, WARM),
  ]),
  zone("world-australian-outback", "The Australian Outback", "#d2a86c", [[113.5, -21.5], [114, -26], [115, -31], [117, -34], [123, -33.8], [128, -31.8], [133, -32], [136, -34.5], [138.5, -33], [141, -31.5], [144, -30.5], [147.5, -27.5], [146, -22], [142, -18.5], [137, -18], [131, -16.5], [126, -17.5], [121, -19.5]], fourSeasons(SOUTH,
    [{ clear: 9, frost: 1 }],
    [{ clear: 8, heat: 2 }],
    [{ clear: 6, heat: 4 }, { heat: 1, pace: 0.85, wear: 0.01 }],
    [{ clear: 8, heat: 2 }],
  )),
  zone("world-tropical-australia", "Tropical Australia", "#7fa874", [[121, -19.5], [123.5, -16.5], [126.5, -14], [129.5, -14.8], [131, -12], [136.5, -11.8], [136, -15.5], [140, -17.5], [141.5, -12.5], [142.5, -10.7], [145.5, -15], [146.5, -19], [149, -22], [146, -22], [142, -18.5], [137, -18], [131, -16.5], [126, -17.5]], [
    season("Wet season", ["11-01", "04-30"], { clear: 4, rain: 3, storm: 3 }, MONSOON),
    season("Dry season", ["05-01", "10-31"], { clear: 9, heat: 1 }),
  ], 400),
  zone("world-temperate-australia", "Temperate Australia", "#9db383", [[147.5, -27.5], [153.5, -26], [153, -31], [151, -34.5], [150, -37.5], [146.5, -39.2], [144, -38.5], [141, -38.2], [138, -35.8], [136, -34.5], [138.5, -33], [141, -31.5], [144, -30.5]], fourSeasons(SOUTH,
    [{ clear: 6, rain: 3, fog: 1 }],
    [{ clear: 7, rain: 3 }],
    [{ clear: 8, heat: 2 }, WARM],
    [{ clear: 7, rain: 2, fog: 1 }],
  ), 380),
  zone("world-new-zealand", "New Zealand", "#8fb59a", [[166.5, -46], [169, -47], [172.5, -44], [174.5, -41.5], [176.5, -41.5], [178.5, -37.5], [175.5, -35.5], [172.8, -34.3], [174, -38], [171, -41.5], [168, -44.2]], fourSeasons(SOUTH,
    [{ clear: 5, rain: 3, frost: 2 }, { cold: 0.2 }],
    [{ clear: 6, rain: 3, storm: 1 }],
    [{ clear: 8, rain: 2 }],
    [{ clear: 6, rain: 3, fog: 1 }],
  ), 260),
  zone("world-antarctica", "Antarctica", "#c8d8e8", [[-179.5, -64], [-120, -70], [-60, -63], [0, -69], [60, -66], [120, -66], [179.5, -68], [179.5, -89.5], [-179.5, -89.5]], [
    season("The polar year", ["01-01", "12-31"], { clear: 4, frost: 3, blizzard: 2, snow: 1 }, DEEP_COLD),
  ], 400),
];

// ---- the hard ground ------------------------------------------------------------------

// Level 3 to 9: a troop crosses it at (10 - level) tenths of its pace (arena.js).
const area = (id, name, level, rings) => ({ id, name, level, rings: [rings] });

const AREAS = [
  // The great mountain ranges.
  area("world-himalaya", "The Himalaya", 9, [[73, 35.5], [75, 36.5], [78, 35.8], [80, 33], [82, 30.5], [85, 29.3], [88, 28.3], [91, 28.2], [94, 29], [97, 28.5], [96.5, 27.3], [93, 26.8], [89, 26.8], [86, 27], [83, 27.6], [80.5, 28.8], [78, 30.3], [76, 32.2], [74, 33.8]]),
  area("world-karakoram-pamir", "The Karakoram & the Pamirs", 8, [[70, 36], [71.5, 38.8], [74.5, 39.8], [77.5, 37.5], [78.5, 35.8], [75, 36.5], [73, 35.5], [71, 35]]),
  area("world-hindu-kush", "The Hindu Kush", 7, [[64.5, 34], [66.5, 36.3], [69.5, 37], [71.5, 36.3], [71, 35], [69, 34.5], [66.5, 34]]),
  area("world-tibetan-plateau", "The Tibetan Plateau", 6, [[78, 35.8], [80, 36.5], [86, 36.2], [92, 36], [97, 35.5], [101, 33], [101, 30], [98, 28.8], [94, 29], [91, 28.2], [88, 28.3], [85, 29.3], [82, 30.5], [80, 33]]),
  area("world-tian-shan", "The Tian Shan", 7, [[68.5, 41.8], [72, 43], [76, 43.3], [80, 43.8], [85, 44.3], [90, 43.6], [91.5, 42.7], [87, 42.4], [82, 41.6], [78, 41.3], [74, 40.6], [70, 40.6]]),
  area("world-altai-sayan", "The Altai & the Sayan", 6, [[83.5, 51.5], [87, 52.5], [92, 52.8], [97, 52.5], [100, 51.7], [96, 49.7], [91, 47.8], [88, 48.8], [85, 49.4]]),
  area("world-caucasus", "The Caucasus", 8, [[37.5, 44.6], [40, 44], [43, 43.4], [46, 42.6], [48.8, 41.7], [48.2, 41], [45.5, 41.8], [42.5, 42.6], [40, 43.1], [37.8, 44]]),
  area("world-alps", "The Alps", 7, [[5.5, 43.9], [6.4, 45.2], [6.6, 46.4], [8, 46.8], [10, 47.3], [12.5, 47.7], [15.5, 47.8], [16, 47.2], [14, 46.5], [12, 46.1], [10.5, 45.9], [9, 45.9], [7.5, 45.1], [7.2, 44.1]]),
  area("world-pyrenees", "The Pyrenees", 6, [[-1.8, 43.3], [0, 43.05], [1.5, 42.75], [3.2, 42.5], [2.8, 42.2], [1, 42.35], [-0.5, 42.6], [-1.6, 42.9]]),
  area("world-carpathians", "The Carpathians", 5, [[18, 49.4], [19.5, 49.7], [21.5, 49.5], [23.5, 48.8], [25, 48], [26.3, 47], [26.3, 45.8], [25, 45.3], [23, 45.2], [22.3, 45.6], [23.3, 46.6], [24.2, 47.4], [22.8, 48.4], [20.5, 49], [18.8, 49.1]]),
  area("world-balkan-mountains", "The Dinarides & the Balkan Mountains", 5, [[14.8, 45.6], [16, 45.3], [18, 44.2], [19.5, 43.3], [21, 42.6], [23, 42.9], [26.5, 42.9], [27.5, 42.6], [26, 42.2], [23.5, 42.2], [22, 41.9], [20.5, 41.6], [19.6, 42.2], [17.8, 43.1], [16, 44.2], [15, 45]]),
  area("world-apennines", "The Apennines", 4, [[8.5, 44.4], [10.5, 44.3], [12.5, 43.8], [13.8, 42.6], [15.2, 41.5], [16.3, 40.3], [16.4, 39.2], [15.9, 38.6], [15.5, 39.6], [14.5, 40.7], [13.3, 41.8], [11.8, 43.1], [10, 43.9]]),
  area("world-scandinavian-mountains", "The Scandinavian Mountains", 5, [[5.3, 59], [7, 61.5], [10, 63.5], [13, 66], [16.5, 68.2], [20, 69.6], [21.5, 69], [18.5, 67.5], [15, 65.5], [12.5, 63.3], [10, 61.2], [8, 59.3]]),
  area("world-urals", "The Urals", 3, [[57.5, 67.5], [60.5, 68], [61, 64], [60.5, 60], [60, 56], [59.5, 52.5], [57.5, 52], [57.8, 56], [58.3, 60], [59, 64]]),
  area("world-zagros", "The Zagros", 6, [[43.5, 37.2], [45.5, 37.5], [47.5, 35.5], [49.5, 33.5], [51.5, 31], [53.5, 29.5], [56, 28], [57.5, 27], [56.5, 26.6], [54, 27.4], [51.5, 28.8], [49, 30.8], [47, 32.7], [45.3, 34.7], [44, 36]]),
  area("world-anatolian-highlands", "The Taurus & the Anatolian Highlands", 5, [[29.5, 37.3], [32, 36.8], [35, 37], [38, 37.8], [41, 38.5], [43.5, 39.5], [44.5, 40.2], [42, 40.6], [39, 40], [36, 39.2], [33, 38.6], [30.5, 38.3]]),
  area("world-elburz", "The Elburz & the Kopet Dag", 6, [[44.8, 38.5], [47.5, 37], [50, 36.5], [53, 36.4], [56, 37.6], [59, 37.6], [61, 36.3], [58, 36.6], [55, 36.2], [52, 35.8], [49.5, 35.9], [47, 36.2], [45, 37.4]]),
  area("world-atlas", "The Atlas", 5, [[-9.8, 30.6], [-8, 31.4], [-5.5, 32.7], [-3, 33.6], [0, 34.3], [3, 35.3], [6.5, 35.8], [9.5, 36.3], [9, 35.3], [6, 34.7], [3, 34.2], [0, 33.3], [-3.5, 32.1], [-6.5, 30.8], [-9, 30.1]]),
  area("world-ethiopian-highlands", "The Ethiopian Highlands", 6, [[36.5, 14.5], [38.5, 14.8], [40, 13.5], [40.5, 11], [41, 9.2], [40, 7], [38.3, 6], [36.3, 6.8], [35.4, 8.6], [35.8, 11], [36.2, 13]]),
  area("world-rocky-mountains", "The Rocky Mountains", 7, [[-127, 58], [-123, 58.5], [-118, 56], [-115, 53], [-112.5, 49], [-110, 45.5], [-106, 43], [-105, 40], [-105, 36.8], [-107.5, 35.8], [-109.5, 38], [-111, 41], [-113.5, 44.5], [-116, 47.5], [-119, 51], [-123, 55]]),
  area("world-sierra-cascades", "The Sierra Nevada & the Cascades", 6, [[-122.5, 49], [-120.5, 49], [-121, 45], [-121.3, 42.5], [-120, 39.8], [-118.5, 37.5], [-117.8, 36], [-118.8, 35.7], [-120, 37.8], [-121.3, 40.2], [-122.2, 42.5], [-122.3, 45.5]]),
  area("world-appalachians", "The Appalachians", 4, [[-84.5, 34.3], [-82.5, 35.8], [-80.5, 37.5], [-78.5, 39.5], [-76.5, 41.2], [-74.5, 42.5], [-72.5, 44.2], [-71.5, 45.3], [-73, 45], [-75.5, 43.1], [-78, 41.1], [-80, 39.2], [-82, 37.2], [-84, 35.3], [-85.5, 34.4]]),
  area("world-sierra-madre", "The Sierra Madre", 6, [[-109, 30.5], [-107, 31], [-105.3, 27], [-103.7, 24], [-102, 20.5], [-99, 18.5], [-96, 17.2], [-95.8, 16.3], [-98.5, 16.7], [-101.5, 18], [-104, 20.3], [-105.8, 23.5], [-107.5, 27]]),
  area("world-andes-range", "The Andes", 8, [[-78.5, 2], [-76.5, 1.5], [-77.5, -2], [-78, -6], [-76.5, -9.5], [-74.5, -13], [-71.5, -15.5], [-68.5, -17.5], [-67.5, -21], [-68, -25], [-69, -29], [-69.6, -33], [-70, -37], [-71, -41], [-71.5, -45], [-72.5, -49], [-72.8, -52], [-74.8, -51], [-73.5, -46], [-72.5, -41], [-71.5, -37], [-70.8, -33], [-70.5, -29], [-69.5, -25], [-69.5, -21], [-70.8, -17.5], [-73.5, -15.5], [-76.5, -12.5], [-78.8, -8], [-80, -4], [-79.5, -1]]),
  area("world-altiplano", "The Altiplano", 6, [[-70.5, -15], [-68, -14.5], [-66, -17], [-65, -20], [-66, -23.5], [-68.5, -23.5], [-69.5, -20], [-69.5, -17]]),
  area("world-brooks-range", "The Brooks Range", 7, [[-163, 68.5], [-152, 68.8], [-142, 69], [-141, 67.8], [-150, 67.3], [-160, 67.5]]),
  area("world-alaska-range", "The Alaska Range", 7, [[-155, 62], [-150, 63.5], [-145, 63.5], [-142, 62], [-148, 62.4], [-153, 61]]),
  area("world-greenland-ice", "The Greenland Ice Sheet", 9, [[-50, 66], [-46, 62.5], [-42, 62], [-38, 65.5], [-28, 68.5], [-23, 72], [-20, 77], [-25, 81], [-40, 82.5], [-55, 81], [-63, 78], [-58, 75], [-55, 71], [-52, 68]]),
  // The marshes.
  area("world-pripyat", "The Pripyat Marshes", 6, [[23.8, 52.4], [25.5, 52.7], [27.5, 52.6], [29.5, 52.4], [31, 51.8], [30.2, 51.2], [28, 51.4], [26, 51.5], [24.5, 51.6]]),
  area("world-west-siberian-bogs", "The West Siberian Bogs", 6, [[66, 62], [70, 63.3], [76, 63], [82, 61.8], [85, 59.5], [84, 57], [79, 56.5], [74, 57], [69, 58.5], [66, 60]]),
  area("world-sudd", "The Sudd", 7, [[29.5, 9.8], [30.8, 10.2], [31.8, 9.6], [32.2, 8], [31.8, 6.6], [30.8, 6.5], [30.4, 7.6], [29.6, 8.6]]),
  area("world-pantanal", "The Pantanal", 6, [[-58, -16], [-56, -16.2], [-55.3, -18], [-56, -20.5], [-57.5, -21.5], [-58.3, -19.5]]),
  area("world-everglades", "The Everglades", 6, [[-81.5, 26.6], [-80.6, 26.6], [-80.4, 25.4], [-81.2, 25.2], [-81.8, 25.8]]),
  area("world-mesopotamian-marshes", "The Mesopotamian Marshes", 5, [[45.8, 32], [47.5, 31.9], [48, 30.9], [47.2, 30.2], [46.2, 30.6]]),
  area("world-okavango", "The Okavango", 5, [[22, -18.5], [23.8, -18.4], [24.2, -19.6], [23.3, -20.5], [22.2, -19.8]]),
  // The jungles.
  area("world-amazon-rainforest", "The Amazon Rainforest", 6, [[-77, 0], [-72, 4], [-66, 3], [-60, 3.5], [-55, 2], [-52, -1], [-50, -4], [-52, -8], [-58, -10], [-64, -11], [-70, -10], [-74.5, -7.5], [-76.5, -3.5]]),
  area("world-congo-rainforest", "The Congo Rainforest", 6, [[9.6, 4], [12, 3.8], [16, 3.8], [20, 4.4], [25, 4], [29, 2.8], [29, -1.5], [27, -4.5], [23, -5], [19, -4.5], [15, -3.5], [12, -2], [9.7, 0.5]]),
  area("world-darien-gap", "The Darién Gap", 8, [[-78.9, 9.3], [-77.4, 8.7], [-76.9, 7.6], [-77.5, 7], [-78.3, 7.6], [-79, 8.4]]),
  area("world-sumatra-jungle", "The Jungles of Sumatra", 6, [[95, 5.5], [100, 2.5], [104, -3.5], [106, -5.8], [104, -6], [100.5, -3.5], [97, 1], [95, 3.5]]),
  area("world-borneo-jungle", "The Jungles of Borneo", 6, [[109, 1.5], [111, 3], [115, 5.5], [118.5, 6.5], [119, 4], [117.5, 1], [116.5, -2], [114, -4], [110.5, -3], [109.2, -1]]),
  area("world-new-guinea", "The Highlands and Jungles of New Guinea", 7, [[131, -1.5], [135, -3], [138, -1.5], [141, -2.6], [145, -4.5], [147.5, -6], [150.5, -10.5], [147, -9], [143, -9.3], [140, -8.2], [137.5, -5.5], [134, -4.5], [131.5, -3.5]]),
  area("world-annamite-range", "The Annamite Range", 5, [[102.5, 21.5], [104.5, 19.5], [106, 17.5], [107.6, 15.5], [108.5, 12.5], [107.5, 11.5], [106.5, 13], [105.5, 15.5], [104, 17.5], [102.5, 19.5]]),
  // The sand seas and the deserts.
  area("world-empty-quarter", "The Empty Quarter", 6, [[44.8, 21], [48, 21.2], [52, 22.5], [55.5, 22.8], [55.5, 20], [54, 18], [51, 17.2], [48, 17.6], [45.5, 18.6]]),
  area("world-taklamakan", "The Taklamakan", 6, [[76.5, 39.5], [80, 40.6], [84, 41.2], [88, 40.5], [89.5, 39.2], [88, 37.6], [84, 37], [80, 36.9], [77.5, 37.6]]),
  area("world-gobi", "The Gobi", 4, [[96, 44.5], [100, 45.2], [105, 45.3], [110, 44.7], [113, 43.2], [112, 41.6], [107, 41.2], [102, 41.5], [98, 42], [95, 43]]),
  area("world-sahara-interior", "The Deep Sahara", 4, [[-12, 26], [-6, 28.5], [0, 29.5], [6, 30.5], [10, 30], [14, 28.5], [20, 28], [25, 28.5], [30, 27.5], [32, 24], [31, 21], [27, 18.5], [20, 18.5], [14, 18.8], [8, 19], [3, 19.5], [-3, 20], [-8, 21.5], [-12, 23]]),
  area("world-australian-deserts", "The Great Australian Deserts", 5, [[119, -21], [124, -20], [129, -20.5], [134, -22], [137, -24], [138, -27.5], [135, -29.5], [130, -29.5], [125, -29], [121.5, -27], [119.5, -24]]),
  area("world-atacama", "The Atacama", 5, [[-70.5, -18.5], [-69.2, -19], [-68.5, -23], [-69.5, -26.5], [-70.6, -26.5], [-70.3, -22]]),
  area("world-namib-kalahari", "The Namib & the Kalahari", 4, [[13, -17.5], [15, -18], [19, -19.5], [23, -22], [24, -25.5], [21.5, -27.5], [17.5, -28.5], [15.5, -26], [14.3, -22.5]]),
  // The roadless north.
  area("world-siberian-wilds", "The Siberian Taiga & Tundra", 4, [[63, 58], [70, 60.5], [80, 62.5], [90, 64.5], [105, 66], [120, 66], [135, 64.5], [150, 63.5], [165, 64], [170, 67], [178, 68], [175, 70.5], [160, 71], [140, 72.5], [120, 73.5], [105, 74.5], [90, 73.5], [75, 71.5], [68, 70], [65, 66.5], [63, 62]]),
  area("world-canadian-shield", "The Canadian Shield & the Barrens", 4, [[-140, 66], [-125, 67.5], [-110, 66], [-97, 64], [-90, 60], [-82, 56], [-75, 55], [-65, 56], [-60, 53.5], [-65, 51.5], [-75, 51.5], [-85, 52.5], [-95, 55], [-105, 58], [-118, 60], [-130, 62]]),
];

export const WORLD_CLIMATE_ZONES = Object.freeze(normalizeClimateZones(ZONES));
export const WORLD_TERRAIN_AREAS = Object.freeze(normalizeTerrainAreas(AREAS));

// ---- which scenarios ------------------------------------------------------------------

// Whether a scenario is fought on the Earth of the built-in basemaps: it
// declares no map of its own (Game/Map/useCustomBackground.js: an image, a
// drawn map, or the plain sea of a flat sheet).
export const onBuiltInBasemap = (world) => !(world?.background && typeof world.background === "object" && String(world.background.kind ?? "").trim());

const NONE = Object.freeze([]);
// A scenario's climate zones as everything reads them: its own; else, on the
// built-in basemaps, the world's; else none. (The same object for the same
// world, so that a page's selector of it holds still.)
export const climateZonesOf = (world) => {
  const own = Array.isArray(world?.climateZones) ? world.climateZones : NONE;
  if (own.length > 0) return own;
  return onBuiltInBasemap(world) ? WORLD_CLIMATE_ZONES : NONE;
};
// A scenario's hard ground as the engine reads it: its own; else, on the built-in basemaps, the world's; else none.
export const terrainAreasOf = (world) => {
  const own = Array.isArray(world?.terrainAreas) ? world.terrainAreas : NONE;
  if (own.length > 0) return own;
  return onBuiltInBasemap(world) ? WORLD_TERRAIN_AREAS : NONE;
};
