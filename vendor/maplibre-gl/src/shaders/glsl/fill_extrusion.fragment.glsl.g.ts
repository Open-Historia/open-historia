// This file is generated. Edit build/generate-shaders.ts, then run `npm run codegen`.
export default 'in vec4 v_color;void main() {fragColor=v_color;\n#ifdef OVERDRAW_INSPECTOR\nfragColor=vec4(1.0);\n#endif\n}';
