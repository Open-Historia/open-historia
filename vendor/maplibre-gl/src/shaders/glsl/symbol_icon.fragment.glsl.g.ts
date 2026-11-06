// This file is generated. Edit build/generate-shaders.ts, then run `npm run codegen`.
export default 'uniform sampler2D u_texture;in vec2 v_tex;in float v_total_opacity;void main() {fragColor=texture(u_texture,v_tex)*v_total_opacity;\n#ifdef OVERDRAW_INSPECTOR\nfragColor=vec4(1.0);\n#endif\n}';
