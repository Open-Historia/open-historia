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


export type BackgroundPaintProps = {
    "background-color": DataConstantProperty<Color>,
    "background-pattern": CrossFadedProperty<ResolvedImage>,
    "background-opacity": DataConstantProperty<number>,
};

export type BackgroundPaintPropsPossiblyEvaluated = {
    "background-color": Color,
    "background-pattern": CrossFaded<ResolvedImage>,
    "background-opacity": number,
};

let paint: Properties<BackgroundPaintProps>;
const getPaint = (): Properties<BackgroundPaintProps> => paint = paint || new Properties({
    "background-color": new DataConstantProperty(styleSpec["paint_background"]["background-color"] as any as StylePropertySpecification, "background-color"),
    "background-pattern": new CrossFadedProperty(styleSpec["paint_background"]["background-pattern"] as any as StylePropertySpecification, "background-pattern"),
    "background-opacity": new DataConstantProperty(styleSpec["paint_background"]["background-opacity"] as any as StylePropertySpecification, "background-opacity"),
});

export default ({ get paint(): Properties<BackgroundPaintProps> { return getPaint() } });