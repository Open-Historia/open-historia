// This file is generated. Edit build/generate-shaders.ts, then run `npm run codegen`.
export default 'layout(location=0) in vec2 a_pos;out vec2 v_pos;void main() {gl_Position=vec4(a_pos.x*2.0-1.0,1.0-a_pos.y*2.0,0.0,1.0);v_pos.x=a_pos.x;v_pos.y=1.0-a_pos.y;}';
