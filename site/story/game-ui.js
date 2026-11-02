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
    [0.6, "u", "And where does our money come from?", 0.02],
    [0.66, "a", "From Europe, mostly. Where French exports went last year:", 0.03, { type: "pie", data: { labels: ["Germany", "Spain", "Italy", "United States", "Belgium", "United Kingdom", "Other"], datasets: [{ label: "Share of exports", data: [16, 8, 8, 7, 7, 7, 47] }] }, options: { unit: "percent" } }],
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
    [9.12, "u", "How did the year go?", 0.02],
    [9.18, "a", "Stability fell with the launches and came back with the congress. Your reputation never stopped climbing.", 0.04, { type: "line", data: { labels: ["Jan '16", "Aug", "Sep", "Dec", "Jan '17", "Feb", "Mar"], datasets: [{ label: "National stability", data: [68, 52, 47, 43, 50, 58, 66] }, { label: "International reputation", data: [64, 64, 62, 68, 79, 81, 90] }] }, options: {} }],
    [9.3, "a", "That was one year of one campaign. What would you like to do next?"]
  ];
  // The diplomatic chats: [T, who ("u" is France), text].
  var CHATS = [
    { with: "China", leader: "The President of China", flag: ["#de2910", "#de2910", "#de2910"], lines: [
      [4.6, "u", "Will you bring Pyongyang to Strasbourg?"],
      [5.25, "t", "China will bring its neighbour. It asks only that the armistice line be the one held on the day of signing."]
    ] },
    { with: "United States", leader: "The President of the United States", flag: ["#3c3b6e", "#ffffff", "#b22234"], lines: [
      [5.2, "t", "Washington accepts Strasbourg. The Secretary of State will lead our delegation."],
      [6.5, "u", "Then we will see you in February."]
    ] },
    { with: "Russia", leader: "The President of Russia", flag: ["#ffffff", "#0039a6", "#d52b1e"], lines: [
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
  var DRAWER = { world: "advisor", launch: "advisor", korea: "advisor", choose: "country", order: "advisor", skip: "country", talks: "advisor", parliament: "country", congress: "advisor", yours: "advisor" };
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
  var state = { T: 0, step: "", drawer: null, view: "economy", pop: null, war: false, manual: {}, extra: [], keys: {}, tool: "", talk: [] };
  function $(id) { return document.getElementById(id); }
  // useIsMobile: the game's phone layout below 700px.
  function phone() { return !!(window.matchMedia && window.matchMedia("(max-width: 700px)").matches); }
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
      '<div class="gx-date-mid"><button type="button" class="gx-date-country" id="gxCountryName" title="France · Open country panel">France</button><span class="gx-date-day" id="gxDate">January 1st, 2016</span></div>' +
      '<button type="button" class="gx-arrow" id="gxSkipBtn" aria-label="Timeline" title="Time skip: on to the next chapter">»</button></div>' +
      // time.jsx PanelChrome: the Events panel and the dock's windows
      '<div class="gx-panel gx-hud" id="gxPanel" hidden><div class="gx-panel-head"><div><div class="gx-panel-title" id="gxPanelTitle">Events</div><div class="gx-panel-sub" id="gxPanelSub"></div></div>' +
      '<button type="button" class="gx-x" id="gxPanelClose" aria-label="Close">' + X_ICON + '</button></div><div class="gx-panel-body" id="gxPanelBody"></div></div>' +
      // chat.jsx: the Diplomacy panel
      '<div class="dp gx-hud" id="gxDip" hidden></div>' +
      // chat.jsx Toolbar
      '<div class="gx-base gx-dock gx-hud" role="toolbar" aria-label="Game windows">' +
      '<button type="button" class="gx-launch" data-pop="chat" title="Chat" aria-label="Diplomacy"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg><span class="gx-badge" id="gxChatBadge" hidden></span></button>' +
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
      '<span class="wr-stencil title">War Room<small class="wr-sides">South Korea against North Korea</small></span><span class="sp"></span>' +
      '<button type="button" class="wr-key wr-fold" id="wrFold" aria-label="Show the map">Map</button>' +
      '<button type="button" class="wr-key" id="wrFit" title="Show the whole battlefield" aria-label="Show the whole battlefield" style="padding:0.42rem 0.5rem"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>' +
      '<button type="button" class="wr-key" id="wrClose" title="Close the war room" aria-label="Close the war room" style="padding:0.42rem 0.55rem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div>' +
      '<div class="wr-info"><div class="wr-soft">Nothing moves here: orders are carried out when time next passes. The troop tools are on the left of the map.</div></div>' +
      '<div class="wr-scroll" id="wrBody"></div>' +
      '<div class="wr-talk"><div class="wr-lines" id="wrLines"></div><form class="wr-form wr-plate" id="wrAsk"><textarea rows="2" placeholder="Speak to your generals…" aria-label="Speak to your generals"></textarea>' +
      '<button type="submit" class="wr-key on" aria-label="Send"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form></div></aside></div>' +
      // stats.jsx AdvancedStatsModal
      '<div class="as-back" id="gxAdvanced" hidden></div>';
  }

  // ---- the Advisor drawer ---------------------------------------------------------------------------
  function messageHtml(who, text, date, chart) {
    if (who === "u") return '<div class="gx-msg user"><div class="gx-bubble">' + esc(text) + "</div></div>";
    return '<div class="gx-msg"><span class="gx-msg-label">🧭 Advisor</span><div class="gx-bubble' + (chart ? " has-chart" : "") + '">' + (text === null ? '<span class="gx-thinking">Thinking' + ".".repeat(Math.floor(Date.now() / 500) % 4) + "</span>" : esc(text)) + (chart ? chartHtml(chart) : "") + "</div>" + (date ? '<span class="gx-msg-time">' + date + "</span>" : "") + "</div>";
  }
  function renderAdvisor(T) {
    var shown = ADVISOR.filter(function (m) { return m[0] <= T; });
    var next = ADVISOR[shown.length];
    var thinking = next && next[1] === "a" && T > next[0] - 0.05;
    var parts = shown.map(function (m) {
      var d = chapterDate(STEPS[Math.min(STEPS.length - 1, Math.floor(m[0]))]);
      var text = typed(m[2], m[0], m[3], T);
      return [m[1], text, m[1] === "a" && d ? shortDate(d) : "", text.length === m[2].length ? m[4] : null];
    });
    var key = parts.map(function (p) { return p[1].length + (p[3] ? "c" : ""); }).join(",") + (thinking ? "…" + Math.floor(Date.now() / 500) % 4 : "") + "|" + state.extra.map(function (m) { return m[1] === null ? "?" : "!"; }).join("");
    if (!changed("advisor", key)) return;
    var html = parts.length || state.extra.length ? "" : '<p class="gx-none">No messages yet. Ask your advisor something!</p>';
    parts.forEach(function (p) { html += messageHtml(p[0], p[1], p[2], p[3]); });
    if (thinking) html += messageHtml("a", null);
    state.extra.forEach(function (m) { html += messageHtml(m[0], m[1]); });
    el.msgs.innerHTML = html;
    drawCharts(el.msgs);
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

  // ---- the advisor's charts (advisor.jsx AdvisorChart: Chart.js, drawn here as the same SVG) -------------
  var CHART_COLORS = ["#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#94a3b8", "#f87171", "#38bdf8"];
  var CHARTS = [];
  function sliceColour(ds, j) { return Array.isArray(ds.backgroundColor) ? ds.backgroundColor[j] : CHART_COLORS[j % CHART_COLORS.length]; }
  function seriesColour(ds, i) { var c = ds.borderColor; return (Array.isArray(c) ? c[0] : c) || CHART_COLORS[i % CHART_COLORS.length]; }
  function chartHtml(cfg) {
    var id = CHARTS.indexOf(cfg);
    if (id < 0) { CHARTS.push(cfg); id = CHARTS.length - 1; }
    var round = cfg.type === "pie" || cfg.type === "doughnut";
    var items = round ? cfg.data.labels.map(function (label, j) { return [label, sliceColour(cfg.data.datasets[0], j)]; }) : cfg.data.datasets.map(function (ds, i) { return [ds.label, seriesColour(ds, i)]; });
    return '<div class="gx-chart"><div class="gx-chart-legend">' + items.map(function (item) { return '<span><i style="background:' + item[1] + '"></i>' + esc(item[0]) + "</span>"; }).join("") + '</div><div class="gx-chart-box" data-chart="' + id + '"></div></div>';
  }
  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    var raw = (max - min) / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= raw; })[0];
    var ticks = [];
    for (var v = Math.floor(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
    if (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10));
    return ticks;
  }
  // Chart.js's splineCurve at tension 0.4: each point's handles lie along the line from its neighbours.
  function spline(points) {
    var d = "M" + points[0][0].toFixed(1) + " " + points[0][1].toFixed(1);
    var handles = points.map(function (p, i) {
      var prev = points[i - 1] || p, next = points[i + 1] || p;
      var d01 = Math.hypot(p[0] - prev[0], p[1] - prev[1]), d12 = Math.hypot(next[0] - p[0], next[1] - p[1]);
      var s01 = d01 / (d01 + d12 || 1), s12 = d12 / (d01 + d12 || 1);
      var fa = 0.4 * s01, fb = 0.4 * s12;
      return [[p[0] - fa * (next[0] - prev[0]), p[1] - fa * (next[1] - prev[1])], [p[0] + fb * (next[0] - prev[0]), p[1] + fb * (next[1] - prev[1])]];
    });
    for (var i = 1; i < points.length; i += 1) {
      d += " C" + handles[i - 1][1][0].toFixed(1) + " " + handles[i - 1][1][1].toFixed(1) + " " + handles[i][0][0].toFixed(1) + " " + handles[i][0][1].toFixed(1) + " " + points[i][0].toFixed(1) + " " + points[i][1].toFixed(1);
    }
    return d;
  }
  function drawChart(box, cfg) {
    var w = Math.max(160, box.clientWidth || 240), h = 175;
    var pct = cfg.options && cfg.options.unit === "percent" ? "%" : "";
    var svg = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true">';
    var tip = function (title, value, colour) { return ' data-tip-title="' + esc(title) + '" data-tip="' + esc(" " + value + pct) + '" data-tip-colour="' + colour + '"'; };
    if (cfg.type === "pie" || cfg.type === "doughnut") {
      var ds = cfg.data.datasets[0];
      var total = ds.data.reduce(function (a, b) { return a + (b || 0); }, 0) || 1;
      var r = (h - 8) / 2 - 1, inner = cfg.type === "doughnut" ? r * 0.5 : 0, cx = w / 2, cy = h / 2, a = -Math.PI / 2;
      ds.data.forEach(function (value, j) {
        var b = a + (value || 0) / total * Math.PI * 2;
        var large = b - a > Math.PI ? 1 : 0;
        var p = function (rad, ang) { return (cx + rad * Math.cos(ang)).toFixed(2) + " " + (cy + rad * Math.sin(ang)).toFixed(2); };
        var path = "M" + p(r, a) + " A" + r + " " + r + " 0 " + large + " 1 " + p(r, b) + (inner ? " L" + p(inner, b) + " A" + inner + " " + inner + " 0 " + large + " 0 " + p(inner, a) : " L" + cx + " " + cy) + " Z";
        svg += '<path d="' + path + '" fill="' + sliceColour(ds, j) + '" stroke="#fff" stroke-width="2" stroke-linejoin="round"' + tip(cfg.data.labels[j], value, sliceColour(ds, j)) + "/>";
        a = b;
      });
    } else {
      var bar = cfg.type === "bar";
      var values = [];
      cfg.data.datasets.forEach(function (ds) { ds.data.forEach(function (v) { if (v != null) values.push(v); }); });
      var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
      if (bar) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
      var ticks = niceTicks(lo, hi, 5);
      var y0 = ticks[0], y1 = ticks[ticks.length - 1];
      var labelW = Math.max.apply(null, ticks.map(function (t) { return String(t + pct).length; })) * 5.6;
      var labels = cfg.data.labels;
      var left = labelW + 10, top = 9, bottom = h - 22, right = w - (bar ? 6 : Math.max(6, String(labels[labels.length - 1]).length * 2.8));
      var n = labels.length, band = (right - left) / n;
      var X = function (i) { return bar ? left + band * (i + 0.5) : left + (n > 1 ? i * (right - left) / (n - 1) : (right - left) / 2); };
      var Y = function (v) { return bottom - (v - y0) / (y1 - y0) * (bottom - top); };
      ticks.forEach(function (t) {
        svg += '<line x1="' + left + '" x2="' + right + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '" stroke="rgba(255,255,255,0.06)"/>';
        svg += '<text x="' + (left - 8) + '" y="' + (Y(t) + 3.5).toFixed(1) + '" text-anchor="end" fill="rgba(255,255,255,0.45)" font-size="10" font-family="sans-serif">' + t + pct + "</text>";
      });
      labels.forEach(function (label, i) {
        var gx = bar ? left + band * i : X(i);
        svg += '<line x1="' + gx.toFixed(1) + '" x2="' + gx.toFixed(1) + '" y1="' + top + '" y2="' + bottom + '" stroke="rgba(255,255,255,0.06)"/>';
        svg += '<text x="' + X(i).toFixed(1) + '" y="' + (h - 7) + '" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="10" font-family="sans-serif">' + esc(label) + "</text>";
      });
      svg += '<line x1="' + left + '" x2="' + left + '" y1="' + top + '" y2="' + bottom + '" stroke="rgba(255,255,255,0.08)"/><line x1="' + left + '" x2="' + right + '" y1="' + bottom + '" y2="' + bottom + '" stroke="rgba(255,255,255,0.08)"/>';
      var count = cfg.data.datasets.length;
      cfg.data.datasets.forEach(function (ds, k) {
        var colour = seriesColour(ds, k);
        if (bar) {
          var bw = band * 0.8 * 0.9 / count;
          ds.data.forEach(function (v, i) {
            if (v == null) return;
            var x = left + band * i + band * 0.1 + band * 0.8 * k / count + band * 0.8 * 0.05 / count;
            var fill = Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] : ds.backgroundColor || colour;
            svg += '<rect x="' + x.toFixed(1) + '" y="' + Math.min(Y(v), Y(0)).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.abs(Y(v) - Y(0)).toFixed(1) + '" fill="' + fill + '" stroke="' + colour + '" stroke-width="2"' + tip(labels[i], v, colour) + "/>";
          });
          return;
        }
        var runs = [[]];
        ds.data.forEach(function (v, i) { if (v == null) runs.push([]); else runs[runs.length - 1].push([X(i), Y(v)]); });
        runs.forEach(function (run) { if (run.length > 1) svg += '<path d="' + spline(run) + '" fill="none" stroke="' + colour + '" stroke-width="2"/>'; });
        ds.data.forEach(function (v, i) {
          if (v == null) return;
          svg += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="3" fill="' + colour + '26" stroke="' + colour + '"/><circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="9" fill="transparent"' + tip(labels[i], v, colour) + "/>";
        });
      });
    }
    box.innerHTML = svg + '</svg><div class="gx-chart-tip" hidden></div>';
  }
  function drawCharts(root) {
    Array.prototype.forEach.call(root.querySelectorAll("[data-chart]"), function (box) { drawChart(box, CHARTS[+box.getAttribute("data-chart")]); });
  }
  function chartHover(event) {
    var box = event.target.closest && event.target.closest(".gx-chart-box");
    if (!box) return;
    var tipBox = box.querySelector(".gx-chart-tip");
    var hit = event.target.closest("[data-tip]");
    if (!hit || event.type === "pointerleave") { tipBox.hidden = true; return; }
    var rect = box.getBoundingClientRect();
    tipBox.innerHTML = "<b>" + hit.getAttribute("data-tip-title") + '</b><span><i style="background:' + hit.getAttribute("data-tip-colour") + '"></i>' + hit.getAttribute("data-tip") + "</span>";
    tipBox.hidden = false;
    var x = event.clientX - rect.left, y = event.clientY - rect.top;
    tipBox.style.left = Math.min(Math.max(4, x + 10), rect.width - tipBox.offsetWidth - 4) + "px";
    tipBox.style.top = Math.max(4, y - tipBox.offsetHeight - 8) + "px";
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
      html += '<button type="button" class="gx-advanced" data-open-advanced><span class="ic">📊</span><span class="tx"><b>Advanced statistics</b><small>Explore campaign trends and historical snapshots</small></span><span class="ch">›</span></button>';
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

  // ---- Advanced statistics (stats.jsx AdvancedStatsModal + AdvancedLineChart) ---------------------------
  var METRIC_GROUPS = [
    ["◈", "Headline economy", [["gdp", "GDP", "#34d399", "gdp"], ["gdpPerCapita", "GDP per capita", "#e7e7e9", "gdpPerCapita"], ["population", "Population", "#94a3b8", "population"]]],
    ["↗", "Economic conditions", [["gdpGrowth", "GDP growth", "#34d399", "percent"], ["inflation", "Inflation", "#f59e0b", "percent"], ["unemployment", "Unemployment", "#60a5fa", "percent"], ["publicDebt", "Public debt", "#94a3b8", "percent"], ["budgetBalance", "Budget balance", "#f87171", "percent"]]],
    ["⚑", "Strategic indices", [["stability", "National stability", "#22c55e", "index"], ["sovereignty", "Sovereignty", "#f97316", "index"], ["foodAutonomy", "Food autonomy", "#22c55e", "index"], ["energyAutonomy", "Energy autonomy", "#eab308", "index"], ["economicIndependence", "Economic independence", "#06b6d4", "index"], ["internalSecurity", "Internal security", "#f43f5e", "index"], ["internationalReputation", "International reputation", "#3b82f6", "index"]]],
    ["▦", "GDP sectors", [["agriculture", "Agriculture", "#22c55e", "sector"], ["industry", "Industry", "#3b82f6", "sector"], ["services", "Services", "#f59e0b", "sector"]]]
  ];
  var METRICS = {};
  METRIC_GROUPS.forEach(function (g) { g[2].forEach(function (m) { METRICS[m[0]] = m; }); });
  var UNIT_LABELS = { gdp: "GDP · 2016-EUR equivalent", gdpPerCapita: "GDP per capita · 2016-EUR equivalent", population: "Population", percent: "Percent", index: "Index · 0–100", sector: "Share of GDP · %" };
  var advanced = { open: false, range: "all", sel: ["gdp"], hover: -1 };
  function compact(v) {
    var a = Math.abs(v);
    return a >= 1e12 ? (v / 1e12).toFixed(2) + "T" : a >= 1e9 ? (v / 1e9).toFixed(1) + "B" : a >= 1e6 ? (v / 1e6).toFixed(1) + "M" : a >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(Math.round(v));
  }
  function formatMetric(key, v) {
    var unit = METRICS[key][3];
    if (unit === "gdp") return "€" + compact(v);
    if (unit === "gdpPerCapita") return "€" + Math.round(v).toLocaleString("en");
    if (unit === "population") return compact(v);
    if (unit === "percent") return (key === "gdpGrowth" || key === "budgetBalance" ? (v >= 0 ? "+" : "") : "") + v.toFixed(1) + "%";
    if (key === "stability") return String(Math.round(v));
    return unit === "sector" ? v.toFixed(1) + "%" : Math.round(v) + "%";
  }
  function formatDelta(key, d) {
    var unit = METRICS[key][3], sign = d > 0 ? "+" : d < 0 ? "−" : "";
    if (unit === "gdp") return sign + "€" + compact(Math.abs(d));
    if (unit === "gdpPerCapita") return sign + "€" + Math.round(Math.abs(d)).toLocaleString("en");
    if (unit === "population") return sign + compact(Math.abs(d));
    if (unit === "percent" || unit === "sector") return sign + Math.abs(d).toFixed(1) + " pp";
    return sign + Math.abs(Math.round(d));
  }
  // One sample per turn the story has played: the chapters behind the reader.
  function samplesAt(T) {
    var out = [];
    for (var i = 0; i < STEPS.length - 1; i += 1) {
      if (i > 0 && i + 0.5 > T) break;
      var f = FIGURES[i], d = chapterDate(STEPS[i]);
      var sample = { date: d, gdp: f.gdp * 1e12, gdpPerCapita: f.gdpc, population: f.population * 1e6 + i * 22000, gdpGrowth: f.growth, inflation: f.inflation, unemployment: f.unemployment, publicDebt: f.debt, budgetBalance: f.balance,
        stability: f.stability, sovereignty: f.sovereignty, foodAutonomy: f.food, energyAutonomy: f.energy, economicIndependence: f.economy, internalSecurity: f.security, internationalReputation: f.reputation,
        agriculture: 1.7 + (i % 3) * 0.1, industry: 19.4 - i * 0.12, services: 78.9 + i * 0.1 };
      if (out.length && +out[out.length - 1].date === +d) out[out.length - 1] = sample; else out.push(sample);
    }
    if (advanced.range !== "all" && out.length) {
      var newest = +out[out.length - 1].date, span = +advanced.range * 365.2425 * 86400000;
      out = out.filter(function (s) { return newest - +s.date <= span; });
    }
    return out;
  }
  function monthYear(d) { return MONTHS[d.getUTCMonth()].slice(0, 3) + " " + d.getUTCFullYear(); }
  function advancedChart(samples, narrow) {
    var W = narrow ? 420 : 900, H = narrow ? 320 : 470, P = { left: 78, right: 34, top: 34, bottom: 58 };
    if (narrow) P.left = 62;
    if (!samples.length) return '<div class="as-empty">No historical samples are available for this selection yet.</div>';
    var keys = advanced.sel, unit = METRICS[keys[0]][3];
    var values = [];
    samples.forEach(function (s) { keys.forEach(function (k) { values.push(s[k]); }); });
    var lo, hi;
    if (unit === "index" || unit === "sector") { lo = 0; hi = 100; }
    else {
      var mn = Math.min.apply(null, values), mx = Math.max.apply(null, values), pad = (mx - mn || Math.abs(mx) * 0.1 || 1) * 0.12;
      lo = mn - pad; hi = mx + pad;
      if (unit === "gdp" || unit === "population" || unit === "gdpPerCapita") lo = Math.max(0, lo);
    }
    var t0 = +samples[0].date, t1 = +samples[samples.length - 1].date;
    var X = function (s) { return t1 === t0 ? (P.left + W - P.right) / 2 : P.left + (+s.date - t0) / (t1 - t0) * (W - P.left - P.right); };
    var Y = function (v) { return H - P.bottom - (v - lo) / (hi - lo) * (H - P.top - P.bottom); };
    var svg = '<svg class="as-svg" viewBox="0 0 ' + W + " " + H + '"><rect x="' + P.left + '" y="' + P.top + '" width="' + (W - P.left - P.right) + '" height="' + (H - P.top - P.bottom) + '" rx="10" fill="rgba(8,8,10,0.18)" stroke="rgba(255,255,255,0.06)"/>';
    for (var g = 0; g <= 4; g += 1) {
      var v = lo + (hi - lo) * g / 4, y = Y(v);
      svg += '<line x1="' + P.left + '" x2="' + (W - P.right) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,0.08)"' + (g ? ' stroke-dasharray="3 6"' : "") + "/>";
      svg += '<text x="' + (P.left - 12) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" fill="rgba(255,255,255,0.42)" font-size="12" font-weight="600">' + formatMetric(keys[0], v) + "</text>";
    }
    var step = Math.max(1, Math.ceil(samples.length / 5)), lastTick = -1e9;
    samples.forEach(function (s, i) {
      if ((i % step && i !== samples.length - 1) || X(s) - lastTick < (narrow ? 64 : 84)) return;
      lastTick = X(s);
      svg += '<line x1="' + X(s).toFixed(1) + '" x2="' + X(s).toFixed(1) + '" y1="' + P.top + '" y2="' + (H - P.bottom) + '" stroke="rgba(255,255,255,0.05)"/><text x="' + X(s).toFixed(1) + '" y="' + (H - 24) + '" text-anchor="middle" fill="rgba(255,255,255,0.42)" font-size="12" font-weight="600">' + monthYear(s.date) + "</text>";
    });
    svg += '<text x="' + P.left + '" y="18" fill="rgba(255,255,255,0.38)" font-size="11" font-weight="700" letter-spacing="1">' + UNIT_LABELS[unit].toUpperCase() + "</text>";
    keys.forEach(function (k) {
      var c = METRICS[k][2];
      svg += '<path d="' + samples.map(function (s, i) { return (i ? "L" : "M") + X(s).toFixed(1) + " " + Y(s[k]).toFixed(1); }).join(" ") + '" fill="none" stroke="' + c + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 5px ' + c + '44)"/>';
      if (samples.length <= 24) samples.forEach(function (s) { svg += '<circle cx="' + X(s).toFixed(1) + '" cy="' + Y(s[k]).toFixed(1) + '" r="3.7" fill="' + c + '" stroke="#141417" stroke-width="2"/>'; });
    });
    var h = advanced.hover;
    if (h >= 0 && samples[h]) {
      svg += '<line x1="' + X(samples[h]).toFixed(1) + '" x2="' + X(samples[h]).toFixed(1) + '" y1="' + P.top + '" y2="' + (H - P.bottom) + '" stroke="rgba(255,255,255,0.34)"/>';
      keys.forEach(function (k) { svg += '<circle cx="' + X(samples[h]).toFixed(1) + '" cy="' + Y(samples[h][k]).toFixed(1) + '" r="6" fill="' + METRICS[k][2] + '" stroke="#141417" stroke-width="3"/>'; });
    }
    // Hit areas split at the midpoints between samples.
    samples.forEach(function (s, i) {
      var a = i ? (X(samples[i - 1]) + X(s)) / 2 : P.left, b = i < samples.length - 1 ? (X(s) + X(samples[i + 1])) / 2 : W - P.right;
      svg += '<rect class="as-hit" data-hover="' + i + '" x="' + a.toFixed(1) + '" y="' + P.top + '" width="' + Math.max(1, b - a).toFixed(1) + '" height="' + (H - P.top - P.bottom) + '" fill="transparent"/>';
    });
    svg += "</svg>";
    if (h >= 0 && samples[h]) {
      var d = samples[h].date;
      svg += '<div class="as-tip" style="left:min(calc(' + (X(samples[h]) / W * 100).toFixed(1) + '% + 10px), calc(100% - 190px))"><div class="d">' + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()].slice(0, 3).toUpperCase() + " " + d.getUTCFullYear() + "</div>" +
        keys.map(function (k) { return '<div class="r"><span><i style="background:' + METRICS[k][2] + '"></i>' + METRICS[k][1] + "</span><b>" + formatMetric(k, samples[h][k]) + "</b></div>"; }).join("") + "</div>";
    }
    return svg;
  }
  function renderAdvanced(T) {
    if (!advanced.open) return;
    var narrow = phone();
    var samples = samplesAt(T);
    var keys = advanced.sel, unit = METRICS[keys[0]][3];
    var html = '<div class="as-sheet" role="dialog" aria-label="Advanced Statistics"><div class="as-head"><span class="as-flag">' + tricolour() + '</span><div class="as-title"><div><b>Advanced Statistics</b><span>France</span></div><small>' +
      (samples.length ? monthYear(samples[0].date) + " – " + monthYear(samples[samples.length - 1].date) + " · " + samples.length + " snapshot" + (samples.length === 1 ? "" : "s") : "No snapshots yet") + '</small></div><button type="button" class="as-x" data-as="close" aria-label="Close">×</button></div>';
    html += '<div class="as-body"><div class="as-main"><div class="as-top"><div><b>' + keys.map(function (k) { return METRICS[k][1]; }).join(" · ") + "</b><small>" + UNIT_LABELS[unit] + '</small></div><div class="as-legend">' + keys.map(function (k) { return '<span><i style="background:' + METRICS[k][2] + '"></i>' + METRICS[k][1] + "</span>"; }).join("") + "</div></div>";
    html += '<div class="as-frame">' + advancedChart(samples, narrow) + "</div>";
    html += '<div class="as-tiles" style="grid-template-columns:repeat(' + (narrow ? 2 : Math.min(4, keys.length)) + ',minmax(0,1fr))">' + keys.map(function (k) {
      var first = samples[0] ? samples[0][k] : 0, last = samples.length ? samples[samples.length - 1][k] : 0, d = last - first;
      return '<div class="as-tile"><small>' + METRICS[k][1] + '</small><b style="color:' + METRICS[k][2] + '">' + (samples.length ? formatMetric(k, last) : "—") + '</b><span style="color:' + (d > 1e-9 ? "#86efac" : d < -1e-9 ? "#fca5a5" : "rgba(255,255,255,0.42)") + '">' + formatDelta(k, d) + " over range</span></div>";
    }).join("") + "</div></div>";
    html += '<aside class="as-side"><div class="as-label">Time range</div><div class="as-ranges">' + [["all", "All"], ["1", "1 year"], ["5", "5 years"], ["10", "10 years"]].map(function (r) { return '<button type="button" class="as-range' + (advanced.range === r[0] ? " on" : "") + '" data-as-range="' + r[0] + '">' + r[1] + "</button>"; }).join("") + "</div>";
    html += '<div class="as-label row">Statistics<span>Selected ' + keys.length + '/4</span></div><div class="as-hint">Compatible metrics can share a chart. Choosing a different scale switches the graph automatically.</div>';
    METRIC_GROUPS.forEach(function (g) {
      html += '<div class="as-group"><div class="as-gtitle">' + g[0] + " " + g[1] + "</div>" + g[2].map(function (m) {
        var on = keys.indexOf(m[0]) >= 0, compatible = m[3] === unit;
        return '<button type="button" class="as-metric" data-as-metric="' + m[0] + '" style="font-weight:' + (on ? 800 : 650) + ";background-color:" + (on ? m[2] + "16" : "transparent") + ";border-color:" + (on ? m[2] + "50" : "transparent") + ";color:" + (on ? "rgba(255,255,255,0.9)" : compatible ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.32)") + '"><span class="as-box" style="background:' + (on ? m[2] : "rgba(255,255,255,0.08)") + ";border-color:" + (on ? m[2] : "rgba(255,255,255,0.13)") + '">' + (on ? "✓" : "") + "</span>" + m[1] + "</button>";
      }).join("") + "</div>";
    });
    html += '<div class="as-note"><b>Campaign history</b><span>' + samples.length + " permanent samples · 0 recovered from rollback snapshots. A completed turn that changes these figures is recorded automatically.</span></div></aside></div></div>";
    if (!changed("advanced", html)) return;
    el.advanced.innerHTML = html;
  }
  function setAdvanced(open) {
    advanced.open = open;
    advanced.hover = -1;
    el.advanced.hidden = !open;
    state.keys.advanced = "";
    renderAdvanced(state.T);
  }
  function advancedClick(event) {
    var target = event.target;
    if (target === el.advanced || target.closest("[data-as=\"close\"]")) { setAdvanced(false); return; }
    var range = target.closest("[data-as-range]");
    var metric = target.closest("[data-as-metric]");
    if (range) advanced.range = range.getAttribute("data-as-range");
    else if (metric) {
      var key = metric.getAttribute("data-as-metric"), at = advanced.sel.indexOf(key);
      if (at >= 0) { if (advanced.sel.length > 1) advanced.sel.splice(at, 1); }
      else if (METRICS[key][3] !== METRICS[advanced.sel[0]][3]) advanced.sel = [key];
      else { advanced.sel.push(key); if (advanced.sel.length > 4) advanced.sel.shift(); }
    } else return;
    renderAdvanced(state.T);
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
  // ---- the Diplomacy panel (chat.jsx: the workspace, ChatListItem, ConversationView) ----------------
  var BACK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  var CONTACTS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  var INSTITUTIONS = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V10M19 21V10M9 21V10M15 21V10"/><path d="M2 10 12 3l10 7z"/></svg>';
  var INTELLIGENCE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var dip = { view: "list", thread: -1, tab: "chats", typed: {}, seen: {} };
  function threadLines(i, T) {
    var shown = CHATS[i].lines.filter(function (l) { return l[0] <= T; }).map(function (l) { return [l[1], typed(l[2], l[0], 0.06, T)]; });
    return shown.concat(dip.typed[i] || []);
  }
  function threadUnread(i, T) {
    var theirs = CHATS[i].lines.filter(function (l) { return l[0] <= T && l[1] === "t"; }).length;
    return theirs > (dip.seen[i] || 0);
  }
  function renderDip(T) {
    if (state.pop !== "chat") return;
    if (dip.view === "thread" && dip.thread >= 0) dip.seen[dip.thread] = CHATS[dip.thread].lines.filter(function (l) { return l[0] <= T && l[1] === "t"; }).length;
    var html = "";
    if (dip.view === "thread" && dip.thread >= 0) {
      var thread = CHATS[dip.thread];
      var lines = threadLines(dip.thread, T);
      html += '<div class="dp-convhead"><button type="button" class="dp-back" data-dip="back" aria-label="Back to diplomacy">' + BACK + "</button>" + tricolour(thread.flag, "dp-flag") +
        '<div class="dp-convtitle"><b>' + thread.with + '</b><small>Direct diplomatic channel</small></div><button type="button" class="dp-x" data-dip="back" aria-label="Close conversation">✕</button></div>';
      html += '<div class="dp-msgs">' + (lines.length ? lines.map(function (l) {
        return '<div class="dp-msg' + (l[0] === "u" ? " me" : "") + '">' + (l[0] === "u" ? "" : '<span class="dp-speaker">' + thread.leader + "</span>") + '<div class="dp-bubble" style="--accent:' + thread.flag[thread.flag.length - 1] + '">' + esc(l[1]) + "</div></div>";
      }).join("") : '<div class="dp-empty">No messages yet. Write the first one.</div>') + "</div>";
      html += '<form class="dp-compose" data-dip="send"><textarea rows="1" placeholder="Send a diplomatic message…" aria-label="Send a diplomatic message"></textarea><button type="submit" aria-label="Send">🚀</button></form>';
    } else {
      var unread = CHATS.filter(function (c, i) { return threadUnread(i, T); }).length;
      html += '<div class="dp-head"><div class="dp-title"><span class="dp-icon">' + CONTACTS + '</span><div><b>Diplomacy</b><small>Conversations, institutions and statecraft</small></div></div><button type="button" class="dp-x" data-dip="close" aria-label="Close diplomacy panel">✕</button></div>';
      html += '<div class="dp-tabs">' + [["chats", CONTACTS, "Contacts", unread], ["institutions", INSTITUTIONS, "Institutions", pendingBallots(T).length], ["spy", INTELLIGENCE, "Intelligence", 0]].map(function (tab) {
        return '<button type="button" class="dp-tab' + (dip.tab === tab[0] ? " on" : "") + '" data-tab="' + tab[0] + '"><span class="ic">' + tab[1] + "</span><span>" + tab[2] + "</span>" + (tab[3] ? '<span class="dp-count">' + tab[3] + "</span>" : "") + "</button>";
      }).join("") + "</div>";
      if (dip.tab === "chats") {
        var open = CHATS.map(function (c, i) { return i; }).filter(function (i) { return threadLines(i, T).length; });
        html += '<div class="dp-list">';
        if (!open.length) html += '<div class="dp-empty">No diplomatic conversations yet.<br>Start one below.</div>';
        else {
          html += '<div class="dp-group">Recent</div>';
          open.slice().reverse().forEach(function (i) {
            var lines = threadLines(i, T);
            var last = lines[lines.length - 1];
            var isUnread = threadUnread(i, T);
            html += '<button type="button" class="dp-row' + (isUnread ? " unread" : "") + '" data-thread="' + i + '"><span class="dp-dot">' + (isUnread ? "<i></i>" : "") + "</span>" + tricolour(CHATS[i].flag, "dp-flag") +
              '<span class="dp-rowtext"><span class="dp-rowtop"><b>' + CHATS[i].with + '</b><em>Direct channel</em></span><span class="dp-preview">' + esc(last ? last[1] : "No messages yet") + '</span></span><span class="dp-chev">›</span></button>';
          });
        }
        html += '</div><div class="dp-foot"><button type="button" class="dp-new" data-dip="new">Start New Chat</button></div>';
      } else if (dip.tab === "institutions") {
        html += renderInst(T);
      } else {
        html += renderSpy(T);
      }
    }
    if (dip.tab === "spy" && dip.view === "list" && spy.intercept >= 0) html = interceptHtml(T);
    if (dip.tab === "spy" && dip.view === "list" && spy.picking) html += deployPickerHtml(T);
    if (!changed("dip", html)) return;
    var focus = document.activeElement && el.dip.contains(document.activeElement) ? document.activeElement.getAttribute("data-field") : null;
    var caret = focus ? document.activeElement.selectionStart : 0;
    el.dip.innerHTML = html;
    // What was typed survives a redraw: fields are written back, and the one being typed in keeps its caret.
    Array.prototype.forEach.call(el.dip.querySelectorAll("[data-field]"), function (input) {
      var key = input.getAttribute("data-field");
      if (fields[key] != null) input.value = fields[key];
      if (key === focus) { input.focus(); try { input.setSelectionRange(caret, caret); } catch (error) { /* a select has no caret */ } }
    });
    syncOrderButtons();
    var msgs = el.dip.querySelector(".dp-msgs");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }
  function dipClick(event) {
    if ((dip.tab === "spy" && dip.view === "list" && spyClick(event)) || (dip.tab === "institutions" && dip.view === "list" && instClick(event))) {
      state.manual.pop = "chat";
      state.keys.dip = "";
      renderDip(state.T);
      return;
    }
    var row = event.target.closest("[data-thread]");
    var tab = event.target.closest(".dp-tab");
    var act = event.target.closest("[data-dip]");
    if (row) { dip.view = "thread"; dip.thread = +row.getAttribute("data-thread"); state.manual.pop = "chat"; }
    else if (tab) dip.tab = tab.getAttribute("data-tab");
    else if (act && act.getAttribute("data-dip") === "back") { dip.view = "list"; state.manual.pop = "chat"; }
    else if (act && act.getAttribute("data-dip") === "close") { setPop(null, true); return; }
    else if (act && act.getAttribute("data-dip") === "new") {
      var fresh = CHATS.map(function (c, i) { return i; }).filter(function (i) { return !threadLines(i, state.T).length; })[0];
      dip.view = "thread";
      dip.thread = fresh == null ? 0 : fresh;
    } else return;
    state.keys.dip = "";
    renderDip(state.T);
  }
  function dipSend(event) {
    if (!event.target.closest("[data-dip=\"send\"]")) return;
    event.preventDefault();
    var input = el.dip.querySelector(".dp-compose textarea");
    var text = input.value.trim();
    if (!text || dip.thread < 0) return;
    var i = dip.thread;
    (dip.typed[i] = dip.typed[i] || []).push(["u", text]);
    state.keys.dip = "";
    renderDip(state.T);
    setTimeout(function () {
      dip.typed[i].push(["t", "In the game, " + CHATS[i].leader.replace(/^The /, "the ") + " would answer you in their own voice, and remember what you said. Here the letters are already written."]);
      state.keys.dip = "";
      renderDip(state.T);
    }, 1200);
  }
  // ---- Intelligence (chat.jsx SpyView, spycraft.js) ------------------------------------------------------
  // France's networks abroad, what they did and what they read, by story time.
  var FOCI = { diplomacy: "Diplomacy", military: "Military", research: "Research and technology", economy: "Economic policy", politics: "Internal politics" };
  var SPY_COUNTRIES = ["China", "Germany", "Italy", "Japan", "North Korea", "Russia", "South Korea", "United Kingdom", "United States"];
  var RATINGS = { China: 76, Germany: 66, Italy: 58, Japan: 62, "North Korea": 55, Russia: 82, "South Korea": 64, "United Kingdom": 84, "United States": 92 };
  var PROFILES = {
    China: ["People's republic, One-party state, Socialism with Chinese characteristics", "President of the People's Republic", "Premier of the State Council", ["Keep the peninsula quiet", "Bring Pyongyang to the table on its own terms"]],
    Germany: ["Federal republic, Parliamentary, Christian democracy", "Federal Chancellor", "Federal Chancellor", ["Hold the European Union together", "Keep the war out of Europe"]],
    "North Korea": ["Socialist state, One-party, Juche", "Supreme Leader", "Premier", ["Take the South before the world can answer", "Keep the regime"]],
    Russia: ["Federal republic, Semi-presidential, Conservative", "President of the Russian Federation", "Prime Minister", ["Answer the strikes on its missile fields", "Inspectors in Montana as well as Plesetsk", "Come to any table as the injured party"]],
    "United States": ["Federal republic, Presidential, Liberal democracy", "President of the United States", "President of the United States", ["Explain the launches", "Keep NATO behind Washington"]]
  };
  var SEATS = {
    China: [["United Nations Security Council", "permanent member"]],
    Russia: [["United Nations Security Council", "permanent member", 1]],
    "United States": [["United Nations Security Council", "permanent member"], ["North Atlantic Treaty Organization", "member"]],
    "United Kingdom": [["United Nations Security Council", "permanent member"], ["North Atlantic Treaty Organization", "member"], ["European Union", "member"]],
    Germany: [["North Atlantic Treaty Organization", "member"], ["European Union", "member"]],
    Italy: [["North Atlantic Treaty Organization", "member"], ["European Union", "member"]],
    Japan: [["United Nations Security Council", "elected member"]]
  };
  // [T it is first known, target, since, focus, recruited sources (with the T each was recruited)]
  var NETWORKS = [
    [0, "Russia", "2016-03-01", "military", [[1.95, "a staff officer at Plesetsk"]]],
    [2.3, "North Korea", "2016-09-10", "military", []]
  ];
  // [T, kind, target, date, instructions, outcome, caught]
  var OPS = [
    [1.95, "Recruit", "Russia", "2016-08-09", "a staff officer at Plesetsk", "success", false],
    [5, "Other operation", "North Korea", "2017-01-01", "Find out whether Pyongyang will honour a ceasefire", "failure", false]
  ];
  var ASSESSMENTS = [
    [3.3, "Russia", "2016-12-01", "High confidence", "HUMINT network", "Moscow wants the strikes on its missile fields answered before it talks of anything else, and it will come to a table only as the injured party.",
      [["Leadership", "The President has the Security Council behind him; the hard line in the General Staff wants a reply in kind."], ["Military", "The Strategic Rocket Forces are on their highest alert since 1983."], ["Diplomacy", "Inspectors in Montana are the price of a seat at Strasbourg."]]],
    [5.4, "North Korea", "2017-01-01", "Low confidence", "Signals and open sources", "Pyongyang will sign an armistice that leaves the line where its armies stand.", [["Military", "The advance has stopped short of Busan for want of fuel."]]]
  ];
  var INTERCEPTS = [
    [5.6, "Russia", "China", "Terms for Strasbourg", "2017-01-10", [
      ["Russia", "We will go to Strasbourg only if inspectors are sent to Montana as well as to Plesetsk."],
      ["China", "Beijing agrees. Pyongyang will not sign anything that moves the line south of where it stands."],
      ["Russia", "Then the line is the line on the day of signing. Say nothing of it in Paris until the French have offered it themselves."]
    ]]
  ];
  var DOCUMENTS = [
    [1.95, "NORAD launch summary, 9 August", "United States", "Aug 10, 2016", "intercepted copy", "TOP SECRET // NOFORN\n\n0412Z: ten launches detected, Malmstrom AFB (6), Minot AFB (4).\nTracks polar, terminal areas Kozelsk, Tatishchevo, Plesetsk, Yasny, Moscow region.\nCause under investigation. No release authority was given."],
    [8.3, "Instructions to the delegation at Strasbourg", "France", "Mar 1, 2017", "held by your government", "1. The line is the line on the day of signing.\n2. Inspectors to Montana and to Plesetsk, on the same day.\n3. No launches for ten years, verified by the Commission."]
  ];
  var spy = { sec: "overview", country: "Russia", search: "", intercept: -1, picking: false, pick: "", doc: -1, recalled: {}, added: [], orders: {}, given: [], foreign: "custody", lost: [] };
  var fields = {};
  function clarity(target) {
    var mine = figuresAt(state.T).intel / 100;
    var theirs = (RATINGS[target] || 40) / 100;
    return clamp(0.07 + Math.pow(mine, 1.6) * 0.92 - theirs * 0.1);
  }
  function capability(v) { return v >= 85 ? "Advanced" : v >= 70 ? "Capable" : v >= 50 ? "Limited" : v >= 30 ? "Developing" : "Minimal"; }
  function networksAt(T) {
    var list = NETWORKS.filter(function (n) { return n[0] <= T && !spy.recalled[n[1]]; }).map(function (n) {
      return { target: n[1], since: n[2], focus: n[3], assets: n[4].filter(function (a) { return a[0] <= T; }).map(function (a) { return a[1]; }), suspected: n[1] === "North Korea" && T >= 5 };
    });
    return list.concat(spy.added.filter(function (n) { return !spy.recalled[n.target]; }));
  }
  function hashWord(text) { var h = 2166136261; for (var i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  // spycraft.js: a word is read when a stable draw falls under the signal's clarity; punctuation stays.
  function redact(text, level, salt) {
    return text.split(/(\s+)/).map(function (word, i) {
      if (/^\s+$/.test(word) || !word) return word;
      var bare = word.replace(/[^\p{L}\p{N}'’-]/gu, "");
      if (!bare || hashWord(salt + ":" + i + ":" + bare) < level) return esc(word);
      return word.replace(bare, "█".repeat(Math.max(2, Math.min(bare.length, 9))));
    }).join("");
  }
  function statCard(label, value, hint, tone) {
    return '<div class="sp-stat ' + (tone || "neutral") + '"><div class="k">' + label + '</div><div class="v">' + value + "</div>" + (hint ? '<div class="h">' + hint + "</div>" : "") + "</div>";
  }
  function opOutcome(op) {
    if (op[5] === "success") return op[6] ? ["Succeeded, but the agent was caught and identified", "#fca5a5"] : ["Succeeded, and was never traced", "#86efac"];
    return [op[6] ? "Failed: the agent reports it could not be done" : "Failed, and nobody noticed", "rgba(255,255,255,0.55)"];
  }
  function odds(kind, target) {
    var c = clarity(target);
    var success = clamp(c * (kind === "assassinate" ? 0.55 : kind === "sabotage" ? 0.8 : 0.95));
    var capture = clamp((1 - c) * (kind === "assassinate" ? 0.9 : 0.5));
    return [success >= 0.7 ? "Good" : success >= 0.45 ? "Even" : success >= 0.25 ? "Poor" : "Slim", capture >= 0.45 ? "High" : capture >= 0.2 ? "Moderate" : "Low"];
  }
  var ORDER_HINTS = { sabotage: "What to sabotage, e.g. the naval yards at Kiel", recruit: "Whom to recruit, e.g. a senior rocket engineer", assassinate: "Who is the target", operation: "What the agent should do" };
  var ORDER_NAMES = { sabotage: "Sabotage", recruit: "Recruit", assassinate: "Assassinate", operation: "Other operation" };
  function renderSpy(T) {
    var v = figuresAt(T);
    var nets = networksAt(T);
    var ops = OPS.filter(function (o) { return o[0] <= T; }).concat(spy.given);
    var assessments = ASSESSMENTS.filter(function (a) { return a[0] <= T; });
    var intercepts = INTERCEPTS.filter(function (x) { return x[0] <= T; });
    var docs = DOCUMENTS.filter(function (d) { return d[0] <= T; });
    var foreignKnown = T >= 4.5 && spy.foreign !== "expelled";
    var html = '<div class="sp" data-intelligence-workspace="restored"><div class="sp-nav">' + [["overview", "Overview"], ["countries", "Countries"], ["operations", "Operations"], ["reports", "Reports"]].map(function (s) {
      return '<button type="button" class="sp-tab' + (spy.sec === s[0] ? " on" : "") + '" data-spy-sec="' + s[0] + '">' + s[1] + "</button>";
    }).join("") + "</div>";
    if (spy.sec === "overview") {
      var warnings = [];
      if (foreignKnown && spy.foreign === "custody") warnings.push("Russia has a detected agent inside France.");
      if (nets.some(function (n) { return n.suspected; })) warnings.push("Source integrity concerns affect the network in North Korea.");
      var recent = [];
      intercepts.forEach(function (x) { recent.push([x[0], x[1] + " ↔ " + x[2], x[3], x[4]]); });
      assessments.forEach(function (a) { recent.push([a[0], "Political assessment: " + a[1], a[5], a[2]]); });
      docs.forEach(function (d) { recent.push([d[0], d[1], "Document from " + d[2], d[3]]); });
      ops.forEach(function (o) { recent.push([o[0], o[1] + " · " + o[2], opOutcome(o)[0], o[3]]); });
      recent.sort(function (a, b) { return b[0] - a[0]; });
      html += '<div class="sp-body"><div class="sp-stats">' +
        statCard("Service capability", capability(v.intel), "National intelligence capability") +
        statCard("Active networks", nets.length, (3 - nets.length) + " field slots available", "green") +
        statCard("Current reports", assessments.length + intercepts.length + docs.length, "Latest political assessments retained") +
        statCard("Counterintel alerts", foreignKnown ? 1 : 0, "Detected or turned foreign agents", foreignKnown ? "amber" : "") + "</div>";
      html += '<div class="sp-two"><div class="sp-panel pad"><div class="sp-title">Strategic warnings</div>' + (warnings.length ? warnings.map(function (w) { return '<div class="sp-line">• ' + w + "</div>"; }).join("") : '<div class="sp-none">No immediate intelligence warnings. This does not imply the absence of undiscovered activity.</div>') + "</div>";
      html += '<div class="sp-panel pad"><div class="sp-title">Recent intelligence</div>' + (recent.length ? recent.slice(0, 4).map(function (r) {
        return '<button type="button" class="sp-recent" data-spy-sec="reports"><span class="t"><b>' + esc(r[1]) + "</b><em>" + esc(String(r[3]).length === 10 ? shortDate(parseDate(r[3])) : r[3]) + '</em></span><span class="s">' + esc(r[2]) + "</span></button>";
      }).join("") : '<div class="sp-none">No private reporting has been collected yet. Deploy a network to begin receiving intelligence.</div>') + "</div></div></div>";
    } else if (spy.sec === "countries") {
      var q = (fields["spy-search"] || "").toLowerCase();
      var target = spy.country;
      var net = nets.filter(function (n) { return n.target === target; })[0];
      var level = net ? clarity(target) : 0;
      var assess = assessments.filter(function (a) { return a[1] === target; }).slice(-1)[0];
      var profile = PROFILES[target];
      html += '<div class="sp-countries"><div class="sp-panel sp-list"><input class="sp-input" data-field="spy-search" placeholder="Search countries" aria-label="Search countries" />' +
        SPY_COUNTRIES.filter(function (c) { return !q || c.toLowerCase().indexOf(q) >= 0; }).map(function (c) {
          return '<button type="button" class="sp-crow' + (c === target ? " on" : "") + '" data-spy-country="' + c + '"><span>' + c + "</span>" + (nets.some(function (n) { return n.target === c; }) ? '<i title="Active intelligence network"></i>' : "") + "</button>";
        }).join("") + "</div>";
      var tier = function (x) { return !net ? "Public" : x >= 0.72 ? "Strong" : "Limited"; };
      html += '<div class="sp-panel sp-dossier"><div class="sp-chead"><span class="sp-flagbox">🏳</span><div><b>' + target + "</b><small>" + (net ? "Active network · since " + net.since : "No active network · public sources only") + "</small></div></div>";
      html += '<div class="sp-stats four">' + statCard("Network", !net ? "None" : level >= 0.72 ? "Strong" : level >= 0.46 ? "Moderate" : "Limited") + statCard("Political", tier(level)) + statCard("Diplomatic", tier(level * 0.9)) +
        statCard("Source", !net ? "None" : net.suspected ? "Low" : level >= 0.6 ? "High" : "Moderate", "", !net ? "" : net.suspected ? "amber" : "green") + "</div>";
      html += '<div class="sp-panel sp-box"><div class="sp-sub">Public political picture</div><div class="sp-text">' + (profile ? esc(profile[0]) + '<div style="color:rgba(255,255,255,.52)">Leadership: ' + esc(profile[1]) + '</div><div style="color:rgba(255,255,255,.45)">Head of government: ' + esc(profile[2]) + "</div>" + profile[3].map(function (g) { return "<div>- " + esc(g) + "</div>"; }).join("") : '<span class="sp-none">No structured political profile is currently available.</span>') + "</div></div>";
      html += '<div class="sp-panel sp-box"><div class="sp-sub">Institutional position</div>' + ((SEATS[target] || []).length ? SEATS[target].map(function (s) {
        return '<div class="sp-seat"><span>' + s[0] + "</span><em>" + s[1] + "</em>" + (s[2] && T >= 2.2 && T < 5.2 ? "<i>" + s[2] + " pending</i>" : "") + "</div>";
      }).join("") : '<div class="sp-none">No current or publicly known institutional record.</div>') + "</div>";
      html += '<div class="sp-panel sp-box"><div class="sp-sub">Intelligence assessment</div>' + (assess ? '<div class="sp-text">' + esc(assess[5]) + '</div><div class="sp-meta">' + assess[3] + " · " + assess[4] + " · " + assess[2] + "</div>" + assess[6].map(function (f) { return '<div class="sp-text">- <strong>' + f[0] + ":</strong> " + esc(f[1]) + "</div>"; }).join("") : '<div class="sp-none">No private political assessment is available. Only public information is shown.</div>') + "</div></div></div>";
    } else if (spy.sec === "operations") {
      html += '<div class="sp-body"><div class="sp-panel sp-strip"><div><b>Field networks</b><small>Persistent HUMINT networks also appear as covert Projects.</small></div><span>' + nets.length + "/3</span></div>";
      html += nets.length ? nets.map(function (n) {
        var order = spy.orders[n.target];
        var kind = fields["spy-kind-" + n.target] || "sabotage";
        var chances = odds(kind, n.target);
        var level = clarity(n.target);
        var html2 = '<div class="sp-panel sp-agent"><div class="sp-agent-top"><div><b>' + n.target + "</b><small>since " + n.since + " · network " + (level >= 0.72 ? "strong" : level >= 0.46 ? "moderate" : "limited") + (n.suspected ? " · source integrity concern" : "") + '</small></div><span><button type="button" class="sp-btn" data-spy-act="dossier" data-target="' + n.target + '">Dossier</button><button type="button" class="sp-btn" data-spy-act="recall" data-target="' + n.target + '">Recall</button></span></div>';
        html2 += '<div class="sp-orders"><label class="sp-collect">Collect on <select class="sp-input" data-field="spy-focus-' + n.target + '">' + Object.keys(FOCI).map(function (f) { return '<option value="' + f + '"' + (f === n.focus ? " selected" : "") + ">" + FOCI[f] + "</option>"; }).join("") + "</select></label>";
        if (n.assets.length) html2 += '<div class="sp-assets">Recruited sources: ' + n.assets.map(esc).join(" · ") + "</div>";
        if (order) html2 += '<div class="sp-pending"><div><b>' + ORDER_NAMES[order[0]] + "</b> — " + esc(order[1]) + '</div><small>Carried out during the next time skip.</small><button type="button" class="sp-btn" data-spy-act="cancel" data-target="' + n.target + '">Cancel order</button></div>';
        else html2 += '<div class="sp-give"><select class="sp-input" data-field="spy-kind-' + n.target + '">' + Object.keys(ORDER_NAMES).map(function (k) { return '<option value="' + k + '"' + (k === kind ? " selected" : "") + ">" + ORDER_NAMES[k] + "</option>"; }).join("") + '</select><input class="sp-input" data-field="spy-text-' + n.target + '" placeholder="' + ORDER_HINTS[kind] + '" /><button type="button" class="sp-btn on" data-spy-act="order" data-target="' + n.target + '">Give the order</button></div>' +
          '<div class="sp-odds">Odds of success: <b>' + chances[0] + "</b> · Risk of capture: <b>" + chances[1] + "</b></div>";
        return html2 + "</div></div>";
      }).join("") : '<div class="sp-none" style="font-size:.68rem">No networks are currently in the field.</div>';
      html += spy.lost.map(function (line) { return '<div class="sp-lost">' + esc(line) + "</div>"; }).join("");
      html += '<div class="sp-sub">Operations log</div>' + (ops.length ? ops.slice().reverse().slice(0, 8).map(function (o) {
        var out = opOutcome(o);
        return '<div class="sp-panel sp-op"><div class="sp-op-top"><b>' + o[1] + " · " + o[2] + "</b><em>" + shortDate(parseDate(o[3])) + '</em></div><div class="sp-op-i">' + esc(o[4]) + '</div><div class="sp-op-o" style="color:' + out[1] + '">' + out[0] + "</div></div>";
      }).join("") : '<div class="sp-panel sp-none" style="padding:.7rem">No operations have been carried out yet. Give a network an order and it acts during the next time skip.</div>');
      html += '<div class="sp-sub">Counterintelligence cases</div>';
      if (foreignKnown) {
        html += '<div class="sp-panel sp-case"><div class="sp-agent-top"><div><b>' + (spy.foreign === "turned" ? "🎭" : "🕵️") + " Russia</b><small>" + (spy.foreign === "turned" ? "double agent since Jan 1, 2017 — Russia still trusts them" : "agent in custody — decide what to do") + "</small></div>" +
          (spy.foreign === "turned" ? "" : '<span><button type="button" class="sp-btn" data-spy-act="expel">Expel</button><button type="button" class="sp-btn on" data-spy-act="turn">Turn &amp; plant story</button></span>') + "</div>" +
          (spy.foreign === "turned" ? '<div class="sp-give" style="margin-top:.5rem"><input class="sp-input" data-field="spy-cover" placeholder="The story they carry home" /><button type="button" class="sp-btn" data-spy-act="cover">' + (fields["spy-cover-saved"] ? "Saved ✓" : "Save") + "</button></div>" : "") + "</div>";
      } else html += '<div class="sp-none">No detected foreign agents currently require action.</div>';
      html += '<button type="button" class="sp-deploy" data-spy-act="deploy"' + (nets.length >= 3 ? " disabled" : "") + ">♟ Deploy a network</button></div>";
    } else {
      html += '<div class="sp-body"><div class="sp-sub">Political assessments</div>' + (assessments.length ? assessments.slice().reverse().map(function (a) {
        return '<button type="button" class="sp-panel sp-report" data-spy-country="' + a[1] + '" data-spy-sec="countries"><span class="t"><b>' + a[1] + "</b><em>" + shortDate(parseDate(a[2])) + '</em></span><span class="s">' + esc(a[5]) + "</span></button>";
      }).join("") : '<div class="sp-none">No private political assessments are currently on file.</div>');
      html += '<div class="sp-sub">Intercepted traffic</div>' + (intercepts.length ? intercepts.map(function (x, i) {
        return '<button type="button" class="sp-panel sp-traffic" data-spy-act="intercept" data-i="' + i + '"><span class="ic">📡</span><span><b>' + x[1] + " ↔ " + x[2] + "</b><small>" + esc(x[3]) + " · " + shortDate(parseDate(x[4])) + "</small></span></button>";
      }).join("") : '<div class="sp-none">No intercepted diplomatic traffic is on file.</div>');
      html += '<div class="sp-sub">Documents on file</div>' + (docs.length ? docs.map(function (d, i) {
        return '<button type="button" class="sp-panel sp-report" data-spy-act="doc" data-i="' + i + '"><span class="t"><b>' + esc(d[1]) + "</b><em>" + d[3] + '</em></span><span class="s">From ' + d[2] + " · " + d[4] + "</span>" + (spy.doc === i ? '<span class="sp-docbody">' + esc(d[5]) + "</span>" : "") + "</button>";
      }).join("") : '<div class="sp-none">No readable government documents are currently on file.</div>') + "</div>";
    }
    return html + "</div>";
  }
  function interceptHtml(T) {
    var x = INTERCEPTS.filter(function (i) { return i[0] <= T; })[spy.intercept];
    if (!x) { spy.intercept = -1; return ""; }
    var level = clarity(x[1]);
    return '<div class="sp-icept"><div class="sp-icept-head"><button type="button" class="dp-back" data-spy-act="back" aria-label="Back">' + BACK + '</button><div><b>🕵 ' + x[1] + " ↔ " + x[2] + "</b><small>" + esc(x[3]) + " · " + shortDate(parseDate(x[4])) + "</small></div></div>" +
      '<div class="sp-clarity"><div class="row"><span>Signal clarity</span><b>' + Math.round(level * 100) + '%</b></div><div class="bar"><i style="width:' + Math.round(level * 100) + '%"></i></div></div>' +
      '<div class="sp-icept-msgs">' + x[5].map(function (m, i) {
        return '<div class="sp-imsg' + (m[0] === x[1] ? "" : " them") + '"><span>' + m[0] + '</span><div class="sp-ibubble">' + redact(m[1], level, x[3] + i) + "</div></div>";
      }).join("") + '</div><div class="sp-inote">Improve your intelligence service to decode more of this exchange.</div></div>';
  }
  function deployPickerHtml(T) {
    var taken = networksAt(T).map(function (n) { return n.target; });
    var open = SPY_COUNTRIES.filter(function (c) { return taken.indexOf(c) < 0; });
    return '<div class="sp-picker"><div class="sp-pick-head"><b>Deploy a Network</b><small>Choose a country for a persistent HUMINT network</small></div>' +
      '<div class="sp-pick-sel"><small>Target</small><b>' + (spy.pick || "No target chosen yet") + "</b></div>" +
      '<div class="sp-pick-grid">' + open.map(function (c) { return '<button type="button" class="sp-tile' + (spy.pick === c ? " on" : "") + '" data-spy-act="pick" data-target="' + c + '"><span class="sp-flagbox">🏳</span><span>' + c + "</span>" + (spy.pick === c ? "<i>✓</i>" : "") + "</button>"; }).join("") + "</div>" +
      '<div class="sp-pick-foot"><button type="button" data-spy-act="unpick">Cancel</button><button type="button" class="go" data-spy-act="confirm"' + (spy.pick ? "" : " disabled") + ">" + (spy.pick ? "Deploy the network" : "Choose a target") + "</button></div></div>";
  }
  function syncOrderButtons() {
    Array.prototype.forEach.call(el.dip.querySelectorAll('[data-spy-act="order"]'), function (button) {
      var text = fields["spy-text-" + button.getAttribute("data-target")];
      button.classList.toggle("dim", !text || !text.trim());
    });
  }
  function spyClick(event) {
    var sec = event.target.closest("[data-spy-sec]");
    var country = event.target.closest("[data-spy-country]");
    var act = event.target.closest("[data-spy-act]");
    if (country) spy.country = country.getAttribute("data-spy-country");
    if (sec) { spy.sec = sec.getAttribute("data-spy-sec"); return true; }
    if (country) return true;
    if (!act) return false;
    var what = act.getAttribute("data-spy-act");
    var target = act.getAttribute("data-target");
    var today = isoDate(dateAt(state.T, state.korea));
    if (what === "dossier") { spy.country = target; spy.sec = "countries"; }
    else if (what === "recall") { spy.recalled[target] = true; delete spy.orders[target]; spy.lost.push("Agent recalled from " + target + " on " + today); }
    else if (what === "order") {
      var text = (fields["spy-text-" + target] || "").trim();
      if (!text) return true;
      spy.orders[target] = [fields["spy-kind-" + target] || "sabotage", text];
      fields["spy-text-" + target] = "";
    } else if (what === "cancel") delete spy.orders[target];
    else if (what === "expel") { spy.foreign = "expelled"; spy.lost.push("Agent expelled by France to Russia on " + today); }
    else if (what === "turn") spy.foreign = "turned";
    else if (what === "cover") fields["spy-cover-saved"] = true;
    else if (what === "deploy") { spy.picking = true; spy.pick = ""; }
    else if (what === "pick") spy.pick = target;
    else if (what === "unpick") spy.picking = false;
    else if (what === "confirm" && spy.pick) { spy.recalled[spy.pick] = false; spy.added.push({ target: spy.pick, since: today, focus: "politics", assets: [], suspected: false }); spy.picking = false; }
    else if (what === "intercept") spy.intercept = +act.getAttribute("data-i");
    else if (what === "back") spy.intercept = -1;
    else if (what === "doc") spy.doc = spy.doc === +act.getAttribute("data-i") ? -1 : +act.getAttribute("data-i");
    return true;
  }

  // ---- Institutions (InstitutionsWorkspace.jsx) -----------------------------------------------------------
  var UNSC_MEMBERS = ["China", "France", "Russia", "United Kingdom", "United States", "Angola", "Egypt", "Japan", "Malaysia", "New Zealand", "Senegal", "Spain", "Ukraine", "Uruguay", "Venezuela"];
  var NATO_MEMBERS = ["Albania", "Belgium", "Bulgaria", "Canada", "Croatia", "Czech Republic", "Denmark", "Estonia", "France", "Germany", "Greece", "Hungary", "Iceland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Netherlands", "Norway", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Turkey", "United Kingdom", "United States"];
  var EU_MEMBERS = ["Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Denmark", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden", "United Kingdom"];
  var INSTITUTIONS_LIST = [
    { id: "unsc", T: -1, name: "United Nations Security Council", short: "UNSC", kind: "security council", founded: "1946-01-17", role: "permanent member", rule: "Nine votes, no permanent member against", members: UNSC_MEMBERS, purpose: "The maintenance of international peace and security", character: "Universal, intergovernmental", scope: "Worldwide", threat: "Threats to the peace, breaches of the peace and acts of aggression" },
    { id: "nato", T: -1, name: "North Atlantic Treaty Organization", short: "NATO", kind: "security_alliance", founded: "1949-04-04", role: "member", rule: "Unanimity", members: NATO_MEMBERS, purpose: "Collective defence", character: "Alliance of democracies", scope: "North Atlantic", threat: "Armed attack on a member" },
    { id: "eu", T: -1, name: "European Union", short: "EU", kind: "political_union", founded: "1993-11-01", role: "member", rule: "Qualified majority", members: EU_MEMBERS, purpose: "An ever closer union among the peoples of Europe", character: "Supranational union", scope: "Europe", threat: "Division of the continent" },
    { id: "strasbourg", T: 8.3, name: "Commission of Strasbourg", short: "", kind: "verification_commission", founded: "2017-03-02", role: "member", rule: "Unanimity", members: ["France", "United States", "Russia", "China", "North Korea", "South Korea"], purpose: "Keeps the Korean armistice and inspects the missile fields of both sides", character: "Treaty commission", scope: "Korean peninsula; missile fields in Russia and the United States", threat: "A second launch" },
    { id: "au", T: -1, name: "African Union", short: "AU", kind: "regional_organisation", founded: "2002-07-09", role: "", rule: "Consensus, else two thirds", members: ["Angola", "Egypt", "Nigeria", "Senegal", "South Africa"], purpose: "Unity and solidarity of the African states", character: "Continental, intergovernmental", scope: "Africa", threat: "Conflict on the continent" },
    { id: "asean", T: -1, name: "Association of Southeast Asian Nations", short: "ASEAN", kind: "regional_organisation", founded: "1967-08-08", role: "", rule: "Consensus", members: ["Indonesia", "Malaysia", "Philippines", "Singapore", "Thailand", "Vietnam"], purpose: "Peace and stability in Southeast Asia", character: "Regional, intergovernmental", scope: "Southeast Asia", threat: "Rivalry among the great powers in the region" }
  ];
  // [institution, T from, T until (a ballot open), title, summary, sponsor]
  var BALLOTS = [["unsc", 2.2, 5.2, "Ceasefire on the Korean peninsula", "Demands an immediate ceasefire, the withdrawal of forces to the 38th parallel and talks under the Council's auspices.", "France"]];
  // [institution, T, title, status, for, against, abstain, veto, date, summary]
  var DECISIONS = [
    ["unsc", 1.95, "Inquiry into the launches of 9 August", "passed", 15, 0, 0, 0, "2016-08-11", "Asks the Secretary-General to establish what flew, from where and by whose order."],
    ["unsc", 5.2, "Ceasefire on the Korean peninsula", "passed", 14, 0, 1, 0, "2017-01-01", "Demands an immediate ceasefire on the peninsula and welcomes the congress at Strasbourg."],
    ["strasbourg", 8.3, "The Final Act of Strasbourg", "passed", 6, 0, 0, 0, "2017-03-02", "An armistice along the line held on the day of signing; inspectors to Montana and Plesetsk; no launches for ten years."]
  ];
  var COUNCIL = { unsc: [[2.25, "United States", "Washington supports a ceasefire, and an inquiry into how the launches happened."], [2.3, "Russia", "Russia will not hear the word ceasefire until it hears the word apology."], [4.6, "China", "China will bring its neighbour to Strasbourg, if the Council does not stand in the way."]] };
  var inst = { open: "", tab: "overview", all: false, founding: false, votes: {}, founded: [] };
  function instAt(T) { return INSTITUTIONS_LIST.filter(function (i) { return i.T <= T; }).concat(inst.founded); }
  function emblem(i, size) {
    var mark = i.short && i.short.length <= 6 ? i.short.toUpperCase() : i.name.split(/\s+/).filter(function (w) { return /^[A-Z]/.test(w); }).map(function (w) { return w[0]; }).join("").slice(0, 5);
    return '<span class="in-emblem" style="width:' + size + "px;height:" + size + 'px">' + esc(mark) + "</span>";
  }
  function pill(text, tone) { return '<span class="in-pill ' + (tone || "neutral") + '">' + esc(text) + "</span>"; }
  function pendingBallots(T) { return BALLOTS.filter(function (b) { return T >= b[1] && T < b[2] && !inst.votes[b[3]]; }); }
  function longDay(iso) { var d = parseDate(iso); return d ? d.getUTCDate() + " " + MONTHS[d.getUTCMonth()].slice(0, 3) + " " + d.getUTCFullYear() : iso; }
  function cap(text) { return text ? text.charAt(0).toUpperCase() + text.slice(1) : text; }
  function renderInst(T) {
    var list = instAt(T);
    var mine = list.filter(function (i) { return i.role; });
    if (inst.open) {
      var i = list.filter(function (x) { return x.id === inst.open; })[0];
      if (i) return instDetail(i, T);
      inst.open = "";
    }
    var pending = pendingBallots(T).length;
    var html = '<div class="in"><div class="in-bar"><button type="button" class="in-toggle' + (inst.all ? "" : " on") + '" data-inst-act="mine">Your institutions (' + mine.length + ')</button><button type="button" class="in-toggle' + (inst.all ? " on" : "") + '" data-inst-act="all">View all (' + list.length + ")</button>" +
      (pending ? pill(pending + " awaiting you", "live") : "") + '<button type="button" class="in-found" data-inst-act="found">＋ Found institution</button></div>';
    if (inst.founding) {
      html += '<div class="in-form"><div class="in-kicker">Found an institution</div><h4>Create the institution first. Let diplomacy decide who joins it.</h4><p>Name it, say what it is for and invite the governments you want at the founding table. The others answer in their own voices.</p>' +
        '<div class="in-panel in-grid"><label>Name<input class="in-field" data-field="in-name" placeholder="Baltic Union" /></label><label>Type<select class="in-field" data-field="in-kind"><option>security alliance</option><option>economic union</option><option>political union</option><option>treaty commission</option></select></label>' +
        '<label class="wide">Purpose<textarea class="in-field" rows="3" data-field="in-purpose" placeholder="What is the institution for?"></textarea></label><label class="wide">Invite founding governments<input class="in-field" data-field="in-invite" placeholder="Germany, Italy, Spain" /></label></div>' +
        '<div class="in-formfoot"><button type="button" data-inst-act="cancel">Cancel</button><button type="button" class="go" data-inst-act="create">Found institution</button></div></div></div>';
      return html;
    }
    var shown = inst.all ? list : mine;
    html += '<div class="in-cards">' + (shown.length ? shown.map(function (x) {
      var open = BALLOTS.filter(function (b) { return b[0] === x.id && T >= b[1] && T < b[2]; }).length;
      var waiting = pendingBallots(T).filter(function (b) { return b[0] === x.id; }).length;
      var sub = x.role ? cap(x.role) + " · participating" + (open ? " · " + open + " open ballot" : "") : "world institution · public overview";
      return '<button type="button" class="in-card" data-inst="' + x.id + '">' + emblem(x, 42) + '<span class="in-cardtext"><span class="in-name"><b>' + esc(x.name) + "</b>" + (waiting ? pill(waiting + " action", "live") : "") + (x.T > 0 && T - x.T < 0.6 ? pill("new") : "") + '</span><span class="in-sub">' + sub + '</span></span><span class="in-chev">›</span></button>';
    }).join("") : '<div class="in-empty">Your government is not part of any institution and has no pending invitation or application.</div>') + "</div></div>";
    return html;
  }
  function instDetail(i, T) {
    var ballots = BALLOTS.filter(function (b) { return b[0] === i.id && T >= b[1] && T < b[2]; });
    var decisions = DECISIONS.filter(function (d) { return d[0] === i.id && d[1] <= T; });
    var docs = i.id === "strasbourg" ? DOCUMENTS.filter(function (d) { return d[0] <= T && d[2] === "France"; }) : [];
    var html = '<div class="in" data-institution-shell="persistent"><div class="in-head"><button type="button" class="in-back" data-inst-act="back" aria-label="Back">‹</button>' + emblem(i, 56) +
      '<div class="in-headtext"><div class="in-name"><b>' + esc(i.name) + "</b>" + pill(i.T > 0 && i.T <= T && i.id === "strasbourg" ? "provisional" : "active", i.id === "strasbourg" ? "neutral" : "good") + '</div><div class="in-sub">' + esc(i.kind.replace(/[_-]/g, " ")) + " · founded " + longDay(i.founded) + '</div><div class="in-purpose">' + esc(i.purpose) + "</div></div></div>";
    html += '<div class="in-facts"><div><small>Members</small><b>' + i.members.length + "/" + i.members.length + "</b></div><div><small>Your role</small><b>" + (i.role ? cap(i.role) : "not a member") + "</b></div><div><small>Decision rule</small><b>" + esc(i.rule) + "</b></div></div>";
    html += '<div class="in-tabs">' + [["overview", "Overview"], ["council", "Council"], ["agenda", "Agenda" + (ballots.length ? " (" + ballots.length + ")" : "")], ["decisions", "Decisions"], ["charter", "Charter"], ["members", "Members"], ["documents", "Documents" + (docs.length ? " (" + docs.length + ")" : "")]].map(function (t) {
      return '<button type="button" class="in-tab' + (inst.tab === t[0] ? " on" : "") + '" data-inst-tab="' + t[0] + '">' + t[1] + "</button>";
    }).join("") + "</div>";
    var waiting = pendingBallots(T).filter(function (b) { return b[0] === i.id; });
    if (inst.tab === "council" && waiting.length) html += '<button type="button" class="in-action" data-inst-tab="agenda"><span><small>Action required</small>' + waiting.length + ' ballot awaiting you</span><em>Review agenda →</em></button>';
    html += '<div class="in-content' + (inst.tab === "council" ? " council" : "") + '">';
    var ballotCard = function (b) {
      var vote = inst.votes[b[3]];
      return '<div class="in-panel in-proposal' + (vote ? "" : " live") + '"><div class="in-name"><b>' + esc(b[3]) + "</b>" + (vote ? "" : pill("Your vote", "live")) + pill("voting", "live") + '</div><div class="in-summary">' + esc(b[4]) + '</div><div class="in-meta">Submitted by ' + b[5] + " · " + esc(i.rule) + " · " + (vote ? 9 : 8) + "/" + i.members.length + " ballots</div>" +
        (vote ? pill("You voted " + vote, "neutral") : '<div class="in-votes">' + ["yes", "no", "abstain", "veto"].map(function (c) { return '<button type="button" data-inst-act="vote" data-title="' + esc(b[3]) + '" data-vote="' + c + '">' + cap(c) + "</button>"; }).join("") + "</div>") + "</div>";
    };
    if (inst.tab === "overview") {
      var business = ballots[0];
      html += '<div class="in-over"><div class="in-panel in-business' + (business ? " has" : "") + '"><div class="in-bizrow"><span class="in-bizic">▤</span><div><div class="in-kicker">Current business</div><b>' + (business ? esc(business[3]) : "No active formal business") + "</b><p>" + (business ? esc(business[4]) : "There are no debates, ballots or membership cases currently requiring attention.") + "</p>" + (business ? pill("voting", "live") : "") + "</div></div>" +
        '<div class="in-bizfoot"><button type="button" class="go" data-inst-tab="agenda">＋ Table a matter</button><button type="button" data-inst-tab="council">Open Council</button><a data-inst-tab="members">Review membership →</a></div></div>';
      html += '<div class="in-panel in-activity"><div class="in-acthead"><b>Recent activity</b>' + (decisions.length ? '<a data-inst-tab="decisions">View formal record →</a>' : "") + "</div>" + (decisions.length ? decisions.slice().reverse().slice(0, 5).map(function (d) {
        return '<div class="in-act"><i style="background:' + (d[3] === "passed" ? "#4ade80" : "#f87171") + '"></i><span><b>' + esc(d[2]) + "</b><small>" + d[3] + " · " + esc(i.rule) + "</small></span><em>" + longDay(d[8]) + "</em></div>";
      }).join("") : '<div class="in-none">No formal activity has been recorded yet.</div>') + "</div></div>";
    } else if (inst.tab === "agenda") {
      html += '<div class="in-panel in-table"><b>Table a matter</b><small>Open a Council debate first, or move a ready matter directly to a formal ballot.</small><input class="in-field" data-field="in-ptitle" placeholder="Proposal title" /><textarea class="in-field" rows="2" data-field="in-pbody" placeholder="What should the institution decide?"></textarea><div class="in-btns"><button type="button" class="go">Open for debate</button><button type="button" class="amber">Put to vote now</button></div></div>';
      html += ballots.length ? ballots.map(ballotCard).join("") : '<div class="in-none center">No active proposals, amendments or ballots.</div>';
    } else if (inst.tab === "decisions") {
      html += '<div class="in-kicker">Institutional record</div><h4 class="in-h">Decisions</h4><div class="in-sub" style="margin-bottom:.6rem">Passed, failed and implemented matters are preserved as formal history rather than buried in chat.</div>';
      html += decisions.length ? decisions.slice().reverse().map(function (d) {
        return '<div class="in-panel in-decision"><div class="in-kicker">Formal decision</div><div class="in-name"><b>' + esc(d[2]) + "</b>" + pill(d[3], d[3] === "passed" ? "good" : "bad") + '</div><div class="in-meta">' + longDay(d[8]) + " · " + esc(i.rule) + " · " + (d[4] + d[5] + d[6]) + ' ballots recorded</div><div class="in-summary">' + esc(d[9]) + '</div><div class="in-tally">' +
          [["For", d[4], "#dcfce7"], ["Against", d[5], "#fecaca"], ["Abstain", d[6], "rgba(255,255,255,.8)"]].concat(d[7] ? [["Veto", d[7], "#fecaca"]] : []).map(function (t) { return '<span><b style="color:' + t[2] + '">' + t[1] + "</b><small>" + t[0] + "</small></span>"; }).join("") + "</div></div>";
      }).join("") : '<div class="in-none center">No recorded formal decisions yet.</div>';
    } else if (inst.tab === "charter") {
      html += '<div class="in-panel in-charter"><div class="in-kicker">Decision framework</div><div class="in-name"><b>' + esc(i.rule) + "</b>" + pill("Default rule") + '</div><div class="in-sub">Every proposal type follows the default rule unless the charter says otherwise.</div></div>';
      html += '<div class="in-panel in-charter"><div class="in-kicker">Membership constitution</div><div class="in-fieldgrid">' + [["Purpose", i.purpose], ["Political character", i.character], ["Geographic scope", i.scope], ["Primary threat model", i.threat]].map(function (f) { return "<div><small>" + f[0] + "</small><span>" + esc(f[1]) + "</span></div>"; }).join("") + "</div>" +
        [["Accession", "approval", ""], ["Withdrawal", "notice", "365d notice"], ["Expulsion", "vote", ""], ["Dissolution", "unanimity", ""]].map(function (r) { return '<div class="in-panel in-rule"><b>' + r[0] + "</b>" + pill(r[1]) + (r[2] ? "<small>" + r[2] + "</small>" : "") + "</div>"; }).join("") + "</div>";
    } else if (inst.tab === "members") {
      html += '<div class="in-acthead"><b>Current members</b><small>' + i.members.length + " listed</small></div>" + i.members.map(function (m) {
        return '<div class="in-panel in-member"><b>' + esc(m) + "</b>" + pill(i.id === "unsc" && UNSC_MEMBERS.indexOf(m) < 5 ? "permanent member" : "member") + "<small>since " + i.founded.slice(0, 4) + "</small></div>";
      }).join("");
    } else if (inst.tab === "documents") {
      html += docs.length ? docs.map(function (d) { return '<div class="in-panel in-doc"><div class="in-name"><b>📄 ' + esc(d[1]) + "</b><em>" + d[3] + '</em></div><div class="in-sub">From ' + d[2] + " · " + d[4] + '</div><div class="in-docbody">' + esc(d[5]) + "</div></div>"; }).join("") : '<div class="in-none center">No institution-related documents currently readable by your government.</div>';
    } else {
      var lines = (COUNCIL[i.id] || []).filter(function (l) { return l[0] <= T; });
      html += '<div class="in-panel in-council">' + (i.role ? (lines.length ? '<div class="dp-msgs">' + lines.map(function (l) { return '<div class="dp-msg"><span class="dp-speaker">' + l[1] + '</span><div class="dp-bubble">' + esc(l[2]) + "</div></div>"; }).join("") + "</div>" : '<div class="in-none center">The Council is quiet.</div>') + '<div class="dp-compose"><textarea rows="1" placeholder="Speak to the Council…" aria-label="Speak to the Council"></textarea><button type="button" aria-label="Send">🚀</button></div>' : '<div class="in-none center"><b>Council channel</b><br>Only participating governments receive a persistent institutional council channel. This public view does not create one.</div>') + "</div>";
    }
    return html + "</div></div>";
  }
  function instClick(event) {
    var card = event.target.closest("[data-inst]");
    var tab = event.target.closest("[data-inst-tab]");
    var act = event.target.closest("[data-inst-act]");
    if (card) { inst.open = card.getAttribute("data-inst"); inst.tab = "overview"; return true; }
    if (tab) { inst.tab = tab.getAttribute("data-inst-tab"); return true; }
    if (!act) return false;
    var what = act.getAttribute("data-inst-act");
    if (what === "back") inst.open = "";
    else if (what === "mine") inst.all = false;
    else if (what === "all") inst.all = true;
    else if (what === "found") inst.founding = true;
    else if (what === "cancel") inst.founding = false;
    else if (what === "create") {
      var name = (fields["in-name"] || "").trim();
      if (!name) return true;
      var invited = (fields["in-invite"] || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      inst.founded.push({ id: "founded-" + inst.founded.length, T: state.T, name: name, short: "", kind: fields["in-kind"] || "security alliance", founded: isoDate(dateAt(state.T, state.korea)), role: "founder", rule: "Simple majority", members: ["France"].concat(invited), purpose: (fields["in-purpose"] || "").trim() || "To be written by its founders", character: "Provisional", scope: "To be agreed", threat: "To be agreed" });
      inst.founding = false;
      ["in-name", "in-purpose", "in-invite"].forEach(function (k) { fields[k] = ""; });
    } else if (what === "vote") inst.votes[act.getAttribute("data-title")] = act.getAttribute("data-vote");
    else return false;
    return true;
  }

  function setPop(which, byHand) {
    if (byHand) state.manual.pop = which || "none";
    if (state.pop === which) return;
    state.pop = which;
    state.keys.panel = "";
    state.keys.dip = "";
    el.panel.hidden = !which || which === "chat";
    el.panel.classList.toggle("dock-panel", which === "actions" || which === "projects");
    el.dip.hidden = which !== "chat";
    if (which === "chat" && !byHand && state.step === "talks") { dip.view = "thread"; dip.thread = CHATS.length - 1; }
    // main.jsx: on a phone a bottom panel opening closes the advisor and the country panel.
    if (which && byHand && phone()) setDrawer(null, true);
    el.eventsBtn.classList.toggle("on", which === "events");
    Array.prototype.forEach.call(el.root.querySelectorAll("[data-pop]"), function (b) { b.classList.toggle("on", b.getAttribute("data-pop") === which); });
    renderPanel(state.T);
    renderDip(state.T);
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
    setFold(phone());
    state.keys.war = "";
  }
  // warRoom.jsx on a phone: "Map" folds the sheet down to its foot and brings out the troop rail.
  function setFold(folded) {
    state.fold = folded;
    el.root.classList.toggle("war-folded", folded);
    $("wrFold").textContent = folded ? "Generals" : "Map";
    $("wrFold").setAttribute("aria-label", folded ? "Show the generals" : "Show the map");
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
      // On a phone a sheet covers the map, so a chapter opens one only where the map is not the point,
      // and never with a bottom panel (main.jsx: they take turns).
      setDrawer(!phone() ? DRAWER[step] || "advisor" : POP[step] || step === "launch" || step === "korea" ? null : DRAWER[step] || null);
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
    renderDip(T);
    var unread = CHATS.filter(function (c, i) { return threadUnread(i, T); }).length;
    el.chatBadge.hidden = !unread;
    el.chatBadge.textContent = unread > 9 ? "9+" : String(unread);
    if (state.war) renderWar(T, state.korea);
    if (advanced.open) renderAdvanced(T);
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
    // advisor.jsx: a touch screen's placeholder leaves out the Shift+Enter hint.
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) el.ask.querySelector("textarea").placeholder = "Ask your advisor…";
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
    el.dip = $("gxDip");
    el.dip.addEventListener("click", dipClick);
    el.dip.addEventListener("submit", dipSend);
    var typing = function (event) {
      var key = event.target.getAttribute && event.target.getAttribute("data-field");
      if (!key) return;
      fields[key] = event.target.value;
      if (key === "spy-search" || key.indexOf("spy-kind-") === 0) { state.keys.dip = ""; renderDip(state.T); }
      else syncOrderButtons();
    };
    el.dip.addEventListener("input", typing);
    el.dip.addEventListener("change", typing);
    el.dip.addEventListener("keydown", function (event) { if (event.key === "Enter" && !event.shiftKey && event.target.tagName === "TEXTAREA") { event.preventDefault(); dipSend({ target: event.target, preventDefault: function () {} }); } });
    el.warBtn.addEventListener("click", function () { setWar(!state.war, true); });
    $("wrFold").addEventListener("click", function () { setFold(!state.fold); });
    $("gxCountryName").addEventListener("click", function () { if (phone()) setDrawer(state.drawer === "country" ? null : "country", true); });
    el.msgs.addEventListener("pointermove", chartHover);
    el.msgs.addEventListener("pointerout", function (event) { if (!event.relatedTarget || !event.relatedTarget.closest || !event.relatedTarget.closest(".gx-chart-box")) Array.prototype.forEach.call(el.msgs.querySelectorAll(".gx-chart-tip"), function (t) { t.hidden = true; }); });
    el.advanced = $("gxAdvanced");
    el.advanced.addEventListener("click", advancedClick);
    el.advanced.addEventListener("pointermove", function (event) {
      var hit = event.target.closest && event.target.closest("[data-hover]");
      var i = hit ? +hit.getAttribute("data-hover") : -1;
      if (i !== advanced.hover) { advanced.hover = i; renderAdvanced(state.T); }
    });
    el.advanced.addEventListener("pointerleave", function () { if (advanced.hover >= 0) { advanced.hover = -1; renderAdvanced(state.T); } });
    el.country.addEventListener("click", function (event) { if (event.target.closest("[data-open-advanced]")) setAdvanced(true); });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape" && advanced.open) setAdvanced(false); });
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
