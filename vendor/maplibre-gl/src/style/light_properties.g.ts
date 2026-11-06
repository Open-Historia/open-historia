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
} from './properties.ts';

import type {Color, Formatted, Padding, NumberArray, ColorArray, ResolvedImage, VariableAnchorOffsetCollection, ProjectionDefinitionSpecification} from '@maplibre/maplibre-gl-style-spec';
import {StylePropertySpecification} from '@maplibre/maplibre-gl-style-spec';


export type LightProps = {
    "anchor": DataConstantProperty<"map" | "viewport">,
    "position": DataConstantProperty<[number, number, number]>,
    "color": DataConstantProperty<Color>,
    "intensity": DataConstantProperty<number>,
};

export type LightPropsPossiblyEvaluated = {
    "anchor": "map" | "viewport",
    "position": [number, number, number],
    "color": Color,
    "intensity": number,
};

let properties: Properties<LightProps>;
export const getProperties = (): Properties<LightProps> => properties = properties || new Properties({
    "anchor": new DataConstantProperty(styleSpec["light"]["anchor"] as any as StylePropertySpecification, "anchor"),
    "position": new DataConstantProperty(styleSpec["light"]["position"] as any as StylePropertySpecification, "position"),
    "color": new DataConstantProperty(styleSpec["light"]["color"] as any as StylePropertySpecification, "color"),
    "intensity": new DataConstantProperty(styleSpec["light"]["intensity"] as any as StylePropertySpecification, "intensity"),
});