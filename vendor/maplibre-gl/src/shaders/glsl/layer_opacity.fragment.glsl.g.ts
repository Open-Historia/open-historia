// This file is generated. Edit build/generate-shaders.ts, then run `npm run codegen`.
export default 'uniform sampler2D u_image;uniform float u_opacity;in vec2 v_pos;void main() {fragColor=texture(u_image,v_pos)*u_opacity;\n#ifdef OVERDRAW_INSPECTOR\nfragColor=vec4(0.0);\n#endif\n}';
