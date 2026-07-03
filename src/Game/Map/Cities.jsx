/*! Open Historia — portions (per-scenario era city layer) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useState } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import {
    PMTILES_PROTOCOL_URLS,
    JSON_URLS,
    ensurePmtilesProtocol,
    readJson,
} from "../../runtime/assets.js";

ensurePmtilesProtocol();

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

const populationFilter = [
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
    [">=", ["get", "tier"], 3],
    ["all", [">=", ["get", "tier"], 2], [">=", ["zoom"], 4.3]],
    [">=", ["zoom"], 5.8],
];

const customSortKey = ["-", ["+", ["*", ["get", "tier"], 1000000000], ["get", "population"]]];

const StockCities = () => (
    <Source id="cities-source" type="vector" url={PMTILES_PROTOCOL_URLS.cities}>
    <Layer
    id="cities-shapes"
    type="symbol"
    source-layer="cities"
    minzoom={3.4}
    filter={populationFilter}
    layout={{
        "symbol-sort-key": ["-", ["get", "population"]],
        "text-allow-overlap": true,
        "text-field": [
            "case",
            ["==", ["get", "capital"], "primary"], "★",
            [">=", ["get", "population"], 2500000], "◆",
            "■",
        ],
        "text-padding": 0,
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, [
                "*",
                [
                    "interpolate", ["linear"], ["get", "population"],
                    100000, 6,
                    1000000, 10,
                ],
                [
                    "case",
                    ["==", ["get", "capital"], "primary"], 2.5,
                    [">=", ["get", "population"], 2500000], 2,
                    1,
                ],
            ],
            10, 22,
        ],
    }}
    paint={{
        "text-color": "rgba(0,0,0,0)",
        "text-halo-color": "#ffffff",
        "text-halo-width": 0.5,
    }}
    />

    <Layer
    id="cities-labels"
    type="symbol"
    source-layer="cities"
    minzoom={3.4}
    filter={populationFilter}
    layout={{
        "symbol-sort-key": ["-", ["get", "population"]],
        "text-field": ["get", "city"],
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-padding": 5,
        "text-radial-offset": 0.7,
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, 8,
            10, 10,
        ],
        "text-variable-anchor": ["top", "bottom", "left", "right"],
    }}
    paint={{
        "text-color": "#ffffff",
        "text-halo-color": "#333333",
        "text-halo-width": 2,
    }}
    />
    </Source>
);

// Same visual language as the stock layers (★/◆/■ markers, haloed labels), but
// fed from the scenario's cities.geojson and gated by the authored tier.
const CustomCities = ({ data }) => (
    <Source id="cities-source" type="geojson" data={data}>
    <Layer
    id="cities-shapes"
    type="symbol"
    minzoom={3.4}
    filter={customTierFilter}
    layout={{
        "symbol-sort-key": customSortKey,
        "text-allow-overlap": true,
        "text-field": [
            "case",
            ["==", ["get", "capital"], "primary"], "★",
            [">=", ["get", "tier"], 3], "◆",
            "■",
        ],
        "text-padding": 0,
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, ["match", ["get", "tier"], 4, 15, 3, 12, 2, 8, 6],
            10, 22,
        ],
    }}
    paint={{
        "text-color": "rgba(0,0,0,0)",
        "text-halo-color": "#ffffff",
        "text-halo-width": 0.5,
    }}
    />

    <Layer
    id="cities-labels"
    type="symbol"
    minzoom={3.4}
    filter={customTierFilter}
    layout={{
        "symbol-sort-key": customSortKey,
        "text-field": ["get", "city"],
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-padding": 5,
        "text-radial-offset": 0.7,
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, ["match", ["get", "tier"], 4, 9.5, 3, 9, 8],
            10, 10,
        ],
        "text-variable-anchor": ["top", "bottom", "left", "right"],
    }}
    paint={{
        "text-color": "#ffffff",
        "text-halo-color": "#333333",
        "text-halo-width": 2,
    }}
    />
    </Source>
);

const Cities = () => {
    // world.customCities marks scenarios whose maps carry their own era-accurate
    // city set (presets, editor maps). Polled like the world state in Nations so
    // switching games/scenarios swaps the city layer within a few seconds.
    const [customFlag, setCustomFlag] = useState(false);
    const [customData, setCustomData] = useState(null);
    const citiesGeojsonUrl = JSON_URLS.citiesGeojson;

    useEffect(() => {
        let cancelled = false;
        const loadFlag = () => {
            readJson(JSON_URLS.world, { defaultValue: {}, force: true })
                .then((data) => {
                    if (!cancelled) setCustomFlag(Boolean(data?.customCities));
                })
                .catch(() => {});
        };
        loadFlag();
        const interval = setInterval(loadFlag, 5000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    // The city set itself is static per scenario — fetched once when the flag (or
    // the runtime token behind the URL) changes.
    useEffect(() => {
        let cancelled = false;
        if (!customFlag) {
            setCustomData(null);
            return undefined;
        }
        readJson(citiesGeojsonUrl, { defaultValue: EMPTY_FEATURE_COLLECTION, force: true })
            .then((data) => {
                if (cancelled) return;
                setCustomData(data && Array.isArray(data.features) ? data : EMPTY_FEATURE_COLLECTION);
            })
            .catch(() => {
                if (!cancelled) setCustomData(EMPTY_FEATURE_COLLECTION);
            });
        return () => {
            cancelled = true;
        };
    }, [customFlag, citiesGeojsonUrl]);

    // Custom-city scenarios never show the modern database (anachronistic); while
    // the custom set is still loading, show nothing rather than flash modern names.
    if (customFlag) {
        if (!customData || !customData.features.length) return null;
        return <CustomCities data={customData} />;
    }
    return <StockCities />;
};

export default Cities;
