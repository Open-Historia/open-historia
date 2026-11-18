/*! Open Historia — the bunker door over the landing page © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The top of the page is a blast door. Its two leaves meet at a toothed seam
// (the idea of the owner's sketch, drawn as machined lugs: straight runs of one
// length joined by 45-degree flanks, so one leaf's tooth sits in the other's notch) and the four ages are painted across both of them.
// "Demo in your browser" opens it: the locking bars and the frame's pins draw
// back, the leaves pop out of their teeth, slide apart into the walls, and the
// view walks into the bunker behind before the demo opens.
//
// Built in layers in real CSS 3D (door.css): the painted armour plate, the
// plate's thickness along the toothed edge (a strip per straight piece of the
// seam, folded back into the depth), the locking bars and their housings
// standing off the face, the rams behind the leaves, and the hall behind all
// of it. Only transform and opacity move.
//
// Nothing here is needed to reach the demo: the button is a plain link, and
// this file only takes over a plain click when motion is allowed. If anything
// here fails, the page keeps the flat hero it had. Plain ES5 like site.js.
(function () {
  "use strict";
  var hero = document.querySelector(".hero");
  var realms = hero && hero.querySelector(".realms");
  var plate = hero && hero.querySelector(".hero-plate");
  if (!hero || !realms || !plate || !window.CSS || !CSS.supports || !CSS.supports("transform-style", "preserve-3d")) return;
  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

  // The seam is made from three numbers, not traced: the teeth's depth (they
  // stand DEPTH either side of the middle), their flanks at FLANK degrees from
  // the vertical, and a pitch near PITCH flank-heights per tooth, rounded so a
  // whole number of teeth fills the height. Every run is the same length, the
  // top and bottom runs are half runs, and both leaves share the one line, so
  // they mate exactly.
  var FLANK = 45;
  var PITCH = 2.4;
  function seamPoints(W, H, depth) {
    var rise = (2 * depth) / Math.tan(FLANK * Math.PI / 180);
    var teeth = Math.max(3, Math.min(9, Math.round(H / (rise * PITCH))));
    var unit = H / teeth, run = unit - rise, side = -1, y = 0, pts = [[W / 2 - depth, 0]];
    for (var i = 0; i < teeth; i += 1) {
      y += i === 0 ? run / 2 : run;
      pts.push([W / 2 + side * depth, y]);
      y += rise;
      side = -side;
      pts.push([W / 2 + side * depth, y]);
    }
    pts.push([W / 2 + side * depth, H]);
    return pts;
  }
  // When things happen, in ms from the click (door.css holds the same numbers).
  var NAVIGATE_BY = 4200;

  // ---- steel, made per pixel as the game's roughMetal.js and the War Room make it ------------
  var hash = function (x, y, seed) {
    var value = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967296;
  };
  var clamp = function (value) { return value < 0 ? 0 : value > 1 ? 1 : value; };
  var ease = function (t) { return t * t * (3 - 2 * t); };
  var drift = function (u, v, cols, rows, seed) {
    var x = u * cols, y = v * rows, x0 = Math.floor(x), y0 = Math.floor(y);
    var tx = ease(x - x0), ty = ease(y - y0);
    var at = function (cx, cy) { return hash(((cx % cols) + cols) % cols, ((cy % rows) + rows) % rows, seed); };
    var top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    var bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
  // Worn plate: grain, patches, a faint brushing, pits and scratches. `light`
  // is filled per pixel; `paint` turns it into a colour.
  function wornLight(size, seed, wear) {
    var light = new Float32Array(size * size).fill(1);
    var wrap = function (value) { return ((Math.round(value) % size) + size) % size; };
    for (var row = 0; row < size; row += 1) for (var col = 0; col < size; col += 1) {
      var u = col / size, v = row / size;
      light[row * size + col] += ((hash(col, row, seed) - 0.5) * 0.11 + (drift(u, v, 3, 3, seed + 1) - 0.5) * 0.27 + (drift(u, v, 9, 9, seed + 2) - 0.5) * 0.14 + (drift(u, v, 2, 72, seed + 3) - 0.5) * 0.13) * wear;
    }
    var pits = Math.round((size * size) / 1500 * wear);
    for (var pit = 0; pit < pits; pit += 1) {
      var cx = hash(pit, 1, seed + 11) * size, cy = hash(pit, 2, seed + 11) * size;
      var radius = 0.8 + hash(pit, 3, seed + 11) * 1.9, depth = 0.16 + hash(pit, 4, seed + 11) * 0.22;
      for (var dy = -4; dy <= 4; dy += 1) for (var dx = -4; dx <= 4; dx += 1) {
        var out = Math.sqrt(dx * dx + dy * dy), at = wrap(cy + dy) * size + wrap(cx + dx);
        if (out <= radius) light[at] -= depth * (1 - out / (radius + 0.5));
        else if (out <= radius + 1.1 && dx + dy > 0) light[at] += 0.07;
      }
    }
    for (var scratch = 0; scratch < Math.round(17 * wear); scratch += 1) {
      var x = hash(scratch, 1, seed + 23) * size, y = hash(scratch, 2, seed + 23) * size;
      var steep = hash(scratch, 3, seed + 23) > 0.75, turn = (hash(scratch, 4, seed + 23) - 0.5) * (steep ? 2.4 : 0.5);
      var length = size * (0.12 + hash(scratch, 5, seed + 23) * (steep ? 0.3 : 0.75)), bright = 0.14 + hash(scratch, 6, seed + 23) * 0.2;
      for (var walked = 0; walked < length; walked += 0.5) {
        var fade = Math.min(1, walked / 6, (length - walked) / 6);
        light[wrap(y) * size + wrap(x)] += bright * fade * 0.42;
        light[wrap(y + 1) * size + wrap(x)] -= bright * fade * 0.28;
        x += Math.cos(turn) * 0.5; y += Math.sin(turn) * 0.5;
      }
    }
    return light;
  }
  function paint(width, height, colourAt) {
    var pixels = new Uint8ClampedArray(width * height * 4);
    for (var row = 0; row < height; row += 1) for (var col = 0; col < width; col += 1) {
      var rgba = colourAt(col, row), at = (row * width + col) * 4;
      pixels[at] = rgba[0]; pixels[at + 1] = rgba[1]; pixels[at + 2] = rgba[2]; pixels[at + 3] = rgba.length > 3 ? rgba[3] : 255;
    }
    try {
      var canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      var context = canvas.getContext("2d"), image = context.createImageData(width, height);
      image.data.set(pixels);
      context.putImageData(image, 0, 0);
      return canvas.toDataURL("image/png");
    } catch (error) { return ""; }
  }
  var shade = function (base, light) { return [Math.round(clamp(base[0] * light / 255) * 255), Math.round(clamp(base[1] * light / 255) * 255), Math.round(clamp(base[2] * light / 255) * 255)]; };
  function steel(size, base, seed, wear) {
    var light = wornLight(size, seed, wear);
    return paint(size, size, function (col, row) { return shade(base, light[row * size + col]); });
  }
  // A domed rivet head lit from the upper left.
  // `width` wider than `size` leaves bare room beside it, for a row of rivets as a tile.
  function rivet(size, width) {
    width = width || size;
    var base = [150, 156, 164], middle = size / 2, radius = size / 2 - 1, dome = radius * 0.8;
    return paint(width, size, function (col, row) {
      var dx = col + 0.5 - width / 2, dy = row + 0.5 - middle, out = Math.sqrt(dx * dx + dy * dy);
      if (out > radius) return [0, 0, 0, 0];
      var lightness;
      if (out > dome) lightness = 0.22;
      else {
        var nx = dx / dome, ny = dy / dome, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        var lit = Math.max(0, nx * -0.5 + ny * -0.62 + nz * 0.6);
        lightness = 0.32 + lit * 0.7 + (lit > 0.93 ? (lit - 0.93) * 4.5 : 0);
      }
      var rgb = shade(base, lightness);
      rgb.push(Math.round(clamp(radius - out) * 255));
      return rgb;
    });
  }
  // The leaf cut through, as its toothed edge shows it: the armour plate at the
  // face, a weld, the ribbed core with a bolt in every rib, and the back plate.
  // Across: the depth of the leaf (top = the face); along: the edge.
  function edgeSection(along, across) {
    var light = wornLight(along, 41, 0.8);
    var rib = 32;
    return paint(along, across, function (col, row) {
      var v = row / across, n = light[(row % along) * along + col];
      var inRib = (col % rib) < 7;
      var bolt = Math.pow((col % rib) - 3.5, 2) + Math.pow(row - across * 0.5, 2) < 9;
      if (v < 0.2) return shade([118, 124, 132], n * (1.05 - v));
      if (v < 0.24) return shade([40, 42, 46], n);
      if (v > 0.84) return shade([82, 87, 94], n * 0.9);
      if (v > 0.8) return shade([36, 38, 42], n);
      if (bolt) return shade([150, 156, 164], n * 0.9);
      return inRib ? shade([86, 91, 98], n * 0.95) : shade([44, 47, 52], n * (0.85 + 0.2 * Math.sin(v * 3.1)));
    });
  }
  // Floor grating: bars one way, cross-bars the other, dark between.
  function grating(size) {
    var light = wornLight(size, 61, 0.6);
    return paint(size, size, function (col, row) {
      var bar = col % 16 < 4, cross = row % 32 < 3, n = light[row * size + col];
      if (bar) return shade([78, 82, 88], n);
      if (cross) return shade([58, 61, 66], n);
      return shade([14, 15, 17], n);
    });
  }

  var textures = null;
  function makeTextures() {
    textures = {
      steel: steel(256, [92, 97, 104], 5, 1),
      dark: steel(256, [42, 45, 50], 9, 1.2),
      grain: steel(256, [128, 128, 128], 13, 1.4),
      rivet: rivet(24),
      rivets: rivet(24, 120),
      edge: edgeSection(128, 64),
      grate: grating(128),
    };
    var vars = { "--bk-steel": textures.steel, "--bk-dark": textures.dark, "--bk-grain": textures.grain, "--bk-rivet": textures.rivet, "--bk-rivets": textures.rivets,"--bk-edge": textures.edge, "--bk-grate": textures.grate };
    for (var name in vars) if (vars[name]) hero.style.setProperty(name, "url(" + vars[name] + ")");
  }

  // ---- building -------------------------------------------------------------------------------
  var SVG = "http://www.w3.org/2000/svg";
  function make(tag, cls, parent) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (parent) parent.appendChild(node);
    return node;
  }
  var scene, world, shaker, hall, halves, frame, fade, live, clones = [];
  function build() {
    makeTextures();
    scene = make("div", "bk-scene");
    scene.setAttribute("aria-hidden", "true");
    world = make("div", "bk-world", scene);
    shaker = make("div", "bk-shake", world);
    hall = make("div", "bk-hall", shaker);
    ["bk-back", "bk-floor", "bk-ceil", "bk-wl", "bk-wr"].forEach(function (cls) { make("div", "bk-wall " + cls, hall); });
    var back = hall.querySelector(".bk-back");
    var screen = make("div", "bk-screen", back);
    screen.innerHTML = '<img src="/play/icon-192.png" alt="" width="96" height="96" /><b>Open Historia</b><span>Opening the demo</span><i><i></i></i>';
    var floor = hall.querySelector(".bk-floor");
    make("i", "bk-guide bk-guide-l", floor);
    make("i", "bk-guide bk-guide-r", floor);
    for (var p = 0; p < 3; p += 1) make("i", "bk-pool bk-pool-" + p, floor);
    var ceil = hall.querySelector(".bk-ceil");
    for (var q = 0; q < 3; q += 1) make("i", "bk-lampbar bk-lampbar-" + q, ceil);
    ["top", "bot"].forEach(function (where) {
      var ram = make("div", "bk-ram bk-ram-" + where, shaker);
      make("i", "bk-rod bk-rod-l", ram);
      make("i", "bk-rod bk-rod-r", ram);
      make("i", "bk-cyl", ram);
    });
    halves = ["l", "r"].map(function (side) {
      var half = make("div", "bk-half bk-" + side, shaker);
      var face = make("div", "bk-face", half);
      var paintBox = make("div", "bk-paint", face);
      var seam = document.createElementNS(SVG, "svg");
      seam.setAttribute("class", "bk-seam");
      face.appendChild(seam);
      var sheen = make("i", "bk-sheen", face);
      return { side: side, half: half, face: face, paint: paintBox, seam: seam, sheen: sheen, edges: make("div", "bk-edges", half), gear: make("div", "bk-gear", half) };
    });
    frame = make("div", "bk-frame");
    frame.setAttribute("aria-hidden", "true");
    ["bk-pin bk-pin-t1", "bk-pin bk-pin-t2", "bk-pin bk-pin-b1", "bk-pin bk-pin-b2", "bk-jamb bk-lintel", "bk-jamb bk-sill", "bk-jamb bk-jl", "bk-jamb bk-jr", "bk-lamp"].forEach(function (cls) { make("i", cls, frame); });
    fade = make("div", "bk-fade");
    live = make("p", "bk-live");
    live.setAttribute("role", "status");

    // The ages move onto the left leaf, and a copy of them onto the right one,
    // with the copy's motion set to the same instant so nothing jumps at the seam.
    var copy = realms.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    halves[0].paint.appendChild(realms);
    halves[1].paint.appendChild(copy);
    hero.insertBefore(scene, hero.firstChild);
    hero.insertBefore(frame, plate);
    hero.appendChild(fade);
    hero.appendChild(live);
    hero.classList.add("bk-ready");
    requestAnimationFrame(function () {
      if (!realms.getAnimations) return;
      var a = realms.getAnimations({ subtree: true }), b = copy.getAnimations({ subtree: true });
      if (a.length === b.length) b.forEach(function (animation, i) { animation.startTime = a[i].startTime; });
    });
    layout();
  }

  // ---- the shape, measured to the hero ---------------------------------------------------------
  var geo = null;
  function px(v) { return Math.round(v * 10) / 10 + "px"; }
  function layout() {
    var W = hero.clientWidth, H = hero.clientHeight;
    if (!W || !H) return;
    var A = Math.max(12, Math.min(42, W * 0.055, H * 0.048));
    var T = Math.max(22, Math.min(78, W * 0.052));
    var P = Math.max(760, Math.min(1400, W * 0.85));
    var band = W < 700 ? 9 : 14;
    var pts = seamPoints(W, H, A);
    var d = W / 2 + A + (W / 2) * (T + 40) / P + 60;
    var u = 1.45 * A;
    geo = { W: W, H: H, A: A, T: T, P: P, pts: pts, d: d };
    var s = hero.style;
    s.setProperty("--bk-T", px(T));
    s.setProperty("--bk-P", px(P));
    s.setProperty("--bk-d", px(d));
    s.setProperty("--bk-u", px(u));
    s.setProperty("--bk-us", String(Math.round(u / d * 1000) / 1000));
    s.setProperty("--bk-D", px(Math.max(900, H * 1.5)));
    s.setProperty("--bk-push", px(P * 0.62));
    var poly = pts.map(function (pt) { return px(pt[0]) + " " + px(pt[1]); });
    halves[0].face.style.clipPath = "polygon(0px 0px, " + poly.join(", ") + ", 0px " + px(H) + ")";
    halves[1].face.style.clipPath = "polygon(" + poly.join(", ") + ", " + px(W) + " " + px(H) + ", " + px(W) + " 0px)";

    // The seam on the face: a groove down the middle of a band of bare steel, riveted both sides.
    var path = "M" + pts.map(function (pt) { return pt[0].toFixed(1) + " " + pt[1].toFixed(1); }).join("L");
    var rivets = "";
    for (var i = 0; i < pts.length - 1; i += 1) {
      var x0 = pts[i][0], y0 = pts[i][1], dx = pts[i + 1][0] - x0, dy = pts[i + 1][1] - y0, len = Math.sqrt(dx * dx + dy * dy);
      var nx = dy / len, ny = -dx / len, off = band * 0.55, step = band < 10 ? 22 : 30;
      for (var at = 12; at < len - 12; at += step) {
        var cx = x0 + dx * at / len, cy = y0 + dy * at / len;
        rivets += '<use href="#bk-rv" x="' + (cx - nx * off).toFixed(1) + '" y="' + (cy - ny * off).toFixed(1) + '"/><use href="#bk-rv" x="' + (cx + nx * off).toFixed(1) + '" y="' + (cy + ny * off).toFixed(1) + '"/>';
      }
    }
    var r = band < 10 ? 2.4 : 3.2;
    halves.forEach(function (h, n) {
      h.seam.setAttribute("viewBox", "0 0 " + W + " " + H);
      h.seam.innerHTML = (n === 0 ? '<defs><pattern id="bk-steel-p" width="256" height="256" patternUnits="userSpaceOnUse"><image href="' + textures.steel + '" width="256" height="256"/></pattern><g id="bk-rv"><circle r="' + r + '" fill="#2a2d32"/><circle r="' + (r - 0.8) + '" fill="#8d939b"/><circle cx="-' + (r * 0.3) + '" cy="-' + (r * 0.3) + '" r="' + (r * 0.38) + '" fill="#d4d9de"/></g></defs>' : "") +
        '<path d="' + path + '" fill="none" stroke="#0a0b0d" stroke-width="' + (band * 2 + 4) + '" stroke-linejoin="miter" stroke-miterlimit="6"/>' +
        '<path d="' + path + '" fill="none" stroke="url(#bk-steel-p)" stroke-width="' + (band * 2) + '" stroke-linejoin="miter" stroke-miterlimit="6"/>' +
        '<path d="' + path + '" fill="none" stroke="#000" stroke-opacity=".9" stroke-width="3"/>' +
        '<path d="' + path + '" fill="none" stroke="#c9ced4" stroke-opacity=".35" stroke-width="1" transform="translate(' + (n === 0 ? -2.2 : 2.2) + ' -1)"/>' + rivets;
    });

    // The leaf's thickness: one strip per straight piece of the seam, folded back into the depth,
    // lit by how much it faces up (the light is above the door).
    halves.forEach(function (h, n) {
      var html = "";
      for (var i = 0; i < pts.length - 1; i += 1) {
        var x0 = pts[i][0], y0 = pts[i][1], dx = pts[i + 1][0] - x0, dy = pts[i + 1][1] - y0, len = Math.sqrt(dx * dx + dy * dy);
        var angle = Math.atan2(dy, dx) * 180 / Math.PI;
        // The outward side: towards the other leaf.
        var ny = n === 0 ? -dx / len : dx / len;
        var dark = clamp(0.42 + ny * 0.38);
        html += '<i class="bk-edge" style="width:' + px(len + 1) + ";transform:translate(" + px(x0) + "," + px(y0) + ") rotate(" + angle.toFixed(3) + "deg) rotateX(-90deg);--bk-shade:" + dark.toFixed(2) + '"></i>';
      }
      h.edges.innerHTML = html;
    });

    // Locking bars across the seam where a straight run is clear of the plate, the rams' brackets
    // behind each leaf, and the frame's pins at the top and bottom of the seam.
    var heroBox = hero.getBoundingClientRect(), plateBox = plate.getBoundingClientRect();
    var keepOut = { l: plateBox.left - heroBox.left - 16, r: plateBox.right - heroBox.left + 16, t: plateBox.top - heroBox.top - 20, b: plateBox.bottom - heroBox.top + 20 };
    var cue = hero.querySelector(".scroll-cue");
    var lintel = W < 700 ? 18 : 26;
    var bars = [];
    for (var j = 0; j < pts.length - 1; j += 1) {
      if (Math.abs(pts[j + 1][0] - pts[j][0]) > A * 0.4) continue;
      var y = (pts[j][1] + pts[j + 1][1]) / 2, sx = (pts[j][0] + pts[j + 1][0]) / 2;
      if (y < lintel + 26 || y > H - lintel - 26) continue;
      var x1 = sx - band - 80, x2 = sx + band + 40;
      if (x2 > keepOut.l && x1 < keepOut.r && y + 20 > keepOut.t && y - 20 < keepOut.b) continue;
      bars.push({ y: y, sx: sx });
    }
    bars = bars.slice(0, 3);
    var barH = W < 700 ? 12 : 16, house = W < 700 ? 46 : 70, keep = W < 700 ? 26 : 36;
    var gearL = "", gearR = "";
    bars.forEach(function (bar) {
      var hx = bar.sx - band - 6 - house, tip = bar.sx + band + keep - 6;
      gearL += '<i class="bk-bar" style="left:' + px(hx + 8) + ";top:" + px(bar.y - barH / 2) + ";width:" + px(tip - hx - 8) + ";height:" + px(barH) + ";--bk-pull:" + px(-(tip - (bar.sx - band - 14))) + '"></i>' +
        '<i class="bk-house" style="left:' + px(hx) + ";top:" + px(bar.y - barH) + ";width:" + px(house) + ";height:" + px(barH * 2) + '"></i>';
      gearR += '<i class="bk-keep" style="left:' + px(bar.sx + band - 2) + ";top:" + px(bar.y - barH * 0.9) + ";width:" + px(keep) + ";height:" + px(barH * 1.8) + '"></i>';
    });
    halves[0].gear.innerHTML = gearL;
    halves[1].gear.innerHTML = gearR;
    // Rams: a cylinder in the middle, top and bottom, as wide as the teeth, so each rod's end
    // sits behind its leaf's edge and travels with it: the rod is as long as the leaf's travel.
    var ramTop = lintel + 18, ramBot = H - lintel - 44;
    var cyl = 2 * (A + 18);
    Array.prototype.forEach.call(hero.querySelectorAll(".bk-ram"), function (ram, n) {
      ram.style.top = px(n === 0 ? ramTop : ramBot);
      ram.style.setProperty("--bk-cyl", px(cyl));
    });
    s.setProperty("--bk-lintel", px(lintel));
    var pinX = [W / 2 - 2.4 * A - 10, W / 2 + 2.4 * A - 10];
    Array.prototype.forEach.call(frame.querySelectorAll(".bk-pin"), function (pin, n) { pin.style.left = px(pinX[n % 2]); });
    if (cue) cue.style.removeProperty("bottom");
  }

  // ---- opening ---------------------------------------------------------------------------------
  var opening = false, timer = 0, sounds = null;
  function soundsOf() {
    var Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    var context, master, noise;
    try {
      context = new Context();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
      noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
      var data = noise.getChannelData(0);
      for (var i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch (error) { return null; }
    // The game's vault door sounds (src/runtime/vaultSounds.js): made, not played from files.
    function hiss(at, length, type, frequency, q, peak) {
      var source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
      source.buffer = noise; source.loop = true;
      filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.006, length / 4));
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      source.connect(filter).connect(gain).connect(master);
      source.start(at, Math.random() * 0.5); source.stop(at + length + 0.02);
      return filter;
    }
    function tone(at, length, type, from, to, peak) {
      var oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(from, at);
      if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(to, at + length);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      oscillator.connect(gain).connect(master);
      oscillator.start(at); oscillator.stop(at + length + 0.02);
    }
    return {
      unlock: function () {
        var now = context.currentTime;
        tone(now, 0.42, "sine", 150, 42, 0.9);
        hiss(now, 0.18, "lowpass", 420, 1, 0.7);
        tone(now + 0.01, 0.6, "triangle", 930, 900, 0.1);
        tone(now + 0.012, 0.45, "triangle", 1410, 1380, 0.05);
      },
      open: function (seconds) {
        var now = context.currentTime;
        hiss(now, 0.5, "highpass", 3200, 1, 0.16);
        var rumble = context.createBufferSource(), low = context.createBiquadFilter(), swell = context.createGain();
        rumble.buffer = noise; rumble.loop = true;
        low.type = "lowpass"; low.frequency.value = 170;
        swell.gain.setValueAtTime(0.0001, now);
        swell.gain.exponentialRampToValueAtTime(0.9, now + seconds * 0.3);
        swell.gain.exponentialRampToValueAtTime(0.5, now + seconds * 0.85);
        swell.gain.exponentialRampToValueAtTime(0.0001, now + seconds + 0.25);
        rumble.connect(low).connect(swell).connect(master);
        rumble.start(now); rumble.stop(now + seconds + 0.3);
        var scrape = hiss(now + 0.05, seconds, "bandpass", 850, 2.5, 0.1);
        scrape.frequency.exponentialRampToValueAtTime(520, now + seconds);
        tone(now + seconds, 0.7, "sine", 78, 38, 0.85);
        hiss(now + seconds, 0.25, "lowpass", 300, 1, 0.5);
      },
      resume: function () { if (context.state === "suspended" && context.resume) context.resume().catch(function () {}); },
      close: function () { try { context.close(); } catch (error) { /* closed */ } },
    };
  }
  function open(href) {
    if (opening) return;
    opening = true;
    layout();
    // The words and buttons go onto the leaves as they are now, split by the seam with everything else.
    var heroBox = hero.getBoundingClientRect(), box = plate.getBoundingClientRect();
    halves.forEach(function (h) {
      var copy = plate.cloneNode(true);
      Array.prototype.forEach.call(copy.querySelectorAll("[id]"), function (node) { node.removeAttribute("id"); });
      copy.removeAttribute("id");
      copy.setAttribute("aria-hidden", "true");
      copy.setAttribute("inert", "");
      copy.classList.add("bk-plate-copy");
      copy.style.left = px(box.left - heroBox.left);
      copy.style.top = px(box.top - heroBox.top);
      copy.style.width = px(box.width);
      h.face.insertBefore(copy, h.seam);
      clones.push(copy);
    });
    live.textContent = "Opening the demo";
    try { var hint = document.createElement("link"); hint.rel = "prefetch"; hint.href = href; document.head.appendChild(hint); } catch (error) { /* only a hint */ }
    hero.classList.add("opening");
    sounds = sounds || soundsOf();
    if (sounds) {
      sounds.resume();
      setTimeout(function () { if (opening) sounds.unlock(); }, 470);
      setTimeout(function () { if (opening) sounds.open(2.1); }, 1150);
    }
    var go = function () { if (opening) window.location.href = href; };
    fade.addEventListener("animationend", go, { once: true });
    timer = setTimeout(go, NAVIGATE_BY);
  }
  function reset() {
    opening = false;
    clearTimeout(timer);
    hero.classList.remove("opening");
    clones.forEach(function (copy) { if (copy.parentNode) copy.parentNode.removeChild(copy); });
    clones = [];
    if (live) live.textContent = "";
  }

  function wire() {
    var trigger = function (event) {
      var link = event.currentTarget;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (calm && calm.matches) return;
      if (link.classList.contains("nav-play")) {
        // The header's Play opens the door only while the door is in view.
        var box = hero.getBoundingClientRect();
        if (box.bottom < window.innerHeight * 0.6) return;
        if (box.top < -40) { window.scrollTo({ top: 0, behavior: "instant" }); }
      }
      event.preventDefault();
      open(link.href);
    };
    Array.prototype.forEach.call(document.querySelectorAll(".hero [data-door-open], .site-head .nav-play"), function (link) { link.addEventListener("click", trigger); });
    var pending = 0;
    window.addEventListener("resize", function () {
      if (opening) return;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(layout);
    });
    // Coming back to this page from the demo (the back button) finds the door shut again.
    window.addEventListener("pageshow", function (event) { if (event.persisted) reset(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (!opening) layout(); });
  }

  function start() {
    try { build(); wire(); }
    catch (error) {
      // Leave the flat hero as it was.
      hero.classList.remove("bk-ready");
      if (scene && scene.parentNode && realms.parentNode !== hero) hero.insertBefore(realms, hero.firstChild);
      if (scene && scene.parentNode) scene.parentNode.removeChild(scene);
      if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
