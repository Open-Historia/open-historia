/*! Open Historia — portions (per-scenario era city layer) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useState } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import {
    PMTILES_PROTOCOL_URLS,
    JSON_URLS,
    ensurePmtilesProtocol,
    readJson,
} from "../../runtime/assets.js";
import { useWorldState } from "./useWorldState.js";
import {
    EMPTY_CITY_FEATURE_COLLECTION,
    customCityFeatureCount,
    normalizeCustomCityFeatureCollection,
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
            2500000,
            5, 1000000,
            6, 500000,
            7, 250000,
            8, 100000,
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
    [">=", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 3],
    ["all",
        [">=", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 2],
        [">=", ["zoom"], 4.0],
    ],
    [">=", ["zoom"], 5.4],
];

const customSortKey = (pop) => [
    "-",
    ["+",
        ["*", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 1000000000],
        ["*", ["case", ["==", ["get", "_ohCapital"], true], 1, 0], 5000000000],
        ["coalesce", pop, 0],
    ],
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
    type="symbol"
    source-layer="cities"
    beforeId="country-curved-labels"
    minzoom={3.4}
    filter={populationFilter(pop)}
    layout={{
        "symbol-sort-key": ["-", pop],
        "text-allow-overlap": true,
        "text-field": [
            "case",
            ["==", ["get", "_ohCapital"], true], "★",
            [">=", pop, 2500000], "◆",
            "■",
        ],
        "text-padding": 0,
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, [
                "*",
                [
                    "interpolate", ["linear"], ["get", "population"],
                    100000, 5.5,
                    1000000, 8,
                ],
                [
                    "case",
                    ["==", ["get", "capital"], "primary"], 1.7,
                    [">=", pop, 2500000], 1.35,
                    1,
                ],
            ],
            10, 14,
        ],
    }}
    paint={{
        "text-color": "rgba(247,246,240,0.96)",
        "text-halo-color": "rgba(8,12,18,0.9)",
        "text-halo-width": 1.1,
        "text-halo-blur": 0.3,
    }}
    />

    <Layer
    id="cities-labels"
    type="symbol"
    source-layer="cities"
    beforeId="country-curved-labels"
    minzoom={4.2}
    filter={populationFilter(pop)}
    layout={{
        "symbol-sort-key": ["-", pop],
        "text-field": label,
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-padding": 3,
        "text-radial-offset": 0.82,
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, 8.5,
            10, 11.2,
        ],
        "text-variable-anchor": ["top", "bottom", "left", "right"],
        "text-letter-spacing": 0.015,
        "text-optional": true,
    }}
    paint={{
        "text-color": "rgba(247,246,240,0.96)",
        "text-halo-color": "rgba(8,12,18,0.88)",
        "text-halo-width": 1.15,
        "text-halo-blur": 0.45,
    }}
    />
    </Source>
);

// Same visual language as the stock layers (★/◆/■ markers, haloed labels), but
// fed from the scenario's cities.geojson and gated by the authored tier.
const CustomCities = ({ data, label, pop }) => (
    <Source id="cities-source" type="geojson" data={data}>
    <Layer
    id="cities-shapes"
    type="symbol"
    beforeId="country-curved-labels"
    minzoom={2.65}
    filter={customTierFilter}
    layout={{
        "symbol-sort-key": customSortKey(pop),
        "text-allow-overlap": true,
        "text-field": [
            "case",
            ["==", ["get", "capital"], "primary"], "★",
            [">=", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 3], "◆",
            "■",
        ],
        "text-padding": 0,
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, [
                "case",
                ["==", ["get", "_ohCapital"], true], 13.5,
                ["match", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 4, 12.5, 3, 10.3, 2, 8.2, 6.0],
            ],
            10, 14.5,
        ],
    }}
    paint={{
        "text-color": "rgba(250,249,244,0.99)",
        "text-halo-color": "rgba(7,10,14,0.94)",
        "text-halo-width": 1.3,
        "text-halo-blur": 0.25,
    }}
    />

    <Layer
    id="cities-labels"
    type="symbol"
    beforeId="country-curved-labels"
    minzoom={3.0}
    filter={customTierFilter}
    layout={{
        "symbol-sort-key": customSortKey(pop),
        "text-field": label,
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-padding": 3,
        "text-radial-offset": 0.82,
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, [
                "case",
                ["==", ["get", "_ohCapital"], true], 11.4,
                ["match", ["coalesce", ["get", "_ohTier"], ["get", "tier"], 0], 4, 10.8, 3, 10.0, 9.0],
            ],
            10, 11.8,
        ],
        "text-variable-anchor": ["top", "bottom", "left", "right"],
        "text-letter-spacing": 0.015,
        "text-optional": true,
    }}
    paint={{
        "text-color": "rgba(250,249,244,0.99)",
        "text-halo-color": "rgba(7,10,14,0.94)",
        "text-halo-width": 1.3,
        "text-halo-blur": 0.32,
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
    const [customLoadFailed, setCustomLoadFailed] = useState(false);
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
            setCustomLoadFailed(false);
            return undefined;
        }

        setCustomData(null);
        setCustomLoadFailed(false);
        readJson(citiesGeojsonUrl, { defaultValue: EMPTY_CITY_FEATURE_COLLECTION, force: true })
            .then((data) => {
                if (cancelled) return;
                const normalized = normalizeCustomCityFeatureCollection(data);
                const count = customCityFeatureCount(normalized);
                setCustomData(normalized);
                setCustomLoadFailed(count === 0);

                if (import.meta.env?.DEV) {
                    console.info(`[cities] custom city asset loaded: ${count} point features`);
                }
                if (count === 0) {
                    console.warn(
                        "[cities] world.customCities=true but cities.geojson is empty/missing; " +
                        "using stock cities as a temporary fallback.",
                    );
                }
            })
            .catch((error) => {
                if (cancelled) return;
                console.warn("[cities] failed to load scenario cities.geojson; using stock fallback.", error);
                setCustomData(EMPTY_CITY_FEATURE_COLLECTION);
                setCustomLoadFailed(true);
            });

        return () => {
            cancelled = true;
        };
    }, [customFlag, citiesGeojsonUrl, cityEditorEpoch]);

    // Never turn the whole planet cityless because a custom city asset is absent.
    if (customFlag) {
        if (customData === null) return null;
        if (!customLoadFailed && customCityFeatureCount(customData) > 0) {
            return <CustomCities data={customData} label={label} pop={pop} />;
        }
        return <StockCities label={label} pop={pop} />;
    }

    return <StockCities label={label} pop={pop} />;
};

export default Cities;
