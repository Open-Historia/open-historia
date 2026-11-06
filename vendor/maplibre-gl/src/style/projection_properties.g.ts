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


export type ProjectionProps = {
    "type": DataConstantProperty<ProjectionDefinitionSpecification>,
};

export type ProjectionPropsPossiblyEvaluated = {
    "type": ProjectionDefinitionSpecification,
};

let properties: Properties<ProjectionProps>;
export const getProperties = (): Properties<ProjectionProps> => properties = properties || new Properties({
    "type": new DataConstantProperty(styleSpec["projection"]["type"] as any as StylePropertySpecification, "type"),
});