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
    ["==", ["get", "capital"], "primary"],
    [">=", ["coalesce", ["get", "tier"], 0], 3],
    ["all", [">=", ["coalesce", ["get", "tier"], 0], 2], [">=", ["zoom"], 4.3]],
    [">=", ["zoom"], 5.8],
];

const customSortKey = [
    "-",
    ["+",
        ["*", ["coalesce", ["get", "tier"], 0], 1000000000],
        ["coalesce", ["get", "population"], 0],
    ],
];

// Stock/custom city labels come from the immutable PMTiles/geojson "city" property.
// AI renames (world.cityRenames) are applied as a client-side match override so a
// renamed city shows its new name without touching the tiles.
const cityLabelExpr = (renames) => {
    const pairs = Object.entries(renames || {});
    if (!pairs.length) return ["get", "city"];
    const expr = ["match", ["downcase", ["get", "city"]]];
    for (const [from, to] of pairs) expr.push(from, to);
    expr.push(["get", "city"]);
    return expr;
};

const StockCities = ({ label, vNext }) => (
    <Source id="cities-source" type="vector" url={PMTILES_PROTOCOL_URLS.cities}>
    <Layer
    id="cities-shapes"
    type="symbol"
    source-layer="cities"
    beforeId={vNext ? "country-curved-labels" : undefined}
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
                    100000, 5.5,
                    1000000, 8,
                ],
                [
                    "case",
                    ["==", ["get", "capital"], "primary"], 1.7,
                    [">=", ["get", "population"], 2500000], 1.35,
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
    beforeId={vNext ? "country-curved-labels" : undefined}
    minzoom={vNext ? 4.2 : 3.4}
    filter={populationFilter}
    layout={{
        "symbol-sort-key": ["-", ["get", "population"]],
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
const CustomCities = ({ data, label, vNext }) => (
    <Source id="cities-source" type="geojson" data={data}>
    <Layer
    id="cities-shapes"
    type="symbol"
    beforeId={vNext ? "country-curved-labels" : undefined}
    minzoom={vNext ? 3.4 : 3.1}
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
            3, [
                "case",
                ["==", ["get", "capital"], "primary"], 13.5,
                ["match", ["coalesce", ["get", "tier"], 0], 4, 12.5, 3, 10.3, 2, 8.2, 6.0],
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
    beforeId={vNext ? "country-curved-labels" : undefined}
    minzoom={vNext ? 4.2 : 3.1}
    filter={customTierFilter}
    layout={{
        "symbol-sort-key": customSortKey,
        "text-field": label,
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-padding": 3,
        "text-radial-offset": 0.82,
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, [
                "case",
                ["==", ["get", "capital"], "primary"], 11.4,
                ["match", ["coalesce", ["get", "tier"], 0], 4, 10.8, 3, 10.0, 9.0],
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

const Cities = ({ vNext = false }) => {
    // world.customCities marks scenarios whose maps carry their own era-accurate
    // city set (presets, editor maps). Consumed from the shared world-state hook
    // so the map doesn't fire its own independent 5s poll.
    const { customCities: customFlag, cityRenames } = useWorldState();
    const [customData, setCustomData] = useState(null);
    const [cityEditorEpoch, setCityEditorEpoch] = useState(0);
    const citiesGeojsonUrl = JSON_URLS.citiesGeojson;
    const label = React.useMemo(() => cityLabelExpr(cityRenames), [cityRenames]);

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
    }, [customFlag, citiesGeojsonUrl, cityEditorEpoch]);

    // Custom-city scenarios never show the modern database (anachronistic); while
    // the custom set is still loading, show nothing rather than flash modern names.
    if (customFlag) {
        if (!customData || !customData.features.length) return null;
        return <CustomCities data={customData} label={label} vNext={vNext} />;
    }
    return <StockCities label={label} vNext={vNext} />;
};

export default Cities;
