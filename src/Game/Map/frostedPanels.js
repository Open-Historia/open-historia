// The interface's glass: backdrop-filter halves a phone's frame rate, so the map paints a blurred copy of itself under the panels.

export const FROST_LAYER_ID = "interface-frost";
// On the page's root while the map paints the glass: styles.css then turns the browser's blur off.
export const FROST_CLASS = "oh-map-frost";
// Every panel of glass reads this one setting, in its own inline style.
export const FROST_PANELS = '[style*="--oh-hud-blur"]';

// How much smaller than the map the blurred copy is, and how far apart its taps are: together about the panels' 14px.
const SCALE = 8;
const SPREAD = 1.5;
// As the setting's saturate().
const SATURATION = 1.18;

// Menus and drawers cover the interface, which only the browser can blur. The map stands still behind them, so it costs nothing.
const OVERLAY_HEIGHT = 120;
export const isOverlay = (rect) => rect.height > OVERLAY_HEIGHT;

export const frostSize = (width, height) => [Math.max(1, Math.ceil(width / SCALE)), Math.max(1, Math.ceil(height / SCALE))];

// A computed border radius in pixels, as much as the box can show.
export const cornerRadius = (value, width, height) => {
  const amount = Number.parseFloat(value) || 0;
  const pixels = String(value).trim().endsWith("%") ? (amount / 100) * Math.min(width, height) : amount;
  return Math.min(pixels, width / 2, height / 2);
};

// A panel's box on the map's canvas, or null if none of it is over the map.
export const panelBox = (rect, canvas, radius = 0) => {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const x = rect.left - canvas.left;
  const y = rect.top - canvas.top;
  if (x >= canvas.width || y >= canvas.height || x + rect.width <= 0 || y + rect.height <= 0) return null;
  return { x, y, width: rect.width, height: rect.height, radius };
};

export const samePanels = (before, after) => before.length === after.length
  && before.every((box, index) => {
    const other = after[index];
    return box.x === other.x && box.y === other.y && box.width === other.width && box.height === other.height && box.radius === other.radius;
  });

const HEAD = "#version 300 es\nprecision highp float;\n";
const WHOLE_VERTEX = `${HEAD}in vec2 corner; out vec2 uv;
void main() { uv = corner; gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0); }`;
// Averages the pixels each texel of the small copy stands for.
const SHRINK_FRAGMENT = `${HEAD}in vec2 uv; out vec4 colour; uniform sampler2D picture; uniform vec2 pixel;
void main() {
  vec4 sum = vec4(0.0);
  for (int y = -1; y <= 2; y++) for (int x = -1; x <= 2; x++) sum += texture(picture, uv + (vec2(x, y) - 0.5) * pixel * 2.0);
  colour = sum / 16.0;
}`;
const BLUR_FRAGMENT = `${HEAD}in vec2 uv; out vec4 colour; uniform sampler2D picture; uniform vec2 step;
void main() {
  colour = texture(picture, uv) * 0.375 + (texture(picture, uv + step) + texture(picture, uv - step)) * 0.25
    + (texture(picture, uv + step * 2.0) + texture(picture, uv - step * 2.0)) * 0.0625;
}`;
const PANEL_VERTEX = `${HEAD}in vec2 corner; out vec2 uv; out vec2 fromCentre; uniform vec4 box; uniform vec2 canvas;
void main() {
  vec2 at = box.xy + corner * box.zw;
  fromCentre = (corner - 0.5) * box.zw;
  uv = vec2(at.x / canvas.x, 1.0 - at.y / canvas.y);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;
const PANEL_FRAGMENT = `${HEAD}in vec2 uv; in vec2 fromCentre; out vec4 colour; uniform sampler2D picture; uniform vec4 box; uniform float radius;
void main() {
  vec2 inside = abs(fromCentre) - box.zw * 0.5 + radius;
  if (length(max(inside, 0.0)) + min(max(inside.x, inside.y), 0.0) - radius > 0.0) discard;
  vec4 seen = texture(picture, uv);
  float grey = dot(seen.rgb, vec3(0.2126, 0.7152, 0.0722));
  colour = vec4(clamp(mix(vec3(grey), seen.rgb, ${SATURATION.toFixed(2)}), 0.0, seen.a), seen.a);
}`;

const compile = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "shader");
  return shader;
};

const programOf = (gl, vertex, fragment, uniforms) => {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, "corner");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "program");
  return { program, ...Object.fromEntries(uniforms.map((name) => [name, gl.getUniformLocation(program, name)])) };
};

const textureOf = (gl, width, height) => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
};

const framebufferOf = (gl, texture) => {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return framebuffer;
};

// `panels()` says where the glass is: { canvas: {width, height}, boxes: [panelBox] }.
export const createFrostLayer = ({ panels, onError }) => {
  let drawn = null;
  let targets = null;

  const freeTargets = (gl) => {
    if (!targets) return;
    for (const texture of [targets.frame, targets.first, targets.second]) gl.deleteTexture(texture);
    for (const framebuffer of [targets.frameBuffer, targets.firstBuffer, targets.secondBuffer]) gl.deleteFramebuffer(framebuffer);
    targets = null;
  };

  const targetsFor = (gl, width, height) => {
    if (targets?.width === width && targets.height === height) return targets;
    freeTargets(gl);
    const [smallWidth, smallHeight] = frostSize(width, height);
    const first = textureOf(gl, smallWidth, smallHeight);
    const second = textureOf(gl, smallWidth, smallHeight);
    const frame = textureOf(gl, width, height);
    targets = {
      width, height, smallWidth, smallHeight, first, second, frame,
      frameBuffer: framebufferOf(gl, frame),
      firstBuffer: framebufferOf(gl, first),
      secondBuffer: framebufferOf(gl, second),
    };
    return targets;
  };

  const pass = (gl, shader, into, from, setUp) => {
    gl.useProgram(shader.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, into);
    gl.bindTexture(gl.TEXTURE_2D, from);
    gl.uniform1i(shader.picture, 0);
    setUp();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  return {
    id: FROST_LAYER_ID,
    type: "custom",
    renderingMode: "2d",
    onAdd(_map, gl) {
      try {
        const corners = gl.createBuffer();
        const array = gl.createVertexArray();
        gl.bindVertexArray(array);
        gl.bindBuffer(gl.ARRAY_BUFFER, corners);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        drawn = {
          array, corners,
          shrink: programOf(gl, WHOLE_VERTEX, SHRINK_FRAGMENT, ["picture", "pixel"]),
          blur: programOf(gl, WHOLE_VERTEX, BLUR_FRAGMENT, ["picture", "step"]),
          panel: programOf(gl, PANEL_VERTEX, PANEL_FRAGMENT, ["picture", "box", "canvas", "radius"]),
        };
      } catch (error) {
        drawn = null;
        onError?.(error);
      }
    },
    render(gl) {
      if (!drawn || gl.isContextLost()) return;
      const { canvas, boxes } = panels();
      if (!boxes.length) return;
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const at = targetsFor(gl, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.activeTexture(gl.TEXTURE0);
      // A blit: copyTexSubImage2D from the canvas stalled the GPU for half a second at a time on the globe.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, at.frameBuffer);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindVertexArray(drawn.array);
      gl.viewport(0, 0, at.smallWidth, at.smallHeight);
      pass(gl, drawn.shrink, at.firstBuffer, at.frame, () => gl.uniform2f(drawn.shrink.pixel, 1 / width, 1 / height));
      pass(gl, drawn.blur, at.secondBuffer, at.first, () => gl.uniform2f(drawn.blur.step, SPREAD / at.smallWidth, 0));
      pass(gl, drawn.blur, at.firstBuffer, at.second, () => gl.uniform2f(drawn.blur.step, 0, SPREAD / at.smallHeight));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(drawn.panel.program);
      gl.bindTexture(gl.TEXTURE_2D, at.first);
      gl.uniform1i(drawn.panel.picture, 0);
      gl.uniform2f(drawn.panel.canvas, canvas.width, canvas.height);
      for (const box of boxes) {
        gl.uniform4f(drawn.panel.box, box.x, box.y, box.width, box.height);
        gl.uniform1f(drawn.panel.radius, box.radius);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.bindVertexArray(null);
    },
    // What the map made is gone with the context, and a restored one does not ask for it again.
    forget() {
      drawn = null;
      targets = null;
    },
    onRemove(_map, gl) {
      if (!drawn) return;
      if (!gl.isContextLost()) {
        freeTargets(gl);
        for (const shader of [drawn.shrink, drawn.blur, drawn.panel]) gl.deleteProgram(shader.program);
        gl.deleteBuffer(drawn.corners);
        gl.deleteVertexArray(drawn.array);
      }
      drawn = null;
      targets = null;
    },
  };
};
