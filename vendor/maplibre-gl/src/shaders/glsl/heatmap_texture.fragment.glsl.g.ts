// This file is generated. Edit build/generate-shaders.ts, then run `npm run codegen`.
export default 'uniform sampler2D u_image;uniform sampler2D u_color_ramp;uniform float u_opacity;in vec2 v_pos;void main() {float t=texture(u_image,v_pos).r;vec4 color=texture(u_color_ramp,vec2(t,0.5));fragColor=color*u_opacity;\n#ifdef OVERDRAW_INSPECTOR\nfragColor=vec4(0.0);\n#endif\n}';
