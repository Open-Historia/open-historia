/*! Open Historia — portions (per-scenario era city layer) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useState } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import {
    PMTILES_PROTOCOL_URLS,
    JSON_URLS,
    ensurePmtilesProtocol,
    readJson,
} from "../../../runtime/assets.js";
import { useWorldCities } from "./useLegacyWorldSelectors.js";
import { normalizeCustomCityFeatureCollection } from "../../../runtime/cityFeatures.js";

// This copy reads `city`, `tier` and `capital === "primary"` straight off the
// features — the shape the editor exports. Imported scenarios arrive with
// `name`, a boolean `capital` and sometimes no `tier`; the current renderer
// normalises those (runtime/cityFeatures.js) and this one drew blank or hidden
// labels for them. Normalise the same way, then spell the result in this copy's
// own vocabulary. (A deliberate deviation from the verbatim copy; see README.)
const legacyCityCollection = (data) => ({
    type: "FeatureCollection",
    features: normalizeCustomCityFeatureCollection(data).features.map((feature) => ({
        ...feature,
        properties: {
            ...feature.properties,
            capital: feature.properties._ohCapital
                ? "primary"
                : (typeof feature.properties.capital === "string" ? feature.properties.capital : ""),
        },
    })),
});

ensurePmtilesProtocol();

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

const populationFilter = (pop) => [
    "any",
    ["==", ["get", "capital"], "primary"],
    [
        ">",
        pop,
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

const customSortKey = (pop) => ["-", ["+", ["*", ["get", "tier"], 1000000000], pop]];

// Stock/custom city labels come from the immutable PMTiles/geojson "city" property.
// AI renames (world.cityRenames) are applied as a client-side match override so a
// renamed city shows its new name without touching the tiles.
// Population overrides (world.cityPopulations) work the same way as renames: the
// tiles are immutable, so a changed population is substituted client-side by the
// city's original name. Unlike a label this feeds FILTERS and SIZES as well, so
// every place the layers read population has to go through it — otherwise a city
// that grew past a threshold resizes but never appears, or appears at its old size.
const cityPopulationExpr = (populations) => {
    const pairs = Object.entries(populations || {});
    if (!pairs.length) return ["get", "population"];
    const expr = ["match", ["downcase", ["get", "city"]]];
    for (const [name, value] of pairs) expr.push(name, value);
    expr.push(["get", "population"]);
    return expr;
};

const cityLabelExpr = (renames) => {
    const pairs = Object.entries(renames || {});
    if (!pairs.length) return ["get", "city"];
    const expr = ["match", ["downcase", ["get", "city"]]];
    for (const [from, to] of pairs) expr.push(from, to);
    expr.push(["get", "city"]);
    return expr;
};

const StockCities = ({ label, pop }) => (
    <Source id="cities-source" type="vector" url={PMTILES_PROTOCOL_URLS.cities}>
    <Layer
    id="cities-shapes"
    type="symbol"
    source-layer="cities"
    minzoom={3.4}
    filter={populationFilter(pop)}
    layout={{
        "symbol-sort-key": ["-", pop],
        "text-allow-overlap": true,
        "text-field": [
            "case",
            ["==", ["get", "capital"], "primary"], "★",
            [">=", pop, 2500000], "◆",
            "■",
        ],
        "text-padding": 0,
        "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, [
                "*",
                [
                    "interpolate", ["linear"], pop,
                    100000, 6,
                    1000000, 10,
                ],
                [
                    "case",
                    ["==", ["get", "capital"], "primary"], 2.5,
                    [">=", pop, 2500000], 2,
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
    filter={populationFilter(pop)}
    layout={{
        "symbol-sort-key": ["-", pop],
        "text-field": label,
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
const CustomCities = ({ data, label, pop }) => (
    <Source id="cities-source" type="geojson" data={data}>
    <Layer
    id="cities-shapes"
    type="symbol"
    minzoom={3.4}
    filter={customTierFilter}
    layout={{
        "symbol-sort-key": customSortKey(pop),
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
        "symbol-sort-key": customSortKey(pop),
        "text-field": label,
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
    // city set (presets, editor maps). Consumed from the shared world-state hook
    // so the map doesn't fire its own independent 5s poll.
    const { customCities: customFlag, cityRenames, cityPopulations } = useWorldCities();
    const [customData, setCustomData] = useState(null);
    const citiesGeojsonUrl = JSON_URLS.citiesGeojson;
    const label = React.useMemo(() => cityLabelExpr(cityRenames), [cityRenames]);
    const pop = React.useMemo(() => cityPopulationExpr(cityPopulations), [cityPopulations]);

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
                setCustomData(data && Array.isArray(data.features) ? legacyCityCollection(data) : EMPTY_FEATURE_COLLECTION);
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
        return <CustomCities data={customData} label={label} pop={pop} />;
    }
    return <StockCities label={label} pop={pop} />;
};

export default Cities;
