/*! Open Historia — the landing page's game interface © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game's own HUD over the story's map, built as the game builds it: the
// ☰ menu, the session pill and Exit Game (libraryBar.jsx), the date with « for
// the Events panel and » for the time skip (time.jsx), the dock of Chat,
// Actions and Projects with Search beside it (chat.jsx, hudDock.js), the flag
// badge and the advisor button (other.jsx, main.jsx), the Advisor drawer
// (advisor.jsx), the Country drawer and its stats (countryPanel.jsx,
// stats.jsx), and in a war the red War Room button and the War Room itself
// (warRoom.jsx, warRoomRail.jsx), its steel painted by the game's own
// generators (roughMetal.js, brushedMetal.js). Its looks are in game-ui.css.
//
// story.js hands it the story time T every frame, and the scroll drives it:
// the advisor's conversation unfolds, the figures move, the orders type
// themselves out, the letters come in. Every button works. A drawer or a
// window opened or closed by hand stays as it is until the next chapter.
(function () {
  "use strict";

  var STEPS = ["world", "launch", "korea", "choose", "order", "skip", "talks", "parliament", "congress", "yours"];

  // ---- what the story says, by story time T (chapter index + how far through it) ----
  // The advisor's conversation: [T, who ("a" advisor, "u" you), text, how long it takes to type out].
  var ADVISOR = [
    [0.3, "a", "Good morning, Président. It is the first of January, 2016. France is at peace; the world is not quiet."],
    [0.45, "u", "Brief me."],
    [0.55, "a", "Washington and Moscow are trading threats over the Baltic. Pyongyang tested again in December. At home the treasury is steady and the unions are restless."],
    [1.06, "a", "Président, NORAD reports launches from Montana and North Dakota. Ten tracks, heading north over the Arctic.", 0.03],
    [1.12, "u", "Where are they going?", 0.02],
    [1.18, "a", "Russia's missile fields: Kozelsk, Tatishchevo, Plesetsk, Yasny. Two tracks end at Moscow itself.", 0.03],
    [1.5, "a", "Interceptors are up from Severomorsk and Sofrino.", 0.02],
    [1.72, "a", "Four stopped over the Barents Sea. Impacts at Tatishchevo and Kozelsk.", 0.025],
    [1.9, "a", "The last one came down at Yasny. Seven were caught; three got through.", 0.025],
    [2.04, "a", "In the confusion, Pyongyang has crossed the 38th parallel.", 0.04],
    [2.12, "u", "Can anyone stop them?", 0.03],
    [2.2, "a", "Not quickly. The South is falling back on Busan, region by region. The War Room has the front.", 0.05],
    [2.6, "a", "Daejeon has fallen. The Nakdong line is breaking.", 0.04],
    [3.3, "a", "None of this is our war, yet. But France holds a permanent seat, an army and a voice. Your figures are under the flag."],
    [4.25, "u", "Summon the American and Russian ambassadors. Offer Strasbourg for a peace congress, and ask Beijing to bring Pyongyang."],
    [4.5, "a", "Washington will come if Moscow does. Moscow will want inspectors in Montana. At home the right will call it weakness: expect stability to slip a few points."],
    [5.3, "a", "Six weeks have passed. Both ambassadors came, and Beijing says it will bring Pyongyang. The guns have gone quiet in Busan."],
    [6.3, "a", "Moscow has answered your letter. It is in your chats."],
    [7.3, "a", "The Assemblée backs the congress: 341 for, 156 against. Stability is recovering."],
    [8.3, "a", "The Final Act is signed in Strasbourg. An armistice in Korea, and no launches for ten years."],
    [8.45, "u", "And France?"],
    [8.55, "a", "Your reputation has never been higher, Président."],
    [9.3, "a", "That was one year of one campaign. What would you like to do next?"]
  ];
  // The diplomatic chats: [T, who ("u" is France), text].
  var CHATS = [
    { with: "China", flag: ["#de2910", "#de2910", "#de2910"], lines: [
      [4.6, "u", "Will you bring Pyongyang to Strasbourg?"],
      [5.25, "t", "China will bring its neighbour. It asks only that the armistice line be the one held on the day of signing."]
    ] },
    { with: "United States", flag: ["#3c3b6e", "#ffffff", "#b22234"], lines: [
      [5.2, "t", "Washington accepts Strasbourg. The Secretary of State will lead our delegation."],
      [6.5, "u", "Then we will see you in February."]
    ] },
    { with: "Russia", flag: ["#ffffff", "#0039a6", "#d52b1e"], lines: [
      [6.15, "u", "The fires at Tatishchevo will not be the last unless we sit down. France offers Strasbourg, and its word that Washington will be at the table."],
      [6.35, "t", "We will come to Strasbourg. Let it be understood that we come as the injured party, and that inspectors go to Montana as well as to Plesetsk."]
    ] }
  ];
  var ORDER = "Summon the American and Russian ambassadors. Offer Strasbourg for a peace congress, and ask Beijing to bring Pyongyang.";
  // The world's events: [T, date, tags, title, what happened, places].
  var EVENTS = [
    [0.4, "2016-01-01", ["Politics"], "A new year in Paris", "The **French Republic** opens 2016 at peace, its treasury steady and its unions restless.", ["France"]],
    [1.05, "2016-08-09", ["Military"], "Launches detected over the Arctic", "**NORAD** tracks ten missiles leaving **Montana**, **North Dakota** and **Wyoming** on the great circles toward Russia.", ["United States", "Russia"]],
    [1.9, "2016-08-09", ["Military"], "Three strikes on Russian missile fields", "Seven missiles are caught by interceptors from **Severomorsk** and **Sofrino**. **Tatishchevo**, **Kozelsk** and **Yasny** are hit.", ["Russia"]],
    [2.05, "2016-09-02", ["Military", "War"], "North Korea crosses the 38th parallel", "In the confusion, **Pyongyang** sends its armies south. **Seoul** is encircled within the week.", ["North Korea", "South Korea"]],
    [2.6, "2016-09-28", ["War"], "Daejeon falls", "The South falls back on the **Nakdong**. **Busan**'s harbour comes under fire.", ["South Korea"]],
    [4.4, "2016-12-01", ["Diplomacy"], "France calls a peace congress", "The **Élysée** summons the American and Russian ambassadors and offers **Strasbourg**.", ["France"]],
    [5.2, "2017-01-01", ["Diplomacy"], "The world accepts Strasbourg", "**Washington** and **Moscow** accept; **Beijing** will bring **Pyongyang**. A ceasefire holds in Busan.", ["United States", "Russia", "China"]],
    [7.3, "2017-02-09", ["Politics"], "The Assemblée backs the congress", "**341** deputies for, **156** against. Protests on the **Place de la Concorde**.", ["France"]],
    [8.3, "2017-03-02", ["Diplomacy", "Peace"], "The Final Act of Strasbourg", "An armistice in Korea along the line held on the day of signing, and **ten years** without a launch.", ["France", "Russia", "United States"]]
  ];
  // France's figures at the middle of each chapter; each takes what it does not set from the one before.
  var FIGURES = [
    { stability: 68, intel: 74, sovereignty: 72, food: 95, energy: 88, economy: 70, security: 66, reputation: 64, population: 66.8, gdp: 2.44, growth: 1.1, gdpc: 36500, inflation: 0.3, unemployment: 10.1, debt: 96, balance: -3.6, us: 62, de: 74, uk: 48, ru: -24, cn: 18, kp: -46, agreements: 2 },
    { stability: 52, intel: 79, sovereignty: 70, food: 93, energy: 80, economy: 66, security: 52, gdp: 2.4, growth: -0.4, gdpc: 35900, inflation: 1.8, unemployment: 10.3, debt: 97, balance: -3.9, us: 58, uk: 52, ru: -44, cn: 12, kp: -55 },
    { stability: 47, intel: 80, sovereignty: 68, food: 92, energy: 74, economy: 61, security: 49, reputation: 62, gdp: 2.36, growth: -1.2, gdpc: 35300, inflation: 3.1, unemployment: 10.6, debt: 99, balance: -4.4, us: 56, de: 72, cn: 8, kp: -72 },
    { reputation: 63 },
    { stability: 43, reputation: 68, us: 60, ru: -36, cn: 16 },
    { stability: 45, reputation: 74, energy: 76, us: 64, ru: -22, cn: 28, kp: -58 },
    { stability: 50, reputation: 79, ru: -8, cn: 34 },
    { stability: 58, reputation: 81 },
    { stability: 66, sovereignty: 74, energy: 82, economy: 66, security: 60, reputation: 90, gdp: 2.42, growth: 0.6, inflation: 2.2, us: 70, ru: 14, cn: 44, kp: -32, agreements: 3 },
    { stability: 70, reputation: 92, energy: 85, economy: 68, security: 63, growth: 1, inflation: 1.6, ru: 20 }
  ];
  for (var f = 1; f < FIGURES.length; f += 1) FIGURES[f] = Object.assign({}, FIGURES[f - 1], FIGURES[f]);
  var RELATIONS = [["de", "Germany"], ["us", "United States"], ["uk", "United Kingdom"], ["cn", "China"], ["ru", "Russia"], ["kp", "North Korea"]];
  var INDICES = [["⚑", "Sovereignty", "sovereignty", "#f97316"], ["🌾", "Food autonomy", "food", "#22c55e"], ["⚡", "Energy autonomy", "energy", "#eab308"], ["🏦", "Economic independence", "economy", "#06b6d4"], ["🛡", "Internal security", "security", "#f43f5e"], ["🤝", "International reputation", "reputation", "#3b82f6"]];
  var RANKING = [["United States", 18.7], ["China", 11.2], ["Japan", 4.9], ["Germany", 3.5], ["United Kingdom", 2.7], ["France", 2.44], ["India", 2.3], ["Italy", 1.9]];
  // Which drawer and which view each chapter opens, and which window; unless the reader chose otherwise.
  var DRAWER = { world: "advisor", launch: "advisor", korea: "advisor", choose: "country", order: "advisor", skip: "country", talks: "advisor", parliament: "country", congress: "advisor", yours: "country" };
  var VIEW = { choose: "economy", skip: "diplomacy", parliament: "politics", yours: "economy" };
  var POP = { order: "actions", skip: "events", talks: "chat", congress: "projects" };
  var TAGS = { world: ["Politics"], launch: ["Military"], korea: ["Military", "War"], choose: ["Politics"], order: ["Diplomacy"], skip: ["Politics"], talks: ["Diplomacy"], parliament: ["Politics"], congress: ["Diplomacy", "Peace"], yours: [] };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // ---- the War Room's battlefield, as Seoul sees it --------------------------------------------
  var GENERALS = [["General Han Ji-ho", "1st Army", 4], ["General Park Sung-min", "2nd Army", 3], ["General Choi Dong-hyun", "3rd Army", 4], ["General Yoon Tae-gyu", "Capital Corps", 3]];
  var WEATHER = ["Clear over Gyeonggi-do", "Rain over Chungcheong, two days", "Fog in the Sobaek passes at dawn", "Typhoon rains over Gyeongsang, three days", "Clear and dry on the Nakdong"];
  var RAIL = [
    ["Select", '<rect x="3.5" y="3.5" width="13" height="13" rx="1" stroke-dasharray="3 3.2"/><path d="M13 13l7.5 3-3.2 1.3L16 20.5z" fill="currentColor" stroke-width="1.4"/>'],
    ["Route", '<path d="M4 19c1-6 4-7 7-7s5-2 5-5"/><path d="M12.5 6.5L16 3.5l3.5 3"/><circle cx="4" cy="19" r="1.2" fill="currentColor"/>'],
    null,
    ["Advance", '<path d="M5 6l6 6-6 6"/><path d="M12.5 6l6 6-6 6"/>'],
    ["Dig in", '<path d="M2.5 9h5l2 7h5l2-7h5"/><path d="M12 3.5v6M9.6 7.4L12 9.8l2.4-2.4"/>'],
    ["Hold", '<path d="M12 3l7 2.6v5.6c0 4.4-2.9 7.6-7 9.3-4.1-1.7-7-4.9-7-9.3V5.6z"/>'],
    ["Fall back", '<path d="M19 7v4a4 4 0 0 1-4 4H5"/><path d="M9.5 10.5L5 15l4.5 4.5"/>'],
    ["Release", '<path d="M3.5 19.5h17"/><path d="M12 4v10.5M7.8 10.6L12 14.8l4.2-4.2"/>'],
    ["Withdraw", '<path d="M20.5 4.5v15"/><path d="M16 12H4M8.5 7.5L4 12l4.5 4.5"/>'],
    null,
    ["Transport", '<rect x="8" y="2.5" width="8" height="8" rx="1.6"/><rect x="8" y="13" width="8" height="8.5" rx="1"/><path d="M12 10.5V13"/>'],
    ["Diversion", '<path d="M4 18c2-7 6-9 14-10" stroke-dasharray="3.2 3.4"/><path d="M14.5 4.6L18.4 8l-3.2 3.9"/>'],
    ["Deploy", '<path d="M3 19h18"/><path d="M4.5 11h4v4h-4z"/><path d="M10 11h4v4h-4z"/><path d="M15.5 11h4v4h-4z"/>'],
    null,
    ["Fortify", '<path d="M3.5 20.5v-11h3v-3h3v3h5v-3h3v3h3v11z"/><path d="M10 20.5v-4.5h4v4.5"/>'],
    ["Fleets", '<path d="M3 15.5h18l-2.8 4.5H5.8z"/><path d="M12 3.5v12"/><path d="M12 5.5l6.5 8H12"/>'],
    ["Supply", '<path d="M4 8l8-4.5L20 8v8.5L12 21l-8-4.5z"/><path d="M4 8l8 4.5L20 8M12 12.5V21"/>']
  ];

  // ---- the game's steel, painted as roughMetal.js and brushedMetal.js paint it ------------------
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
  function roughMetalPixels(size) {
    var base = [50, 53, 58], wear = 1, seed = 5;
    var light = new Float32Array(size * size).fill(1);
    var wrap = function (value) { return ((Math.round(value) % size) + size) % size; };
    for (var row = 0; row < size; row += 1) for (var col = 0; col < size; col += 1) {
      var u = col / size, v = row / size;
      var grain = (hash(col, row, seed) - 0.5) * 0.11;
      var patches = (drift(u, v, 3, 3, seed + 1) - 0.5) * 0.27 + (drift(u, v, 9, 9, seed + 2) - 0.5) * 0.14;
      var streaks = (drift(u, v, 2, 72, seed + 3) - 0.5) * 0.13;
      light[row * size + col] += (grain + patches + streaks) * wear;
    }
    var pits = Math.round((size * size) / 1500 * wear);
    for (var pit = 0; pit < pits; pit += 1) {
      var cx = hash(pit, 1, seed + 11) * size, cy = hash(pit, 2, seed + 11) * size;
      var radius = 0.8 + hash(pit, 3, seed + 11) * 1.9;
      var depth = 0.16 + hash(pit, 4, seed + 11) * 0.22;
      for (var dy = -4; dy <= 4; dy += 1) for (var dx = -4; dx <= 4; dx += 1) {
        var out = Math.sqrt(dx * dx + dy * dy);
        var at = wrap(cy + dy) * size + wrap(cx + dx);
        if (out <= radius) light[at] -= depth * (1 - out / (radius + 0.5));
        else if (out <= radius + 1.1 && dx + dy > 0) light[at] += 0.07;
      }
    }
    var scratches = Math.round(17 * wear);
    for (var scratch = 0; scratch < scratches; scratch += 1) {
      var x = hash(scratch, 1, seed + 23) * size, y = hash(scratch, 2, seed + 23) * size;
      var steep = hash(scratch, 3, seed + 23) > 0.75;
      var turn = (hash(scratch, 4, seed + 23) - 0.5) * (steep ? 2.4 : 0.5);
      var length = size * (0.12 + hash(scratch, 5, seed + 23) * (steep ? 0.3 : 0.75));
      var bright = 0.14 + hash(scratch, 6, seed + 23) * 0.2;
      var stepX = Math.cos(turn) * 0.5, stepY = Math.sin(turn) * 0.5;
      for (var walked = 0; walked < length; walked += 0.5) {
        var fade = Math.min(1, walked / 6, (length - walked) / 6);
        var waver = 0.7 + hash(Math.floor(walked / 3), scratch, seed + 29) * 0.3;
        light[wrap(y) * size + wrap(x)] += bright * fade * waver * 0.5;
        light[wrap(y + 1) * size + wrap(x)] -= bright * fade * 0.28;
        x += stepX; y += stepY;
      }
    }
    var pixels = new Uint8ClampedArray(size * size * 4);
    for (var i = 0; i < size * size; i += 1) {
      for (var c = 0; c < 3; c += 1) pixels[i * 4 + c] = Math.round(clamp((base[c] * light[i]) / 255) * 255);
      pixels[i * 4 + 3] = 255;
    }
    return pixels;
  }
  function rivetPixels(size) {
    var base = [132, 138, 146];
    var pixels = new Uint8ClampedArray(size * size * 4);
    var middle = size / 2, radius = size / 2 - 1, dome = radius * 0.78;
    var lx = -0.5, ly = -0.62, lz = 0.6;
    for (var row = 0; row < size; row += 1) for (var col = 0; col < size; col += 1) {
      var dx = col + 0.5 - middle, dy = row + 0.5 - middle;
      var out = Math.sqrt(dx * dx + dy * dy);
      if (out > radius) continue;
      var at = (row * size + col) * 4;
      var lightness;
      if (out > dome) lightness = 0.2 + ((-dx * lx - dy * ly) / radius) * -0.08;
      else {
        var nx = dx / dome, ny = dy / dome, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        var lit = Math.max(0, nx * lx + ny * ly + nz * lz);
        lightness = 0.34 + lit * 0.72 + (lit > 0.93 ? (lit - 0.93) * 4.5 : 0);
      }
      for (var c = 0; c < 3; c += 1) pixels[at + c] = Math.round(clamp((base[c] * lightness) / 255) * 255);
      pixels[at + 3] = Math.round(clamp(radius - out) * 255);
    }
    return pixels;
  }
  var noise = function (value) { var h = (value | 0) * 374761393 + 668265263; h = (h ^ (h >>> 13)) * 1274126177; h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  function brushedMetalPixels(size) {
    var base = [168, 24, 30], light = 0.105, grooves = 2.2, seed = 7;
    var pixels = new Uint8ClampedArray(size * size * 4);
    var middle = size / 2, radius = size / 2, turn = light * Math.PI * 2;
    for (var row = 0; row < size; row += 1) for (var col = 0; col < size; col += 1) {
      var dx = col + 0.5 - middle, dy = row + 0.5 - middle;
      var out = Math.sqrt(dx * dx + dy * dy);
      var at = (row * size + col) * 4;
      if (out > radius) continue;
      var far = out / radius;
      var ring = Math.floor(out * grooves);
      var scratch = noise(ring * 31 + seed);
      var groove = (noise(ring + seed * 977) - 0.5) * 0.17 + (scratch > 0.82 ? (scratch - 0.82) * -0.7 : 0);
      var angle = Math.atan2(dy, dx) - turn;
      var across = Math.cos(angle * 2);
      var wedge = Math.pow(clamp(across), 3) * 0.62 + Math.pow(clamp(-across), 6) * 0.2;
      var shine = wedge * (0.35 + 0.65 * clamp(far * 1.4));
      var lip = Math.exp(-Math.pow((far - 0.9) / 0.022, 2)) * 0.34;
      var edge = far > 0.93 ? (far - 0.93) / 0.07 : 0;
      var boss = Math.exp(-Math.pow(far / 0.16, 2)) * 0.14;
      var lightness = 0.62 + groove + lip - edge * 0.5 - boss;
      for (var c = 0; c < 3; c += 1) {
        var lit = base[c] * lightness + (255 - base[c] * lightness) * clamp(shine * (1 + groove * 2.5));
        pixels[at + c] = Math.round(clamp(lit / 255) * 255);
      }
      pixels[at + 3] = Math.round(clamp(radius - out) * 255);
    }
    return pixels;
  }
  function pixelsUrl(size, pixels) {
    try {
      var canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      var context = canvas.getContext("2d");
      var image = context.createImageData(size, size);
      image.data.set(pixels);
      context.putImageData(image, 0, 0);
      return canvas.toDataURL("image/png");
    } catch (error) {
      return "";
    }
  }

  // ---- small helpers ------------------------------------------------------------------------------
  var opts = null;
  var el = {};
  var state = { T: 0, step: "", drawer: null, view: "economy", pop: null, war: false, manual: {}, extra: [], keys: {}, seenChats: 0, tool: "", talk: [] };
  function $(id) { return document.getElementById(id); }
  function smooth(x) { return x * x * (3 - 2 * x); }
  function esc(text) { return String(text).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function bold(text) { return esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); }
  function changed(key, value) { if (state.keys[key] === value) return false; state.keys[key] = value; return true; }
  function typed(text, at, dur, T) { return text.slice(0, Math.ceil(text.length * clamp((T - at) / (dur || 0.06)))); }
  function tricolour(colours, cls) { return "<span class=\"gx-tricolour" + (cls ? " " + cls : "") + "\"><i" + (colours ? " style=\"background:" + colours[0] + "\"" : "") + "></i><i" + (colours ? " style=\"background:" + colours[1] + "\"" : "") + "></i><i" + (colours ? " style=\"background:" + colours[2] + "\"" : "") + "></i></span>"; }
  // Dates as the game writes them: "MMMM Do, YYYY" in the date widget, "MMM D, YYYY" on pills.
  function parseDate(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || "");
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = /^(\d{1,2}) (\w+) (\d{4})$/.exec(text || "");
    if (m && MONTHS.indexOf(m[2]) >= 0) return new Date(Date.UTC(+m[3], MONTHS.indexOf(m[2]), +m[1]));
    return null;
  }
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function longDate(d) { return MONTHS[d.getUTCMonth()] + " " + ordinal(d.getUTCDate()) + ", " + d.getUTCFullYear(); }
  function shortDate(d) { return MONTHS[d.getUTCMonth()].slice(0, 3) + " " + d.getUTCDate() + ", " + d.getUTCFullYear(); }
  function isoDate(d) { return d.toISOString().slice(0, 10); }
  function chapterDate(step) { var node = document.querySelector(".step[data-step=\"" + step + "\"]"); return parseDate(node && node.getAttribute("data-date")); }
  function dateAt(T, korea) {
    var step = STEPS[Math.max(0, Math.min(STEPS.length - 1, Math.floor(T)))];
    if (step === "korea" && korea > 0) return new Date(Date.UTC(2016, 8, 2) + korea * 5.3 * 86400000);
    return chapterDate(step) || new Date(Date.UTC(2017, 2, 2));
  }
  var CALENDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/></svg>';
  var X_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  // ---- the parts, as the game builds them -----------------------------------------------------------
  function build(root) {
    root.innerHTML =
      // settings.jsx: the game menu
      '<button type="button" class="gx-base gx-menu-btn gx-hud" id="gxMenuBtn" title="Game menu" aria-label="Open game menu" aria-expanded="false">☰</button>' +
      '<div class="gx-menu gx-hud" id="gxMenu" hidden><a href="/play/">▶ Play in your browser</a><a href="#download">⬇ Download the game</a><a href="/wiki/">📖 Wiki</a></div>' +
      // libraryBar.jsx: the session pill and Exit Game
      '<div class="gx-topbar gx-hud"><div class="gx-pill gx-surface"><img src="/play/icon-192.png" alt="Open Historia" /><div class="gx-pill-text"><b>Open Historia</b><small id="gxSession">Modern Day / France / 2016-01-01</small></div></div>' +
      '<a class="gx-exit gx-surface" href="#download">⌂ Exit Game</a></div>' +
      // time.jsx: the date widget
      '<div class="gx-base gx-date gx-hud"><button type="button" class="gx-arrow" id="gxEventsBtn" aria-label="Events" title="Events">«</button>' +
      '<div class="gx-date-mid"><span class="gx-date-country">France</span><span class="gx-date-day" id="gxDate">January 1st, 2016</span></div>' +
      '<button type="button" class="gx-arrow" id="gxSkipBtn" aria-label="Timeline" title="Time skip: on to the next chapter">»</button></div>' +
      // time.jsx PanelChrome: the Events panel and the dock's windows
      '<div class="gx-panel gx-hud" id="gxPanel" hidden><div class="gx-panel-head"><div><div class="gx-panel-title" id="gxPanelTitle">Events</div><div class="gx-panel-sub" id="gxPanelSub"></div></div>' +
      '<button type="button" class="gx-x" id="gxPanelClose" aria-label="Close">' + X_ICON + '</button></div><div class="gx-panel-body" id="gxPanelBody"></div></div>' +
      // chat.jsx Toolbar
      '<div class="gx-base gx-dock gx-hud" role="toolbar" aria-label="Game windows">' +
      '<button type="button" class="gx-launch" data-pop="chat" title="Chat" aria-label="Chat"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg><span class="gx-badge" id="gxChatBadge" hidden></span></button>' +
      '<button type="button" class="gx-launch" data-pop="actions" title="Actions" aria-label="Actions"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L13.5 9.5L21 11L13.5 12.5L12 20L10.5 12.5L3 11L10.5 9.5L12 2Z"/></svg></button>' +
      '<button type="button" class="gx-launch" data-pop="projects" title="Projects &amp; Operations" aria-label="Projects and operations"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/></svg></button></div>' +
      // search.jsx
      '<button type="button" class="gx-base gx-search gx-hud" id="gxSearch" title="Search place" aria-label="Search place"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="text" placeholder="Search place…" aria-label="Search place" hidden /></button>' +
      // other.jsx flag badge, main.jsx AdvisorButton
      '<button type="button" class="gx-base gx-flag-btn gx-hud" id="gxFlagBtn" title="France" aria-label="Country">' + tricolour() + '</button>' +
      '<button type="button" class="gx-base gx-advisor-btn gx-hud" id="gxAdvisorBtn" title="Advisor" aria-label="Advisor"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M4.5 21c.8-4.2 3.3-6.3 7.5-6.3s6.7 2.1 7.5 6.3"/></svg></button>' +
      // advisor.jsx
      '<aside class="gx-drawer gx-hud" id="gxAdvisor" aria-label="Advisor"><span class="gx-grip"></span>' +
      '<div class="gx-drawer-head"><span class="ic">🧭</span><b>Advisor</b><span class="sp"></span><button type="button" class="gx-hbtn" id="gxClear" title="Clear chat" aria-label="Clear chat">🗑</button><button type="button" class="gx-hbtn close" data-close aria-label="Close">✕</button></div>' +
      '<div class="gx-msgs" id="gxMsgs" aria-live="polite"></div>' +
      '<form class="gx-composer" id="gxAsk"><textarea rows="1" placeholder="Ask your advisor…  (Shift+Enter for a new line)" aria-label="Ask your advisor"></textarea><button type="submit" class="gx-send" aria-label="Send">🚀</button></form></aside>' +
      // countryPanel.jsx + stats.jsx
      '<aside class="gx-drawer gx-hud" id="gxCountry" aria-label="Country"><span class="gx-grip"></span>' +
      '<div class="gx-drawer-head"><span class="ic">🏳</span><div><b>Country</b><small>Politics, diplomacy and national statistics</small></div><span class="sp"></span><button type="button" class="gx-hbtn close" data-close aria-label="Close">✕</button></div>' +
      '<div class="gx-stats"><div class="gx-nation"><span class="gx-nation-flag">' + tricolour() + '</span><div style="flex:1;min-width:0"><div class="gx-nation-name"><b>France</b><span class="gx-yours">Your country</span></div>' +
      '<div class="l1">Paris · Europe</div><div class="l2">Semi-presidential republic</div><div class="l3">Leader: President of the Republic</div>' +
      '<div class="gx-chips"><span class="gx-chip-tier">Great power</span><span class="gx-chip-tag">Security Council</span><span class="gx-chip-tag">European Union</span><span class="gx-chip-tag">NATO</span></div></div></div>' +
      '<div class="gx-subtabs"><button type="button" class="gx-subtab" data-view="politics">🏛 Politics</button><button type="button" class="gx-subtab" data-view="diplomacy">🤝 Diplomacy</button><button type="button" class="gx-subtab" data-view="economy">📈 Economy</button><button type="button" class="gx-subtab" data-view="ranking">🏆 Ranking</button></div>' +
      '<div id="gxView"></div></div></aside>' +
      // main.jsx WarRoomButton
      '<button type="button" class="gx-base gx-war-btn" id="gxWarBtn" title="War room" aria-label="War room" hidden><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="rgba(255,214,214,0.5)" stroke-width="2.1" transform="translate(0.45 0.6)"><path d="M5 4l12.5 12.5M16 19l3-3M18.2 17.8l2 2"/><path d="M19 4L6.5 16.5M8 19l-3-3M5.8 17.8l-2 2"/></g><g stroke="rgba(34,4,6,0.88)" stroke-width="2.1"><path d="M5 4l12.5 12.5M16 19l3-3M18.2 17.8l2 2"/><path d="M19 4L6.5 16.5M8 19l-3-3M5.8 17.8l-2 2"/></g></svg></button>' +
      // warRoom.jsx: the frame round the map, the rail, the drawer
      '<div class="wr" id="gxWar" hidden>' +
      '<div class="wr-frame-top wr-plate"><span class="wr-rivet" style="left:0.45rem;bottom:0.75rem"></span><span class="wr-rivet" style="right:0.45rem;bottom:0.75rem"></span><span class="wr-stencil name">Korean Peninsula</span><span class="wr-stencil sides">South Korea against North Korea</span><span class="sp"></span><span class="wr-stencil date" id="wrDate"></span></div>' +
      '<div class="wr-frame-left wr-plate"></div><div class="wr-frame-bottom wr-plate"></div>' +
      '<div class="wr-rail wr-plate" id="wrRail"></div>' +
      '<aside class="wr-drawer wr-plate" aria-label="War Room"><div class="wr-head"><span class="wr-rivet" style="left:.4rem;top:.4rem"></span><span class="wr-rivet" style="left:.4rem;bottom:.4rem"></span><span class="wr-rivet" style="right:.4rem;top:.4rem"></span><span class="wr-rivet" style="right:.4rem;bottom:.4rem"></span>' +
      '<span class="wr-stencil title">War Room</span><span class="sp"></span>' +
      '<button type="button" class="wr-key" id="wrFit" title="Show the whole battlefield" aria-label="Show the whole battlefield" style="padding:0.42rem 0.5rem"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>' +
      '<button type="button" class="wr-key" id="wrClose" title="Close the war room" aria-label="Close the war room" style="padding:0.42rem 0.55rem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div>' +
      '<div class="wr-info"><div class="wr-soft">Nothing moves here: orders are carried out when time next passes. The troop tools are on the left of the map.</div></div>' +
      '<div class="wr-scroll" id="wrBody"></div>' +
      '<div class="wr-talk"><div class="wr-lines" id="wrLines"></div><form class="wr-form wr-plate" id="wrAsk"><textarea rows="2" placeholder="Speak to your generals…" aria-label="Speak to your generals"></textarea>' +
      '<button type="submit" class="wr-key on" aria-label="Send"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form></div></aside></div>';
  }

  // ---- the Advisor drawer ---------------------------------------------------------------------------
  function messageHtml(who, text, date) {
    if (who === "u") return '<div class="gx-msg user"><div class="gx-bubble">' + esc(text) + "</div></div>";
    return '<div class="gx-msg"><span class="gx-msg-label">🧭 Advisor</span><div class="gx-bubble">' + (text === null ? '<span class="gx-thinking">Thinking' + ".".repeat(Math.floor(Date.now() / 500) % 4) + "</span>" : esc(text)) + "</div>" + (date ? '<span class="gx-msg-time">' + date + "</span>" : "") + "</div>";
  }
  function renderAdvisor(T) {
    var shown = ADVISOR.filter(function (m) { return m[0] <= T; });
    var next = ADVISOR[shown.length];
    var thinking = next && next[1] === "a" && T > next[0] - 0.05;
    var parts = shown.map(function (m) {
      var d = chapterDate(STEPS[Math.min(STEPS.length - 1, Math.floor(m[0]))]);
      return [m[1], typed(m[2], m[0], m[3], T), m[1] === "a" && d ? shortDate(d) : ""];
    });
    var key = parts.map(function (p) { return p[1].length; }).join(",") + (thinking ? "…" + Math.floor(Date.now() / 500) % 4 : "") + "|" + state.extra.map(function (m) { return m[1] === null ? "?" : "!"; }).join("");
    if (!changed("advisor", key)) return;
    var html = parts.length || state.extra.length ? "" : '<p class="gx-none">No messages yet. Ask your advisor something!</p>';
    parts.forEach(function (p) { html += messageHtml(p[0], p[1], p[2]); });
    if (thinking) html += messageHtml("a", null);
    state.extra.forEach(function (m) { html += messageHtml(m[0], m[1]); });
    el.msgs.innerHTML = html;
    el.msgs.scrollTop = el.msgs.scrollHeight;
  }
  function ask(event) {
    event.preventDefault();
    var input = el.ask.querySelector("textarea");
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    state.extra.push(["u", text]);
    var reply = ["a", null];
    state.extra.push(reply);
    setTimeout(function () {
      reply[1] = "In the game I would answer that, and the world would answer you. Here the story is already written: download Open Historia, or play it in your browser, and ask me again.";
      state.keys.advisor = "";
      renderAdvisor(state.T);
    }, 1400);
    renderAdvisor(state.T);
  }

  // ---- the Country drawer (stats.jsx) -------------------------------------------------------------------
  function figuresAt(T) {
    var x = Math.max(0, T - 0.5);
    var i = Math.min(FIGURES.length - 1, Math.floor(x));
    var j = Math.min(FIGURES.length - 1, i + 1);
    var e = smooth(clamp(x - i));
    var out = {};
    for (var key in FIGURES[i]) out[key] = FIGURES[i][key] + (FIGURES[j][key] - FIGURES[i][key]) * e;
    return out;
  }
  function bar(value, colour) { return '<div class="gx-bar"><i style="width:' + Math.max(0, Math.min(100, value)).toFixed(1) + "%;background-color:" + colour + '"></i></div>'; }
  function stabilityColour(v) { return v < 40 ? "#ef4444" : v < 70 ? "#f59e0b" : "#22c55e"; }
  function relationTone(v) {
    if (v >= 55) return ["Friendly", "#34d399"];
    if (v >= 20) return ["Cordial", "#60a5fa"];
    if (v >= -10) return ["Neutral", "#d1d1d5"];
    if (v >= -30) return ["Cautious", "#fbbf24"];
    if (v >= -60) return ["Strained", "#fb923c"];
    return ["Hostile", "#f87171"];
  }
  function signed(v, digits) { return (v >= 0 ? "+" : "") + v.toFixed(digits); }
  function renderCountry(T) {
    var v = figuresAt(T);
    var key = state.view + ":" + Object.keys(v).map(function (k) { return Math.round(v[k] * 10); }).join(",");
    if (!changed("country", key)) return;
    Array.prototype.forEach.call(el.country.querySelectorAll(".gx-subtab"), function (b) { b.classList.toggle("on", b.getAttribute("data-view") === state.view); });
    var html = "";
    if (state.view === "economy") {
      html += '<div class="gx-cardbox" style="margin-top:1rem"><div class="gx-row"><span class="cap">⚠ National stability</span><span class="val">' + Math.round(v.stability) + "/100</span></div>" + bar(v.stability, stabilityColour(v.stability)) + "</div>";
      html += '<div class="gx-cardbox" style="margin-top:0.6rem"><div class="gx-row"><span class="cap">🕵 Intelligence service</span><span class="val">' + Math.round(v.intel) + "/100</span></div>" + bar(v.intel, "#38bdf8") + "</div>";
      html += '<div class="gx-section">⚑ Strategic indices</div><div class="gx-indices">';
      INDICES.forEach(function (row) {
        html += '<div class="gx-cardbox"><div class="gx-row"><span class="lab">' + row[0] + " " + row[1] + '</span><span class="pct">' + Math.round(v[row[2]]) + "%</span></div>" + bar(v[row[2]], row[3]) + "</div>";
      });
      html += '</div><div class="gx-section">👥 Population</div><div class="gx-cardbox gx-pop"><div class="k">Total population</div><div class="v">' + v.population.toFixed(1) + "M</div></div>";
      html += '<div class="gx-section">📈 Economy</div><div class="gx-econ">';
      var cards = [
        ["GDP", "€" + v.gdp.toFixed(2) + "T", "Growth " + signed(v.growth, 1) + "% · 2016-EUR eq.", "#34d399"],
        ["GDP/capita", "€" + (Math.round(v.gdpc / 10) * 10).toLocaleString("en"), "Whole polity", "#e7e7e9"],
        ["Inflation", v.inflation.toFixed(1) + "%", "", "#34d399"],
        ["Unemployment", v.unemployment.toFixed(1) + "%", "", "#34d399"],
        ["Public debt", v.debt.toFixed(1) + "%", "of GDP", "#34d399"],
        ["Budget balance", signed(v.balance, 1) + "%", (v.balance < 0 ? "Deficit" : "Surplus") + " · of GDP", v.balance < 0 ? "#f87171" : "#34d399"]
      ];
      cards.forEach(function (c) { html += '<div class="gx-cardbox"><div class="k">' + c[0] + '</div><div class="v" style="color:' + c[3] + '">' + c[1] + "</div>" + (c[2] ? '<div class="s">' + c[2] + "</div>" : "") + "</div>"; });
      html += '</div><div class="gx-currency">Domestic currency: EUR · GDP accounting shown in 2016-EUR-equivalent values.</div>';
      html += '<div class="gx-cardbox gx-gdp"><div class="t">GDP breakdown</div><div class="stack"><i style="width:2%;background:#22c55e"></i><i style="width:19%;background:#3b82f6"></i><i style="width:79%;background:#f59e0b"></i></div>' +
        '<div class="legend"><span><i style="background:#22c55e"></i>Agriculture 2%</span><span><i style="background:#3b82f6"></i>Industry 19%</span><span><i style="background:#f59e0b"></i>Services 79%</span></div></div>';
    } else if (state.view === "diplomacy") {
      var conflicts = 0;
      html += '<div class="gx-section">🤝 Diplomacy</div><div class="gx-dipl">' +
        '<div class="gx-cardbox"><div class="k">Relations</div><div class="v" style="color:#60a5fa">' + RELATIONS.length + "</div></div>" +
        '<div class="gx-cardbox"><div class="k">Active agreements</div><div class="v" style="color:#34d399">' + Math.round(v.agreements) + "</div></div>" +
        '<div class="gx-cardbox"><div class="k">Conflicts</div><div class="v" style="color:' + (conflicts ? "#f87171" : "#94a3b8") + '">' + conflicts + "</div></div></div>";
      html += '<div class="gx-cardbox gx-rels"><div class="gx-rels-head">Bilateral relations<small>−100 to +100</small></div>';
      RELATIONS.forEach(function (r) {
        var score = Math.round(v[r[0]]);
        var tone = relationTone(score);
        var left = score < 0 ? 50 + score / 2 : 50;
        html += '<div class="gx-rel"><div class="gx-rel-top"><span>' + r[1] + '</span><span class="gx-status" style="background-color:' + tone[1] + "1f;border:1px solid " + tone[1] + "66;color:" + tone[1] + '">' + tone[0] + '</span><b style="color:' + tone[1] + '">' + signed(score, 0) + "</b></div>" +
          '<div class="gx-meter"><i style="left:' + left.toFixed(1) + "%;width:" + (Math.abs(score) / 2).toFixed(1) + "%;background:" + tone[1] + '"></i></div></div>';
      });
      html += '</div><div class="gx-note">Click any country on the map to inspect it.</div>';
    } else if (state.view === "politics") {
      html += '<div class="gx-section">🏛 Government</div><div class="gx-cardbox"><div class="gx-row"><span class="lab">Semi-presidential republic</span></div><div class="wr-soft" style="color:rgba(255,255,255,0.55)">Head of state: President of the Republic · Head of government: Prime Minister</div></div>';
      html += '<div class="gx-cardbox" style="margin-top:0.6rem"><div class="gx-row"><span class="cap">Public approval</span><span class="val">' + Math.round(v.stability * 0.82) + '%</span></div>' + bar(v.stability * 0.82, stabilityColour(v.stability)) + "</div>";
      html += '<div class="gx-section">🗳 Assemblée nationale · 577 seats</div><div class="gx-cardbox"><div class="gx-seats"><i style="width:17%;background:#c0392b"></i><i style="width:50%;background:#3b82f6"></i><i style="width:20%;background:#f59e0b"></i><i style="width:13%;background:#64748b"></i></div>' +
        '<div class="gx-gdp" style="margin:0"><div class="legend"><span><i style="background:#c0392b"></i>Left 98</span><span><i style="background:#3b82f6"></i>Governing majority 289</span><span><i style="background:#f59e0b"></i>Right 115</span><span><i style="background:#64748b"></i>Others 75</span></div></div></div>';
      if (state.T >= 7) html += '<div class="gx-cardbox" style="margin-top:0.6rem"><div class="gx-row"><span class="lab">Vote: the Congress of Strasbourg</span><span class="pct" style="color:#34d399">Passed</span></div><div class="wr-soft" style="color:rgba(255,255,255,0.55)">341 for · 156 against · 80 abstaining</div></div>';
    } else {
      html += '<div class="gx-section">🏆 Ranking · GDP</div><div class="gx-cardbox" style="padding:0">';
      RANKING.forEach(function (r, i) {
        var value = r[0] === "France" ? v.gdp : r[1];
        html += '<div class="gx-rank' + (r[0] === "France" ? " me" : "") + '"><em>' + (i + 1) + "</em><span>" + r[0] + "</span><b>€" + value.toFixed(2) + "T</b></div>";
      });
      html += "</div>";
    }
    el.view.innerHTML = html;
  }

  // ---- the Events panel and the dock's windows ----------------------------------------------------------
  function eventCard(e) {
    var d = parseDate(e[1]);
    return '<div class="gx-card"><div class="gx-card-head"><span class="gx-metric">' + CALENDAR + (d ? shortDate(d) : "") + '</span></div><div class="gx-card-body"><div class="gx-tags">' +
      e[2].map(function (t) { return '<span class="gx-tag">' + t + "</span>"; }).join("") + e[5].map(function (p) { return '<span class="gx-link"><i>⚑</i>' + p + "</span>"; }).join("") +
      '</div><div class="gx-card-title">' + esc(e[3]) + '</div><div class="gx-card-text"><p>' + bold(e[4]) + "</p></div></div></div>";
  }
  function renderPanel(T) {
    var which = state.pop;
    if (!which) return;
    var title = "", sub = "", html = "";
    if (which === "events") {
      var shown = EVENTS.filter(function (e) { return e[0] <= T; });
      var later = EVENTS.length - shown.length;
      title = "Events";
      sub = "Jan 1, 2016 -> " + shortDate(dateAt(T, state.korea));
      html = shown.length ? shown.slice().reverse().map(eventCard).join("") : '<div class="gx-empty-box">No world events were recorded for this time skip.</div>';
      html += '<button type="button" class="gx-ghost" data-go="next"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>Next event</button>';
      if (later) html += '<button type="button" class="gx-ghost" data-go="end" style="min-height:1.9rem;opacity:0.75">Skip to end (' + later + " more)</button>";
    } else if (which === "chat") {
      title = "Chat";
      sub = "Diplomatic correspondence";
      CHATS.forEach(function (thread) {
        var lines = thread.lines.filter(function (l) { return l[0] <= T; });
        html += '<div class="gx-card"><div class="gx-card-head"><span class="gx-thread-head">' + tricolour(thread.flag) + thread.with + '</span></div><div class="gx-card-body gx-thread">' +
          (lines.length ? lines.map(function (l) { return '<div class="gx-msg' + (l[1] === "u" ? " user" : "") + '"><div class="gx-bubble">' + esc(typed(l[2], l[0], 0.06, T)) + "</div></div>"; }).join("") : '<div class="gx-card-text">No messages yet.</div>') +
          "</div></div>";
      });
    } else if (which === "actions") {
      title = "Actions";
      sub = "Carried out when time next passes";
      var done = T >= 5;
      var items = [];
      if (T >= 1.3) items.push(["Put the forces of deterrence on alert", done ? "Carried out" : "Queued"]);
      if (T >= 4.15) items.push([typed(ORDER, 4.15, 0.22, T), done ? "Carried out" : T >= 4.4 ? "Queued" : "Writing…"]);
      html = items.length ? items.map(function (item) {
        return '<div class="gx-action"><p>' + esc(item[0]) + (item[1] === "Writing…" ? '<span class="gx-caret"></span>' : "") + '</p><small class="' + (item[1] === "Carried out" ? "ok" : "") + '">' + item[1] + "</small></div>";
      }).join("") : '<div class="gx-empty-box">Nothing ordered this turn. Write what France does, in your own words.</div>';
    } else if (which === "projects") {
      title = "Projects & Operations";
      sub = "What France is working at, turn by turn";
      var congress = clamp((T - 4.4) / 3.9);
      var deterrence = T >= 1.3 ? (T >= 8.3 ? "Stood down" : "Active") : "";
      html = '<div class="gx-action gx-project"><p><strong>The Congress of Strasbourg</strong></p><small class="' + (congress >= 1 ? "ok" : "") + '">' + (congress >= 1 ? "Complete" : T >= 4.4 ? "In progress · " + Math.round(congress * 100) + "%" : "Not begun") + "</small>" + bar(congress * 100, congress >= 1 ? "#34d399" : "#3b82f6") + "</div>";
      if (deterrence) html += '<div class="gx-action gx-project"><p><strong>Deterrence alert</strong> · Forces on alert across the Republic</p><small class="' + (deterrence === "Stood down" ? "ok" : "") + '">' + deterrence + "</small></div>";
    }
    var key = which + title + sub + html;
    if (!changed("panel", key)) return;
    el.panelTitle.textContent = title;
    el.panelSub.textContent = sub;
    el.panelBody.innerHTML = html;
  }
  function setPop(which, byHand) {
    if (byHand) state.manual.pop = which || "none";
    if (state.pop === which) return;
    state.pop = which;
    state.keys.panel = "";
    el.panel.hidden = !which;
    el.eventsBtn.classList.toggle("on", which === "events");
    Array.prototype.forEach.call(el.root.querySelectorAll("[data-pop]"), function (b) { b.classList.toggle("on", b.getAttribute("data-pop") === which); });
    renderPanel(state.T);
  }
  function setDrawer(which, byHand) {
    if (byHand) state.manual.drawer = which || "none";
    state.drawer = which;
    el.advisor.classList.toggle("open", which === "advisor");
    el.country.classList.toggle("open", which === "country");
    el.advisorBtn.classList.toggle("on", which === "advisor");
    el.flagBtn.classList.toggle("on", which === "country");
    el.root.classList.toggle("drawer-open", !!which);
    if (which === "advisor") state.keys.advisor = "";
  }
  function setView(view, byHand) {
    if (byHand) state.manual.view = view;
    if (state.view === view) return;
    state.view = view;
    state.keys.country = "";
  }

  // ---- the War Room ---------------------------------------------------------------------------------------
  function renderWar(T, korea) {
    var regions = (opts.order || []).map(function (id) { return opts.regionNames[id]; });
    var k = Math.max(0, korea || 0);
    if (!changed("war", k + ":" + state.tool + ":" + state.talk.length)) return;
    var lost = Math.min(k, regions.length);
    var next = regions[lost] || "Busan";
    var after = regions[lost + 1] || "Busan";
    var heading = function (text) { return '<div class="wr-heading"><span class="wr-stencil">' + text + "</span><i></i></div>"; };
    var html = heading("Your generals");
    GENERALS.forEach(function (g, i) {
      var left = Math.max(1, g[2] - Math.floor((k + i) / 5));
      var strength = Math.max(18, 92 - k * 4 - i * 3);
      var lit = state.tool === "Select" && i === 0;
      html += '<div class="wr-general wr-tray' + (lit ? " lit" : "") + '"><span class="wr-num"' + (lit ? ' style="background:#c9a54c;color:#1c1608"' : "") + ">" + (i + 1) + '</span><div class="who"><b>' + g[0] + ' <span class="wr-stencil army">' + g[1] + '</span></b><div class="wr-soft">' + left + " formations at " + strength + "% · holding the line before " + esc(next) + '</div><div class="orders">Ordered: ' + (i % 2 ? "Dig in" : "Fall back toward " + esc(after)) + '</div></div><button type="button" class="wr-link">Pick</button></div>';
    });
    html += heading("Weather ahead") + '<div class="wr-soft" style="margin-top:0.3rem">' + WEATHER[Math.min(WEATHER.length - 1, Math.floor(k / 4))] + ".</div>";
    html += heading("Planned movements");
    html += k >= regions.length ? '<div class="wr-plan wr-tray"><span class="dash" style="background:#93a1b5"></span><div class="what"><b>Hold around Busan</b><div class="wr-soft">Hold what is left until the armistice.</div></div></div>' :
      '<div class="wr-plan wr-tray"><span class="dash" style="background:#f4f7fb"></span><div class="what"><b>Fall back from ' + esc(next) + '</b><div class="wr-soft">To a line before ' + esc(after) + '.</div><div class="links"><button type="button" class="wr-link">Redraw</button><button type="button" class="wr-link">Hold it back</button><button type="button" class="wr-link">Pick its troops</button></div></div></div>' +
      '<div class="wr-plan wr-tray"><span class="dash" style="background:#2bc1f3"></span><div class="what"><b>Dig in on the Nakdong</b><div class="wr-soft">East of Daegu, the Board\'s operation.</div><div class="links"><button type="button" class="wr-link">Redraw</button><button type="button" class="wr-link">Call it off</button></div></div></div>';
    html += heading("What is known of theirs") + '<div class="wr-plan wr-tray"><span class="dash" style="background:#ff6b6b"></span><div class="what"><div class="wr-soft">' + (k >= regions.length ? "The North holds the peninsula to the sea." : "Aimed at " + esc(next) + ", with about " + (6 + (k % 3)) + " formations sent forward.") + "</div></div></div>";
    el.warBody.innerHTML = html;
    el.warDate.textContent = longDate(dateAt(T, korea));
    el.warLines.innerHTML = state.talk.length ? state.talk.map(function (line) {
      return '<div class="wr-line' + (line[0] === "u" ? " own" : "") + '">' + (line[0] === "u" ? "" : '<span class="wr-stencil name">General Han Ji-ho <em>· 1st Army</em></span>') + '<div class="wr-bubble">' + esc(line[1]) + "</div></div>";
    }).join("") : '<div class="wr-soft" style="font-size:0.78rem;line-height:1.45">Speak to your generals. Tell them what you want done and they will say what they think of it; an order they accept is carried out when time next passes.</div>';
    el.warLines.scrollTop = el.warLines.scrollHeight;
  }
  function renderRail() {
    var html = '<span class="wr-rivet" style="left:0.25rem"></span><span class="wr-rivet" style="right:0.25rem"></span><span class="wr-stencil lbl">Troops</span><span class="wr-count">14</span><span class="wr-rule"></span>';
    RAIL.forEach(function (key) {
      if (!key) { html += '<span class="wr-rule"></span>'; return; }
      html += '<button type="button" class="wr-railkey' + (state.tool === key[0] ? " on" : "") + '" data-tool="' + key[0] + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + key[1] + "</svg>" + key[0] + "</button>";
    });
    el.rail.innerHTML = html;
  }
  function setWar(open, byHand) {
    if (byHand) state.manual.war = open ? "open" : "shut";
    if (state.war === open) return;
    state.war = open;
    el.war.hidden = !open;
    el.root.classList.toggle("war-open", open);
    state.keys.war = "";
  }
  function warSay(event) {
    event.preventDefault();
    var input = el.warAsk.querySelector("textarea");
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    state.talk.push(["u", text]);
    renderWar(state.T, state.korea);
    setTimeout(function () {
      state.talk.push(["g", "Understood, Excellency. In the game we would answer you properly, push back if we must, and take your orders. Here the front is already drawn."]);
      renderWar(state.T, state.korea);
    }, 1200);
  }

  // ---- the chapters, as the game's event cards ------------------------------------------------------------
  function dressChapters() {
    Array.prototype.forEach.call(document.querySelectorAll(".step[data-step]"), function (step) {
      var card = step.querySelector(".chapter");
      if (!card || card.querySelector(".gx-card-head")) return;
      var d = parseDate(step.getAttribute("data-date"));
      var tags = TAGS[step.getAttribute("data-step")] || [];
      var head = document.createElement("div");
      head.className = "gx-card-head";
      head.innerHTML = '<span class="gx-metric">' + CALENDAR + (d ? shortDate(d) : esc(step.getAttribute("data-date") || "")) + "</span>";
      var body = document.createElement("div");
      body.className = "ev-body";
      if (tags.length) body.innerHTML = '<div class="gx-tags">' + tags.map(function (t) { return '<span class="gx-tag">' + t + "</span>"; }).join("") + "</div>";
      while (card.firstChild) body.appendChild(card.firstChild);
      card.appendChild(head);
      card.appendChild(body);
    });
  }

  // ---- each frame -------------------------------------------------------------------------------------------
  function update(T, step, extra) {
    if (!el.root) return;
    state.T = T;
    state.korea = extra && extra.korea >= 0 ? extra.korea : 0;
    if (step !== state.step) {
      state.step = step;
      state.manual = {};
      setDrawer(DRAWER[step] || "advisor");
      if (VIEW[step]) setView(VIEW[step]);
    }
    // What the chapter opens, unless the reader has chosen.
    if (!state.manual.pop) setPop(POP[step] || null);
    var atWar = T >= 1 && T < 3;
    el.warBtn.hidden = !atWar;
    el.root.classList.toggle("at-war", atWar);
    if (!atWar) setWar(false);
    else if (!state.manual.war) setWar(step === "korea" && T > 2.3 && T < 2.9);
    var date = dateAt(T, state.korea);
    if (changed("date", isoDate(date))) {
      el.date.textContent = step === "yours" ? "Your turn" : longDate(date);
      el.session.textContent = "Modern Day / France / " + isoDate(date);
    }
    if (state.drawer === "advisor") renderAdvisor(T);
    if (state.drawer === "country") renderCountry(T);
    renderPanel(T);
    var chats = CHATS.reduce(function (n, t) { return n + t.lines.filter(function (l) { return l[0] <= T && l[1] === "t"; }).length; }, 0);
    if (state.pop === "chat") state.seenChats = chats;
    var unread = Math.max(0, chats - state.seenChats);
    el.chatBadge.hidden = !unread;
    el.chatBadge.textContent = unread > 9 ? "9+" : String(unread);
    if (state.war) renderWar(T, state.korea);
  }

  function init(options) {
    opts = options || {};
    el.root = $("gameUi");
    if (!el.root) return;
    build(el.root);
    var plate = pixelsUrl(256, roughMetalPixels(256));
    var rivet = pixelsUrl(28, rivetPixels(28));
    var brushed = pixelsUrl(160, brushedMetalPixels(160));
    if (plate) el.root.style.setProperty("--plate", "url(" + plate + ")");
    var sheet = document.createElement("style");
    sheet.textContent = (plate ? ".wr-plate{background-image:url(" + plate + ")}" : "") + (rivet ? ".wr-rivet{background-image:url(" + rivet + ")}" : "") + (brushed ? ".gx-war-btn{background-image:url(" + brushed + ")}" : "");
    document.head.appendChild(sheet);
    ["msgs", "ask", "panel", "panelTitle", "panelSub", "panelBody", "date", "session", "chatBadge", "warBtn"].forEach(function (name) { el[name] = $("gx" + name.charAt(0).toUpperCase() + name.slice(1)); });
    el.advisor = $("gxAdvisor");
    el.country = $("gxCountry");
    el.view = $("gxView");
    el.advisorBtn = $("gxAdvisorBtn");
    el.flagBtn = $("gxFlagBtn");
    el.eventsBtn = $("gxEventsBtn");
    el.war = $("gxWar");
    el.warBody = $("wrBody");
    el.warLines = $("wrLines");
    el.warAsk = $("wrAsk");
    el.warDate = $("wrDate");
    el.rail = $("wrRail");
    renderRail();
    dressChapters();

    el.advisorBtn.addEventListener("click", function () { setDrawer(state.drawer === "advisor" ? null : "advisor", true); });
    el.flagBtn.addEventListener("click", function () { setDrawer(state.drawer === "country" ? null : "country", true); });
    Array.prototype.forEach.call(el.root.querySelectorAll("[data-close]"), function (b) { b.addEventListener("click", function () { setDrawer(null, true); }); });
    $("gxClear").addEventListener("click", function () { state.extra = []; state.keys.advisor = ""; renderAdvisor(state.T); });
    el.ask.addEventListener("submit", ask);
    el.ask.querySelector("textarea").addEventListener("keydown", function (event) { if (event.key === "Enter" && !event.shiftKey) ask(event); });
    el.country.querySelector(".gx-subtabs").addEventListener("click", function (event) {
      var button = event.target.closest("[data-view]");
      if (button) { setView(button.getAttribute("data-view"), true); renderCountry(state.T); }
    });
    el.root.querySelector(".gx-dock").addEventListener("click", function (event) {
      var button = event.target.closest("[data-pop]");
      if (button) setPop(state.pop === button.getAttribute("data-pop") ? null : button.getAttribute("data-pop"), true);
    });
    el.eventsBtn.addEventListener("click", function () { setPop(state.pop === "events" ? null : "events", true); });
    $("gxPanelClose").addEventListener("click", function () { setPop(null, true); });
    el.panelBody.addEventListener("click", function (event) {
      var go = event.target.closest("[data-go]");
      if (!go) return;
      opts.goTo(go.getAttribute("data-go") === "end" ? STEPS.length - 1 : Math.floor(state.T) + 1);
    });
    // » is the time skip: on to the next chapter.
    $("gxSkipBtn").addEventListener("click", function () { opts.goTo(Math.floor(state.T) + 1); });
    var menuButton = $("gxMenuBtn");
    var menu = $("gxMenu");
    menuButton.addEventListener("click", function () { menu.hidden = !menu.hidden; menuButton.setAttribute("aria-expanded", String(!menu.hidden)); });
    var search = $("gxSearch");
    search.addEventListener("click", function () {
      if (search.classList.contains("open")) return;
      search.classList.add("open");
      var input = search.querySelector("input");
      input.hidden = false;
      input.focus();
    });
    search.querySelector("input").addEventListener("blur", function (event) { if (!event.target.value) { search.classList.remove("open"); event.target.hidden = true; } });
    el.warBtn.addEventListener("click", function () { setWar(!state.war, true); });
    $("wrClose").addEventListener("click", function () { setWar(false, true); });
    $("wrFit").addEventListener("click", function () { opts.goTo(2); });
    el.warAsk.addEventListener("submit", warSay);
    el.rail.addEventListener("click", function (event) {
      var key = event.target.closest("[data-tool]");
      if (!key) return;
      state.tool = state.tool === key.getAttribute("data-tool") ? "" : key.getAttribute("data-tool");
      renderRail();
      state.keys.war = "";
      renderWar(state.T, state.korea);
    });
    setDrawer("advisor");
  }

  window.OH_GAME_UI = { init: init, update: update };
})();
