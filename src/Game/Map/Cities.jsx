/*! Open Historia — portions (per-scenario era city layer) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useEffect, useState } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import {
    PMTILES_PROTOCOL_URLS,
    JSON_URLS,
    ensurePmtilesProtocol,
    jsonReadSucceeded,
    readJson,
} from "../../runtime/assets.js";
import { useWorldState } from "./useWorldState.js";
import { publishCustomCityIndex } from "../../runtime/placeSearch.js";
import {
    EMPTY_CITY_FEATURE_COLLECTION,
    customCityFeatureCount,
    normalizeCustomCityFeatureCollection,
    resolveCityLayerSource,
} from "../../runtime/cityFeatures.js";

ensurePmtilesProtocol();

const populationFilter = (pop) => [
    "any",
    ["==", ["get", "capital"], "primary"],
    [
        ">",
        ["get", "population"],
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
const populationLabelFilter = (pop) => [
    "any",
    ["==", ["get", "capital"], "primary"],
    [
        ">",
        ["get", "population"],
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

// Custom (scenario-authored) cities are a curated era set, not the 70k-strong
// modern database, and their historical populations are far below modern
// thresholds (Paris in 1200 held ~50k). Visibility is driven by the authored
// prominence tier instead: 4 = capital, 3 = major city, 2 = city, 1 = town.
const customTierFilter = [
    "any",
    ["==", ["get", "_ohCapital"], true],
    [">=", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 4],
    ["all",
        [">=", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 3],
        [">=", ["zoom"], 4.7],
    ],
    ["all",
        [">=", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 2],
        [">=", ["zoom"], 5.8],
    ],
    [">=", ["zoom"], 7.0],
];

const customLabelFilter = [
    "any",
    ["==", ["get", "_ohCapital"], true],
    [">=", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 4],
    ["all",
        [">=", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 3],
        [">=", ["zoom"], 5.0],
    ],
    ["all",
        [">=", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 2],
        [">=", ["zoom"], 6.5],
    ],
    [">=", ["zoom"], 8.0],
];

const customSortKey = (pop) => [
    "-",
    ["+",
        ["*", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 1000000000],
        ["*", ["case", ["==", ["get", "_ohCapital"], true], 1, 0], 5000000000],
        ["coalesce", pop, 0],
    ],
];

const isStockCapital = ["==", ["get", "capital"], "primary"];
const isCustomCapital = [
    "any",
    ["==", ["get", "_ohCapital"], true],
    ["==", ["get", "capital"], "primary"],
];
const customTier = ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0];

const stockCircleSortKey = (pop) => [
    "+",
    ["case", isStockCapital, 5000000000, 0],
    ["coalesce", pop, 0],
];

const customCircleSortKey = (pop) => [
    "+",
    ["*", customTier, 1000000000],
    ["*", ["case", isCustomCapital, 1, 0], 5000000000],
    ["coalesce", pop, 0],
];

// Stock/custom city labels come from the immutable PMTiles/geojson "city" property.
// AI renames (world.cityRenames) are applied as a client-side match override so a
// renamed city shows its new name without touching the tiles.
const cityPopulationExpr = (populations) => {
    const baseName = ["downcase", ["coalesce", ["get", "city"], ["get", "name"], ""]];
    const pairs = Object.entries(populations || {});
    if (!pairs.length) return ["get", "population"];
    const expr = ["match", baseName];
    for (const [name, value] of pairs) expr.push(String(name).toLowerCase(), value);
    expr.push(["get", "population"]);
    return expr;
};

const cityLabelExpr = (renames) => {
    const baseLabel = ["coalesce", ["get", "city"], ["get", "name"], ""];
    const pairs = Object.entries(renames || {});
    if (!pairs.length) return baseLabel;
    const expr = ["match", ["downcase", baseLabel]];
    for (const [from, to] of pairs) expr.push(from, to);
    expr.push(baseLabel);
    return expr;
};

const StockCities = ({ label, pop }) => (
    <Source id="cities-source" type="vector" url={PMTILES_PROTOCOL_URLS.cities}>
    <Layer
    id="cities-shapes"
    type="circle"
    source-layer="cities"
    beforeId="country-curved-labels"
    minzoom={3.4}
    filter={["all", populationFilter(pop), ["!", isStockCapital]]}
    layout={{
        "circle-sort-key": stockCircleSortKey(pop),
    }}
    paint={{
        "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            3.4, [
                "case",
                [">=", pop, 2500000], 3.3,
                [">=", pop, 1000000], 2.7,
                1.65,
            ],
            10, [
                "case",
                [">=", pop, 2500000], 4.7,
                [">=", pop, 1000000], 3.9,
                2.6,
            ],
        ],
        "circle-color": [
            "case",
            [">=", pop, 2500000], "rgba(248, 247, 241, 0.98)",
            [">=", pop, 1000000], "rgba(224, 230, 234, 0.94)",
            "rgba(194, 204, 212, 0.78)",
        ],
        "circle-stroke-color": "rgba(7, 10, 14, 0.96)",
        "circle-stroke-width": 1.15,
        "circle-opacity": [
            "case",
            [">=", pop, 2500000], 0.98,
            [">=", pop, 1000000], 0.90,
            0.72,
        ],
        "circle-blur": 0.02,
    }}
    />

    <Layer
    id="cities-capitals"
    type="symbol"
    source-layer="cities"
    beforeId="country-curved-labels"
    minzoom={3.4}
    filter={isStockCapital}
    layout={{
        "text-field": "★",
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3.4, 13.5,
            10, 16.5,
        ],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-padding": 0,
    }}
    paint={{
        "text-color": "rgba(228, 185, 61, 0.99)",
        "text-halo-color": "rgba(6, 9, 13, 0.96)",
        "text-halo-width": 1.35,
        "text-halo-blur": 0.22,
    }}
    />

    <Layer
    id="cities-labels"
    type="symbol"
    source-layer="cities"
    beforeId="country-curved-labels"
    minzoom={3.7}
    filter={populationLabelFilter(pop)}
    layout={{
        "symbol-sort-key": ["-", pop],
        "text-field": label,
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-padding": 4,
        "text-radial-offset": 1.0,
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3.7, [
                "case",
                isStockCapital, 11.6,
                [">=", pop, 2500000], 10.2,
                [">=", pop, 1000000], 9.4,
                8.2,
            ],
            10, [
                "case",
                isStockCapital, 13.4,
                [">=", pop, 2500000], 11.8,
                [">=", pop, 1000000], 10.8,
                10.0,
            ],
        ],
        "text-variable-anchor": ["top", "bottom", "left", "right"],
        "text-letter-spacing": 0.015,
        "text-optional": true,
    }}
    paint={{
        "text-color": "rgba(247,246,240,0.96)",
        "text-halo-color": "rgba(8,12,18,0.90)",
        "text-halo-width": ["case", isStockCapital, 1.5, 1.1],
        "text-halo-blur": 0.45,
        "text-opacity": [
            "case",
            isStockCapital, 1,
            [">=", pop, 2500000], 0.96,
            [">=", pop, 1000000], 0.88,
            0.74,
        ],
    }}
    />
    </Source>
);

// Same visual language as the stock layers (ranked city circles + haloed labels), but
// fed from the scenario's cities.geojson and gated by the authored tier.
const CustomCities = ({ data, label, pop }) => (
    <Source id="cities-source" type="geojson" data={data}>
    <Layer
    id="cities-shapes"
    type="circle"
    beforeId="country-curved-labels"
    minzoom={2.65}
    filter={["all", customTierFilter, ["!", isCustomCapital]]}
    layout={{
        "circle-sort-key": customCircleSortKey(pop),
    }}
    paint={{
        "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            3, [
                "case",
                [">=", customTier, 4], 4.2,
                [">=", customTier, 3], 3.1,
                [">=", customTier, 2], 2.1,
                1.45,
            ],
            10, [
                "case",
                [">=", customTier, 4], 5.4,
                [">=", customTier, 3], 4.3,
                [">=", customTier, 2], 3.0,
                2.2,
            ],
        ],
        "circle-color": [
            "case",
            [">=", customTier, 4], "rgba(250, 249, 244, 0.99)",
            [">=", customTier, 3], "rgba(232, 236, 238, 0.96)",
            [">=", customTier, 2], "rgba(204, 214, 221, 0.84)",
            "rgba(186, 198, 207, 0.66)",
        ],
        "circle-stroke-color": "rgba(7, 10, 14, 0.96)",
        "circle-stroke-width": [
            "case",
            [">=", customTier, 3], 1.3,
            1.0,
        ],
        "circle-opacity": [
            "case",
            [">=", customTier, 4], 0.98,
            [">=", customTier, 3], 0.94,
            [">=", customTier, 2], 0.80,
            0.62,
        ],
        "circle-blur": 0.02,
    }}
    />

    <Layer
    id="cities-capitals"
    type="symbol"
    beforeId="country-curved-labels"
    minzoom={2.65}
    filter={isCustomCapital}
    layout={{
        "text-field": "★",
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, 13.8,
            10, 16.8,
        ],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-padding": 0,
    }}
    paint={{
        "text-color": "rgba(228, 185, 61, 0.99)",
        "text-halo-color": "rgba(6, 9, 13, 0.96)",
        "text-halo-width": 1.4,
        "text-halo-blur": 0.22,
    }}
    />

    <Layer
    id="cities-labels"
    type="symbol"
    beforeId="country-curved-labels"
    minzoom={3.0}
    filter={customLabelFilter}
    layout={{
        "symbol-sort-key": customSortKey(pop),
        "text-field": label,
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-padding": 4,
        "text-radial-offset": 1.0,
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, [
                "case",
                isCustomCapital, 12.0,
                ["match", customTier, 4, 11.1, 3, 10.0, 2, 8.9, 8.0],
            ],
            10, [
                "case",
                isCustomCapital, 13.4,
                [">=", customTier, 4], 12.2,
                [">=", customTier, 3], 11.4,
                [">=", customTier, 2], 10.3,
                9.5,
            ],
        ],
        "text-variable-anchor": ["top", "bottom", "left", "right"],
        "text-letter-spacing": 0.015,
        "text-optional": true,
    }}
    paint={{
        "text-color": "rgba(250,249,244,0.99)",
        "text-halo-color": "rgba(7,10,14,0.94)",
        "text-halo-width": ["case", isCustomCapital, 1.6, 1.2],
        "text-halo-blur": 0.32,
        "text-opacity": [
            "case",
            isCustomCapital, 1,
            [">=", customTier, 4], 0.98,
            [">=", customTier, 3], 0.92,
            [">=", customTier, 2], 0.78,
            0.62,
        ],
    }}
    />
    </Source>
);

const Cities = () => {
    // world.customCities marks scenarios whose maps carry their own era-accurate
    // city set (presets, editor maps). Consumed from the shared world-state hook
    // so the map doesn't fire its own independent 5s poll.
    const { customCities: customFlag, cityRenames, cityPopulations } = useWorldState();
    const [customData, setCustomData] = useState(null);
    // Whether the asset arrived, not whether it held any cities.
    const [customRead, setCustomRead] = useState(false);
    const [cityEditorEpoch, setCityEditorEpoch] = useState(0);
    const citiesGeojsonUrl = JSON_URLS.citiesGeojson;
    const label = React.useMemo(() => cityLabelExpr(cityRenames), [cityRenames]);
    const pop = React.useMemo(() => cityPopulationExpr(cityPopulations), [cityPopulations]);

    // Cheats 2.0 can authoritatively edit the scenario city asset while the game is
    // already open. Listen for that narrow editor signal rather than polling a ~MB
    // GeoJSON document or forcing a page reload. Normal scenario switches still use
    // the runtime token / customCities dependencies below.
    useEffect(() => {
        const refresh = () => setCityEditorEpoch((value) => value + 1);
        window.addEventListener("oh:cities-updated", refresh);
        return () => window.removeEventListener("oh:cities-updated", refresh);
    }, []);

    // The city set itself is static per scenario except for explicit editor writes.
    // Those writes bump cityEditorEpoch so the map refetches the canonical asset.
    useEffect(() => {
        let cancelled = false;
        if (!customFlag) {
            setCustomData(null);
            setCustomRead(false);
            publishCustomCityIndex(null);
            return undefined;
        }

        setCustomData(null);
        setCustomRead(false);
        readJson(citiesGeojsonUrl, { defaultValue: EMPTY_CITY_FEATURE_COLLECTION, force: true })
            .then((data) => {
                if (cancelled) return;
                const normalized = normalizeCustomCityFeatureCollection(data);
                const count = customCityFeatureCount(normalized);
                // The empty default is served on failure too, so counting can't tell.
                const read = jsonReadSucceeded(citiesGeojsonUrl);
                setCustomData(normalized);
                // Names for the place search; stock cities are OSM's already.
                publishCustomCityIndex(count > 0 ? normalized : null);
                setCustomRead(read);

                if (import.meta.env?.DEV) {
                    console.info(`[cities] custom city asset loaded: ${count} point features`);
                }
                if (!read) {
                    console.warn(
                        "[cities] world.customCities=true but cities.geojson could not be read; " +
                        "using stock cities as a temporary fallback.",
                    );
                }
            })
            .catch((error) => {
                if (cancelled) return;
                console.warn("[cities] failed to load scenario cities.geojson; using stock fallback.", error);
                setCustomData(EMPTY_CITY_FEATURE_COLLECTION);
                publishCustomCityIndex(null);
                setCustomRead(false);
            });

        return () => {
            cancelled = true;
        };
    }, [customFlag, citiesGeojsonUrl, cityEditorEpoch]);

    const source = resolveCityLayerSource({
        customCities: customFlag,
        collection: customData,
        readSucceeded: customRead,
    });
    if (source === "loading") return null;
    if (source === "custom") return <CustomCities data={customData} label={label} pop={pop} />;
    return <StockCities label={label} pop={pop} />;
};

export default Cities;
