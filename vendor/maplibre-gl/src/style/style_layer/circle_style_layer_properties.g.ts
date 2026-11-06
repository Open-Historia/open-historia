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


export type CircleLayoutProps = {
    "circle-sort-key": DataDrivenProperty<number>,
};

export type CircleLayoutPropsPossiblyEvaluated = {
    "circle-sort-key": PossiblyEvaluatedPropertyValue<number>,
};

let layout: Properties<CircleLayoutProps>;
const getLayout = (): Properties<CircleLayoutProps> => layout = layout || new Properties({
    "circle-sort-key": new DataDrivenProperty(styleSpec["layout_circle"]["circle-sort-key"] as any as StylePropertySpecification, "circle-sort-key"),
});

export type CirclePaintProps = {
    "circle-radius": DataDrivenProperty<number>,
    "circle-color": DataDrivenProperty<Color>,
    "circle-blur": DataDrivenProperty<number>,
    "circle-opacity": DataDrivenProperty<number>,
    "circle-translate": DataConstantProperty<[number, number]>,
    "circle-translate-anchor": DataConstantProperty<"map" | "viewport">,
    "circle-pitch-scale": DataConstantProperty<"map" | "viewport">,
    "circle-pitch-alignment": DataConstantProperty<"map" | "viewport">,
    "circle-stroke-width": DataDrivenProperty<number>,
    "circle-stroke-color": DataDrivenProperty<Color>,
    "circle-stroke-opacity": DataDrivenProperty<number>,
};

export type CirclePaintPropsPossiblyEvaluated = {
    "circle-radius": PossiblyEvaluatedPropertyValue<number>,
    "circle-color": PossiblyEvaluatedPropertyValue<Color>,
    "circle-blur": PossiblyEvaluatedPropertyValue<number>,
    "circle-opacity": PossiblyEvaluatedPropertyValue<number>,
    "circle-translate": [number, number],
    "circle-translate-anchor": "map" | "viewport",
    "circle-pitch-scale": "map" | "viewport",
    "circle-pitch-alignment": "map" | "viewport",
    "circle-stroke-width": PossiblyEvaluatedPropertyValue<number>,
    "circle-stroke-color": PossiblyEvaluatedPropertyValue<Color>,
    "circle-stroke-opacity": PossiblyEvaluatedPropertyValue<number>,
};

let paint: Properties<CirclePaintProps>;
const getPaint = (): Properties<CirclePaintProps> => paint = paint || new Properties({
    "circle-radius": new DataDrivenProperty(styleSpec["paint_circle"]["circle-radius"] as any as StylePropertySpecification, "circle-radius"),
    "circle-color": new DataDrivenProperty(styleSpec["paint_circle"]["circle-color"] as any as StylePropertySpecification, "circle-color"),
    "circle-blur": new DataDrivenProperty(styleSpec["paint_circle"]["circle-blur"] as any as StylePropertySpecification, "circle-blur"),
    "circle-opacity": new DataDrivenProperty(styleSpec["paint_circle"]["circle-opacity"] as any as StylePropertySpecification, "circle-opacity"),
    "circle-translate": new DataConstantProperty(styleSpec["paint_circle"]["circle-translate"] as any as StylePropertySpecification, "circle-translate"),
    "circle-translate-anchor": new DataConstantProperty(styleSpec["paint_circle"]["circle-translate-anchor"] as any as StylePropertySpecification, "circle-translate-anchor"),
    "circle-pitch-scale": new DataConstantProperty(styleSpec["paint_circle"]["circle-pitch-scale"] as any as StylePropertySpecification, "circle-pitch-scale"),
    "circle-pitch-alignment": new DataConstantProperty(styleSpec["paint_circle"]["circle-pitch-alignment"] as any as StylePropertySpecification, "circle-pitch-alignment"),
    "circle-stroke-width": new DataDrivenProperty(styleSpec["paint_circle"]["circle-stroke-width"] as any as StylePropertySpecification, "circle-stroke-width"),
    "circle-stroke-color": new DataDrivenProperty(styleSpec["paint_circle"]["circle-stroke-color"] as any as StylePropertySpecification, "circle-stroke-color"),
    "circle-stroke-opacity": new DataDrivenProperty(styleSpec["paint_circle"]["circle-stroke-opacity"] as any as StylePropertySpecification, "circle-stroke-opacity"),
});

export default ({ get paint(): Properties<CirclePaintProps> { return getPaint() }, get layout(): Properties<CircleLayoutProps> { return getLayout() } });