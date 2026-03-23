import React from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { addProtocol } from 'maplibre-gl';
import { Protocol } from 'pmtiles';

let pmtilesAdded = false;

const setupProtocol = () => {
    if (!pmtilesAdded) {
        const protocol = new Protocol();
        addProtocol('pmtiles', protocol.tile.bind(protocol));
        pmtilesAdded = true;
    }
};

setupProtocol();

const PMTILES_URL = `pmtiles://${window.location.origin}/saves/save0/cities.pmtiles`;

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
]
]
];

const Cities = () => {
    return (
        <Source id="cities-source" type="vector" url={PMTILES_URL}>
        {/* City marker */}
        <Layer
        id="cities-shapes"
        type="symbol"
        source-layer="cities"
        minzoom={3.4}
        filter={populationFilter}
        layout={{
            'text-field': [
                'case',
                ['==', ['get', 'capital'], 'primary'], '★',
                ['>=', ['get', 'population'], 2500000], '◆',
                '■'
            ],
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                3, [
                    '*',
                    [
                        'interpolate', ['linear'], ['get', 'population'],
                        100000, 6,
                        1000000, 10
                    ],
                    [
                        'case',
                        ['==', ['get', 'capital'], 'primary'], 2.5,
                        ['>=', ['get', 'population'], 2500000], 2,
                        1
                    ]
                ],
                10, 22
            ],
            'symbol-sort-key': ['-', ['get', 'population']],
            'text-allow-overlap': true,
            'text-padding': 0
        }}
        paint={{
            'text-color': 'rgba(0,0,0,0)',
            'text-halo-color': '#ffffff',
            'text-halo-width': 0.5
        }}
        />
        {/* City label */}
        <Layer
        id="cities-labels"
        type="symbol"
        source-layer="cities"
        minzoom={3.4}
        filter={populationFilter}
        layout={{
            'text-field': ['get', 'city'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                3, 8,
                10, 10
            ],
            'symbol-sort-key': ['-', ['get', 'population']],
            'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
            'text-radial-offset': 0.7,
            'text-padding': 5
        }}
        paint={{
            'text-color': '#ffffff',
            'text-halo-color': '#333333',
            'text-halo-width': 2
        }}
        />
        </Source>
    );
};

export default Cities;
