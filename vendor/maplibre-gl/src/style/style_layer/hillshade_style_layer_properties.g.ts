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


export type HillshadePaintProps = {
    "hillshade-illumination-direction": DataConstantProperty<NumberArray>,
    "hillshade-illumination-altitude": DataConstantProperty<NumberArray>,
    "hillshade-illumination-anchor": DataConstantProperty<"map" | "viewport">,
    "hillshade-exaggeration": DataConstantProperty<number>,
    "hillshade-shadow-color": DataConstantProperty<ColorArray>,
    "hillshade-highlight-color": DataConstantProperty<ColorArray>,
    "hillshade-accent-color": DataConstantProperty<Color>,
    "hillshade-method": DataConstantProperty<"standard" | "basic" | "combined" | "igor" | "multidirectional">,
    "resampling": DataConstantProperty<"linear" | "nearest">,
};

export type HillshadePaintPropsPossiblyEvaluated = {
    "hillshade-illumination-direction": NumberArray,
    "hillshade-illumination-altitude": NumberArray,
    "hillshade-illumination-anchor": "map" | "viewport",
    "hillshade-exaggeration": number,
    "hillshade-shadow-color": ColorArray,
    "hillshade-highlight-color": ColorArray,
    "hillshade-accent-color": Color,
    "hillshade-method": "standard" | "basic" | "combined" | "igor" | "multidirectional",
    "resampling": "linear" | "nearest",
};

let paint: Properties<HillshadePaintProps>;
const getPaint = (): Properties<HillshadePaintProps> => paint = paint || new Properties({
    "hillshade-illumination-direction": new DataConstantProperty(styleSpec["paint_hillshade"]["hillshade-illumination-direction"] as any as StylePropertySpecification, "hillshade-illumination-direction"),
    "hillshade-illumination-altitude": new DataConstantProperty(styleSpec["paint_hillshade"]["hillshade-illumination-altitude"] as any as StylePropertySpecification, "hillshade-illumination-altitude"),
    "hillshade-illumination-anchor": new DataConstantProperty(styleSpec["paint_hillshade"]["hillshade-illumination-anchor"] as any as StylePropertySpecification, "hillshade-illumination-anchor"),
    "hillshade-exaggeration": new DataConstantProperty(styleSpec["paint_hillshade"]["hillshade-exaggeration"] as any as StylePropertySpecification, "hillshade-exaggeration"),
    "hillshade-shadow-color": new DataConstantProperty(styleSpec["paint_hillshade"]["hillshade-shadow-color"] as any as StylePropertySpecification, "hillshade-shadow-color"),
    "hillshade-highlight-color": new DataConstantProperty(styleSpec["paint_hillshade"]["hillshade-highlight-color"] as any as StylePropertySpecification, "hillshade-highlight-color"),
    "hillshade-accent-color": new DataConstantProperty(styleSpec["paint_hillshade"]["hillshade-accent-color"] as any as StylePropertySpecification, "hillshade-accent-color"),
    "hillshade-method": new DataConstantProperty(styleSpec["paint_hillshade"]["hillshade-method"] as any as StylePropertySpecification, "hillshade-method"),
    "resampling": new DataConstantProperty(styleSpec["paint_hillshade"]["resampling"] as any as StylePropertySpecification, "resampling"),
});

export default ({ get paint(): Properties<HillshadePaintProps> { return getPaint() } });