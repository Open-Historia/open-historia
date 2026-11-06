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


export type LineLayoutProps = {
    "line-cap": DataDrivenProperty<"butt" | "round" | "square">,
    "line-join": DataDrivenProperty<"bevel" | "round" | "miter">,
    "line-miter-limit": DataDrivenProperty<number>,
    "line-round-limit": DataDrivenProperty<number>,
    "line-sort-key": DataDrivenProperty<number>,
};

export type LineLayoutPropsPossiblyEvaluated = {
    "line-cap": PossiblyEvaluatedPropertyValue<"butt" | "round" | "square">,
    "line-join": PossiblyEvaluatedPropertyValue<"bevel" | "round" | "miter">,
    "line-miter-limit": PossiblyEvaluatedPropertyValue<number>,
    "line-round-limit": PossiblyEvaluatedPropertyValue<number>,
    "line-sort-key": PossiblyEvaluatedPropertyValue<number>,
};

let layout: Properties<LineLayoutProps>;
const getLayout = (): Properties<LineLayoutProps> => layout = layout || new Properties({
    "line-cap": new DataDrivenProperty(styleSpec["layout_line"]["line-cap"] as any as StylePropertySpecification, "line-cap"),
    "line-join": new DataDrivenProperty(styleSpec["layout_line"]["line-join"] as any as StylePropertySpecification, "line-join"),
    "line-miter-limit": new DataDrivenProperty(styleSpec["layout_line"]["line-miter-limit"] as any as StylePropertySpecification, "line-miter-limit"),
    "line-round-limit": new DataDrivenProperty(styleSpec["layout_line"]["line-round-limit"] as any as StylePropertySpecification, "line-round-limit"),
    "line-sort-key": new DataDrivenProperty(styleSpec["layout_line"]["line-sort-key"] as any as StylePropertySpecification, "line-sort-key"),
});

export type LinePaintProps = {
    "line-opacity": DataDrivenProperty<number>,
    "line-layer-opacity": DataConstantProperty<number>,
    "line-color": DataDrivenProperty<Color>,
    "line-translate": DataConstantProperty<[number, number]>,
    "line-translate-anchor": DataConstantProperty<"map" | "viewport">,
    "line-width": DataDrivenProperty<number>,
    "line-gap-width": DataDrivenProperty<number>,
    "line-offset": DataDrivenProperty<number>,
    "line-blur": DataDrivenProperty<number>,
    "line-dasharray": CrossFadedDataDrivenProperty<number[]>,
    "line-pattern": CrossFadedDataDrivenProperty<ResolvedImage>,
    "line-gradient": ColorRampProperty,
};

export type LinePaintPropsPossiblyEvaluated = {
    "line-opacity": PossiblyEvaluatedPropertyValue<number>,
    "line-layer-opacity": number,
    "line-color": PossiblyEvaluatedPropertyValue<Color>,
    "line-translate": [number, number],
    "line-translate-anchor": "map" | "viewport",
    "line-width": PossiblyEvaluatedPropertyValue<number>,
    "line-gap-width": PossiblyEvaluatedPropertyValue<number>,
    "line-offset": PossiblyEvaluatedPropertyValue<number>,
    "line-blur": PossiblyEvaluatedPropertyValue<number>,
    "line-dasharray": PossiblyEvaluatedPropertyValue<CrossFaded<number[]>>,
    "line-pattern": PossiblyEvaluatedPropertyValue<CrossFaded<ResolvedImage>>,
    "line-gradient": ColorRampProperty,
};

let paint: Properties<LinePaintProps>;
const getPaint = (): Properties<LinePaintProps> => paint = paint || new Properties({
    "line-opacity": new DataDrivenProperty(styleSpec["paint_line"]["line-opacity"] as any as StylePropertySpecification, "line-opacity"),
    "line-layer-opacity": new DataConstantProperty(styleSpec["paint_line"]["line-layer-opacity"] as any as StylePropertySpecification, "line-layer-opacity"),
    "line-color": new DataDrivenProperty(styleSpec["paint_line"]["line-color"] as any as StylePropertySpecification, "line-color"),
    "line-translate": new DataConstantProperty(styleSpec["paint_line"]["line-translate"] as any as StylePropertySpecification, "line-translate"),
    "line-translate-anchor": new DataConstantProperty(styleSpec["paint_line"]["line-translate-anchor"] as any as StylePropertySpecification, "line-translate-anchor"),
    "line-width": new DataDrivenProperty(styleSpec["paint_line"]["line-width"] as any as StylePropertySpecification, "line-width"),
    "line-gap-width": new DataDrivenProperty(styleSpec["paint_line"]["line-gap-width"] as any as StylePropertySpecification, "line-gap-width"),
    "line-offset": new DataDrivenProperty(styleSpec["paint_line"]["line-offset"] as any as StylePropertySpecification, "line-offset"),
    "line-blur": new DataDrivenProperty(styleSpec["paint_line"]["line-blur"] as any as StylePropertySpecification, "line-blur"),
    "line-dasharray": new CrossFadedDataDrivenProperty(styleSpec["paint_line"]["line-dasharray"] as any as StylePropertySpecification, "line-dasharray"),
    "line-pattern": new CrossFadedDataDrivenProperty(styleSpec["paint_line"]["line-pattern"] as any as StylePropertySpecification, "line-pattern"),
    "line-gradient": new ColorRampProperty(styleSpec["paint_line"]["line-gradient"] as any as StylePropertySpecification, "line-gradient"),
});

export default ({ get paint(): Properties<LinePaintProps> { return getPaint() }, get layout(): Properties<LineLayoutProps> { return getLayout() } });