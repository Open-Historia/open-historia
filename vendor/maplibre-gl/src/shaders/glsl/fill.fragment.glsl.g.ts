// This file is generated. Edit build/generate-shaders.ts, then run `npm run codegen`.
export default '#pragma maplibre: define highp vec4 color\n#pragma maplibre: define lowp float opacity\nvoid main() {\n#pragma maplibre: initialize highp vec4 color\n#pragma maplibre: initialize lowp float opacity\nfragColor=color*opacity;\n#ifdef OVERDRAW_INSPECTOR\nfragColor=vec4(1.0);\n#endif\n}';
