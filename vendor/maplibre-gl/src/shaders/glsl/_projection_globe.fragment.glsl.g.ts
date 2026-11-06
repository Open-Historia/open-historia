// This file is generated. Edit build/generate-shaders.ts, then run `npm run codegen`.
export default 'in highp float v_projection_tile_x;void clipAntimeridian() {if (u_projection_clip_antimeridian !=0 && (v_projection_tile_x < 0.0 || v_projection_tile_x >=8192.0)) {discard;}}';
