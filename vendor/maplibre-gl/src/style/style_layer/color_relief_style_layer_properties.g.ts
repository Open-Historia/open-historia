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


export type ColorReliefPaintProps = {
    "color-relief-opacity": DataConstantProperty<number>,
    "color-relief-color": ColorRampProperty,
    "resampling": DataConstantProperty<"linear" | "nearest">,
};

export type ColorReliefPaintPropsPossiblyEvaluated = {
    "color-relief-opacity": number,
    "color-relief-color": ColorRampProperty,
    "resampling": "linear" | "nearest",
};

let paint: Properties<ColorReliefPaintProps>;
const getPaint = (): Properties<ColorReliefPaintProps> => paint = paint || new Properties({
    "color-relief-opacity": new DataConstantProperty(styleSpec["paint_color-relief"]["color-relief-opacity"] as any as StylePropertySpecification, "color-relief-opacity"),
    "color-relief-color": new ColorRampProperty(styleSpec["paint_color-relief"]["color-relief-color"] as any as StylePropertySpecification, "color-relief-color"),
    "resampling": new DataConstantProperty(styleSpec["paint_color-relief"]["resampling"] as any as StylePropertySpecification, "resampling"),
});

export default ({ get paint(): Properties<ColorReliefPaintProps> { return getPaint() } });