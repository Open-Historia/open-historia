// This file is generated. Edit build/generate-style-code.ts, then run 'npm run codegen'.
/* eslint-disable */

import {latest as styleSpec} from '@maplibre/maplibre-gl-style-spec';

import {
    Properties,
    DataConstantProperty,
    DataDrivenProperty,
    CrossFadedDataDrivenProperty,
    CrossFadedProperty,
    ColorRampProperty,
    PossiblyEvaluatedPropertyValue,
    CrossFaded
} from '../properties.ts';

import type {Color, Formatted, Padding, NumberArray, ColorArray, ResolvedImage, VariableAnchorOffsetCollection, ProjectionDefinitionSpecification} from '@maplibre/maplibre-gl-style-spec';
import {StylePropertySpecification} from '@maplibre/maplibre-gl-style-spec';


export type HeatmapPaintProps = {
    "heatmap-radius": DataDrivenProperty<number>,
    "heatmap-weight": DataDrivenProperty<number>,
    "heatmap-intensity": DataConstantProperty<number>,
    "heatmap-color": ColorRampProperty,
    "heatmap-opacity": DataConstantProperty<number>,
};

export type HeatmapPaintPropsPossiblyEvaluated = {
    "heatmap-radius": PossiblyEvaluatedPropertyValue<number>,
    "heatmap-weight": PossiblyEvaluatedPropertyValue<number>,
    "heatmap-intensity": number,
    "heatmap-color": ColorRampProperty,
    "heatmap-opacity": number,
};

let paint: Properties<HeatmapPaintProps>;
const getPaint = (): Properties<HeatmapPaintProps> => paint = paint || new Properties({
    "heatmap-radius": new DataDrivenProperty(styleSpec["paint_heatmap"]["heatmap-radius"] as any as StylePropertySpecification, "heatmap-radius"),
    "heatmap-weight": new DataDrivenProperty(styleSpec["paint_heatmap"]["heatmap-weight"] as any as StylePropertySpecification, "heatmap-weight"),
    "heatmap-intensity": new DataConstantProperty(styleSpec["paint_heatmap"]["heatmap-intensity"] as any as StylePropertySpecification, "heatmap-intensity"),
    "heatmap-color": new ColorRampProperty(styleSpec["paint_heatmap"]["heatmap-color"] as any as StylePropertySpecification, "heatmap-color"),
    "heatmap-opacity": new DataConstantProperty(styleSpec["paint_heatmap"]["heatmap-opacity"] as any as StylePropertySpecification, "heatmap-opacity"),
});

export default ({ get paint(): Properties<HeatmapPaintProps> { return getPaint() } });