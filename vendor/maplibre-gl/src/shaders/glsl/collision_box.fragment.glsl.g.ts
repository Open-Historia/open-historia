// This file is generated. Edit build/generate-shaders.ts, then run `npm run codegen`.
export default 'in float v_placed;in float v_notUsed;void main() {float alpha=0.5;fragColor=vec4(1.0,0.0,0.0,1.0)*alpha;if (v_placed > 0.5) {fragColor=vec4(0.0,0.0,1.0,0.5)*alpha;}if (v_notUsed > 0.5) {fragColor*=.1;}}';
