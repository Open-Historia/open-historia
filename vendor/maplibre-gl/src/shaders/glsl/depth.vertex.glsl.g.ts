// This file is generated. Edit build/generate-shaders.ts, then run `npm run codegen`.
export default 'layout(location=0) in vec2 a_pos;void main() {\n#ifdef GLOBE\ngl_Position=projectTileFor3D(a_pos,0.0);\n#else\ngl_Position=u_projection_matrix*vec4(a_pos,0.0,1.0);\n#endif\n}';
