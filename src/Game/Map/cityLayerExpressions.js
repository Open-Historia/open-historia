// MapLibre expressions for the stock city layers (Cities.jsx). Plain data, so
// the tests can evaluate them with MapLibre's own expression engine.
import { cityPopulationOverridesByTileName } from "../../runtime/cityPopulation.js";

// Which stock cities draw at a zoom. `pop` is the city's population as the map
// has it (cityPopulationExpr): a population the AI or the GM set decides
// whether a city shows, as it decides its size and colour, so a town grown
// into a city appears where cities do and an emptied city leaves.
const STOCK_CAPITAL = ["==", ["get", "capital"], "primary"];

export const populationFilter = (pop, capital = STOCK_CAPITAL) => [
    "any",
    capital,
    [
        ">",
        pop,
        [
            "step", ["zoom"],
            3000000,
            5.25, 1500000,
            6.25, 750000,
            7.25, 350000,
            8.25, 150000,
        ],
    ],
];

// City labels are intentionally stricter than markers. A regional map can carry
// a useful constellation of settlements without asking the eye to read every
// one of their names at once. Capitals always win; smaller labels arrive later.
export const populationLabelFilter = (pop, capital = STOCK_CAPITAL) => [
    "any",
    capital,
    [
        ">",
        pop,
        [
            "step", ["zoom"],
            4000000,
            5.5, 2000000,
            6.5, 1000000,
            7.5, 500000,
            8.5, 250000,
        ],
    ],
];

// Whether a city is a capital: `base` (the map's own capitals) or a city a
// country's figures now name its capital (`names`, world.countryStats[...]
// .capital in lower case, useWorldState.js capitalNames). A capital named by
// its new name (world.cityRenames) is matched back to the name on the tile.
export const capitalExpr = (names, renames = null, base = STOCK_CAPITAL) => {
    const wanted = new Set((Array.isArray(names) ? names : []).map((name) => String(name ?? "").trim().toLowerCase()).filter(Boolean));
    if (!wanted.size) return base;
    for (const [from, to] of Object.entries(renames && typeof renames === "object" ? renames : {})) {
        if (wanted.has(String(to ?? "").trim().toLowerCase())) wanted.add(String(from ?? "").trim().toLowerCase());
    }
    const tileName = ["downcase", ["coalesce", ["get", "city"], ["get", "name"], ""]];
    return ["any", base, ["in", tileName, ["literal", [...wanted].sort()]]];
};

// A stock city's population: world.cityPopulations over the tile's own figure.
// The tiles keep the original "city" name, so a figure set under a city's new
// name (world.cityRenames) is matched back to the name on the tile.
export const cityPopulationExpr = (populations, renames = null) => {
    const baseName = ["downcase", ["coalesce", ["get", "city"], ["get", "name"], ""]];
    const pairs = Object.entries(cityPopulationOverridesByTileName(populations, renames));
    if (!pairs.length) return ["get", "population"];
    const expr = ["match", baseName];
    for (const [name, value] of pairs) expr.push(name, value);
    expr.push(["get", "population"]);
    return expr;
};
