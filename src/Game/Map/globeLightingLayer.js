/*! Open Historia — globe surface lighting layer © 2026 Nicholas Krol, MIT. */
import { directionFromLngLat, globeTransitionOpacity } from "./globeSunMath.js";

export const GLOBE_LIGHTING_LAYER_ID = "oh-globe-surface-lighting";

const LATITUDE_SEGMENTS = 48;
const LONGITUDE_SEGMENTS = 96;

const buildSphereMesh = () => {
  const vertices = [];
  const indices = [];

  for (let latIndex = 0; latIndex <= LATITUDE_SEGMENTS; latIndex += 1) {
    const lat = -90 + (latIndex / LATITUDE_SEGMENTS) * 180;
    for (let lngIndex = 0; lngIndex <= LONGITUDE_SEGMENTS; lngIndex += 1) {
      const lng = -180 + (lngIndex / LONGITUDE_SEGMENTS) * 360;
      vertices.push(...directionFromLngLat(lng, lat));
    }
  }

  const rowLength = LONGITUDE_SEGMENTS + 1;
  for (let latIndex = 0; latIndex < LATITUDE_SEGMENTS; latIndex += 1) {
    for (let lngIndex = 0; lngIndex < LONGITUDE_SEGMENTS; lngIndex += 1) {
      const lowerLeft = latIndex * rowLength + lngIndex;
      const upperLeft = lowerLeft + rowLength;
      indices.push(lowerLeft, upperLeft, lowerLeft + 1);
      indices.push(lowerLeft + 1, upperLeft, upperLeft + 1);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
};

const compileShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const reason = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Globe lighting shader failed to compile: ${reason}`);
  }
  return shader;
};

const createProgram = (gl) => {
  const isWebGL2 = typeof gl.createVertexArray === "function";
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, isWebGL2 ? `#version 300 es
    precision highp float;
    in vec3 a_position;
    uniform mat4 u_matrix;
    out vec3 v_normal;

    void main() {
      v_normal = a_position;
      gl_Position = u_matrix * vec4(a_position * 1.002, 1.0);
    }
  ` : `
    precision highp float;
    attribute vec3 a_position;
    uniform mat4 u_matrix;
    varying vec3 v_normal;

    void main() {
      v_normal = a_position;
      gl_Position = u_matrix * vec4(a_position * 1.002, 1.0);
    }
  `);
  const fragmentBody = `
    precision mediump float;
    VARYING vec3 v_normal;
    uniform vec3 u_sun_direction;
    uniform float u_transition;

    void main() {
      float sun_dot = dot(normalize(v_normal), normalize(u_sun_direction));
      float night = 1.0 - smoothstep(-0.18, 0.12, sun_dot);
      float dusk = smoothstep(-0.24, -0.02, sun_dot)
        * (1.0 - smoothstep(0.04, 0.28, sun_dot));
      float daylight = smoothstep(0.0, 0.85, sun_dot);
      float night_alpha = night * 0.72;
      float dusk_alpha = dusk * 0.14;
      float day_alpha = daylight * 0.06;
      float weight = night_alpha + dusk_alpha + day_alpha;
      float alpha = min(0.78, weight) * u_transition;
      vec3 color = (
        vec3(0.008, 0.024, 0.09) * night_alpha
        + vec3(1.0, 0.34, 0.08) * dusk_alpha
        + vec3(1.0, 0.68, 0.32) * day_alpha
      ) / max(weight, 0.0001);
      OUTPUT = vec4(color * alpha, alpha);
    }
  `;
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, isWebGL2
    ? `#version 300 es
      ${fragmentBody
        .replace("precision mediump float;", "precision mediump float;\nout vec4 frag_color;")
        .replace("VARYING", "in")
        .replace("OUTPUT", "frag_color")}
    `
    : fragmentBody.replace("VARYING", "varying").replace("OUTPUT", "gl_FragColor"));

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const reason = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Globe lighting program failed to link: ${reason}`);
  }
  return program;
};

export const createGlobeLightingLayer = (getSunPosition) => ({
  id: GLOBE_LIGHTING_LAYER_ID,
  type: "custom",
  renderingMode: "3d",

  onAdd(_map, gl) {
    const mesh = buildSphereMesh();
    this.program = createProgram(gl);
    this.indexCount = mesh.indices.length;
    this.vertexBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    this.positionLocation = gl.getAttribLocation(this.program, "a_position");
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    this.matrixLocation = gl.getUniformLocation(this.program, "u_matrix");
    this.sunLocation = gl.getUniformLocation(this.program, "u_sun_direction");
    this.transitionLocation = gl.getUniformLocation(this.program, "u_transition");
  },

  render(gl, args) {
    const transition = globeTransitionOpacity(
      args.defaultProjectionData?.projectionTransition,
    );
    if (!this.program || transition <= 0.001) return;

    const { lng, lat } = getSunPosition();
    const sunDirection = directionFromLngLat(lng, lat);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.uniformMatrix4fv(this.matrixLocation, false, args.defaultProjectionData.mainMatrix);
    gl.uniform3fv(this.sunLocation, sunDirection);
    gl.uniform1f(this.transitionLocation, transition);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  },

  onRemove(_map, gl) {
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    if (this.program) gl.deleteProgram(this.program);
    this.vertexBuffer = null;
    this.indexBuffer = null;
    this.program = null;
  },
});
