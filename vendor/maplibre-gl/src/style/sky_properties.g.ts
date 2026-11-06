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


export type SkyProps = {
    "sky-color": DataConstantProperty<Color>,
    "horizon-color": DataConstantProperty<Color>,
    "fog-color": DataConstantProperty<Color>,
    "fog-ground-blend": DataConstantProperty<number>,
    "horizon-fog-blend": DataConstantProperty<number>,
    "sky-horizon-blend": DataConstantProperty<number>,
    "atmosphere-blend": DataConstantProperty<number>,
};

export type SkyPropsPossiblyEvaluated = {
    "sky-color": Color,
    "horizon-color": Color,
    "fog-color": Color,
    "fog-ground-blend": number,
    "horizon-fog-blend": number,
    "sky-horizon-blend": number,
    "atmosphere-blend": number,
};

let properties: Properties<SkyProps>;
export const getProperties = (): Properties<SkyProps> => properties = properties || new Properties({
    "sky-color": new DataConstantProperty(styleSpec["sky"]["sky-color"] as any as StylePropertySpecification, "sky-color"),
    "horizon-color": new DataConstantProperty(styleSpec["sky"]["horizon-color"] as any as StylePropertySpecification, "horizon-color"),
    "fog-color": new DataConstantProperty(styleSpec["sky"]["fog-color"] as any as StylePropertySpecification, "fog-color"),
    "fog-ground-blend": new DataConstantProperty(styleSpec["sky"]["fog-ground-blend"] as any as StylePropertySpecification, "fog-ground-blend"),
    "horizon-fog-blend": new DataConstantProperty(styleSpec["sky"]["horizon-fog-blend"] as any as StylePropertySpecification, "horizon-fog-blend"),
    "sky-horizon-blend": new DataConstantProperty(styleSpec["sky"]["sky-horizon-blend"] as any as StylePropertySpecification, "sky-horizon-blend"),
    "atmosphere-blend": new DataConstantProperty(styleSpec["sky"]["atmosphere-blend"] as any as StylePropertySpecification, "atmosphere-blend"),
});