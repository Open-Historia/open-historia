/*! Open Historia — the landing page's story © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The chronicle: a sticky stage and ten chapters that scroll over it. The map
// is drawn on a canvas by a small camera of its own: a point it looks at, a
// zoom, a heading (which way is up) and a tilt (how far it leans back), with
// perspective. The camera follows the scroll: each chapter is a stretch of
// "story time", and inside a chapter the scroll also drives what happens on
// the map (the missiles' flight, the North's advance). The map is the game's
// own (map-data.js, built by scripts/build-site-story-map.mjs).
(function () {
  "use strict";

  var data = window.OH_STORY_MAP;
  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var SVGNS = "http://www.w3.org/2000/svg";

  // ---- the hero (SVG: a still map) ------------------------------------------------------
  function svgNode(tag, attrs, parent) {
    var element = document.createElementNS(SVGNS, tag);
    for (var name in attrs) if (attrs[name] != null) element.setAttribute(name, attrs[name]);
    if (parent) parent.appendChild(element);
    return element;
  }
  function heroMap() {
    var svg = document.getElementById("heroMap");
    if (!svg || !data) return;
    svg.setAttribute("viewBox", "0 0 " + data.w + " " + data.h);
    svgNode("path", { d: data.graticule.world, class: "grat" }, svg);
    var frag = document.createDocumentFragment();
    data.countries.forEach(function (country) { svgNode("path", { d: country.d }, frag); });
    svg.appendChild(frag);
    var lanes = [["London", "Washington"], ["Paris", "Cairo"], ["Moscow", "Beijing"], ["Tokyo", "Canberra"], ["Madrid", "Brasília"], ["Cairo", "New Delhi"], ["Pretoria", "Brasília"], ["Beijing", "Tokyo"]];
    lanes.forEach(function (pair, index) {
      var a = data.places[pair[0]];
      var b = data.places[pair[1]];
      if (!a || !b) return;
      var my = (a[1] + b[1]) / 2 - Math.abs(a[0] - b[0]) * 0.18;
      var lane = svgNode("path", { d: "M" + a.join(" ") + "Q" + (a[0] + b[0]) / 2 + " " + my + " " + b.join(" "), class: "lane" + (index % 2 ? " p" : "") }, svg);
      lane.style.animationDelay = -index * 1.3 + "s";
    });
    ["Washington", "Brasília", "London", "Paris", "Berlin", "Moscow", "Cairo", "Pretoria", "New Delhi", "Beijing", "Tokyo", "Canberra", "Madrid", "Seoul"].forEach(function (name, index) {
      var at = data.places[name];
      if (!at) return;
      var dot = svgNode("circle", { cx: at[0], cy: at[1], r: 9, class: "ember" + (index % 2 ? " p" : "") }, svg);
      dot.style.animationDelay = (index * 0.9) % 7 + "s";
      svgNode("circle", { cx: at[0], cy: at[1], r: 2.6, class: "cap" }, svg);
    });
    requestAnimationFrame(function () { svg.classList.add("ready"); });
  }
  function scales() {
    var svg = document.getElementById("scales");
    var hero = svg && svg.closest(".hero");
    if (!svg || !hero) return;
    var idle = 0;
    function set(deg) { svg.style.setProperty("--tilt", deg.toFixed(2) + "deg"); }
    set(-4);
    var timer = calm ? 0 : setInterval(function () { if (Date.now() - idle > 2500) set(Math.sin(Date.now() / 1000 * 0.7) * 4); }, 1200);
    hero.addEventListener("pointermove", function (event) {
      idle = Date.now();
      var box = hero.getBoundingClientRect();
      set(((event.clientX - box.left) / box.width - 0.5) * 18);
    }, { passive: true });
    window.addEventListener("pagehide", function () { clearInterval(timer); });
  }
  function astrolabe() {
    var ticks = document.getElementById("astroTicks");
    if (!ticks) return;
    for (var a = 0; a < 360; a += 2) {
      var long = a % 10 === 0;
      var r0 = long ? 338 : 344;
      var rad = a * Math.PI / 180;
      svgNode("line", { x1: Math.sin(rad) * r0, y1: -Math.cos(rad) * r0, x2: Math.sin(rad) * 350, y2: -Math.cos(rad) * 350, class: long ? "long" : "" }, ticks);
      if (a % 30 === 0) {
        var t = svgNode("text", { x: Math.sin(rad) * 372, y: -Math.cos(rad) * 372 + 4 }, ticks);
        t.textContent = a + "°";
      }
    }
  }
  // The doves of the congress, five of them, the first with an olive sprig.
  // Side on, flying right: the far wing behind, the body, the near wing with
  // its primaries fingered at the tips.
  var DOVE =
    '<g class="wing far"><path class="vane" d="M84 31C82 20 77 12 69 7L61 4L55 3L57 8L49 6L52 11L44 10L48 15L40 16L45 20L38 23L44 25C50 29 57 32 64 34Z"/></g>' +
    '<path class="body" d="M112.5 30L104 27.6C102 22 94 21 90 25C83 30 70 32 57 34.5C49 34 39 32 29 30.5C26.5 32.5 27.5 34.5 24.5 36C27.5 37.8 27 39.6 24.5 41.4C27.5 42.8 27.6 44.8 26 47C36 46.6 46 45 55 43C64 48.5 80 49 89 42.4C95 38.2 100 35 104 32.6Z"/>' +
    '<g class="wing near"><path class="vane" d="M78 30C76 18 70 9 62 4L54 1L48 0L50 5L42 2L45 8L37 6L41 12L33 12L38 17L31 19L37 22C42 26 50 30 58 33Z"/>' +
    '<path class="quill" d="M58 9L49 4M57 13L44 7M56 17L40 12M56 21L37 17M57 25L36 21M75 21C67 19 61 21 57 28"/></g>' +
    '<path class="beak" d="M104 28.4L112.5 30L104 31.6Z"/><circle class="eye" cx="99.2" cy="27.6" r="1.1"/>';
  var SPRIG =
    '<path class="stem" d="M109 31.5C113 34 116 38 121 41"/>' +
    '<ellipse class="leaf" cx="113.5" cy="37" rx="3.4" ry="1.3" transform="rotate(48 113.5 37)"/>' +
    '<ellipse class="leaf" cx="118" cy="36.6" rx="3.2" ry="1.2" transform="rotate(-20 118 36.6)"/>' +
    '<ellipse class="leaf" cx="116.6" cy="41.4" rx="3.2" ry="1.2" transform="rotate(70 116.6 41.4)"/>' +
    '<ellipse class="leaf" cx="121.6" cy="40" rx="2.8" ry="1.1" transform="rotate(10 121.6 40)"/>';
  function doves() {
    var box = document.querySelector(".doves");
    if (!box || box.firstElementChild) return;
    var html = "";
    for (var i = 1; i <= 5; i += 1) html += '<svg class="dove d' + i + '" viewBox="0 0 126 64">' + DOVE + (i === 1 ? SPRIG : "") + "</svg>";
    box.innerHTML = html;
  }
  function slips() {
    var list = Array.prototype.slice.call(document.querySelectorAll(".slip"));
    if (!list.length || calm) return;
    var queued = 0;
    function place() {
      queued = 0;
      var y = window.scrollY;
      if (y > window.innerHeight * 1.5) return;
      list.forEach(function (slip) {
        slip.style.transform = "translateY(" + (-y * (parseFloat(slip.getAttribute("data-depth")) || 0.2)).toFixed(1) + "px) rotate(" + slip.getAttribute("data-rot") + "deg)";
      });
    }
    window.addEventListener("scroll", function () { if (!queued) queued = requestAnimationFrame(place); }, { passive: true });
    place();
  }

  if (!data) {
    document.addEventListener("DOMContentLoaded", function () { scales(); astrolabe(); slips(); doves(); });
    return;
  }

  // ---- the map as rings of points ----------------------------------------------------------
  // Paths come as "Mx yLx y…Z" (closed) or "Mx yLx y…" (lines).
  function rings(d) {
    var out = [];
    (d || "").split("M").forEach(function (part) {
      if (!part) return;
      var closed = part.indexOf("Z") >= 0;
      var pairs = part.replace("Z", "").split("L");
      var pts = new Float32Array(pairs.length * 2);
      var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (var i = 0; i < pairs.length; i += 1) {
        var xy = pairs[i].split(" ");
        var x = +xy[0];
        var y = +xy[1];
        pts[i * 2] = x;
        pts[i * 2 + 1] = y;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
      out.push({ pts: pts, closed: closed, box: [minx, miny, maxx, maxy] });
    });
    return out;
  }
  var COLOURS = ["#3d5a6c", "#6b4f3a", "#4f5d3a", "#6c6a3d", "#3a5d55", "#7a4a3a", "#56653f", "#2f5263", "#7a6338", "#5a3f33", "#3f5f4a", "#6a5a46"];
  var world = data.countries.map(function (country, index) {
    return { n: country.n, rings: rings(country.d), colour: COLOURS[(index * 7 + country.n.length) % COLOURS.length] };
  });
  var europe = data.europe.map(function (region) { return { id: region.id, o: region.o, rings: rings(region.d) }; });
  var korea = data.korea.regions.map(function (region) { return { id: region.id, o: region.o, n: region.n, rings: rings(region.d) }; });
  var koreaFronts = data.korea.fronts.map(rings);
  var koreaOrder = data.korea.order;
  var gratWorld = rings(data.graticule.world);
  var gratFine = rings(data.graticule.europe).concat(rings(data.graticule.korea));
  var rivers = data.rivers.map(function (river) { return { n: river.n, rings: rings(river.d), at: river.at }; });
  var missiles = data.missiles.map(function (flight, index) {
    var p = flight.p;
    var len = 0;
    for (var i = 2; i < p.length; i += 2) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    return { from: flight.from, to: flight.to, p: p, n: p.length / 2, len: len, index: index };
  });
  var regionNames = {};
  korea.forEach(function (region) { regionNames[region.id] = region.n; });

  // ---- the camera ----------------------------------------------------------------------------
  // It looks at a point (x, y, and z, a height above the map), from a distance
  // set by the zoom, turned by the heading and leaned back by the tilt. Leaned
  // far back it looks along the ground to a horizon, so anything that passes
  // behind the eye is cut off where it does.
  var canvas, ctx, W = 0, H = 0, dpr = 1;
  var cam = { x: 800, y: 600, z: 0, ls: 0, h: 0, t: 0, ax: 0.5, ay: 0.5 };
  var P = { cosA: 1, sinA: 0, cosT: 1, sinT: 0, s: 1, D: 1000, near: 100, cx: 0, cy: 0 };
  function setCamera(c) {
    cam = c;
    var a = -c.h * Math.PI / 180;
    var t = c.t * Math.PI / 180;
    P.cosA = Math.cos(a); P.sinA = Math.sin(a);
    P.cosT = Math.cos(t); P.sinT = Math.sin(t);
    P.s = Math.pow(2, c.ls);
    P.D = Math.max(W, H) * 1.05;
    P.near = P.D * 0.1;
    P.cx = c.ax * W;
    P.cy = c.ay * H;
  }
  // A point on the map (x, y in map units, z = height above it) in the eye's
  // terms: across the screen, down it, and how far in front of the eye.
  var C = [0, 0, 0];
  function toCam(x, y, z, out) {
    var u = (x - cam.x) * P.s;
    var v = (y - cam.y) * P.s;
    var w = (z - (cam.z || 0)) * P.s;
    var v2 = u * P.sinA + v * P.cosA;
    out[0] = u * P.cosA - v * P.sinA;
    out[1] = v2 * P.cosT - w * P.sinT;
    out[2] = P.D - (v2 * P.sinT + w * P.cosT);
    return out;
  }
  // ...and on the screen: [sx, sy, perspective factor]. The factor is -1 for
  // a point behind the eye, which is then put far off the screen.
  function project(x, y, z, out) {
    toCam(x, y, z || 0, C);
    if (C[2] < P.near) { out[0] = -1e5; out[1] = -1e5; out[2] = -1; return out; }
    var k = P.D / C[2];
    out[0] = P.cx + C[0] * k;
    out[1] = P.cy + C[1] * k;
    out[2] = k;
    return out;
  }
  function visible(box) {
    var left = 0, right = 0, above = 0, below = 0, behind = 0;
    for (var i = 0; i < 4; i += 1) {
      toCam(i & 1 ? box[2] : box[0], i & 2 ? box[3] : box[1], 0, C);
      if (C[2] < P.near) { behind += 1; continue; }
      var k = P.D / C[2];
      var sx = P.cx + C[0] * k;
      var sy = P.cy + C[1] * k;
      if (sx < -60) left += 1; else if (sx > W + 60) right += 1;
      if (sy < -60) above += 1; else if (sy > H + 60) below += 1;
    }
    if (behind === 4) return false;
    return behind > 0 || (left < 4 && right < 4 && above < 4 && below < 4);
  }
  // A run of points (x, y pairs on the map, or x, y, z triples) as a path, cut
  // where it passes behind the eye. A closed ring stays closed: it runs along
  // the cut between where it leaves and where it comes back.
  var CA = [0, 0, 0];
  var CB = [0, 0, 0];
  function put(target, u, v, depth, move) {
    var k = P.D / depth;
    if (move) target.moveTo(P.cx + u * k, P.cy + v * k);
    else target.lineTo(P.cx + u * k, P.cy + v * k);
  }
  function line3(target, pts, stride, closed) {
    var n = Math.floor(pts.length / stride);
    if (n < 2) return;
    var near = P.near;
    toCam(pts[0], pts[1], stride === 3 ? pts[2] : 0, CA);
    var pen = CA[2] >= near;
    if (pen) put(target, CA[0], CA[1], CA[2], true);
    var count = closed ? n + 1 : n;
    for (var i = 1; i < count; i += 1) {
      var o = (i % n) * stride;
      toCam(pts[o], pts[o + 1], stride === 3 ? pts[o + 2] : 0, CB);
      var inA = CA[2] >= near;
      var inB = CB[2] >= near;
      if (inA !== inB) {
        var r = (near - CA[2]) / (CB[2] - CA[2]);
        put(target, CA[0] + (CB[0] - CA[0]) * r, CA[1] + (CB[1] - CA[1]) * r, near, !pen);
        pen = closed || inB;
      }
      if (inB) { put(target, CB[0], CB[1], CB[2], !pen); pen = true; }
      CA[0] = CB[0]; CA[1] = CB[1]; CA[2] = CB[2];
    }
    if (closed && pen) target.closePath();
  }
  function trace(target, list) {
    for (var r = 0; r < list.length; r += 1) {
      var ring = list[r];
      if (visible(ring.box)) line3(target, ring.pts, 2, ring.closed);
    }
  }
  // Where the ground meets the sky on the screen (it never does looking straight down).
  function horizonY() { return P.sinT > 0.02 ? P.cy - P.D * P.cosT / P.sinT : -1e5; }

  // ---- where the camera is at each moment of the story ---------------------------------------
  var STEPS = ["world", "launch", "korea", "choose", "order", "skip", "talks", "parliament", "congress", "yours"];
  var EDGE = 0.22;   // the part of a chapter at each end given to moving to the next

  function narrow() { return W < 860; }
  // A flat view of a frame: the zoom that fits it in the part of the screen left beside the chapter.
  function fit(frame, extra) {
    var areaW = narrow() ? W - 24 : W - Math.min(W * 0.46, 560) - 40;
    var areaH = narrow() ? H * 0.42 : H - 220;
    var s = Math.min(areaW / (frame[2] - frame[0]), areaH / (frame[3] - frame[1])) * (extra || 1);
    return Math.log(s) / Math.LN2;
  }
  function flatCam(frame, extra, tilt) {
    return {
      x: (frame[0] + frame[2]) / 2,
      y: (frame[1] + frame[3]) / 2,
      ls: fit(frame, extra),
      h: 0,
      t: tilt || 0,
      ax: narrow() ? 0.5 : (Math.min(W * 0.46, 560) + (W - 40)) / 2 / W,
      ay: narrow() ? 0.36 : 0.56
    };
  }
  function pointOn(flight, m) {
    var f = Math.max(0, Math.min(1, m)) * (flight.n - 1);
    var i = Math.min(flight.n - 2, Math.floor(f));
    var r = f - i;
    var p = flight.p;
    return [p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * r, p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * r];
  }
  function camFor(step, p) {
    switch (step) {
      case "world": return flatCam(data.frames.world, 1, 0);
      case "launch": return journeyCam(p * 0.5);
      case "korea": return journeyCam(0.5 + p * 0.5);
      case "choose": return flatCam(data.frames.europe, 1.05, 18);
      case "order": { var c = flatCam(data.frames.europe, 1.6, 22); c.x = data.places.France[0]; c.y = data.places.France[1]; return c; }
      case "skip": return flatCam(data.frames.skip, 1, 26);
      case "talks": return flatCam(data.frames.talks, 1, 30);
      case "parliament": { var pc = flatCam(data.frames.europe, 2.6, 34); pc.x = data.places.Paris[0]; pc.y = data.places.Paris[1]; pc.h = -8; if (!narrow()) pc.ax = 0.52; return pc; }
      case "congress": { var cc = flatCam(data.frames.europe, 1.3, 26); cc.x = data.places.Strasbourg[0]; cc.y = data.places.Strasbourg[1]; if (!narrow()) cc.ax = 0.5; return cc; }
      default: return flatCam(data.frames.world, 1, 0);
    }
  }
  function lerp(a, b, e) { return a + (b - a) * e; }
  function smooth(e) { return e * e * (3 - 2 * e); }
  function clamp01(e) { return Math.max(0, Math.min(1, e)); }
  function blend(a, b, e) {
    var dh = ((b.h - a.h + 540) % 360) - 180;
    // A long way flies up and over: the zoom dips in the middle, as far as
    // it takes to have both ends in sight.
    var dist = Math.hypot(b.x - a.x, b.y - a.y);
    var see = Math.log(Math.max(W, H) * 0.8 / Math.max(1, dist)) / Math.LN2;
    var lift = Math.max(0, lerp(a.ls, b.ls, 0.5) - see);
    var arc = Math.sin(Math.PI * e);
    return {
      x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), z: lerp(a.z || 0, b.z || 0, e),
      ls: lerp(a.ls, b.ls, e) - lift * arc,
      h: a.h + dh * e, t: lerp(a.t, b.t, e) * (1 - 0.35 * arc * Math.min(1, lift)),
      ax: lerp(a.ax, b.ax, e), ay: lerp(a.ay, b.ay, e)
    };
  }
  // Story time T: chapter index plus how far through it the middle of the screen is.
  // The chapters differ in height, so a move that spans two is timed by the
  // scroll itself, keeping its pace across the boundary.
  var heights = [];
  function dist(T) {
    var i = Math.max(0, Math.min(heights.length - 1, Math.floor(T)));
    var d = 0;
    for (var k = 0; k < i; k += 1) d += heights[k];
    return d + (T - i) * (heights[i] || 1);
  }
  function cameraAt(T) {
    if (T >= J0 && T <= J1) return journeyCam(journeyU(T));
    var i = Math.max(0, Math.min(STEPS.length - 1, Math.floor(T)));
    var f = T - i;
    var b = f > 1 - EDGE ? i + 1 : f < EDGE ? i : -1;
    if (b > 0 && b < STEPS.length) {
      var e = clamp01((dist(T) - dist(b - EDGE)) / (dist(b + EDGE) - dist(b - EDGE) || 1));
      return blend(camFor(STEPS[b - 1], 1), camFor(STEPS[b], 0), smooth(e));
    }
    return camFor(STEPS[i], clamp01((f - EDGE) / (1 - 2 * EDGE)));
  }

  // ---- the journey: from the silos, behind the missiles, on to Korea ---------------------------
  // The launch and Korea chapters are one flight of the camera, never stopping.
  // Its share u runs 0 → 1 between the far edges of the two chapters:
  //   0 → UX   behind the last missile, up and over the Arctic and down toward its target;
  //   UX → UB  banking away just before it strikes, on across Asia, coming down
  //            and turning right, south into Korea;
  //   UB → 1   south down the peninsula with the front.
  var LEAD = 9;               // the flight the camera follows: the last away, Minot to Yasny
  var J0 = 1 + EDGE;          // the story time the journey starts at
  var J1 = 3 - EDGE;          // and ends at
  var UA = 0.564;             // the lead strikes
  var UC = 0.62;              // the camera would be over the target, had it stayed on the track
  var CX = 0.88;              // how far along the track it stays: it leaves before the strike
  var UB = 0.75;              // the camera reaches the front
  var RAMP = 0.12;            // the share of a flight spent getting up to speed
  var UX = UC * (CX * (1 - RAMP / 2) + RAMP / 2);   // when it leaves the track
  function journeyU(T) { return (dist(T) - dist(J0)) / (dist(J1) - dist(J0) || 1); }
  // 0 → 1 with a gentle start, and straight on before it (a countdown).
  function profile(x) {
    if (x <= 0) return x / (1 - RAMP / 2);
    if (x < RAMP) return x * x / (2 * RAMP) / (1 - RAMP / 2);
    return (x - RAMP / 2) / (1 - RAMP / 2);
  }
  function chaseZoom(c) {
    // Close over the silo, back as it climbs, a little closer as it falls.
    var base = narrow() ? 3 : 4.5;
    return Math.log(base * (1 + 0.6 * Math.exp(-c * 12) + 0.25 * smooth(clamp01((c - 0.7) / 0.3)))) / Math.LN2;
  }
  function chaseTilt(c) { return 76 - 6 * Math.exp(-c * 10); }
  function koreaZoom() { return Math.log(narrow() ? 28 : 46) / Math.LN2; }
  var KOREA_TILT = 63;
  function unit(dx, dy) { var l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; }

  // Down the peninsula: the front's middle at each step, smoothed, a little behind it.
  var koreaPath = null;
  function koreaPathPoints() {
    if (koreaPath) return koreaPath;
    var N = koreaOrder.length;
    var mids = [];
    for (var k = 0; k <= N; k += 1) mids.push(frontMiddle(k));
    koreaPath = mids.map(function (_, k) {
      var x = 0, y = 0, n = 0;
      for (var j = Math.max(0, k - 3); j <= Math.min(N, k + 3); j += 1) { x += mids[j][0]; y += mids[j][1]; n += 1; }
      return [x / n, y / n - 1.4];
    });
    return koreaPath;
  }
  function koreaAt(e) {
    // Catmull-Rom through the path's points, e steps along it.
    var q = koreaPathPoints();
    var N = q.length - 1;
    e = Math.max(0, Math.min(N, e));
    var i = Math.min(N - 1, Math.floor(e));
    var t = e - i;
    var p0 = q[Math.max(0, i - 1)], p1 = q[i], p2 = q[i + 1], p3 = q[Math.min(N, i + 2)];
    var out = [0, 0];
    for (var a = 0; a < 2; a += 1) {
      out[a] = 0.5 * (2 * p1[a] + (p2[a] - p0[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t * t + (3 * p1[a] - p0[a] - 3 * p2[a] + p3[a]) * t * t * t);
    }
    return out;
  }
  function koreaSpeed() {
    // Map units per u as the front starts to move.
    var q = koreaPathPoints();
    return 0.5 * Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) * (koreaOrder.length + 0.999) / (1 - UB);
  }

  // Across Asia: a curve from where the camera leaves the track to the front,
  // sampled by distance. It leaves along the track and arrives along the front's way.
  var transit = null;
  function transitPath() {
    if (transit) return transit;
    var lead = missiles[LEAD];
    var p0 = pointOn(lead, CX);
    var back = pointOn(lead, CX - 0.015);
    var a0 = unit(p0[0] - back[0], p0[1] - back[1]);
    var q = koreaPathPoints();
    var p3 = q[0];
    var a1 = unit(q[1][0] - q[0][0], q[1][1] - q[0][1]);
    var chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    var p1 = [p0[0] + a0[0] * chord * 0.4, p0[1] + a0[1] * chord * 0.4];
    var p2 = [p3[0] - a1[0] * chord * 0.3, p3[1] - a1[1] * chord * 0.3];
    var pts = [];
    var acc = [0];
    for (var i = 0; i <= 240; i += 1) {
      var t = i / 240, s = 1 - t;
      pts.push([
        s * s * s * p0[0] + 3 * s * s * t * p1[0] + 3 * s * t * t * p2[0] + t * t * t * p3[0],
        s * s * s * p0[1] + 3 * s * s * t * p1[1] + 3 * s * t * t * p2[1] + t * t * t * p3[1]
      ]);
      if (i) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    var lift = Math.sin(Math.PI * CX);
    transit = { pts: pts, acc: acc, len: acc[240], z0: apex(lead) * lift * lift, timing: null, narrow: null };
    return transit;
  }
  // How far along the curve the camera is at each moment w of the crossing:
  // it leaves at the chase's speed, arrives at the front's, and in between
  // keeps a steady pace on the screen while it comes down.
  function transitTiming() {
    var path = transitPath();
    if (path.timing && path.narrow === narrow()) return path.timing;
    var lead = missiles[LEAD];
    var span = UB - UX;
    var ls0 = chaseZoom(CX), ls1 = koreaZoom();
    var zoom = function (w) { return Math.pow(2, lerp(ls0, ls1, smooth(w))); };
    var a0 = lead.len / (UC * (1 - RAMP / 2)) * span * zoom(0);
    var a1 = koreaSpeed() * span * zoom(1);
    var n = 200, base = [0], bump = [0];
    for (var i = 1; i <= n; i += 1) {
      var w = (i - 0.5) / n;
      base.push(base[i - 1] + lerp(a0, a1, smooth(w)) / zoom(w) / n);
      bump.push(bump[i - 1] + Math.sin(Math.PI * w) / zoom(w) / n);
    }
    var extra = (path.len - base[n]) / bump[n];
    var table = base.map(function (b, i) { return b + extra * bump[i]; });
    // Never backward: a pace that would have to dip below nothing is scaled instead.
    for (var j = 1; j <= n; j += 1) if (table[j] < table[j - 1]) { table = base.map(function (b) { return b * path.len / base[n]; }); break; }
    path.timing = table;
    path.narrow = narrow();
    return table;
  }
  function transitAt(w) {
    var path = transitPath();
    var table = transitTiming();
    var f = clamp01(w) * (table.length - 1);
    var i = Math.min(table.length - 2, Math.floor(f));
    var d = lerp(table[i], table[i + 1], f - i);
    var acc = path.acc;
    var lo = 0, hi = acc.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (acc[mid] < d) lo = mid; else hi = mid; }
    var r = (d - acc[lo]) / ((acc[hi] - acc[lo]) || 1);
    return [lerp(path.pts[lo][0], path.pts[hi][0], r), lerp(path.pts[lo][1], path.pts[hi][1], r)];
  }

  // Where the camera looks at u: a point and its height.
  function journeyAt(u) {
    if (u <= UX) {
      var lead = missiles[LEAD];
      var c = clamp01(profile(u / UC));
      var at = pointOn(lead, c);
      // Along the missile's arc behind it, coming down as it does.
      var lift = Math.sin(Math.PI * c);
      return [at[0], at[1], apex(lead) * lift * lift];
    }
    if (u <= UB) {
      var w = (u - UX) / (UB - UX);
      var t = transitAt(w);
      return [t[0], t[1], transitPath().z0 * (1 - w) * (1 - w)];
    }
    var k = koreaAt((u - UB) / (1 - UB) * (koreaOrder.length + 0.999));
    return [k[0], k[1], 0];
  }
  function journeyCam(u) {
    var here = journeyAt(u);
    // Facing the way it is going.
    var from = journeyAt(Math.max(0, u) - 0.006);
    var to = journeyAt(Math.max(0, u) + 0.018);
    var h = Math.atan2(to[0] - from[0], -(to[1] - from[1])) * 180 / Math.PI;
    // Down the peninsula it keeps looking south.
    var hold = smooth(clamp01((u - UB + 0.05) / 0.1));
    if (hold > 0) h += (((180 - h) % 360 + 540) % 360 - 180) * hold;
    var c = clamp01(profile(u / UC));
    var ls, t, ay;
    var ax = narrow() ? 0.5 : 0.6;
    if (u <= UX) {
      ls = chaseZoom(c); t = chaseTilt(c); ay = narrow() ? 0.6 : 0.66;
    } else if (u <= UB) {
      var w = smooth((u - UX) / (UB - UX));
      ls = lerp(chaseZoom(CX), koreaZoom(), w);
      t = lerp(chaseTilt(CX), KOREA_TILT, w);
      ay = lerp(narrow() ? 0.6 : 0.66, narrow() ? 0.5 : 0.62, w);
    } else {
      ls = koreaZoom(); t = KOREA_TILT; ay = narrow() ? 0.5 : 0.62;
    }
    return { x: here[0], y: here[1], z: here[2], ls: ls, h: h, t: t, ax: ax, ay: ay };
  }
  function koreaProgress(T) { return clamp01((journeyU(T) - UB) / (1 - UB)); }

  // ---- the missiles ------------------------------------------------------------------------
  // u → each flight's share of its way. The others went up before the lead,
  // a little apart, so the camera sees them ahead; seven of the ten are
  // stopped by interceptors late in their fall.
  var STOPPED = { 0: 1, 1: 1, 3: 1, 4: 1, 6: 1, 7: 1, 8: 1 };
  var MEET = 0.8;           // where on its flight an interceptor meets a missile
  var RISE = 0.6;           // where on its flight the interceptor is launched
  var GAP = 0.035;          // between one launch and the next, as a share of a flight
  function missileClock(u) {
    var lead = profile(u / UA);
    var each = missiles.map(function (flight, i) { return lead + (LEAD - i) * GAP; });
    return { each: each, lead: lead };
  }
  function apex(flight) { return flight.len * 0.075; }
  function altitude(flight, m) { return apex(flight) * 4 * m * (1 - m); }
  function nearestDefence(at) {
    var best = null;
    var bestD = Infinity;
    Object.keys(data.sites.defence).forEach(function (name) {
      var s = data.sites.defence[name];
      var d = Math.hypot(s[0] - at[0], s[1] - at[1]);
      if (d < bestD) { bestD = d; best = s; }
    });
    return best;
  }
  var A = [0, 0, 1];
  var B = [0, 0, 1];
  // How big a mark is drawn at a point: by its perspective, within reason. 0 behind the eye.
  function near(k) { return k > 0 ? Math.max(0.45, Math.min(3, k)) : 0; }
  function dot(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2); }
  function drawMissiles(u, now) {
    var clock = missileClock(u);
    var counts = { flying: 0, stopped: 0, hit: 0, waiting: 0 };
    missiles.forEach(function (flight, i) {
      var m = clock.each[i];
      if (m <= 0) { counts.waiting += 1; return; }
      var stopped = STOPPED[i];
      var end = stopped ? Math.min(m, MEET) : Math.min(m, 1);
      var pts = [];
      // The ground track, faint and dashed: where it would fall.
      for (var g = 0; g <= 48; g += 1) {
        var gp = pointOn(flight, g / 48);
        pts.push(gp[0], gp[1], 0);
      }
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = "rgba(236, 228, 210, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath(); line3(ctx, pts, 3, false); ctx.stroke();
      ctx.setLineDash([]);
      // The flight itself: a contrail along its arc, a soft wake under a bright line.
      pts = [];
      var steps = Math.max(2, Math.round(end * 72));
      for (var s = 0; s <= steps; s += 1) {
        var mm = end * s / steps;
        var pt = pointOn(flight, mm);
        pts.push(pt[0], pt[1], altitude(flight, mm));
      }
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(242, 238, 228, 0.1)";
      ctx.lineWidth = i === LEAD ? 9 : 6;
      ctx.beginPath(); line3(ctx, pts, 3, false); ctx.stroke();
      ctx.strokeStyle = "rgba(242, 238, 228, 0.85)";
      ctx.lineWidth = i === LEAD ? 2.6 : 1.8;
      ctx.beginPath(); line3(ctx, pts, 3, false); ctx.stroke();
      ctx.lineCap = "butt";
      // Its shadow on the ground, under the head.
      var head = pointOn(flight, end);
      if (m < (stopped ? MEET : 1)) {
        counts.flying += 1;
        ctx.strokeStyle = "rgba(242, 238, 228, 0.2)";
        ctx.lineWidth = 1;
        ctx.beginPath(); line3(ctx, [head[0], head[1], 0, head[0], head[1], altitude(flight, end)], 3, false); ctx.stroke();
        project(head[0], head[1], altitude(flight, end), A);
        var size = near(A[2]);
        if (size) {
          var flicker = (1 + 0.25 * Math.sin(now / 40 + i)) * size;
          ctx.fillStyle = "#f2eee4";
          dot(A[0], A[1], 3.2 * flicker); ctx.fill();
          ctx.strokeStyle = "rgba(224, 102, 47, 0.9)";
          ctx.lineWidth = 2;
          dot(A[0], A[1], 7 * flicker); ctx.stroke();
        }
      }
      // The launch: a flash at the silo.
      if (m < 0.08) {
        var site = pointOn(flight, 0);
        project(site[0], site[1], 0, B);
        if (B[2] > 0) {
          ctx.fillStyle = "rgba(224, 102, 47," + (1 - m / 0.08) + ")";
          dot(B[0], B[1], (10 + m * 200) * near(B[2])); ctx.fill();
        }
      }
      if (stopped) {
        // The interceptor, up from the nearest defence site to meet it.
        var meetAt = pointOn(flight, MEET);
        var meetAlt = altitude(flight, MEET);
        var from = nearestDefence(meetAt);
        var k = (m - RISE) / (MEET - RISE);
        if (k > 0) {
          var kk = Math.min(1, k);
          pts = [];
          for (var q = 0; q <= 20; q += 1) {
            var qq = kk * q / 20;
            var ease = 1 - Math.pow(1 - qq, 2.2);
            pts.push(from[0] + (meetAt[0] - from[0]) * qq, from[1] + (meetAt[1] - from[1]) * qq, meetAlt * ease);
          }
          ctx.strokeStyle = "rgba(43, 193, 243, 0.9)";
          ctx.lineWidth = 1.6;
          ctx.beginPath(); line3(ctx, pts, 3, false); ctx.stroke();
          if (k < 1) {
            project(pts[60], pts[61], pts[62], A);
            if (A[2] > 0) { ctx.fillStyle = "#bfefff"; dot(A[0], A[1], 2.6 * near(A[2])); ctx.fill(); }
          }
        }
        if (m >= MEET) {
          counts.stopped += 1;
          // A burst in the air, and debris falling out of it.
          var since = (m - MEET) / 0.12;
          project(meetAt[0], meetAt[1], meetAlt, A);
          var big = near(A[2]);
          if (since < 1 && big) {
            ctx.fillStyle = "rgba(242, 238, 228," + (1 - since) + ")";
            dot(A[0], A[1], (6 + since * 34) * big); ctx.fill();
            ctx.strokeStyle = "rgba(224, 102, 47," + (1 - since) + ")";
            ctx.lineWidth = 3;
            dot(A[0], A[1], (12 + since * 60) * big); ctx.stroke();
          }
          var fall = Math.min(1, (m - MEET) / 0.4);
          ctx.fillStyle = "rgba(160, 150, 130," + (0.8 * (1 - fall)) + ")";
          for (var dbr = 0; dbr < 6; dbr += 1) {
            project(meetAt[0] + Math.cos(dbr * 1.1) * fall * 2, meetAt[1] + Math.sin(dbr * 1.7) * fall * 2, meetAlt * (1 - fall), B);
            if (B[2] > 0) ctx.fillRect(B[0] - 1.5, B[1] - 1.5, 3, 3);
          }
        }
      } else if (m >= 1) {
        counts.hit += 1;
        drawImpact(pointOn(flight, 1), (m - 1) / 0.5, now, i === LEAD ? 1.8 : 1);
      }
    });
    return counts;
  }
  // A strike on the ground: a flash, a shockwave across the map, a column of
  // smoke, then a scar that burns on.
  function drawImpact(at, since, now, scale) {
    var t = Math.max(0, since);
    var ring = Math.min(1, t) * 9 * scale;
    if (t < 1) {
      var pts = [];
      for (var a = 0; a < 40; a += 1) pts.push(at[0] + Math.cos(a / 40 * Math.PI * 2) * ring, at[1] + Math.sin(a / 40 * Math.PI * 2) * ring);
      ctx.strokeStyle = "rgba(242, 238, 228," + (1 - t) + ")";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); line3(ctx, pts, 2, true); ctx.stroke();
    }
    project(at[0], at[1], 0, A);
    var size = near(A[2]) * scale;
    if (!size) return;
    if (t < 0.4) {
      var flash = 1 - t / 0.4;
      ctx.fillStyle = "rgba(255, 244, 220," + flash + ")";
      dot(A[0], A[1], (10 + 26 * (1 - flash)) * size); ctx.fill();
      ctx.fillStyle = "rgba(224, 102, 47," + flash * 0.9 + ")";
      dot(A[0], A[1], (22 + 40 * (1 - flash)) * size); ctx.fill();
    }
    // Smoke: grey puffs climbing.
    for (var s = 0; s < 8; s += 1) {
      var climb = Math.min(1, t * 0.8) * (0.3 + s * 0.12);
      project(at[0] + Math.sin(s * 2.1) * 0.6 * scale, at[1] + Math.cos(s * 1.3) * 0.6 * scale, climb * 4 * scale, B);
      if (B[2] <= 0) continue;
      ctx.fillStyle = "rgba(90, 86, 80," + Math.min(0.55, t * 1.4) * (1 - s * 0.08) + ")";
      dot(B[0], B[1], (6 + s * 3 + t * 10) * near(B[2]) * scale); ctx.fill();
    }
    // The scar: a burning ring that stays.
    ctx.strokeStyle = "rgba(196, 67, 44," + Math.min(0.9, t * 2) * (0.75 + 0.25 * Math.sin(now / 160)) + ")";
    ctx.lineWidth = 2;
    dot(A[0], A[1], 5 * size); ctx.stroke();
  }

  // ---- Korea: the North comes south ----------------------------------------------------------------
  // The middle of the front at a step (Busan once there is no front left).
  var middles = [];
  function frontMiddle(step) {
    if (middles[step]) return middles[step];
    var pts = frontPoints(koreaFronts[step] || [], 12);
    var x = 0;
    var y = 0;
    pts.forEach(function (pt) { x += pt[0]; y += pt[1]; });
    middles[step] = pts.length ? [x / pts.length, y / pts.length] : data.places.Busan;
    return middles[step];
  }
  function koreaStep(p) { return Math.max(0, Math.min(koreaOrder.length, Math.floor(p * (koreaOrder.length + 0.999)))); }
  function frontPoints(list, count) {
    // Points spread along the front, for counters and bursts.
    var segs = [];
    var total = 0;
    list.forEach(function (ring) {
      for (var i = 2; i < ring.pts.length; i += 2) {
        var l = Math.hypot(ring.pts[i] - ring.pts[i - 2], ring.pts[i + 1] - ring.pts[i - 1]);
        segs.push([ring.pts[i - 2], ring.pts[i - 1], ring.pts[i], ring.pts[i + 1], l]);
        total += l;
      }
    });
    var out = [];
    if (!total) return out;
    for (var c = 0; c < count; c += 1) {
      var want = total * (c + 0.5) / count;
      for (var s = 0; s < segs.length; s += 1) {
        if (want <= segs[s][4]) {
          var r = want / segs[s][4];
          out.push([segs[s][0] + (segs[s][2] - segs[s][0]) * r, segs[s][1] + (segs[s][3] - segs[s][1]) * r]);
          break;
        }
        want -= segs[s][4];
      }
    }
    return out;
  }
  function drawCounter(x, y, side, kind, label) {
    project(x, y, 0, A);
    if (A[2] < 0.3) return;
    var z = Math.max(0.55, Math.min(1.5, A[2]));
    var w = 24 * z;
    var h = 16 * z;
    ctx.fillStyle = side === "n" ? "#8a2c1c" : "#1f5a6e";
    ctx.strokeStyle = "#ece4d2";
    ctx.lineWidth = 1.2;
    ctx.fillRect(A[0] - w / 2, A[1] - h / 2, w, h);
    ctx.strokeRect(A[0] - w / 2, A[1] - h / 2, w, h);
    ctx.beginPath();
    if (kind !== "arm") { ctx.moveTo(A[0] - w / 2, A[1] - h / 2); ctx.lineTo(A[0] + w / 2, A[1] + h / 2); ctx.moveTo(A[0] + w / 2, A[1] - h / 2); ctx.lineTo(A[0] - w / 2, A[1] + h / 2); }
    if (kind !== "inf") ctx.ellipse(A[0], A[1], w * 0.3, h * 0.24, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ece4d2";
    ctx.font = "700 " + Math.round(9 * z) + "px ui-monospace, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, A[0], A[1] - h / 2 - 3);
  }
  function drawKorea(p, now) {
    var step = koreaStep(p);
    var front = koreaFronts[Math.min(step, koreaFronts.length - 1)];
    // The front: a dark bed, then the line itself, its dashes marching south;
    // thinner seen from far off.
    var mid = frontMiddle(Math.min(step, koreaFronts.length - 1));
    project(mid[0], mid[1], 0, A);
    if (A[2] <= 0) return step;
    var z = Math.max(0.3, Math.min(1.4, A[2]));
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(13, 13, 15, 0.9)";
    ctx.lineWidth = 9 * z;
    ctx.beginPath(); trace(ctx, front); ctx.stroke();
    ctx.strokeStyle = "#e0662f";
    ctx.lineWidth = 3.5 * z;
    ctx.setLineDash([12 * z, 6 * z]);
    ctx.lineDashOffset = -now / 40;
    ctx.beginPath(); trace(ctx, front); ctx.stroke();
    ctx.setLineDash([]);
    // Counters on both sides of it, bursts along it.
    var points = frontPoints(front, 4);
    points.forEach(function (pt, i) {
      drawCounter(pt[0], pt[1] - 0.85, "n", i % 3 === 0 ? "arm" : i % 3 === 1 ? "mech" : "inf", String(100 + i * 7 + step));
      drawCounter(pt[0], pt[1] + 0.9, "s", i % 2 ? "inf" : "mech", String(1 + i * 2));
    });
    frontPoints(front, 9).forEach(function (pt, i) {
      var phase = (now / 700 + i * 0.37) % 1;
      if (phase > 0.5) return;
      project(pt[0] + Math.sin(i * 3.1) * 0.15, pt[1] + Math.cos(i * 1.7) * 0.15, 0, A);
      if (A[2] < 0.3) return;
      var r = (4 + phase * 22) * Math.min(1.4, A[2]);
      ctx.fillStyle = "rgba(255, 228, 170," + (1 - phase * 2) + ")";
      ctx.beginPath();
      for (var s = 0; s < 10; s += 1) {
        var ang = s / 10 * Math.PI * 2;
        var rr = s % 2 ? r * 0.45 : r;
        ctx.lineTo(A[0] + Math.cos(ang) * rr, A[1] + Math.sin(ang) * rr);
      }
      ctx.closePath();
      ctx.fill();
    });
    return step;
  }

  // ---- links between capitals: arcs rising off the map ------------------------------------------------
  function drawLink(a, b, colour, now, lift) {
    var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -now / 30;
    var pts = [];
    for (var i = 0; i <= 40; i += 1) {
      var t = i / 40;
      pts.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, len * (lift || 0.18) * 4 * t * (1 - t));
    }
    ctx.beginPath(); line3(ctx, pts, 3, false); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- labels: upright, sized by distance ---------------------------------------------------------------
  function label(textValue, x, y, opts) {
    project(x, y, 0, A);
    if (A[0] < -100 || A[0] > W + 100 || A[1] < -40 || A[1] > H + 40) return;
    var z = Math.max(0.5, Math.min(1.35, A[2]));
    if (A[2] < 0.35) return;
    var size = (opts.size || 13) * z;
    ctx.font = (opts.weight || "600") + " " + size.toFixed(1) + "px " + (opts.font || "Cinzel, Georgia, serif");
    ctx.textAlign = opts.align || "left";
    ctx.globalAlpha = (opts.alpha == null ? 1 : opts.alpha) * Math.min(1, (A[2] - 0.35) * 3);
    if (opts.dot) {
      ctx.fillStyle = opts.dot;
      ctx.beginPath(); ctx.arc(A[0], A[1], (opts.r || 3) * z, 0, Math.PI * 2); ctx.fill();
    }
    var dx = opts.dot ? 7 * z : 0;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "rgba(11, 15, 18, 0.95)";
    ctx.lineJoin = "round";
    var tx = A[0] + (opts.align === "center" ? 0 : dx);
    var ty = A[1] + (opts.dy || 4) * z;
    ctx.strokeText(textValue, tx, ty);
    ctx.fillStyle = opts.colour || "#ece4d2";
    ctx.fillText(textValue, tx, ty);
    ctx.globalAlpha = 1;
  }

  // ---- drawing a frame -------------------------------------------------------------------------------------
  var state = { T: 0, target: 0, step: "world", korea: -1, counts: null };
  var HISTORIES = [
    ["Washington", "1861 · The Union holds without a war"], ["Brasília", "1889 · The Empire of Brazil endures"],
    ["Madrid", "1588 · The Armada lands"], ["Paris", "1815 · Napoleon wins at Waterloo"], ["Moscow", "1918 · A Siberian republic"],
    ["Cairo", "1250 · The Ayyubids rally"], ["New Delhi", "1857 · Delhi stands"], ["Beijing", "1421 · Zheng He sails west"],
    ["Tokyo", "1905 · Peace at Portsmouth fails"], ["Pretoria", "1902 · The Boer republics endure"], ["Canberra", "2016 · A republic down under"]
  ];
  // Where a pin's note may go, in order of preference: outward or inward, up or down, how far.
  var PIN_SPOTS = [];
  [1, 1.9, 2.8, 3.7, 4.6].forEach(function (reach) {
    [[1, -1], [-1, -1], [1, 1], [-1, 1]].forEach(function (side) { PIN_SPOTS.push([side[0], side[1], reach]); });
  });
  var SEA = "#0b1015";
  var SKY = "#121a21";
  var LAND = "#22252b";

  function draw(now) {
    var T = state.T;
    var step = STEPS[Math.max(0, Math.min(STEPS.length - 1, Math.floor(T)))];
    setCamera(cameraAt(T));
    var s = P.s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, W, H);

    // The sea's engraving: a grid of degrees, finer close in.
    ctx.strokeStyle = "rgba(236, 228, 210, 0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (s < 16) trace(ctx, gratWorld);
    if (s > 2.5) trace(ctx, gratFine);
    ctx.stroke();

    // The land: echoed coasts, then the countries.
    var colourful = T > STEPS.indexOf("yours") - 0.3;
    var land = new Path2D();
    world.forEach(function (country) { trace(land, country.rings); });
    ctx.lineJoin = "round";
    [[10, 0.04], [6, 0.06], [2.6, 0.1]].forEach(function (echo) {
      ctx.lineWidth = echo[0];
      ctx.strokeStyle = "rgba(160, 190, 205," + echo[1] + ")";
      ctx.stroke(land);
    });
    if (colourful) {
      world.forEach(function (country) {
        ctx.fillStyle = country.colour;
        ctx.beginPath(); trace(ctx, country.rings); ctx.fill();
      });
    } else {
      ctx.fillStyle = LAND;
      ctx.fill(land);
    }
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(236, 228, 210, 0.24)";
    ctx.stroke(land);

    // Western Europe and Korea, region by region, when close enough.
    var franceOn = T > 2.7 && T < 9.3;
    if (s > 1.6) {
      europe.forEach(function (region) {
        if (region.o !== "France" || !franceOn) return;
        ctx.fillStyle = "rgba(43, 193, 243, 0.2)";
        ctx.beginPath(); trace(ctx, region.rings); ctx.fill();
      });
      ctx.strokeStyle = "rgba(236, 228, 210, 0.16)";
      ctx.lineWidth = 0.7;
      ctx.beginPath(); europe.forEach(function (region) { trace(ctx, region.rings); }); ctx.stroke();
      if (franceOn) {
        ctx.strokeStyle = "#2bc1f3";
        ctx.lineWidth = 2.2;
        ctx.beginPath(); europe.forEach(function (region) { if (region.o === "France") trace(ctx, region.rings); }); ctx.stroke();
      }
    }
    var kp = koreaProgress(T);
    var kStep = koreaStep(kp);
    var taken = {};
    koreaOrder.slice(0, kStep).forEach(function (id) { taken[id] = 1; });
    if (s > 3) {
      korea.forEach(function (region) {
        var north = region.o === "North Korea" || taken[region.id];
        ctx.fillStyle = north ? "#5e2015" : "#1d4656";
        ctx.beginPath(); trace(ctx, region.rings); ctx.fill();
      });
      ctx.strokeStyle = "rgba(11, 15, 18, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath(); korea.forEach(function (region) { trace(ctx, region.rings); }); ctx.stroke();
    }

    // Rivers.
    if (s > 2.2) {
      ctx.strokeStyle = "rgba(92, 132, 150, 0.85)";
      ctx.lineWidth = 1.3;
      ctx.beginPath(); rivers.forEach(function (river) { trace(ctx, river.rings); }); ctx.stroke();
    }

    // Names: regions, rivers, towns.
    if (s > 9) {
      data.regionLabels.forEach(function (r) { label(r.n, r.at[0], r.at[1], { size: 11, align: "center", alpha: 0.6, font: "italic EB Garamond, Georgia, serif", weight: "400" }); });
    }
    if (s > 4) {
      rivers.forEach(function (river) { label(river.n, river.at[0], river.at[1], { size: 11, alpha: 0.75, colour: "#8fb2c2", font: "italic EB Garamond, Georgia, serif", weight: "400" }); });
    }
    if (s > 1.6) {
      data.towns.forEach(function (town) {
        if (town.t === 2 && s < 7) return;
        label(town.n, town.at[0], town.at[1], { size: town.t === 1 ? 12 : 10.5, dot: "rgba(236, 228, 210, 0.8)", r: town.t === 1 ? 2.4 : 1.8, alpha: 0.82, font: "EB Garamond, Georgia, serif", weight: town.t === 1 ? "600" : "400" });
      });
    }

    // What happens in each chapter.
    if (step === "world") {
      ["Washington", "Paris", "Moscow", "Cairo", "New Delhi", "Beijing", "Tokyo", "Brasília", "Pretoria", "Canberra", "Seoul"].forEach(function (name, i) {
        var at = data.places[name];
        var pulse = (now / 2600 + i * 0.13) % 1;
        project(at[0], at[1], 0, A);
        if (A[2] <= 0) return;
        ctx.strokeStyle = "rgba(236, 228, 210," + (0.8 * (1 - pulse)) + ")";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(A[0], A[1], 4 + pulse * 18, 0, Math.PI * 2); ctx.stroke();
        label(name, at[0], at[1], { size: 12, dot: "#ece4d2", r: 3.2 });
      });
    }
    // The missiles while the camera is with them or near; the front from the
    // time it can be seen ahead.
    var u = journeyU(T);
    if (T > 0.75 && u < UB + 0.1) {
      Object.keys(data.sites.launch).forEach(function (name) { var at = data.sites.launch[name]; label(name, at[0], at[1], { size: 12, dot: "#e0662f", r: 3.6 }); });
      Object.keys(data.sites.target).forEach(function (name) { var at = data.sites.target[name]; label(name, at[0], at[1], { size: 12, dot: "#c4432c", r: 3.6 }); });
      Object.keys(data.sites.defence).forEach(function (name) { var at = data.sites.defence[name]; label(name, at[0], at[1], { size: 11, dot: "#2bc1f3", r: 3, alpha: 0.85 }); });
      state.counts = drawMissiles(u, now);
    }
    if (u > UX - 0.05 && T < 3.25) {
      var kn = drawKorea(kp, now);
      ["Seoul", "Pyongyang", "Busan"].forEach(function (name) { var at = data.places[name]; label(name, at[0], at[1], { size: 14, dot: "#ece4d2", r: 3.6 }); });
      state.korea = kn;
    }
    if (step === "talks") {
      drawLink(data.places.Paris, data.places.Washington, "rgba(226, 196, 134, 0.95)", now, 0.16);
      drawLink(data.places.Paris, data.places.Moscow, "rgba(226, 196, 134, 0.95)", now, 0.22);
      drawLink(data.places.Paris, data.places.Beijing, "rgba(226, 196, 134, 0.6)", now, 0.14);
      ["Paris", "Washington", "Moscow", "Beijing"].forEach(function (name) { var at = data.places[name]; label(name, at[0], at[1], { size: 13, dot: "#e2c486", r: 3.6 }); });
    }
    if (step === "congress") {
      ["Washington", "Moscow", "Seoul", "Pyongyang", "Beijing"].forEach(function (name, i) {
        drawLink(data.places[name], data.places.Strasbourg, i % 2 ? "rgba(195, 207, 143, 0.9)" : "rgba(226, 196, 134, 0.9)", now, 0.12);
      });
      var st = data.places.Strasbourg;
      var pulse2 = (now / 2200) % 1;
      project(st[0], st[1], 0, A);
      ctx.strokeStyle = "rgba(195, 207, 143," + (1 - pulse2) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(A[0], A[1], 6 + pulse2 * 40, 0, Math.PI * 2); ctx.stroke();
      label("Strasbourg", st[0], st[1], { size: 15, dot: "#c3cf8f", r: 4.2 });
    }
    if (step === "choose" || step === "order" || step === "skip" || step === "parliament") {
      label("Paris", data.places.Paris[0], data.places.Paris[1], { size: 15, dot: "#2bc1f3", r: 4 });
    }
    if (step === "yours") {
      // Each pin's note goes in the first place around it that is free: clear
      // of the notes already placed, the other pins and the chapter's card.
      ctx.font = "italic 600 14px EB Garamond, Georgia, serif";
      var pins = [];
      HISTORIES.forEach(function (entry) {
        var at = data.places[entry[0]];
        if (!at) return;
        project(at[0], at[1], 0, A);
        if (A[2] > 0) pins.push({ x: A[0], y: A[1], text: entry[1], w: ctx.measureText(entry[1]).width });
      });
      var minX = narrow() ? 8 : Math.min(W * 0.46, 560) + 8;
      var maxY = narrow() ? H * 0.47 : H - 50;   // on a phone the card takes the lower half
      var boxes = [];
      var clash = function (b) {
        if (b[0] < minX || b[2] > W - 24 || b[1] < 70 || b[3] > maxY) return true;
        for (var k = 0; k < boxes.length; k += 1) if (b[0] < boxes[k][2] + 6 && b[2] > boxes[k][0] - 6 && b[1] < boxes[k][3] + 3 && b[3] > boxes[k][1] - 3) return true;
        return pins.some(function (q) { return q.x > b[0] - 5 && q.x < b[2] + 5 && q.y > b[1] - 5 && q.y < b[3] + 5; });
      };
      // The pins nearest the right edge first, their notes turned inward.
      var middle = (minX + W) / 2;
      pins.sort(function (a, b) { return b.x - a.x; });
      pins.forEach(function (pin) {
        var spot = null;
        var inward = pin.x > middle ? -1 : 1;
        var spots = narrow() ? 8 : PIN_SPOTS.length;   // on a phone, only close to the pin
        for (var c = 0; c < spots && !spot; c += 1) {
          var fx = PIN_SPOTS[c][0] * inward, fy = PIN_SPOTS[c][1], reach = PIN_SPOTS[c][2];
          var tx = pin.x + 20 * fx;
          var ty = pin.y + (fy < 0 ? -28 : 34) * reach;
          var box = fx > 0 ? [tx, ty - 12, tx + pin.w, ty + 4] : [tx - pin.w, ty - 12, tx, ty + 4];
          if (!clash(box)) spot = { fx: fx, tx: tx, ty: ty, box: box };
        }
        // A phone has no room for every note: a pin with nowhere free stays a pin.
        if (!spot && narrow()) spot = { none: true };
        if (!spot) spot = { fx: inward, tx: pin.x + 20 * inward, ty: pin.y - 28, box: inward > 0 ? [pin.x + 20, pin.y - 40, pin.x + 20 + pin.w, pin.y - 24] : [pin.x - 20 - pin.w, pin.y - 40, pin.x - 20, pin.y - 24] };
        ctx.fillStyle = "#e2c486";
        ctx.beginPath(); ctx.arc(pin.x, pin.y, 3.4, 0, Math.PI * 2); ctx.fill();
        if (spot.none) return;
        boxes.push(spot.box);
        ctx.strokeStyle = "rgba(226, 196, 134, 0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pin.x, pin.y); ctx.lineTo(pin.x + 16 * spot.fx, spot.ty + (spot.ty < pin.y ? 2 : -12)); ctx.stroke();
        ctx.textAlign = spot.fx > 0 ? "left" : "right";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(11, 15, 18, 0.95)";
        ctx.strokeText(pin.text, spot.tx, spot.ty);
        ctx.fillStyle = "#f2eee4";
        ctx.fillText(pin.text, spot.tx, spot.ty);
      });
    }

    // Haze toward the horizon when the map leans back: flat bands, thicker
    // further off. Leaned far enough, the sky above the horizon.
    if (cam.t > 8) {
      var strength = Math.min(1, cam.t / 60);
      var horizon = horizonY();
      var top = Math.max(0, horizon);
      for (var b = 0; b < 7; b += 1) {
        ctx.fillStyle = "rgba(11, 16, 21," + (0.11 * strength) + ")";
        ctx.fillRect(0, top, W, H * (0.3 - b * 0.04));
      }
      if (horizon > 0) {
        ctx.fillStyle = SKY;
        ctx.fillRect(0, 0, W, horizon);
        for (var band = 1; band <= 4; band += 1) {
          ctx.fillStyle = "rgba(160, 190, 205," + (0.035 * (5 - band) / 4) + ")";
          ctx.fillRect(0, horizon - band * 9, W, 9);
        }
        ctx.fillStyle = "rgba(236, 228, 210, 0.16)";
        ctx.fillRect(0, horizon - 0.5, W, 1);
      }
    }
    instruments();
  }

  // ---- the HTML instruments that follow the camera --------------------------------------------------
  var NICE = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  // Back from Mercator to degrees.
  function latOfY(y) { return (2 * Math.atan(Math.exp((data.merc.y0 - y) / data.merc.k)) - Math.PI / 2) * 180 / Math.PI; }
  function lonOfX(x) { return (x - data.merc.x0) / data.merc.k * 180 / Math.PI; }
  function deg(value, pos, neg) {
    var a = Math.abs(value);
    var d = Math.floor(a);
    var m = Math.round((a - d) * 60);
    if (m === 60) { d += 1; m = 0; }
    return d + "°" + (m < 10 ? "0" : "") + m + "′" + (value >= 0 ? pos : neg);
  }
  var lastScale = "";
  function instruments() {
    var bar = document.getElementById("scaleBar");
    var barText = document.getElementById("scaleText");
    var lat = latOfY(cam.y);
    if (bar && barText) {
      // A map unit is 6371 / k km at the equator, less by the cosine of the latitude.
      var kmPerPx = 6371 * Math.cos(lat * Math.PI / 180) / data.merc.k / P.s;
      var km = NICE[0];
      for (var i = 0; i < NICE.length; i += 1) if (NICE[i] / kmPerPx <= 150) km = NICE[i];
      var label = km.toLocaleString("en") + " km";
      bar.style.width = Math.round(km / kmPerPx) + "px";
      if (label !== lastScale) { barText.textContent = label; lastScale = label; }
    }
    var compass = document.getElementById("compass");
    if (compass) compass.style.transform = "rotate(" + (-cam.h).toFixed(1) + "deg)";
    var coords = document.getElementById("coords");
    if (coords) coords.textContent = deg(lat, "N", "S") + "  " + deg(lonOfX(cam.x), "E", "W") + "  ·  heading " + Math.round(((cam.h % 360) + 360) % 360) + "°  ·  tilt " + Math.round(cam.t) + "°";
  }

  // ---- HTML that changes inside a chapter: the telemetry and the front report ----------------------------
  var lastCounts = "";
  var lastKorea = -1;
  function liveOverlays() {
    var counts = state.counts;
    if (counts && state.step === "launch") {
      var key = counts.flying + "/" + counts.stopped + "/" + counts.hit;
      if (key !== lastCounts) {
        lastCounts = key;
        var set = function (id, value) { var el = document.getElementById(id); if (el) el.textContent = value; };
        set("tmFlying", counts.flying);
        set("tmStopped", counts.stopped);
        set("tmHit", counts.hit);
        var rows = document.querySelectorAll("#tmTracks li");
        var clock = missileClock(journeyU(state.T));
        Array.prototype.forEach.call(rows, function (row, i) {
          var m = clock.each[i];
          var status = m <= 0 ? "Holding" : STOPPED[i] ? (m >= MEET ? "Intercepted" : m >= RISE ? "Engaged" : "In flight") : (m >= 1 ? "Impact" : "In flight");
          row.setAttribute("data-status", status.toLowerCase().replace(" ", "-"));
          row.querySelector("b").textContent = status;
        });
      }
    }
    if (state.step === "korea" && state.korea !== lastKorea) {
      lastKorea = state.korea;
      var list = document.getElementById("frontFallen");
      if (list) {
        var fallen = koreaOrder.slice(0, state.korea).map(function (id) { return regionNames[id]; }).reverse();
        list.innerHTML = fallen.slice(0, 6).map(function (name, i) { return "<li" + (i === 0 ? " class=\"new\"" : "") + ">" + name + "</li>"; }).join("") || "<li>The line holds at the 38th parallel</li>";
      }
      var count = document.getElementById("frontCount");
      if (count) count.textContent = state.korea + " / " + koreaOrder.length;
      // The date runs on with the front.
      var date = document.getElementById("hudDate");
      if (date) {
        var day = new Date(Date.UTC(2016, 8, 2) + state.korea * 5.3 * 86400000);
        date.textContent = day.getUTCDate() + " " + MONTHS[day.getUTCMonth()] + " " + day.getUTCFullYear();
      }
    }
  }

  // ---- chapters: the HUD, the overlays, the figures -----------------------------------------------------
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var dateTimer = 0;
  function parseDate(value) {
    var m = /^(\d{1,2}) (\w+) (\d{4})$/.exec(value || "");
    if (!m) return null;
    var month = MONTHS.indexOf(m[2]);
    return month < 0 ? null : new Date(Date.UTC(+m[3], month, +m[1]));
  }
  function showDate(value, from) {
    var out = document.getElementById("hudDate");
    clearInterval(dateTimer);
    var a = parseDate(from);
    var b = parseDate(value);
    if (!a || !b || calm) { out.textContent = value; return; }
    var day = a.getTime();
    dateTimer = setInterval(function () {
      day += 86400000;
      var d = new Date(day);
      out.textContent = d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
      if (day >= b.getTime()) { clearInterval(dateTimer); out.textContent = value; }
    }, 1700 / Math.max(1, (b - a) / 86400000));
  }
  function showFigures(element) {
    var hud = document.getElementById("hud");
    var balance = parseFloat(element.getAttribute("data-balance")) || 0;
    hud.style.setProperty("--balance", balance);
    hud.setAttribute("data-lean", balance > 0.25 ? "war" : balance < -0.25 ? "peace" : "even");
    var turn = document.getElementById("hudTurn");
    if (turn) turn.textContent = element.getAttribute("data-turn") || "";
    ["stability", "treasury", "manpower"].forEach(function (key) {
      var bar = document.getElementById("hud-" + key);
      var value = parseFloat(element.getAttribute("data-" + key));
      if (bar && isFinite(value)) {
        bar.style.width = value + "%";
        bar.parentNode.setAttribute("data-low", value < 40 ? "1" : "0");
      }
    });
    var set = function (id, attr) { var el = document.getElementById(id); if (el) el.textContent = element.getAttribute(attr) || ""; };
    set("cartoucheTitle", "data-map");
    set("cartouchePlate", "data-plate");
    var ticker = document.getElementById("tickerTrack");
    var news = element.getAttribute("data-news");
    if (ticker && news) {
      var items = news.split("|").map(function (item) { return "<span>" + item + "</span>"; }).join("");
      ticker.innerHTML = items + items;
    }
  }
  var ORDER = "Summon the American and Russian ambassadors. Offer Strasbourg for a peace congress, and ask Beijing to bring Pyongyang.";
  var typeTimer = 0;
  function typeOrder(on) {
    var out = document.getElementById("typed");
    var advice = document.getElementById("advice");
    clearInterval(typeTimer);
    if (!out) return;
    if (!on) { out.textContent = ""; advice.classList.remove("on"); return; }
    if (calm) { out.textContent = ORDER; advice.classList.add("on"); return; }
    var i = 0;
    out.textContent = "";
    advice.classList.remove("on");
    typeTimer = setInterval(function () {
      i += 1;
      out.textContent = ORDER.slice(0, i);
      if (i >= ORDER.length) {
        clearInterval(typeTimer);
        setTimeout(function () { advice.classList.add("on"); }, 400);
      }
    }, 28);
  }
  // The Assemblée, seat by seat, for the parliament chapter.
  function hemicycle() {
    var svg = document.getElementById("hemicycle");
    if (!svg || svg.childNodes.length) return;
    var BLOCS = [["#7a2a22", 17], ["#b8322a", 73], ["#d8657a", 30], ["#e6a23c", 42], ["#5aa0c8", 314], ["#2c4f8f", 101]];
    var seats = [];
    var rows = 12;
    for (var r = 0; r < rows; r += 1) {
      var radius = 40 + r * 7;
      var count = Math.round(Math.PI * radius / 7.6);
      for (var i = 0; i < count; i += 1) {
        var a = Math.PI - Math.PI * (i + 0.5) / count;
        seats.push({ a: a, x: Math.cos(a) * radius, y: -Math.sin(a) * radius });
      }
    }
    seats.sort(function (p, q) { return q.a - p.a; });
    var blocIndex = 0;
    var left = BLOCS[0][1];
    var total = BLOCS.reduce(function (sum, b) { return sum + b[1]; }, 0);
    var scale = seats.length / total;
    left = Math.round(BLOCS[0][1] * scale);
    seats.forEach(function (seat) {
      while (left <= 0 && blocIndex < BLOCS.length - 1) { blocIndex += 1; left = Math.round(BLOCS[blocIndex][1] * scale); }
      left -= 1;
      svgNode("circle", { cx: seat.x.toFixed(1), cy: seat.y.toFixed(1), r: 2.6, fill: BLOCS[blocIndex][0] }, svg);
    });
  }

  function show(name, element) {
    if (name === state.step && element === state.element) return;
    state.step = name;
    state.element = element;
    var stage = document.getElementById("stage");
    stage.setAttribute("data-step", name);
    Array.prototype.forEach.call(stage.querySelectorAll("[data-on]"), function (ov) {
      ov.classList.toggle("on", (" " + ov.getAttribute("data-on") + " ").indexOf(" " + name + " ") >= 0);
    });
    typeOrder(name === "order");
    if (name === "parliament") hemicycle();
    if (element) {
      if (name !== "korea") showDate(element.getAttribute("data-date"), element.getAttribute("data-from"));
      else lastKorea = -1;
      showFigures(element);
      var index = STEPS.indexOf(name);
      Array.prototype.forEach.call(document.querySelectorAll(".progress i"), function (dot, i) { dot.classList.toggle("on", i <= index); });
    }
  }

  // ---- the loop: scroll → story time → a frame ------------------------------------------------------------
  var steps = [];
  function readScroll() {
    var middle = window.innerHeight / 2;
    var T = 0;
    var active = steps[0];
    for (var i = 0; i < steps.length; i += 1) {
      var box = steps[i].getBoundingClientRect();
      if (box.top <= middle && box.bottom > middle) {
        T = i + (middle - box.top) / box.height;
        active = steps[i];
        break;
      }
      if (box.top > middle) { T = i; active = steps[i]; break; }
      T = i + 0.999;
      active = steps[i];
    }
    state.target = T;
    show(active.getAttribute("data-step"), active);
  }
  function resize() {
    var box = canvas.getBoundingClientRect();
    W = box.width || window.innerWidth;
    H = box.height || window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  function measure() {
    heights = steps.map(function (step) { return step.offsetHeight || 1; });
    if (transit) transit.timing = null;
  }
  var live = false;
  var last = 0;
  function frame(now) {
    if (!live) { last = 0; return; }
    requestAnimationFrame(frame);
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
    last = now;
    // The camera eases toward where the scroll says it should be.
    var gap = state.target - state.T;
    state.T = calm || Math.abs(gap) < 0.0005 ? state.target : state.T + gap * Math.min(1, dt * 5);
    draw(now);
    liveOverlays();
  }

  function start() {
    heroMap();
    scales();
    astrolabe();
    slips();
    doves();
    canvas = document.getElementById("stageCanvas");
    if (!canvas || !canvas.getContext) return;
    ctx = canvas.getContext("2d");
    steps = Array.prototype.slice.call(document.querySelectorAll(".step[data-step]"));
    resize();
    measure();
    readScroll();
    state.T = state.target;
    var chronicle = document.getElementById("story");
    function wake() {
      if (live) return;
      live = true;
      requestAnimationFrame(frame);
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          chronicle.classList.toggle("live", entry.isIntersecting);
          if (entry.isIntersecting) wake(); else live = false;
        });
      }, { rootMargin: "0px" }).observe(chronicle);
    } else {
      chronicle.classList.add("live");
      wake();
    }
    var queued = 0;
    window.addEventListener("scroll", function () { if (!queued) queued = requestAnimationFrame(function () { queued = 0; readScroll(); }); }, { passive: true });
    window.addEventListener("resize", function () { resize(); measure(); readScroll(); });
    // The map's fonts arrive after the first frame.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (!live) draw(performance.now()); });
    draw(performance.now());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
