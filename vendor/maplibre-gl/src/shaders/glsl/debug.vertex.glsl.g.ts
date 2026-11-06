// This file is generated. Edit build/generate-shaders.ts, then run `npm run codegen`.
export default 'layout(location=0) in vec2 a_pos;out vec2 v_uv;uniform float u_overlay_scale;void main() {v_uv=a_pos/8192.0;gl_Position=projectTileWithElevation(a_pos*u_overlay_scale,get_elevation(a_pos));}';
