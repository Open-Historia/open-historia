import React from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import { PMTILES_PROTOCOL_URLS, ensurePmtilesProtocol } from "../../runtime/assets.js";

ensurePmtilesProtocol();

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

const Cities = () => {
    const pmtilesUrl = PMTILES_PROTOCOL_URLS.cities;

    return (
        <Source id="cities-source" type="vector" url={pmtilesUrl}>
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
};

export default Cities;
