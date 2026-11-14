/*! Open Historia — the landing page's game interface © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game's own HUD over the story's map, built as the game builds it: the
// ☰ menu, the session pill and Exit Game (libraryBar.jsx), the date with « for
// the Events panel and » for the time skip (time.jsx), the dock of Chat,
// Actions (with Projects as its second tab) and Rostra, the world's social
// network, with Search beside it (chat.jsx, actions.jsx, social.jsx,
// hudDock.js), the flag badge and the advisor button (other.jsx, main.jsx), the Advisor drawer
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
  // Rostra's feed (social.jsx): each post is out from story time t. A flag is three stripes, down
  // unless `across`; France's are the default. `kind` "player" is France's own, "everyday" a post about
  // nothing in world affairs (one every other time skip); `round` is the chapter a post of France's
  // was made in, answered from the next.
  var POSTS = [
    { t: 0.2, id: "p1", author: "Margot Lefèvre", role: "Political editor, Le Quotidien", country: "France", date: "2016-01-01", text: "Happy new year from Paris. The unions promise a hard spring, the Élysée a quiet one. One of them is wrong.", reposts: 210, likes: 1900 },
    { t: 0.5, id: "p2", author: "The Chancellor of Germany", country: "Germany", flag: ["#000000", "#dd0000", "#ffce00"], across: true, date: "2016-01-01", mentions: ["France"], text: "A good start to 2016 with our friends in France. Europe is strongest when Paris and Berlin speak with one voice.", reposts: 9800, likes: 64000 },
    { t: 0.75, id: "p3", author: "Luca Marino", role: "Actor", country: "Italy", flag: ["#009246", "#ffffff", "#ce2b37"], date: "2016-01-01", kind: "everyday", text: "Three hours in the queue at a bakery in Montmartre for one croissant. Worth every minute. I would do it again tomorrow.", reposts: 7400, likes: 88000 },
    { t: 1.2, id: "p4", author: "The President of Russia", country: "Russia", flag: ["#ffffff", "#0039a6", "#d52b1e"], across: true, date: "2016-08-09", text: "Ten missiles crossed the Arctic tonight. Russia will remember who fired them, and when.", reposts: 41000, likes: 230000 },
    { t: 1.95, id: "p5", author: "Margot Lefèvre", role: "Political editor, Le Quotidien", country: "France", date: "2016-08-09", text: "Seven caught, three through. Paris is very quiet tonight.", reposts: 520, likes: 4100 },
    { t: 2.1, id: "p6", author: "Antoine Garnier", role: "Correspondent in Busan", country: "France", date: "2016-09-02", text: "Sirens across Seoul. The trains south are full. Nobody here thought the North would cross tonight.", reposts: 1300, likes: 11000 },
    { t: 2.7, id: "p7", author: "Siobhán Kelly", role: "Nurse, Cork", country: "Ireland", flag: ["#169b62", "#ffffff", "#ff883e"], date: "2016-09-28", kind: "everyday", text: "Night shift done, the dog has eaten my left shoe, and the kettle is on. Small victories.", reposts: 12, likes: 96 },
    { t: 4.4, id: "p8", author: "France", country: "France", date: "2016-12-01", kind: "player", round: 4, text: "France offers Strasbourg for a peace congress. Washington, Moscow, Beijing: there is a seat at the table for each of you.", reposts: 26000, likes: 190000 },
    { t: 5.2, id: "p9", author: "The President of the United States", country: "United States", flag: ["#3c3b6e", "#ffffff", "#b22234"], across: true, date: "2017-01-01", quote: "p8", text: "Washington accepts. Our Secretary of State will lead the delegation to Strasbourg.", reposts: 18000, likes: 150000 },
    { t: 5.25, id: "p10", author: "The President of China", country: "China", flag: ["#de2910", "#de2910", "#de2910"], date: "2017-01-01", quote: "p8", text: "China will bring its neighbour. The armistice line is the one held on the day of signing.", reposts: 9100, likes: 72000 },
    { t: 6.3, id: "p11", author: "The President of Russia", country: "Russia", flag: ["#ffffff", "#0039a6", "#d52b1e"], across: true, date: "2017-01-14", quote: "p8", text: "We will come to Strasbourg, as the injured party. Inspectors go to Montana as well as to Plesetsk.", reposts: 33000, likes: 210000 },
    { t: 7.3, id: "p12", author: "Camille Rousseau", role: "Deputy, Assemblée nationale", country: "France", date: "2017-02-09", mentions: ["France"], text: "341 to 156. France goes to Strasbourg with the Assemblée behind it.", reposts: 2100, likes: 19000 },
    { t: 7.6, id: "p13", author: "Tunde Adeyemi", role: "Footballer", country: "Nigeria", flag: ["#008751", "#ffffff", "#008751"], date: "2017-02-09", kind: "everyday", text: "Hat-trick tonight and my mother still wants to know why I missed the fourth.", reposts: 15000, likes: 120000 },
    { t: 8.3, id: "p14", author: "The Secretary-General of the United Nations", date: "2017-03-02", quote: "p8", mentions: ["France"], text: "The Final Act of Strasbourg is signed: an armistice in Korea, and ten years without a launch. The world owes France a debt today.", reposts: 61000, likes: 420000 }
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
  var POP = { order: "actions", skip: "events", talks: "chat", congress: "actions" };
  // Which tab of the Actions panel a chapter opens it on.
  var ACTIONS_TAB = { congress: "projects" };
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
    ["Transport", '<path d="M12 2.5l4.5 6v10L14 21.5h-4l-2.5-3v-10z"/><path d="M12 7v10"/>'],
    ["Diversion", '<path d="M4 18c2-7 6-9 14-10" stroke-dasharray="3.2 3.4"/><path d="M14.5 4.6L18.4 8l-3.2 3.9"/>'],
    ["Deploy", '<path d="M3 19h18"/><path d="M4.5 11h4v4h-4z"/><path d="M10 11h4v4h-4z"/><path d="M15.5 11h4v4h-4z"/>'],
    ["Aircraft", '<path d="M12 2.5l1.2 5.5 6.8 4v1.7l-6.8-1.9-.4 3.6 2.2 1.6v1.2L12 17.5l-3 .7V17l2.2-1.6-.4-3.6L4 13.7V12l6.8-4z"/><path d="M7 20.5h.01M12 21.5h.01M17 20.5h.01" stroke-width="2.6"/>'],
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
      '<div class="gx-base gx-date gx-hud"><button type="button" class="gx-arrow" id="gxEventsBtn" aria-label="Events">«</button>' +
      '<div class="gx-date-mid"><button type="button" class="gx-date-country" id="gxCountryName" title="France · Open country panel">France</button><span class="gx-date-day" id="gxDate">January 1st, 2016</span></div>' +
      '<button type="button" class="gx-arrow" id="gxSkipBtn" aria-label="Timeline">»</button></div>' +
      // time.jsx PanelChrome: the Events panel and the dock's windows
      '<div class="gx-panel gx-hud" id="gxPanel" hidden><div class="gx-panel-head"><div><div class="gx-panel-title" id="gxPanelTitle">Events</div><div class="gx-panel-sub" id="gxPanelSub"></div></div>' +
      '<button type="button" class="gx-x" id="gxPanelClose" aria-label="Close">' + X_ICON + '</button></div><div class="gx-panel-body" id="gxPanelBody"></div></div>' +
      // chat.jsx: the Diplomacy panel
      '<div class="dp gx-hud" id="gxDip" hidden></div>' +
      // actions.jsx ActionsPanel
      '<div class="gx-panel dock-panel ac gx-hud" id="gxActions" hidden></div>' +
      // social.jsx SocialPanel
      '<div class="gx-panel dock-panel rs gx-hud" id="gxSocial" role="dialog" aria-label="Rostra" hidden></div>' +
      // chat.jsx Toolbar
      '<div class="gx-base gx-dock gx-hud" role="toolbar" aria-label="Game windows">' +
      '<button type="button" class="gx-launch" data-pop="chat" title="Chat" aria-label="Diplomacy"><span class="rs-dock"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg><span class="gx-badge" id="gxChatBadge" hidden></span></span></button>' +
      '<button type="button" class="gx-launch" data-pop="actions" title="Actions and Projects" aria-label="Actions"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L13.5 9.5L21 11L13.5 12.5L12 20L10.5 12.5L3 11L10.5 9.5L12 2Z"/></svg></button>' +
      '<button type="button" class="gx-launch" data-pop="social" title="Rostra" aria-label="Rostra" id="gxSocialBtn"><span class="rs-dock">' + ROSTRA_ICON + '<span class="gx-badge rs-badge" id="gxSocialBadge" hidden></span></span></button></div>' +
      // search.jsx
      '<div class="gx-base gx-search gx-hud" id="gxSearch" role="button" tabindex="0" title="Search place" aria-label="Search place"><span class="gx-search-ic"><svg class="mag" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg><svg class="cls" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></span>' +
      '<input type="text" placeholder="Search place..." aria-label="Search place" hidden /><span class="gx-search-go" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span><div class="gx-search-list" hidden></div></div>' +
      // MapModeSelector.jsx: Political / Diplomatic, under the advisor button, with the diplomatic legend
      '<div class="gx-mapmode gx-hud" id="gxMapMode"><div class="gx-mm-legend" hidden><div class="hd"><span>Diplomacy</span><button type="button" data-mm="hide" title="Close legend">✕</button></div>' +
      [["You", "rgb(37, 99, 235)"], ["Puppets", "rgb(20, 184, 166)"], ["Allies", "rgb(56, 189, 248)"], ["Friendly / Trade", "rgb(34, 197, 94)"], ["Hostile", "rgb(249, 115, 22)"], ["At War", "rgb(239, 68, 68)"], ["Neutral", "rgb(100, 116, 139)"]].map(function (r) { return '<div class="row"><i style="background:' + r[1] + ";box-shadow:0 0 6px " + r[1].replace("rgb", "rgba").replace(")", ", 0.33)") + '"></i>' + r[0] + "</div>"; }).join("") + "</div>" +
      '<div class="gx-mm-bar"><button type="button" class="on" data-mm="political" title="Political map mode"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg><span>Political</span></button>' +
      '<button type="button" class="dip" data-mm="diplomatic" title="Diplomatic map mode"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg><span>Diplomatic</span></button></div></div>' +
      // other.jsx flag badge, main.jsx AdvisorButton
      '<button type="button" class="gx-base gx-flag-btn gx-hud" id="gxFlagBtn" title="France" aria-label="Country">' + tricolour() + '</button>' +
      '<button type="button" class="gx-base gx-advisor-btn gx-hud" id="gxAdvisorBtn" title="Advisor" aria-label="Advisor"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M4.5 21c.8-4.2 3.3-6.3 7.5-6.3s6.7 2.1 7.5 6.3"/></svg></button>' +
      // advisor.jsx + AdvisorRecipients.jsx + AdvisorMic.jsx: the Advisor dossier
      '<aside class="gx-drawer gx-adv gx-hud" id="gxAdvisor" aria-label="Advisor"><span class="gx-grip"></span>' +
      '<div class="gx-adv-head"><span class="mark" aria-hidden="true">◇</span><span class="title">Advisor</span><span class="sp"></span><button type="button" class="gx-adv-hbtn" id="gxClear" title="Clear chat" aria-label="Clear chat">🗑</button><button type="button" class="gx-adv-hbtn close" data-close aria-label="Close advisor">✕</button></div>' +
      '<section class="gx-adv-recipients" aria-label="Advisor conversations"><div class="gx-adv-rtop"><button type="button" class="gx-adv-trigger" id="gxRecipient" aria-expanded="false"><span>Chief advisor</span><span class="chev">▾</span></button><button type="button" class="gx-adv-contact" id="gxContact">+ Contact</button></div>' +
      '<div class="gx-adv-list" id="gxRecipientList" hidden><button type="button" class="gx-adv-row on"><b>Chief advisor</b> · Original conversation<small>Your government\'s chief advisor</small></button></div></section>' +
      '<div class="gx-msgs" id="gxMsgs" aria-live="polite"></div>' +
      '<form class="gx-adv-composer" id="gxAsk"><div class="gx-adv-field"><textarea rows="1" aria-label="Ask your advisor"></textarea>' +
      '<button type="button" class="gx-adv-mic" aria-label="Speak to the advisor"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button></div>' +
      '<button type="submit" class="gx-adv-send" aria-label="Send message" disabled><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m-7 7 7-7 7 7"/></svg></button></form></aside>' +
      // countryPanel.jsx + stats.jsx: the Country dossier
      '<aside class="gx-drawer gx-dos gx-hud" id="gxCountry" aria-label="Country"><span class="gx-grip"></span>' +
      '<div class="gx-dos-toolbar"><span class="mark" aria-hidden="true">◈</span><span class="title">Country</span><span class="sp"></span><button type="button" class="gx-dos-close" data-close aria-label="Close country panel">✕</button></div>' +
      '<div class="gx-dos-scroll" id="gxDosScroll"><div class="gx-dos-hero"><div class="gx-dos-flag">' + tricolour() + '</div><div class="gx-dos-id"><div class="gx-dos-namerow"><span class="gx-dos-name">France</span><span class="gx-dos-yours">Your country</span></div>' +
      '<div class="gx-dos-place">Paris · Europe</div><div class="gx-dos-chips"><span class="tier">Major power</span><span>Security Council</span><span>European Union</span><span>NATO</span></div></div><span class="gx-dos-refresh" id="gxDosRefresh" aria-hidden="true">↻</span></div>' +
      '<div class="gx-dos-tabs" role="navigation" aria-label="Country"><button type="button" data-view="politics">🏛 Politics</button><button type="button" data-view="diplomacy">🤝 Diplomacy</button><button type="button" data-view="economy">📈 Economy</button><button type="button" data-view="ranking">🏆 Ranking</button></div>' +
      '<div class="gx-dos-content" id="gxView"></div></div></aside>' +
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

  // ---- the Advisor dossier (advisor.jsx, advisorDossier.css) ------------------------------------------
  // The advisor's replies are a column under a rule, not bubbles; only the player's own words are a bubble.
  function messageHtml(who, text, date, chart) {
    if (who === "u") return '<div class="gx-msg user"><div class="gx-adv-body user">' + esc(text) + "</div></div>";
    if (text === null) return '<div class="gx-msg thinking"><span class="gx-adv-thinklabel">🧭 Advisor</span><div class="gx-adv-thinking"><span>Thinking…&nbsp;</span>' + ".".repeat(Math.floor(Date.now() / 500) % 4) + "</div></div>";
    return '<div class="gx-msg"><span class="gx-msg-label">🧭 Advisor</span><div class="gx-adv-body">' + esc(text) + (chart ? chartHtml(chart) : "") + "</div>" + (date ? '<span class="gx-msg-time">' + date + "</span>" : "") + "</div>";
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
  // AdvisorMic.jsx: the mic sits in the box until something is typed; the send arrow wakes with the text.
  function syncComposer() {
    var typedText = !!el.ask.querySelector("textarea").value.trim();
    el.ask.querySelector(".gx-adv-mic").hidden = typedText;
    el.ask.querySelector(".gx-adv-send").disabled = !typedText;
  }
  function ask(event) {
    event.preventDefault();
    var input = el.ask.querySelector("textarea");
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    syncComposer();
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

  // ---- the Country dossier (stats.jsx, PoliticalOverview.jsx, countryDossier.css) ------------------------
  function figuresAt(T) {
    var x = Math.max(0, T - 0.5);
    var i = Math.min(FIGURES.length - 1, Math.floor(x));
    var j = Math.min(FIGURES.length - 1, i + 1);
    var e = smooth(clamp(x - i));
    var out = {};
    for (var key in FIGURES[i]) out[key] = FIGURES[i][key] + (FIGURES[j][key] - FIGURES[i][key]) * e;
    return out;
  }
  // Small flags for the countries the dossier lists, drawn as the game shows its flag images (3:2, contained).
  var FLAGS = {
    "France": '<rect width="3" height="2" fill="#fff"/><rect width="1" height="2" fill="#0055a4"/><rect x="2" width="1" height="2" fill="#ef4135"/>',
    "Italy": '<rect width="3" height="2" fill="#fff"/><rect width="1" height="2" fill="#009246"/><rect x="2" width="1" height="2" fill="#ce2b37"/>',
    "Germany": '<rect width="3" height="2" fill="#ffce00"/><rect width="3" height=".667" fill="#000"/><rect y=".667" width="3" height=".667" fill="#dd0000"/>',
    "Russia": '<rect width="3" height="2" fill="#d52b1e"/><rect width="3" height=".667" fill="#fff"/><rect y=".667" width="3" height=".667" fill="#0039a6"/>',
    "Japan": '<rect width="3" height="2" fill="#fff"/><circle cx="1.5" cy="1" r=".6" fill="#bc002d"/>',
    "China": '<rect width="3" height="2" fill="#de2910"/><path d="M.5 .25l.12.36h.38l-.31.22.12.36-.31-.22-.31.22.12-.36-.31-.22h.38z" fill="#ffde00"/>',
    "United States": '<rect width="3" height="2" fill="#fff"/><path d="M0 0h3v.154H0zm0 .308h3v.154H0zm0 .308h3v.154H0zm0 .308h3v.154H0zm0 .308h3v.154H0zm0 .308h3v.154H0zm0 .308h3v.154H0z" fill="#b22234"/><rect width="1.2" height="1.077" fill="#3c3b6e"/>',
    "United Kingdom": '<rect width="3" height="2" fill="#012169"/><path d="M0 0l3 2M3 0L0 2" stroke="#fff" stroke-width=".4"/><path d="M0 0l3 2M3 0L0 2" stroke="#c8102e" stroke-width=".13"/><path d="M1.5 0v2M0 1h3" stroke="#fff" stroke-width=".55"/><path d="M1.5 0v2M0 1h3" stroke="#c8102e" stroke-width=".3"/>',
    "India": '<rect width="3" height="2" fill="#fff"/><rect width="3" height=".667" fill="#ff9933"/><rect y="1.333" width="3" height=".667" fill="#138808"/><circle cx="1.5" cy="1" r=".24" fill="none" stroke="#000080" stroke-width=".05"/>',
    "Brazil": '<rect width="3" height="2" fill="#009c3b"/><path d="M1.5 .2L2.75 1 1.5 1.8.25 1z" fill="#ffdf00"/><circle cx="1.5" cy="1" r=".42" fill="#002776"/>',
    "Canada": '<rect width="3" height="2" fill="#fff"/><rect width=".75" height="2" fill="#d52b1e"/><rect x="2.25" width=".75" height="2" fill="#d52b1e"/><path d="M1.5 .45l.14.3.25-.08-.08.36.22.06-.3.24.05.17H1.56v.3h-.12v-.3H1.22l.05-.17-.3-.24.22-.06-.08-.36.25.08z" fill="#d52b1e"/>',
    "South Korea": '<rect width="3" height="2" fill="#fff"/><circle cx="1.5" cy="1" r=".5" fill="#003478"/><path d="M1 1a.5.5 0 0 1 1 0 .25.25 0 0 1-.5 0 .25.25 0 0 0-.5 0z" fill="#c60c30"/>',
    "North Korea": '<rect width="3" height="2" fill="#024fa2"/><rect y=".33" width="3" height="1.34" fill="#fff"/><rect y=".4" width="3" height="1.2" fill="#ed1c27"/><circle cx="1" cy="1" r=".4" fill="#fff"/><path d="M1 .68l.09.27h.29l-.24.17.09.28L1 1.23l-.23.17.09-.28-.24-.17h.29z" fill="#ed1c27"/>',
    "Australia": '<rect width="3" height="2" fill="#012169"/><path d="M0 0l1.5 1M1.5 0L0 1" stroke="#fff" stroke-width=".2"/><path d="M.75 0v1M0 .5h1.5" stroke="#fff" stroke-width=".3"/><path d="M.75 0v1M0 .5h1.5" stroke="#c8102e" stroke-width=".16"/><circle cx=".75" cy="1.5" r=".18" fill="#fff"/><circle cx="2.25" cy=".5" r=".08" fill="#fff"/><circle cx="2.25" cy="1.6" r=".09" fill="#fff"/><circle cx="2.6" cy="1" r=".08" fill="#fff"/>',
    "Turkey": '<rect width="3" height="2" fill="#e30a17"/><circle cx="1.15" cy="1" r=".5" fill="#fff"/><circle cx="1.27" cy="1" r=".4" fill="#e30a17"/><circle cx="1.85" cy="1" r=".16" fill="#fff"/>'
  };
  function flagSvg(name) { return FLAGS[name] ? '<svg viewBox="0 0 3 2" aria-hidden="true">' + FLAGS[name] + "</svg>" : ""; }
  // The Assemblée as it sat in 2016, and who stood where in the polls.
  var PARTIES = [
    { name: "Socialist Party", abbr: "PS", native: "Parti socialiste", colour: "#e75480", role: "Governing", family: "Social Democracy", sub: "Third Way", leader: "Jean-Christophe Cambadélis", seats: 280, support: 19.5, founded: 1969 },
    { name: "The Republicans", abbr: "LR", native: "Les Républicains", colour: "#2b6cb8", role: "Opposition", family: "Social Conservatism", sub: "Gaullism", leader: "Nicolas Sarkozy", seats: 194, support: 22, founded: 2015 },
    { name: "National Front", abbr: "FN", native: "Front national", colour: "#24345e", role: "Opposition", family: "National Populism", sub: "Souverainism", leader: "Marine Le Pen", seats: 2, support: 26, founded: 1972 },
    { name: "Left Front", abbr: "FG", native: "Front de gauche", colour: "#c9182b", role: "Opposition", family: "Radical Socialism", sub: "Democratic socialism", leader: "Jean-Luc Mélenchon", seats: 10, support: 12, founded: 2008 },
    { name: "Union of Democrats and Independents", abbr: "UDI", native: "Union des démocrates et indépendants", colour: "#00a3d9", role: "Opposition", family: "Social Liberalism", sub: "Christian democracy", leader: "Jean-Christophe Lagarde", seats: 27, support: 5, founded: 2012 },
    { name: "Europe Ecology – The Greens", abbr: "EELV", native: "Europe Écologie Les Verts", colour: "#3fa535", role: "Opposition", family: "Social Democracy", sub: "Green politics", leader: "David Cormand", seats: 16, support: 4, founded: 2010 },
    { name: "Radical Party of the Left", abbr: "PRG", native: "Parti radical de gauche", colour: "#f2b134", role: "Coalition partner", family: "Social Liberalism", sub: "Radicalism", leader: "Sylvia Pinel", seats: 17, support: 1.5, founded: 1972 }
  ];
  var ROLE_TONES = { "Governing": "#fbbf24", "Coalition partner": "#fcd34d", "Opposition": "#93c5fd", "Outside parliament": "#94a3b8" };
  var FAMILY_COLOURS = { "Radical Socialism": "#f0506e", "Social Democracy": "#f28cb1", "Social Liberalism": "#f2c94c", "Market Liberalism": "#e8e25a", "Social Conservatism": "#5aa9e6", "National Populism": "#6b4226" };
  var MEMBERSHIPS = [["United Nations", "since 24 Oct 1945 · permanent seat on the Security Council", "member / founder"], ["European Union", "since 1 Nov 1993 · the Communities since 1 Jan 1958", "member / founder"], ["North Atlantic Treaty Organization", "since 4 Apr 1949", "member / founder"], ["Group of Seven", "since 15 Nov 1975", "member / founder"], ["Council of Europe", "since 5 May 1949", "member / founder"]];
  var RELATION_NOTES = {
    de: "The closest partner in Europe: the two capitals agree before Brussels does.",
    us: "An old ally, shaken by launches nobody in Washington will yet explain.",
    uk: "Neighbours and fellow permanent members, with a referendum between them.",
    cn: "A trading partner that holds Pyongyang's ear.",
    ru: "Sanctions over Ukraine, and now the fires at its missile fields.",
    kp: "No embassy in Paris, and a war in the South."
  };
  // [key, label, value of each country (France's from its figures where it has them), format]
  var RANKINGS = [
    ["population", "Population", { "China": 1379, "India": 1324, "United States": 323, "Brazil": 206, "Russia": 144, "Japan": 127, "Germany": 82.5, "Turkey": 79.5, "France": null, "United Kingdom": 65.6, "Italy": 60.6, "South Korea": 51.2, "Canada": 36.3, "North Korea": 25.4, "Australia": 24.1 }, function (v) { return v.toFixed(1) + "M"; }],
    ["economy", "Economy", { "United States": 18.7, "China": 11.2, "Japan": 4.9, "Germany": 3.5, "United Kingdom": 2.7, "France": null, "India": 2.3, "Italy": 1.9, "Brazil": 1.8, "Canada": 1.5, "South Korea": 1.4, "Russia": 1.3, "Australia": 1.2, "Turkey": 0.86, "North Korea": 0.03 }, function (v) { return "$" + (v >= 1 ? v.toFixed(1) + "T" : Math.round(v * 1000) + "B"); }],
    ["wealth", "Wealth per person", { "United States": 57900, "Australia": 49900, "Canada": 42300, "Germany": 42100, "United Kingdom": 41100, "Japan": 38900, "France": null, "Italy": 30500, "South Korea": 27600, "Russia": 8700, "Turkey": 10900, "China": 8100, "Brazil": 8700, "India": 1700, "North Korea": 1200 }, function (v) { return "$" + Math.round(v / 100) * 100 >= 0 ? "$" + (Math.round(v / 100) * 100).toLocaleString("en") : ""; }],
    ["military", "Military power", { "United States": 94.2, "Russia": 86.5, "China": 82.1, "India": 64.8, "France": 61.3, "United Kingdom": 59.7, "Japan": 52.4, "South Korea": 51.6, "Turkey": 47.9, "Germany": 46.2, "Italy": 42.5, "Brazil": 39.8, "North Korea": 38.4, "Australia": 33.1, "Canada": 27.6 }, function (v) { return v.toFixed(1); }],
    ["land", "Land held", { "Russia": 85, "Canada": 72, "United States": 186, "China": 34, "Brazil": 27, "Australia": 8, "India": 36, "France": 66, "Turkey": 81, "Germany": 16, "Japan": 47, "Italy": 20, "United Kingdom": 72, "South Korea": 17, "North Korea": 13 }, function (v) { return String(Math.round(v)); }],
    ["stability", "Stability", { "Canada": 81, "Australia": 79, "Germany": 77, "Japan": 76, "United Kingdom": 66, "France": null, "Italy": 61, "United States": 58, "South Korea": 55, "China": 72, "India": 57, "Brazil": 44, "Turkey": 41, "Russia": 49, "North Korea": 38 }, function (v) { return String(Math.round(v)); }],
    ["reputation", "Reputation", { "Canada": 86, "Germany": 84, "Japan": 82, "Australia": 79, "France": null, "United Kingdom": 74, "Italy": 70, "South Korea": 69, "United States": 61, "Brazil": 58, "India": 60, "Turkey": 43, "China": 47, "Russia": 31, "North Korea": 8 }, function (v) { return String(Math.round(v)); }],
    ["weariness", "War weariness", { "North Korea": 41, "South Korea": 47, "Russia": 22, "United States": 9, "France": 0, "Germany": 0, "United Kingdom": 0, "Japan": 3, "China": 2, "India": 0, "Italy": 0, "Brazil": 0, "Canada": 0, "Australia": 0, "Turkey": 0 }, function (v) { return String(Math.round(v)); }]
  ];
  RANKINGS[2][3] = function (v) { return "$" + (Math.round(v / 100) * 100).toLocaleString("en"); };
  var dossier = { rank: "economy", openRank: "France", openRelation: "", relSearch: "", relSort: "strongest" };
  function bar(value, colour) { return '<div class="gx-bar"><i style="width:' + Math.max(0, Math.min(100, value)).toFixed(1) + "%;background-color:" + colour + '"></i></div>'; }
  function stabilityColour(v) { return v < 40 ? "#ef4444" : v < 70 ? "#f59e0b" : "#22c55e"; }
  function relationTone(v) {
    if (v >= 55) return ["Friendly", "#34d399"];
    if (v >= 20) return ["Cordial", "#60a5fa"];
    if (v >= -10) return ["Neutral", "#d1d1d5"];
    if (v >= -30) return ["Cautious", "#fbbf24"];
    if (v >= -60) return ["Strained", "#fb923c"];
    if (v > -90) return ["Hostile", "#f87171"];
    return ["Rival", "#f87171"];
  }
  function signed(v, digits) { return (v >= 0 ? "+" : "") + v.toFixed(digits); }
  function badge(text, tone, extra) { return '<span class="gx-badge-s" style="background:' + tone + "1f;border-color:" + tone + "66;color:" + tone + (extra || "") + '">' + esc(text) + "</span>"; }
  // PoliticalOverview.jsx: the support donut, segments clockwise from twelve o'clock with a hair of a gap.
  function donut(parties, other) {
    var slices = parties.map(function (p) { return [p.support, p.colour]; }).concat([[other, "rgba(148,163,184,0.72)"]]);
    var a = 0, svg = '<svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="78" fill="rgba(255,255,255,0.025)" stroke="rgba(255,255,255,0.05)"/>';
    var pt = function (r, deg) { var rad = (deg - 90) * Math.PI / 180; return (90 + r * Math.cos(rad)).toFixed(2) + " " + (90 + r * Math.sin(rad)).toFixed(2); };
    slices.forEach(function (s) {
      var span = s[0] * 3.6, gap = span < 7 ? 0.25 : 1.2, from = a + gap / 2, to = a + span - gap / 2;
      if (to > from) {
        var large = to - from > 180 ? 1 : 0;
        svg += '<path d="M' + pt(78, from) + " A78 78 0 " + large + " 1 " + pt(78, to) + " L" + pt(50, to) + " A50 50 0 " + large + " 0 " + pt(50, from) + 'Z" fill="' + s[1] + '" opacity="0.9" stroke="rgba(11,15,23,0.88)" stroke-width="1.5"/>';
      }
      a += span;
    });
    return svg + '<circle cx="90" cy="90" r="47" fill="rgba(18,20,27,0.98)" stroke="rgba(255,255,255,0.07)"/><text x="90" y="85" text-anchor="middle" fill="rgba(255,255,255,0.94)" font-size="11" font-weight="800">Political</text><text x="90" y="101" text-anchor="middle" fill="rgba(255,255,255,0.36)" font-size="9" font-weight="700">landscape</text></svg>';
  }
  function politicsHtml(T, v) {
    var pm = T >= 4.5 ? "Bernard Cazeneuve" : "Manuel Valls";
    var mapped = PARTIES.reduce(function (s, p) { return s + p.support; }, 0);
    var sorted = PARTIES.slice().sort(function (a, b) { return b.seats - a.seats; });
    var html = '<div class="gx-dos-politics"><section class="gx-dos-gov"><div class="gx-dos-label">Government</div><div class="form">Semi-presidential republic</div>' +
      '<div class="offices"><div><small>Head of state</small><b class="hos">François Hollande</b></div><div><small>Head of government</small><b>' + pm + "</b></div></div>" +
      '<div class="line"><span>Government:</span> Socialist Party | Radical Party of the Left</div>' +
      '<div class="leg"><div><span>Legislature</span> National Assembly (577 seats)</div><div><span>Next election</span> June 2017</div></div>' +
      '<div class="seats">' + sorted.map(function (p) { return '<i style="width:' + (p.seats / 577 * 100).toFixed(2) + "%;background:" + p.colour + '"></i>'; }).join("") + '<i style="width:' + ((577 - PARTIES.reduce(function (s, p) { return s + p.seats; }, 0)) / 577 * 100).toFixed(2) + '%;background:rgba(148,163,184,0.72)"></i></div></section>';
    html += '<div class="gx-dos-strip"><button type="button" class="gx-dos-link">Compile the government and parties again</button></div>';
    html += '<section class="gx-dos-landscape"><div class="head"><div><div class="gx-dos-label">Political landscape</div><small>Click a party to inspect public information</small></div><span class="mapped">' + Math.round(mapped) + "% support mapped</span></div>" +
      '<div class="overview"><div class="donut">' + donut(PARTIES.slice().sort(function (a, b) { return b.support - a.support; }), 100 - mapped) + '</div><div class="legend">' +
      PARTIES.slice().sort(function (a, b) { return b.support - a.support; }).slice(0, 4).map(function (p) { return '<div><i style="background:' + p.colour + '"></i><span>' + p.abbr + "</span><b>" + p.support.toFixed(1) + "%</b></div>"; }).join("") + "</div></div>";
    html += '<div class="parties">' + PARTIES.map(function (p) {
      var tone = ROLE_TONES[p.role];
      return '<div class="party" style="border-left-color:' + p.colour + '"><div class="top"><div><div class="pname">' + esc(p.name) + " <span>(" + p.abbr + ')</span></div><div class="native">' + esc(p.native) + '</div></div><span class="role" style="border-color:' + tone + "55;color:" + tone + '">' + p.role + "</span></div>" +
        '<div class="ideo"><span style="color:' + (FAMILY_COLOURS[p.family] || "#cbd5e1") + '">' + p.family + "</span> · " + esc(p.sub) + '</div><div class="meta"><span>Leader: <b>' + esc(p.leader) + "</b></span><span>" + p.seats + "/577 seats</span><span>" + p.support.toFixed(1) + "% support</span><span>Founded " + p.founded + "</span></div></div>";
    }).join("") + '<div class="party other" style="border-left-color:rgba(148,163,184,0.72)"><div class="top"><div class="pname">Other political support</div><span class="oth">' + (100 - mapped).toFixed(1) + "%</span></div></div></div></section>";
    html += '<div class="gx-dos-strip"><div class="gx-dos-label">National priorities</div><div class="bullets"><div>• Keep the Republic out of a war it did not start</div><div>• Bring the powers to one table</div><div>• Hold the Union together after the British vote</div><div>• Win back the unions before the election</div></div></div>';
    html += '<section class="gx-dos-inst"><div class="ihead"><div><div class="gx-dos-label">Institutions</div><small>Canonical memberships and institutional history</small></div><span class="count">' + (MEMBERSHIPS.length + (T >= 8.3 ? 1 : 0)) + '</span></div><div class="ilist">' +
      MEMBERSHIPS.concat(T >= 8.3 ? [["Commission of Strasbourg", "since 2 Mar 2017", "member / founder"]] : []).map(function (m) {
        return '<div class="irow"><span class="dot"></span><div><div class="iname">' + esc(m[0]) + '</div><div class="imeta">' + esc(m[1]) + '</div></div><span class="istatus">' + m[2] + "</span></div>";
      }).join("") + "</div></section></div>";
    return html;
  }
  function diplomacyHtml(T, v) {
    var agreements = [["North Atlantic Treaty", "Alliance · NATO members", "Active"], ["Treaty on European Union", "Union treaty · European Union members", "Active"], ["Paris Agreement", "Climate agreement · Multilateral agreement", T >= 0.95 ? "Active" : "Signed"]];
    if (T >= 8.3) agreements.unshift(["The Final Act of Strasbourg", "Peace treaty · United States · Russia · China · North Korea · South Korea", "Active"]);
    var html = '<div class="gx-dos-summary"><div><small>Relations</small><b style="color:#91d4f4">' + RELATIONS.length + '</b></div><div><small>Active agreements</small><b style="color:#6dd7b5">' + agreements.filter(function (a) { return a[2] === "Active"; }).length + '</b></div><div><small>Conflicts</small><b style="color:#9aabb8">0</b></div></div>';
    var rows = RELATIONS.map(function (r) { return { key: r[0], name: r[1], score: Math.round(v[r[0]]) }; });
    var q = (fields["dos-rel"] || "").toLowerCase();
    var shown = rows.filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) >= 0 || relationTone(r.score)[0].toLowerCase().indexOf(q) >= 0; });
    shown.sort(dossier.relSort === "weakest" ? function (a, b) { return a.score - b.score; } : dossier.relSort === "name" ? function (a, b) { return a.name.localeCompare(b.name); } : function (a, b) { return b.score - a.score; });
    html += '<section class="gx-dos-ledger"><div class="lhead"><span>Bilateral relations</span><small>−100 to +100 · ' + rows.length + ' recorded</small></div><div class="gx-dos-reltools"><input type="search" data-field="dos-rel" placeholder="Find country or relation…" aria-label="Find country or relation" /><select data-dos="sort" aria-label="Sort relations">' +
      [["strongest", "Strongest first"], ["weakest", "Weakest first"], ["name", "Name A–Z"]].map(function (o) { return '<option value="' + o[0] + '"' + (dossier.relSort === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></div>";
    html += shown.length ? shown.map(function (r) {
      var tone = relationTone(r.score);
      var w = Math.abs(r.score) / 2;
      var open = dossier.openRelation === r.key;
      return '<div class="gx-dos-rel"><button type="button" data-rel="' + r.key + '"' + (open ? ' class="open"' : "") + '><span class="rname">' + r.name + '</span><span class="sig"><b style="color:' + tone[1] + '">' + signed(r.score, 0) + '</b><i class="meter"><i class="tick"></i><i class="fill" style="background:' + tone[1] + ";width:" + w.toFixed(1) + "%;left:" + (r.score < 0 ? "calc(50% - " + w.toFixed(1) + "%)" : "50%") + '"></i></i></span>' + badge(tone[0], tone[1], ";min-width:3.9rem;justify-content:center") + '<span class="chev">⌄</span></button>' +
        (open ? '<div class="rdetail"><p>' + esc(RELATION_NOTES[r.key] || "Tracked bilateral relationship.") + '</p><span class="ilink">Inspect country ›</span></div>' : "") + "</div>";
    }).join("") : '<div class="gx-dos-empty">No relationships match the search. ' + rows.length + " records are still available.</div>";
    html += "</section>";
    html += '<section class="gx-dos-ledger"><div class="lhead"><span>Formal agreements</span></div>' + agreements.map(function (a) {
      var tone = a[2] === "Active" ? "#34d399" : a[2] === "Suspended" ? "#fbbf24" : "#94a3b8";
      return '<div class="gx-dos-agree"><div><div class="t">' + esc(a[0]) + '</div><div class="s">' + esc(a[1]) + "</div></div>" + badge(a[2], tone) + "</div>";
    }).join("") + "</section>";
    html += '<section class="gx-dos-ledger"><div class="lhead"><span>Current conflicts</span></div><div class="gx-dos-empty plain">No active or ceasefire canonical conflicts involving this polity.</div></section>';
    return html;
  }
  function economyHtml(T, v) {
    var html = '<div class="gx-dos-card stab"><div class="gx-row"><span class="cap">⚠ National stability</span><span class="val">' + Math.round(v.stability) + "/100</span></div>" + bar(v.stability, stabilityColour(v.stability)) + "</div>";
    html += '<div class="gx-dos-intel"><div class="gx-row"><span class="cap">🕵 Intelligence service</span><span class="val">' + Math.round(v.intel) + "/100</span></div>" + bar(v.intel, "#38bdf8") + "</div>";
    html += '<div class="gx-dos-title econ">⚑ Strategic indices</div><div class="gx-dos-indices">' + INDICES.map(function (row) {
      return '<div class="gx-dos-index"><div class="lab">' + row[0] + " " + row[1] + '</div><div class="num">' + Math.round(v[row[2]]) + "<span> / 100</span></div>" + bar(v[row[2]], row[3]) + "</div>";
    }).join("") + "</div>";
    html += '<div class="gx-dos-title econ">👥 Population</div><div class="gx-dos-card"><div class="k">Total population</div><div class="pop">' + v.population.toFixed(1) + "M</div></div>";
    html += '<div class="gx-dos-title econ">📈 Economy</div><div class="gx-dos-econ">' + [
      ["GDP", "$" + v.gdp.toFixed(2) + "T", "Growth " + signed(v.growth, 1) + "% · 2026-USD eq.", "#34d399"],
      ["GDP/capita", "$" + (Math.round(v.gdpc / 10) * 10).toLocaleString("en"), "Whole polity", "#e7e7e9"],
      ["Inflation", v.inflation.toFixed(1) + "%", "", "#34d399"],
      ["Unemployment", v.unemployment.toFixed(1) + "%", "", "#34d399"],
      ["Public debt", v.debt.toFixed(1) + "%", "of GDP", "#34d399"],
      ["Budget balance", signed(v.balance, 1) + "%", (v.balance < 0 ? "Deficit" : "Surplus") + " · of GDP", v.balance < 0 ? "#f87171" : "#34d399"]
    ].map(function (c) { return '<div class="cell"><div class="k">' + c[0] + '</div><div class="v" style="color:' + c[3] + '">' + c[1] + "</div>" + (c[2] ? '<div class="s">' + c[2] + "</div>" : "") + "</div>"; }).join("") + "</div>";
    html += '<div class="gx-dos-currency">Domestic currency: EUR · GDP accounting shown in 2026-USD-equivalent values.</div>';
    html += '<div class="gx-dos-card gdp"><div class="t">GDP breakdown</div><div class="stack"><i style="width:2%;background:#22c55e"></i><i style="width:19%;background:#3b82f6"></i><i style="width:79%;background:#f59e0b"></i></div>' +
      '<div class="legend"><span><i style="background:#22c55e"></i>Agriculture 2%</span><span><i style="background:#3b82f6"></i>Industry 19%</span><span><i style="background:#f59e0b"></i>Services 79%</span></div></div>';
    var weariness = T >= 1 && T < 5 ? 4 : 0;
    var military = [["Troop quality", 72, "own"], ["Technology", 81, "own"], ["Spending", 64, "own"], ["Manpower share", 0.3, "share"], ["War weariness", weariness, "weary"], ["Land", 58, "own"], ["Naval", 66, "own"], ["Air", 70, "own"]];
    html += '<div class="gx-dos-title econ">⚔ Military</div><div class="gx-dos-card mil"><div class="gx-row"><span class="cap">Military power</span><span class="mval">61.3</span></div><div class="rows">' + military.map(function (m) {
      var pct = m[2] === "share" ? m[1] / 1.5 * 100 : m[1];
      var fill = m[2] === "weary" ? (m[1] > 0 ? "#f59e0b" : "rgba(255,255,255,0.32)") : "#2bc1f3";
      return '<div class="mrow"><span>' + m[0] + '</span><span class="mbar"><i style="width:' + Math.min(100, pct).toFixed(1) + "%;background:" + fill + '"></i><b></b></span><em>' + (m[2] === "share" ? m[1].toFixed(1) + "%" : Math.round(m[1]) + "/100") + "</em></div>";
    }).join("") + '</div><div class="foot">In colour: its own figures. In grey: what every country has. The mark on a bar is where every country stands.</div></div>';
    html += '<button type="button" class="gx-advanced" data-open-advanced><span class="ic">📊</span><span class="tx"><b>Advanced statistics</b><small>Explore campaign trends and historical snapshots</small></span><span class="ch">›</span></button>';
    html += '<button type="button" class="gx-advanced tracking"><span class="ic">⚙</span><span class="tx"><b>Historical tracking</b><small>Auto-refresh: Manual only · Tracked: 1/8</small><small class="names">France</small></span><span class="ch">›</span></button>';
    return html;
  }
  function rankingHtml(T, v) {
    var def = RANKINGS.filter(function (r) { return r[0] === dossier.rank; })[0] || RANKINGS[1];
    var own = { population: v.population, economy: v.gdp, wealth: v.gdpc, stability: v.stability, reputation: v.reputation };
    var rows = Object.keys(def[2]).map(function (name) { var value = def[2][name]; return { name: name, value: value == null ? own[def[0]] : value }; }).filter(function (r) { return r.value != null; });
    rows.sort(function (a, b) { return b.value - a.value; });
    var rank = 0;
    rows.forEach(function (r, i) { if (!i || r.value !== rows[i - 1].value) rank = i + 1; r.rank = rank; });
    var mine = rows.filter(function (r) { return r.name === "France"; })[0];
    var html = '<div class="gx-dos-rank"><div class="picker"><label for="gxRankBy">Ranked by</label><select id="gxRankBy" data-dos="rank">' + RANKINGS.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === def[0] ? " selected" : "") + ">" + r[1] + "</option>"; }).join("") + "</select></div>" +
      '<div class="context"><div><b class="accent">#' + (mine ? mine.rank : "—") + '</b><small>Selected country</small></div><div><b>' + rows.length + "<span> / " + rows.length + "</span></b><small>Countries ranked</small></div></div>" +
      '<div class="colhead"><span>Rank</span><span></span><span>Country</span><span>Value</span></div><div class="list">' + rows.map(function (r) {
        var tier = r.rank === 1 ? "gold" : r.rank === 2 ? "silver" : r.rank === 3 ? "bronze" : "";
        return '<button type="button" class="rrow' + (r.name === "France" ? " mine" : "") + (dossier.openRank === r.name ? " open" : "") + '" data-rank-row="' + esc(r.name) + '"><span class="rk ' + tier + '">' + (r.rank < 10 ? "0" : "") + r.rank + '</span><span class="rflag">' + flagSvg(r.name) + '</span><span class="rname">' + esc(r.name) + '</span><span class="rval">' + def[3](r.value) + "</span></button>";
      }).join("") + "</div></div>";
    return html;
  }
  function renderCountry(T) {
    var v = figuresAt(T);
    var key = state.view + ":" + dossier.rank + ":" + dossier.openRank + ":" + dossier.openRelation + ":" + dossier.relSort + ":" + (fields["dos-rel"] || "") + ":" + (T >= 4.5) + (T >= 8.3) + ":" + Object.keys(v).map(function (k) { return Math.round(v[k] * 10); }).join(",");
    if (!changed("country", key)) return;
    Array.prototype.forEach.call(el.country.querySelectorAll(".gx-dos-tabs [data-view]"), function (b) { b.classList.toggle("on", b.getAttribute("data-view") === state.view); b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === state.view)); });
    $("gxDosRefresh").hidden = state.view !== "economy";
    var focus = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute("data-field");
    var html = state.view === "economy" ? economyHtml(T, v) : state.view === "diplomacy" ? diplomacyHtml(T, v) : state.view === "politics" ? politicsHtml(T, v) : rankingHtml(T, v);
    html += '<p class="gx-dos-hint">Click any country on the map to inspect it, or open its card and choose Stats.</p>';
    el.view.setAttribute("data-view", state.view);
    el.view.innerHTML = html;
    var search = el.view.querySelector('[data-field="dos-rel"]');
    if (search) { search.value = fields["dos-rel"] || ""; if (focus === "dos-rel") { search.focus(); search.setSelectionRange(search.value.length, search.value.length); } }
  }
  function dossierClick(event) {
    var rel = event.target.closest("[data-rel]");
    var row = event.target.closest("[data-rank-row]");
    if (rel) dossier.openRelation = dossier.openRelation === rel.getAttribute("data-rel") ? "" : rel.getAttribute("data-rel");
    else if (row) dossier.openRank = row.getAttribute("data-rank-row");
    else return;
    state.keys.country = "";
    renderCountry(state.T);
  }
  function dossierInput(event) {
    var target = event.target;
    if (target.getAttribute("data-field") === "dos-rel") fields["dos-rel"] = target.value;
    else if (target.getAttribute("data-dos") === "sort") dossier.relSort = target.value;
    else if (target.getAttribute("data-dos") === "rank") dossier.rank = target.value;
    else return;
    state.keys.country = "";
    renderCountry(state.T);
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
  var UNIT_LABELS = { gdp: "GDP · 2016-USD equivalent", gdpPerCapita: "GDP per capita · 2016-USD equivalent", population: "Population", percent: "Percent", index: "Index · 0–100", sector: "Share of GDP · %" };
  var advanced = { open: false, range: "all", sel: ["gdp"], hover: -1 };
  function compact(v) {
    var a = Math.abs(v);
    return a >= 1e12 ? (v / 1e12).toFixed(2) + "T" : a >= 1e9 ? (v / 1e9).toFixed(1) + "B" : a >= 1e6 ? (v / 1e6).toFixed(1) + "M" : a >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(Math.round(v));
  }
  function formatMetric(key, v) {
    var unit = METRICS[key][3];
    if (unit === "gdp") return "$" + compact(v);
    if (unit === "gdpPerCapita") return "$" + Math.round(v).toLocaleString("en");
    if (unit === "population") return compact(v);
    if (unit === "percent") return (key === "gdpGrowth" || key === "budgetBalance" ? (v >= 0 ? "+" : "") : "") + v.toFixed(1) + "%";
    if (key === "stability") return String(Math.round(v));
    return unit === "sector" ? v.toFixed(1) + "%" : Math.round(v) + "%";
  }
  function formatDelta(key, d) {
    var unit = METRICS[key][3], sign = d > 0 ? "+" : d < 0 ? "−" : "";
    if (unit === "gdp") return sign + "$" + compact(Math.abs(d));
    if (unit === "gdpPerCapita") return sign + "$" + Math.round(Math.abs(d)).toLocaleString("en");
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

  // ---- the Events panel (time.jsx: PanelChrome, TurnPicker, EventCard) and the Timeline -------------------
  // eventTags.js: the six tags the game knows, in the order the filter chips take.
  var EVENT_TAGS = ["Military", "Diplomacy", "Economy", "Politics", "Culture", "Disaster"];
  var TAG_OF = { War: "Military", Peace: "Diplomacy" };
  // A time skip is one turn: each chapter's events are its own turn, from the chapter before's date.
  var events = { turn: -1, filter: {} };
  function eventTurns(T) {
    var turns = [];
    EVENTS.forEach(function (e) {
      if (e[0] > T) return;
      var chapter = Math.floor(e[0]);
      var last = turns[turns.length - 1];
      if (last && last.chapter === chapter) last.items.push(e); else turns.push({ chapter: chapter, items: [e] });
    });
    return turns;
  }
  function eventCard(e) {
    var d = parseDate(e[1]);
    var tags = [];
    e[2].forEach(function (t) { var tag = TAG_OF[t] || t; if (tags.indexOf(tag) < 0) tags.push(tag); });
    return '<div class="gx-cardwrap"><div class="gx-card"><div class="gx-card-head"><span class="gx-metric">' + CALENDAR + (d ? shortDate(d) : "") + '</span></div><div class="gx-card-body"><div class="gx-tags">' +
      tags.map(function (t) { return '<span class="gx-tag">' + t + "</span>"; }).join("") + e[5].map(function (p) { return '<span class="gx-link"><i>⚑</i>' + p + "</span>"; }).join("") +
      '</div><div class="gx-card-title">' + esc(e[3]) + '</div><div class="gx-card-text"><p>' + bold(e[4]) + "</p></div></div></div></div>";
  }
  function turnRange(turn) {
    var from = turn.chapter > 0 ? chapterDate(STEPS[turn.chapter - 1]) : parseDate("2016-01-01");
    var to = parseDate(turn.items[turn.items.length - 1][1]);
    return shortDate(from) + " -> " + shortDate(to);
  }
  function addDays(d, days) { return new Date(+d + days * 86400000); }
  function addMonths(d, months) { var n = new Date(+d); n.setUTCMonth(n.getUTCMonth() + months); return n; }
  function mdy(d) { return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + "/" + d.getUTCFullYear(); }
  var JUMPS = [["6 hours", 0.25], ["1 day", 1], ["3 days", 3], ["1 week", 7], ["1 month", "1m"], ["3 months", "3m"], ["6 months", "6m"], ["1 year", "12m"]];
  function renderPanel(T) {
    var which = state.pop;
    if (!which) return;
    var title = "", sub = "", html = "";
    if (which === "events") {
      var turns = eventTurns(T);
      title = "Events";
      if (!turns.length) {
        html = '<div class="gx-empty-box">No world events were recorded for this time skip.</div>';
      } else {
        var at = events.turn < 0 || events.turn >= turns.length ? turns.length - 1 : events.turn;
        var turn = turns[at];
        sub = turns.length > 1 ? '<span class="gx-turns"><button type="button" data-turn="-1"' + (at ? "" : " disabled") + ">‹</button>Round " + (at + 1) + " · " + turnRange(turn) + '<button type="button" data-turn="1"' + (at < turns.length - 1 ? "" : " disabled") + ">›</button></span>" : turnRange(turn);
        var present = EVENT_TAGS.filter(function (tag) { return turn.items.some(function (e) { return e[2].some(function (t) { return (TAG_OF[t] || t) === tag; }); }); });
        var picked = present.filter(function (tag) { return events.filter[tag]; });
        html = present.length > 1 ? '<div class="gx-echips">' + present.map(function (tag) { return '<button type="button" class="' + (events.filter[tag] ? "on" : "") + '" data-etag="' + tag + '">' + tag + "</button>"; }).join("") + "</div>" : "";
        var items = turn.items.filter(function (e) { return !picked.length || e[2].some(function (t) { return picked.indexOf(TAG_OF[t] || t) >= 0; }); });
        html += '<div class="gx-ecol">' + items.map(eventCard).join("") + "</div>";
        // The rest of the turn is told as the reader goes on: the next event is the next chapter's.
        var later = EVENTS.filter(function (e) { return e[0] > T; }).length;
        if (later && at === turns.length - 1) {
          html += '<button type="button" class="gx-ghost" data-go="next"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>Next event</button>';
          html += '<button type="button" class="gx-ghost" data-go="end" style="min-height:1.9rem;opacity:0.75">Skip to end (' + later + " more)</button>";
        }
      }
    } else if (which === "timeline") {
      title = "Timeline";
      var now = dateAt(T, state.korea);
      var custom = +(fields["tl-n"] || 0);
      var unit = fields["tl-unit"] || "days";
      var lands = custom > 0 ? (unit === "hours" ? addDays(now, custom / 24) : unit === "days" ? addDays(now, custom) : unit === "weeks" ? addDays(now, custom * 7) : unit === "months" ? addMonths(now, custom) : addMonths(now, custom * 12)) : null;
      html = '<div class="gx-tl"><span class="gx-tl-date">' + mdy(now) + "</span>" + JUMPS.map(function (j) {
        var to = typeof j[1] === "number" ? addDays(now, j[1]) : addMonths(now, parseInt(j[1], 10));
        return '<i class="gx-tl-link"></i><button type="button" class="gx-tl-node" data-go="next"><b>' + mdy(to) + "</b><span>" + j[0] + "</span></button>";
      }).join("") + '<i class="gx-tl-link"></i><button type="button" class="gx-tl-auto" data-go="next">Auto-jump</button><i class="gx-tl-link"></i>' +
        '<div class="gx-tl-custom"><input type="number" min="1" data-field="tl-n" placeholder="Custom" aria-label="Custom length" /><select data-field="tl-unit" aria-label="Unit">' + ["hours", "days", "weeks", "months", "years"].map(function (u) { return '<option value="' + u + '"' + (u === unit ? " selected" : "") + ">" + u + "</option>"; }).join("") + '</select><button type="button" data-go="next"' + (custom > 0 ? "" : ' class="off"') + ">Go</button></div>" +
        (lands ? '<div class="gx-tl-lands">Lands on ' + mdy(lands) + "</div>" : "") +
        '<div class="gx-tl-cap">' + Math.min(500, Math.floor(T)) + " of 500 AI requests used today<br />a skip uses 1 request</div></div>";
    }
    var key = which + title + sub + html;
    if (!changed("panel", key)) return;
    var focus = document.activeElement && el.panel.contains(document.activeElement) ? document.activeElement.getAttribute("data-field") : null;
    el.panelTitle.textContent = title;
    el.panelSub.innerHTML = sub;
    el.panelSub.hidden = !sub;
    el.panelBody.innerHTML = html;
    Array.prototype.forEach.call(el.panelBody.querySelectorAll("[data-field]"), function (input) {
      var key = input.getAttribute("data-field");
      if (fields[key] != null) input.value = fields[key];
      if (key === focus) input.focus();
    });
    if (which === "events") el.panelBody.scrollTop = el.panelBody.scrollHeight;
  }
  // ---- Projects & Operations, the Actions panel's second tab (projects.jsx ProjectsBoard, ProjectCard) -------
  var PROJECT_TONES = { Proposed: ["#93c5fd", "rgba(59,130,246,0.16)"], Active: ["#4ade80", "rgba(34,197,94,0.16)"], Stalled: ["#fbbf24", "rgba(245,158,11,0.18)"], Paused: ["rgba(255,255,255,0.6)", "rgba(255,255,255,0.08)"], Complete: ["#67e8f9", "rgba(6,182,212,0.16)"], Failed: ["#f87171", "rgba(239,68,68,0.18)"], Cancelled: ["rgba(255,255,255,0.45)", "rgba(255,255,255,0.06)"] };
  var projects = { view: "mine", closed: false, sort: "updated", priority: {} };
  function daysBetween(a, b) { return Math.round((+b - +a) / 86400000); }
  function projectsAt(T) {
    var now = dateAt(T, state.korea);
    var list = [];
    var congress = clamp((T - 4.4) / 3.9);
    list.push({ id: "congress", glyph: "🔬", name: "The Congress of Strasbourg", owner: "France", status: T < 4.4 ? "Proposed" : congress >= 1 ? "Complete" : "Active", priority: projects.priority.congress || "High",
      summary: "A peace congress at Strasbourg for the war in Korea, with Washington, Moscow and Beijing at the table and Pyongyang brought by China.", tags: ["Diplomacy", "Peace"],
      from: parseDate("2016-12-01"), to: parseDate("2017-03-02"), progress: Math.round(congress * 100), next: congress < 0.5 ? "The delegations arrive in Strasbourg — Feb 2017" : congress < 1 ? "The Final Act is signed — Mar 2017" : "",
      update: T >= 7.3 ? "The Assemblée backed the congress, 341 to 156." : T >= 5.2 ? "Washington and Moscow accepted; Beijing will bring Pyongyang." : "", activity: T >= 7.3 ? 4 : T >= 5.2 ? 2 : 1 });
    if (T >= 1.3) list.push({ id: "deterrence", glyph: "⚔", name: "Deterrence alert", owner: "France", secret: "🔒", status: T >= 8.3 ? "Complete" : "Active", ongoing: true, priority: projects.priority.deterrence || "Normal",
      summary: "The forces of deterrence on alert across the Republic until the launches are explained.", tags: ["Military"], from: parseDate("2016-08-09"), progress: T >= 8.3 ? 100 : 40, update: T >= 8.3 ? "Stood down with the Final Act." : "", activity: T >= 8.3 ? 2 : 1 });
    if (T >= 2.05) list.push({ id: "offensive", glyph: "⚔", name: "The march on Busan", owner: "North Korea", foreign: true, status: T >= 5.2 ? "Stalled" : "Active", ongoing: false,
      summary: "Pyongyang's armies push south toward Busan and the sea.", tags: ["Military", "War"], from: parseDate("2016-09-02"), to: parseDate("2016-12-31"), progress: Math.min(92, Math.round(state.korea >= 0 ? 30 + state.korea * 3 : 30)), update: T >= 5.2 ? "The guns have gone quiet in Busan." : "", activity: 3 });
    list.forEach(function (p) {
      if (!p.to) { p.when = "Began " + shortDate(p.from) + " · ongoing"; return; }
      var left = daysBetween(now, p.to);
      p.overdue = left < 0 && p.status === "Active";
      p.when = shortDate(p.from) + " → " + shortDate(p.to) + (p.status === "Complete" ? "" : left >= 0 ? " (" + left + "d left)" : " (" + -left + "d overdue)");
    });
    return list;
  }
  function projectCard(p) {
    var tone = PROJECT_TONES[p.status];
    var closed = p.status === "Complete" || p.status === "Failed" || p.status === "Cancelled";
    var barColour = p.status === "Complete" ? "#22d3ee" : p.overdue ? "#ef4444" : p.status === "Stalled" ? "#f59e0b" : closed ? "rgba(255,255,255,0.25)" : "#22c55e";
    var html = '<div class="pj-card"><div class="pj-top"><span class="pj-glyph">' + p.glyph + '</span><b>' + esc(p.name) + "</b>" + (p.secret ? '<span class="pj-secret">' + p.secret + "</span>" : "") + '<span class="sp"></span>' +
      (p.priority === "High" ? '<span class="pj-pill" style="color:#fcd34d;background:rgba(245,158,11,0.16)">High</span>' : p.priority === "Low" ? '<span class="pj-pill" style="color:rgba(255,255,255,0.5);background:rgba(255,255,255,0.07)">Low</span>' : "") +
      (p.ongoing ? '<span class="pj-pill" style="color:rgba(255,255,255,0.6);background:rgba(255,255,255,0.07)">Ongoing</span>' : "") + '<span class="pj-status" style="color:' + tone[0] + ";background:" + tone[1] + '">' + p.status + "</span></div>" +
      '<div class="pj-owner' + (p.foreign ? " foreign" : "") + '">' + (p.owner === "France" ? tricolour(null, "pj-flag") : tricolour(["#024fa2", "#ed1c27", "#024fa2"], "pj-flag across")) + "<span>" + esc(p.owner) + "</span>" + (p.foreign ? '<span class="pj-pill foreign">Foreign</span>' : "") + "</div>" +
      '<div class="pj-sum">' + esc(p.summary) + '</div><div class="pj-tags">' + p.tags.map(function (t) { return "<span>" + t + "</span>"; }).join("") + "</div>" +
      '<div class="pj-when"><span>' + esc(p.when) + "</span><span>" + p.progress + '%</span></div><div class="pj-bar"><i style="width:' + p.progress + "%;background:" + barColour + '"></i></div>' +
      (p.next && !closed ? '<div class="pj-next">▸ Next: ' + esc(p.next) + "</div>" : "") + (p.update ? '<div class="pj-update">' + esc(p.update) + "</div>" : "") +
      (p.overdue ? '<div class="pj-warn">⚠ Overdue</div>' : "") +
      '<div class="pj-btns">' + (p.foreign ? '<button type="button">🧭 What do we know?</button><button type="button">⚖ Our options</button>' : '<button type="button">🧭 Ask advisor</button>') + '<button type="button">📍 Show on map</button><button type="button">▸ Activity (' + p.activity + ")</button></div>";
    if (!p.foreign && !closed) html += '<div class="pj-own"><span class="pj-prio">' + [["High", "▲"], ["Normal", "●"], ["Low", "▼"]].map(function (x) { return '<button type="button" data-ac="prio" data-id="' + p.id + '" data-prio="' + x[0] + '" class="' + (p.priority === x[0] ? "on" : "") + '" title="' + x[0] + ' priority">' + x[1] + "</button>"; }).join("") + '</span><button type="button" class="pj-abandon">Abandon</button></div>';
    else if (p.foreign) html += '<div class="pj-note">' + esc(p.owner) + " runs this — you can watch it and act against it, but its priority and its cancellation are not yours to set.</div>";
    return html + "</div>";
  }
  function projectsBoard(T) {
    var all = projectsAt(T);
    var find = (fields["pj-search"] || "").trim().toLowerCase();
    var isClosed = function (p) { return p.status === "Complete" || p.status === "Failed" || p.status === "Cancelled"; };
    var mine = all.filter(function (p) { return !p.foreign && !isClosed(p); }).length;
    var foreign = all.filter(function (p) { return p.foreign && !isClosed(p); }).length;
    var closedN = all.filter(isClosed).length;
    var list = all.filter(function (p) {
      if (projects.closed ? !isClosed(p) : isClosed(p)) return false;
      if (projects.view === "mine" && p.foreign) return false;
      if (projects.view === "foreign" && !p.foreign) return false;
      return !find || (p.name + " " + p.summary + " " + p.tags.join(" ")).toLowerCase().indexOf(find) >= 0;
    });
    if (projects.sort === "name") list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else if (projects.sort === "progress") list.sort(function (a, b) { return b.progress - a.progress; });
    var chip = function (key, label) { return '<button type="button" class="pj-chip' + ((key === "closed" ? projects.closed : !projects.closed && projects.view === key) ? " on" : "") + '" data-ac="pjview" data-view="' + key + '">' + label + "</button>"; };
    var html = '<div class="ac-board"><div class="pj-filters"><label class="pj-find"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" data-field="pj-search" placeholder="Search projects…" aria-label="Search projects" /></label>' +
      '<div class="pj-row"><select data-field="pj-sort" aria-label="Sort projects">' + [["updated", "Recently updated"], ["priority", "Priority"], ["milestone", "Next milestone"], ["progress", "Progress"], ["name", "Name"], ["status", "Status"]].map(function (o) { return '<option value="' + o[0] + '"' + (projects.sort === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>" +
      chip("all", "All") + chip("mine", "Mine (" + mine + ")") + (foreign ? chip("foreign", "Foreign (" + foreign + ")") : "") + (closedN ? (projects.closed ? '<button type="button" class="pj-chip on" data-ac="pjview" data-view="running">← Running (' + (mine + foreign) + ")</button>" : chip("closed", "Closed (" + closedN + ")")) : "") + "</div></div>" +
      '<div class="pj-list">' + (list.length ? list.map(projectCard).join("") : '<p class="ac-none">' + (projects.closed ? "No closed entries match those filters." : "Nothing matches those filters.") + (foreign && projects.view === "mine" ? " " + foreign + " entries belong to another power — show Foreign." : "") + "</p>") +
      '<button type="button" class="pj-review">🧭 Ask the advisor to review or extend the board</button></div></div>';
    return html;
  }

  // ---- the Actions panel (actions.jsx ActionsPanel, StandingGoal, ActionItem, SuggestionCard) ----------
  var ORDERS_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/></svg>';
  var PROJECTS_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/></svg>';
  var ACTIONS_TABS = [["actions", "Actions", ORDERS_ICON], ["projects", "Projects", PROJECTS_ICON]];
  var SPARKLE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2L13.5 9.5L21 11L13.5 12.5L12 20L10.5 12.5L3 11L10.5 9.5L12 2Z"/></svg>';
  var SEND = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  var SPINNER = '<svg class="ac-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="rgba(255,255,255,0.2)" stroke-width="2.2"/><path d="M12 4a8 8 0 0 1 8 8" stroke="rgba(255,255,255,0.88)" stroke-width="2.2" stroke-linecap="round"/></svg>';
  var GOAL = "Keep France out of the war, and bring the powers to one table.";
  // The orders the story gives: [T queued, text]. The time skip carries them out and empties the queue.
  var STORY_ACTIONS = [[1.3, "Put the forces of deterrence on alert"], [4.4, ORDER]];
  var SUGGESTIONS = [
    { title: "Keep the war in Korea from spreading", description: "The South is falling back on Busan and Moscow is still counting its dead. France can speak where others cannot.", actions: [
      { id: "s1", title: "Call the Security Council", text: "Ask for an emergency session on Korea and table a ceasefire resolution." },
      { id: "s2", title: "Reassure Seoul", text: "Send the Foreign Minister to Busan with a field hospital and medical aid." }
    ] },
    { title: "Steady the home front", description: "The unions are restless and the right calls any talk with Moscow weakness.", actions: [
      { id: "s3", title: "Meet the unions", text: "Invite the union leaders to the Élysée before the strikes spread." }
    ] }
  ];
  var acts = { tab: "actions", user: [], deleted: {}, asked: false, suggesting: false, open: "submitted", queued: {}, editing: false, goal: null };
  function goalAt(T) { return acts.goal != null ? acts.goal : T >= 4.1 ? GOAL : ""; }
  function submittedAt(T) {
    var list = T >= 5 ? [] : STORY_ACTIONS.filter(function (a) { return a[0] <= T; }).map(function (a, i) { return { id: "story" + i, text: a[1] }; });
    return list.concat(acts.user).filter(function (a) { return !acts.deleted[a.id]; });
  }
  function actionItem(a) {
    return '<div class="ac-item"><div class="ac-item-text">' + (a.title ? '<div class="t">' + esc(a.title) + "</div>" : "") + '<div class="l">' + esc(a.text) + '</div><div class="k">action • planned</div></div><button type="button" class="ac-del" data-ac="delete" data-id="' + a.id + '" title="Delete action" aria-label="Delete action">✕</button></div>';
  }
  function sectionHeader(title, count, open, which) {
    return '<button type="button" class="ac-section" data-ac="section" data-open="' + which + '" aria-expanded="' + open + '"><span class="tri' + (open ? " on" : "") + '">▶</span><span class="ti">' + title + "</span><span>" + count + "</span></button>";
  }
  // The panel's two tabs, in the diplomacy panel's tab strip: the orders, and the Projects & Operations board.
  function actionsTabs(T) {
    var count = projectsAt(T).length;
    return '<div class="ac-tabs" role="tablist">' + ACTIONS_TABS.map(function (tab) {
      var on = acts.tab === tab[0];
      return '<button type="button" role="tab" aria-selected="' + on + '" class="dp-tab ac-tab' + (on ? " on" : "") + '" data-ac="tab" data-tab="' + tab[0] + '"><span class="ic">' + tab[2] + "</span><span>" + tab[1] + "</span>" +
        (tab[0] === "projects" && count ? '<span class="dp-count ac-count">' + count + "</span>" : "") + "</button>";
    }).join("") + "</div>";
  }
  function renderActions(T) {
    if (state.pop !== "actions") return;
    var html = '<div class="ac-head">' + actionsTabs(T) + '<button type="button" class="dp-x" data-ac="close" aria-label="Close actions">✕</button></div>' + (acts.tab === "projects" ? projectsBoard(T) : ordersTab(T));
    // The story's order is written into the box, a letter at a time, before it is queued.
    var storyTyping = acts.tab === "actions" && T >= 4.15 && T < 4.4 && !fields["ac-input"] ? typed(ORDER, 4.15, 0.22, T) : "";
    if (!changed("actions", html + "|" + storyTyping)) return;
    var focus = document.activeElement && el.actions.contains(document.activeElement) ? document.activeElement.getAttribute("data-field") : null;
    var caret = focus ? document.activeElement.selectionStart : 0;
    var scroller = el.actions.querySelector(".ac-body, .ac-board");
    var scroll = scroller ? scroller.scrollTop : 0;
    el.actions.innerHTML = html;
    if (acts.editing && fields["ac-goal"] == null) fields["ac-goal"] = goalAt(T);
    Array.prototype.forEach.call(el.actions.querySelectorAll("[data-field]"), function (input) {
      var key = input.getAttribute("data-field");
      input.value = key === "ac-input" && storyTyping ? storyTyping : fields[key] || "";
      if (key === focus) { input.focus(); try { input.setSelectionRange(caret, caret); } catch (error) { /* no caret */ } }
    });
    scroller = el.actions.querySelector(".ac-body, .ac-board");
    if (scroller) scroller.scrollTop = scroll;
    syncSend();
  }
  function ordersTab(T) {
    var goal = goalAt(T);
    var list = submittedAt(T);
    var html = '<div class="ac-body">';
    if (acts.editing) {
      html += '<div class="ac-goal editing"><span class="ac-goal-label">Standing goal</span><textarea class="ac-input" rows="2" data-field="ac-goal" aria-label="Standing goal" placeholder="What is your government steering toward? e.g. Keep out of the war and grow the economy"></textarea>' +
        '<div class="ac-goal-btns">' + (goal ? '<button type="button" class="ac-gbtn" data-ac="goal-clear" style="margin-right:auto">Clear goal</button>' : "") + '<button type="button" class="ac-gbtn" data-ac="goal-cancel">Cancel</button><button type="button" class="ac-gbtn primary" data-ac="goal-save">Save</button></div></div>';
    } else if (!goal) html += '<button type="button" class="ac-setgoal" data-ac="goal-edit" title="Your advisor, the time skip and the AI suggestions steer by it. Foreign leaders never see it.">🎯 Set a standing goal</button>';
    else html += '<div class="ac-goal"><div class="ac-goal-row"><span class="ac-goal-label">Standing goal</span><button type="button" class="ac-goal-edit" data-ac="goal-edit" title="Change or clear the goal">Edit</button></div><span class="ac-goal-text">🎯 ' + esc(goal) + "</span></div>";
    html += '<div class="ac-pair"><button type="button" class="ac-brain" data-ac="brainstorm">Brainstorm</button><button type="button" class="ac-suggest" data-ac="suggest">' + (acts.suggesting ? SPINNER : "") + "<span>AI Suggestions</span></button></div>";
    var showSuggested = acts.asked;
    var suggestedOpen = showSuggested && acts.open === "suggested";
    if (showSuggested) {
      html += '<div class="ac-sec' + (suggestedOpen ? " open" : "") + '">' + sectionHeader("Suggested Actions", acts.suggesting ? 0 : SUGGESTIONS.length, suggestedOpen, suggestedOpen ? "submitted" : "suggested");
      if (suggestedOpen) html += '<div class="ac-list wide">' + (acts.suggesting ? "" : SUGGESTIONS.map(function (topic) {
        return '<div class="ac-topic"><div><div class="t">' + esc(topic.title) + '</div><div class="d">' + esc(topic.description) + '</div></div><div class="ac-topic-acts">' + topic.actions.map(function (a) {
          var queued = acts.queued[a.id];
          return '<button type="button" class="ac-sugg' + (queued ? " queued" : "") + '" data-ac="queue" data-id="' + a.id + '"' + (queued ? " disabled" : "") + '><div class="t">' + (queued ? "✓ Queued — " : "") + esc(a.title) + '</div><div class="x">' + esc(a.text) + "</div></button>";
        }).join("") + "</div></div>";
      }).join("")) + "</div>";
      html += "</div>";
    }
    var submittedOpen = !suggestedOpen;
    html += '<div class="ac-sec' + (submittedOpen ? " open" : "") + '">' + (showSuggested ? sectionHeader("Your Submitted Actions", list.length, submittedOpen, submittedOpen ? "suggested" : "submitted") : '<p class="ac-title">Your Submitted Actions</p>');
    if (submittedOpen) html += '<div class="ac-list">' + (list.length ? list.map(actionItem).join("") : '<p class="ac-none">No actions submitted yet.</p>') + "</div>";
    html += "</div></div>";
    var touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    html += '<div class="ac-compose"><div class="ac-box"><textarea class="ac-input ac-composer" data-field="ac-input" aria-label="Enter your action" placeholder="' + (touch ? "Enter your action…" : "Enter your action…  (Shift+Enter for a new line)") + '"></textarea><button type="button" class="ac-improve" data-ac="improve" title="Improve action text" aria-label="Improve action text">' + SPARKLE + '</button></div><button type="button" class="ac-send" data-ac="submit" aria-label="Submit action">' + SEND + "</button></div>";
    return html;
  }
  function syncSend() {
    var box = el.actions.querySelector(".ac-composer");
    if (!box) return;
    var has = !!box.value.trim();
    el.actions.querySelector(".ac-send").classList.toggle("on", has);
    el.actions.querySelector(".ac-improve").classList.toggle("on", has);
    var save = el.actions.querySelector('[data-ac="goal-save"]');
    if (save) save.classList.toggle("off", (fields["ac-goal"] || "").trim() === goalAt(state.T));
  }
  function submitAction() {
    var text = (fields["ac-input"] || "").trim();
    if (!text) return;
    acts.user.push({ id: "user" + acts.user.length + "-" + Date.now(), text: text });
    fields["ac-input"] = "";
    acts.open = "submitted";
  }
  function actionsClick(event) {
    var act = event.target.closest("[data-ac]");
    if (!act) return;
    var what = act.getAttribute("data-ac");
    state.manual.pop = "actions";
    if (what === "close") { setPop(null, true); return; }
    if (what === "tab") acts.tab = act.getAttribute("data-tab");
    else if (what === "delete") { acts.deleted[act.getAttribute("data-id")] = true; delete acts.queued[act.getAttribute("data-id")]; }
    else if (what === "section") acts.open = act.getAttribute("data-open");
    else if (what === "prio") projects.priority[act.getAttribute("data-id")] = act.getAttribute("data-prio");
    else if (what === "pjview") { var view = act.getAttribute("data-view"); if (view === "closed") projects.closed = true; else if (view === "running") projects.closed = false; else { projects.view = view; projects.closed = false; } }
    else if (what === "goal-edit") { acts.editing = true; fields["ac-goal"] = goalAt(state.T); }
    else if (what === "goal-cancel") acts.editing = false;
    else if (what === "goal-clear") { acts.goal = ""; acts.editing = false; }
    else if (what === "goal-save") { if ((fields["ac-goal"] || "").trim() === goalAt(state.T)) return; acts.goal = (fields["ac-goal"] || "").trim(); acts.editing = false; }
    else if (what === "submit") submitAction();
    else if (what === "improve") {
      var text = (fields["ac-input"] || "").trim();
      if (!text) return;
      fields["ac-input"] = text.charAt(0).toUpperCase() + text.slice(1).replace(/\s*$/, "") + (/[.!?]$/.test(text) ? "" : ".") + " Have the Foreign Ministry brief our allies first, and announce it from the Élysée.";
    } else if (what === "brainstorm") {
      setDrawer("advisor", true);
      var input = el.ask.querySelector("textarea");
      input.value = "Let's brainstorm a plan of concrete actions for this round. Ask me what I'm trying to accomplish, then propose specific ones we can queue.";
      input.focus();
      return;
    } else if (what === "suggest") {
      acts.asked = true;
      acts.suggesting = true;
      acts.open = "suggested";
      setTimeout(function () { acts.suggesting = false; state.keys.actions = ""; renderActions(state.T); }, 1300);
    } else if (what === "queue") {
      var id = act.getAttribute("data-id");
      SUGGESTIONS.forEach(function (topic) { topic.actions.forEach(function (a) { if (a.id === id && !acts.queued[id]) { acts.queued[id] = true; delete acts.deleted[id]; acts.user = acts.user.filter(function (u) { return u.id !== id; }); acts.user.push({ id: id, title: a.title, text: a.text }); } }); });
    } else return;
    state.keys.actions = "";
    renderActions(state.T);
  }

  // ---- Rostra, the world's social network (social.jsx SocialPanel, PostCard, QuotedPost) -------------------
  // The posts of the people who make the news, out as the story passes them, and France's own: the reader
  // posts as France, and Quote under a post puts it in the box. Drawn as the game draws it: a phone that
  // rises from the dock, its tabs along the foot of the screen; on a phone, the app alone (game-ui.css).
  // The dock launcher: a smartphone (social.jsx RostraIcon).
  var ROSTRA_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="2" width="13" height="20" rx="3"/><path d="M10.5 5h3"/><path d="M9.5 19h5"/></svg>';
  var ROSTRA_MARK = '<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><path d="M6 3h20a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H13l-6 5v-5H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z" fill="#2bc1f3"/><path d="M12 21h8l-1.2-7.5h-5.6z" fill="#0b1a20"/><path d="M9.5 13.5h13" stroke="#0b1a20" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="9" r="2" fill="#0b1a20"/></svg>';
  var QUOTE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h4v4c0 2.5-1.3 4-4 5"/><path d="M14 7h4v4c0 2.5-1.3 4-4 5"/></svg>';
  var REPOST_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3l3 3-3 3"/><path d="M4 12V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 12v3a3 3 0 0 1-3 3H4"/></svg>';
  var HEART_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 5.8a5 5 0 0 0-7.1 0L12 7.2l-1.4-1.4a5 5 0 0 0-7.1 7.1L12 21.4l8.5-8.5a5 5 0 0 0 0-7.1z"/></svg>';
  var CLOSE_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var PEN_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l3.4-9.4 3.8-1.8 4 4-1.8 3.8z"/><path d="M10.2 9.8l4.6-4.6a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-4.6 4.6"/><path d="M3 21l5.6-5.6"/><circle cx="10" cy="14" r="1.4"/></svg>';
  var POLL_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h11"/><path d="M4 12h16"/><path d="M4 18h7"/></svg>';
  var REFRESH_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 4v6h-6"/><path d="M3 20v-6h6"/><path d="M5.2 9a8 8 0 0 1 13.6-2.6L21 10"/><path d="M18.8 15a8 8 0 0 1-13.6 2.6L3 14"/></svg>';
  var MAG_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/></svg>';
  var PIN_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>';
  var FLAGPOLE_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4.5c4.5-2 7.5 2 14 0v9c-6.5 2-9.5-2-14 0"/></svg>';
  var REPLY_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.6A8.4 8.4 0 1 1 21 11.5z"/></svg>';
  var TAB_ICON = function (paths) { return '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>"; };
  var RS_TABS = [
    ["all", "For you", TAB_ICON('<path d="M4 10.5L12 4l8 6.5V20h-5.5v-5.5h-5V20H4z"/>')],
    ["search", "Search", TAB_ICON('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/>')],
    ["mentions", "Mentions", TAB_ICON('<path d="M18 9a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>')],
    ["mine", "Your posts", TAB_ICON('<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-4.2 3.3-6.3 7.5-6.3s6.7 2.1 7.5 6.3"/>')]
  ];
  // The top of a phone's screen: the game's day, the island, the signal, wireless and battery marks.
  var STATUS_MARKS = '<svg width="16" height="10" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="0.7"/><rect x="4.6" y="5" width="3" height="6" rx="0.7"/><rect x="9.2" y="2.6" width="3" height="8.4" rx="0.7"/><rect x="13.8" y="0" width="3" height="11" rx="0.7"/></svg>' +
    '<svg width="14" height="10" viewBox="0 0 15 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1 4.2a9.2 9.2 0 0 1 13 0"/><path d="M3.4 6.7a5.8 5.8 0 0 1 8.2 0"/><circle cx="7.5" cy="9.3" r="0.9" fill="currentColor" stroke="none"/></svg>' +
    '<svg width="22" height="10" viewBox="0 0 24 11" fill="none"><rect x="0.5" y="0.5" width="20" height="10" rx="2.6" stroke="currentColor" opacity="0.45"/><rect x="2" y="2" width="14" height="7" rx="1.4" fill="currentColor"/><rect x="21.6" y="3.4" width="1.6" height="4.2" rx="0.8" fill="currentColor" opacity="0.5"/></svg>';
  var RS_EMPTY = {
    mentions: "Nobody has mentioned you yet. Post something, and the answers come with the next time skip.",
    mine: "You have not posted yet."
  };
  var RS_MAX = 280;
  // socialFeed.js playerAccount: the player posts as the leader, with the leader's title.
  var ME = { author: "The President of France", role: "Leader of France", country: "France", kind: "player" };
  // France asks its public before the congress (a poll: the public votes until the next time skip).
  POSTS.push({ t: 7.15, id: "p15", author: ME.author, role: ME.role, country: "France", date: "2017-02-09", kind: "player", round: 7, text: "If Strasbourg holds, should France send soldiers to keep the armistice in Korea?",
    poll: { choices: ["Yes, under the UN flag", "Observers only", "No French soldiers"], results: { shares: [46, 38, 16], votes: 1284000, consensus: "Most would back a UN mission, but few want French soldiers on the line itself." } }, reposts: 31000, likes: 240000 });
  POSTS.forEach(function (p) { if (p.kind === "player") { p.author = ME.author; p.role = ME.role; } });
  // Rostra's Search (rostraSearch.jsx): the places it knows, and what ordinary people there post.
  var PLACES = [["France", "country"], ["Île-de-France", "region", "France"], ["Provence-Alpes-Côte d'Azur", "region", "France"], ["Germany", "country"], ["Bavaria", "region", "Germany"], ["United Kingdom", "country"], ["Italy", "country"], ["Russia", "country"], ["Moscow Oblast", "region", "Russia"], ["China", "country"], ["United States", "country"], ["California", "region", "United States"], ["North Korea", "country"], ["South Korea", "country"], ["Gyeonggi-do", "region", "South Korea"], ["Busan", "region", "South Korea"]];
  var PEOPLE = {
    "France": [["Élodie Marchand", "elodie_lyon", "Teacher, Lyon", "5m", "Third strike notice this month at the lycée. The pupils are thrilled. I am not.", 412], ["Karim Benali", "karim_b75", "Taxi driver, Paris", "18m", "Everyone in my cab today has an opinion on Korea. Nobody has one on the traffic, which is the real war.", 1240], ["Juliette Fabre", "jufabre", "Student, Bordeaux", "1h", "If Strasbourg works I am naming my next cat Armistice.", 3400], ["Gilles Poirier", "gpoirier_vin", "Winemaker, Burgundy", "2h", "Frost forecast for the weekend. Forget the missiles, pray for the vines.", 286], ["Nadia Haddad", "nadia.hd", "Nurse, Marseille", "3h", "Twelve-hour shift, two coffees, one patient who called me an angel. Good day.", 2100]],
    "*": [["Anna Keller", "anna_k", "Baker", "4m", "Queue out of the door since six this morning. Everyone wants to talk about the news, nobody wants the rye.", 318], ["Tomás Ortega", "tortega", "Bus driver", "27m", "Route 12 is running again after the snow. You're welcome, {place}.", 960], ["Mei Lin", "meilin.reads", "Librarian", "1h", "Record day for the history shelf. People want to know how the last congress went.", 1530], ["Yusuf Demir", "ydemir", "Shopkeeper", "2h", "Prices up again. My customers blame the war, the government blames the weather, I blame my supplier.", 204]]
  };
  var TRENDS = { "France": ["#Strasbourg", "#Grève", "Korea", "Hollande", "Bourgogne"], "*": ["#Strasbourg", "Korea", "Prices", "{place}"] };
  var AVATAR_HUES = ["#3f6f9f", "#2f8577", "#5a8a45", "#8a7f3a", "#b0792a", "#b8643a", "#a44e48", "#5f6875"];
  var social = { tab: "all", seen: 0, user: [], quoting: "", posted: false, drawn: {}, composing: false, pollOn: false, choices: 2, refreshed: false, refreshing: false, place: "France", placeTab: "region", people: {}, liked: {} };
  function initials(name) {
    var words = String(name || "").trim().split(/\s+/).filter(Boolean);
    var letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
    return letters.map(function (w) { return Array.from(w)[0] || ""; }).join("").toUpperCase() || "?";
  }
  function compact(value) {
    var n = Math.max(0, Math.round(value || 0));
    if (n < 1000) return String(n);
    var shown = n < 1e6 ? n / 1e3 : n / 1e6;
    return (shown >= 100 ? Math.round(shown) : Math.round(shown * 10) / 10) + (n < 1e6 ? "K" : "M");
  }
  function postDate(text) { var d = parseDate(text); return d ? d.getUTCDate() + " " + MONTHS[d.getUTCMonth()].slice(0, 3) + " " + d.getUTCFullYear() : ""; }
  // rostraRefresh.jsx: before anyone has posted, Refresh brings the first posts in (one AI request in the game).
  function feedAt(T) {
    var upTo = social.refreshed ? Math.max(T, 0.8) : T;
    return POSTS.filter(function (p) { return p.t <= upTo; }).concat(social.user).sort(function (a, b) { return b.t - a.t || (b.n || 0) - (a.n || 0); });
  }
  function findPost(feed, id) { for (var i = 0; i < feed.length; i += 1) if (feed[i].id === id) return feed[i]; return null; }
  // As the game has it (runtime/socialFeed.js mentionsPlayer): a post that quotes France's, or that names France among
  // the polities it mentions (each canned post says so, as a time skip does), never the words of the post.
  function isMention(p, feed) {
    if (p.kind === "player") return false;
    var quoted = p.quote && findPost(feed, p.quote);
    return !!(quoted && quoted.kind === "player") || (p.mentions || []).indexOf("France") >= 0;
  }
  function inTab(p, tab, feed) {
    if (tab === "mentions") return isMention(p, feed);
    if (tab === "mine") return p.kind === "player";
    return true;
  }
  // A post of France's is answered with the next time skip: until then it has no reposts or likes.
  function engagement(p, feed, T) {
    var quotes = feed.filter(function (q) { return q.quote === p.id; }).length;
    if (p.kind === "player" && Math.floor(T) <= p.round) return { quotes: quotes, waiting: true };
    if (!p.user) return { quotes: quotes, reposts: p.reposts, likes: p.likes };
    var likes = Math.round(180000 * (0.25 + hash(p.n, 7, 11) * 1.5));
    return { quotes: quotes, reposts: Math.round(likes * (0.08 + hash(p.n, 3, 5) * 0.14)), likes: likes };
  }
  function avatar(p, small) {
    var mine = p.kind === "player";
    var flag = p.country ? tricolour(p.country === "France" ? null : p.flag, "rs-flag" + (p.across ? " across" : "")) : "";
    return '<span class="rs-av' + (small ? " small" : "") + (mine ? " mine" : "") + '" aria-hidden="true"><span>' + esc(initials(p.author)) + "</span>" + flag + "</span>";
  }
  function quotedPost(p) {
    if (!p) return '<div class="rs-quoted gone">This post is no longer available.</div>';
    return '<div class="rs-quoted"><div class="rs-qtop">' + avatar(p, true) + "<b>" + esc(p.author) + "</b>" + (p.role ? '<span class="rs-qrole">' + esc(p.role) + "</span>" : "") + "<small>" + postDate(p.date) + '</small></div><div class="rs-qtext">' + esc(p.text) + "</div></div>";
  }
  // PollCard: open until the round has passed, then its results.
  function pollCard(p, T) {
    var closed = p.poll.results && Math.floor(T) > p.round;
    var r = p.poll.results;
    var top = closed ? Math.max.apply(null, r.shares) : -1;
    var winner = closed && r.shares.filter(function (s) { return s === top; }).length === 1 ? r.shares.indexOf(top) : -1;
    return '<div class="rs-poll"><div class="rs-pchoices">' + p.poll.choices.map(function (c, i) {
      if (!closed) return '<div class="rs-pchoice open">' + esc(c) + "</div>";
      return '<div class="rs-pchoice"><i style="width:' + r.shares[i] + "%;background:" + (i === winner ? "rgba(43,193,243,0.28)" : "rgba(255,255,255,0.1)") + '"></i><span class="' + (i === winner ? "win" : "") + '"><b>' + (i === winner ? "✓ " : "") + esc(c) + "</b><em>" + r.shares[i] + "%</em></span></div>";
    }).join("") + '</div><div class="rs-pfoot">' + (closed ? "<span>" + r.votes.toLocaleString("en") + " votes</span><span>Final results</span>" : "<span>The public votes until the next time skip.</span>") + "</div>" +
      (closed && r.consensus ? '<div class="rs-consensus"><strong>Public consensus:</strong> ' + esc(r.consensus) + "</div>" : "") + "</div>";
  }
  function postCard(p, feed, T) {
    var mine = p.kind === "player";
    var e = engagement(p, feed, T);
    var meta = [p.role, p.country && p.country !== p.author ? p.country : ""].filter(Boolean).join(" · ");
    var fresh = !social.drawn[p.id];
    return '<article class="rs-post' + (fresh ? " fresh" : "") + '">' + avatar(p) + '<div class="rs-main"><div class="rs-top"><b>' + esc(p.author) + "</b>" + (mine ? '<span class="rs-you">You</span>' : "") + "<small>" + postDate(p.date) + "</small></div>" +
      (meta || p.poll ? '<div class="rs-meta">' + (p.poll ? '<span class="rs-pollchip">Poll</span>' : "") + "<span>" + esc(meta) + "</span></div>" : "") + '<div class="rs-text">' + esc(p.text) + "</div>" + (p.poll ? pollCard(p, T) : "") + (p.quote ? quotedPost(findPost(feed, p.quote)) : "") +
      '<div class="rs-acts"><button type="button" class="rs-act" data-rs="quote" data-id="' + p.id + '" title="Quote this post" aria-label="Quote this post">' + QUOTE_ICON + "<span>" + compact(e.quotes) + "</span></button>" +
      (e.waiting ? '<span class="rs-wait">The world answers with the next time skip.</span>' : '<span class="rs-count" title="Reposts">' + REPOST_ICON + "<span>" + compact(e.reposts) + '</span></span><span class="rs-count" title="Likes">' + HEART_ICON + "<span>" + compact(e.likes) + "</span></span>") +
      "</div></div></article>";
  }
  function composerHtml(feed) {
    var quoting = social.quoting ? findPost(feed, social.quoting) : null;
    var html = '<div class="rs-compose">' + avatar(ME) + '<div class="rs-main"><div class="rs-as">Posting as <b>' + esc(ME.author) + ", " + esc(ME.role) + "</b></div>" +
      '<textarea class="rs-input" data-field="rs-input" rows="2" aria-label="Your post" placeholder="' + (social.pollOn ? "Ask the public a question" : "What would you like to tell the world?") + '"></textarea>';
    if (social.pollOn) {
      html += '<div class="rs-pedit">';
      for (var i = 0; i < social.choices; i += 1) html += '<div class="rs-prow"><input class="rs-pin" data-field="rs-c' + i + '" maxlength="40" placeholder="Choice ' + (i + 1) + '" aria-label="Choice ' + (i + 1) + '" />' + (social.choices > 2 ? '<button type="button" class="rs-prm" data-rs="rmchoice" data-i="' + i + '" aria-label="Remove choice ' + (i + 1) + '">' + CLOSE_ICON + "</button>" : "") + "</div>";
      html += '<div class="rs-pmore">' + (social.choices < 4 ? '<button type="button" class="rs-addc" data-rs="addchoice">Add a choice</button>' : "<span></span>") + "<span>The public votes until the next time skip.</span></div></div>";
    }
    html += (quoting ? '<div class="rs-quoting">' + quotedPost(quoting) + '<button type="button" class="rs-unquote" data-rs="unquote" title="Remove the quote" aria-label="Remove the quote">' + CLOSE_ICON + "</button></div>" : "") +
      '<div class="rs-cfoot"><button type="button" class="rs-polltog' + (social.pollOn ? " on" : "") + '" data-rs="poll" title="' + (social.pollOn ? "Remove the poll" : "Add a poll") + '">' + POLL_ICON + 'Poll</button><span class="rs-len"></span><button type="button" class="rs-send" data-rs="post">Post</button></div></div></div>';
    return html;
  }
  function personPost(p, place, i) {
    var hue = AVATAR_HUES[Math.floor(hash(i, p[0].length, 3) * AVATAR_HUES.length)];
    var key = place + ":" + i;
    var liked = social.liked[key];
    return '<div class="rs-post rs-person"><span class="rs-pav" style="background:' + hue + '">' + esc(initials(p[0])) + '</span><div class="rs-main"><div class="rs-top"><b>' + esc(p[0]) + "</b><em>@" + esc(p[1]) + " · " + p[3] + '</em></div><div class="rs-about">' + esc(p[2]) + '</div><div class="rs-text">' + esc(p[4].replace("{place}", place)) + "</div>" +
      '<div class="rs-pacts"><span>' + REPLY_ICON + "</span><span>" + REPOST_ICON + '</span><button type="button" class="rs-like' + (liked ? " on" : "") + '" data-rs="like" data-key="' + esc(key) + '">' + HEART_ICON + "<span>" + compact(p[5] + (liked ? 1 : 0)) + "</span></button></div></div></div>";
  }
  function searchHtml(feed, T) {
    var q = (fields["rs-search"] || "").trim().toLowerCase();
    var html = '<div class="rs-sbox"><label class="rs-sfield">' + MAG_ICON + '<input type="search" data-field="rs-search" placeholder="Search countries and regions" aria-label="Search countries and regions" />' + (q ? '<button type="button" class="rs-sclear" data-rs="sclear" aria-label="Clear the search">' + CLOSE_ICON + "</button>" : "") + "</label></div>";
    if (q) {
      var hits = PLACES.filter(function (p) { return p[0].toLowerCase().indexOf(q) >= 0; });
      return html + (hits.length ? hits.map(function (p) {
        return '<button type="button" class="rs-hit" data-rs="pick" data-place="' + esc(p[0]) + '"><span class="ic">' + (p[1] === "region" ? PIN_ICON : FLAGPOLE_ICON) + '</span><span><b>' + esc(p[0]) + "</b><small>" + (p[1] === "region" ? esc(p[2]) : "Country") + "</small></span></button>";
      }).join("") : '<div class="rs-none">No country or region by that name.</div>');
    }
    var place = PLACES.filter(function (p) { return p[0] === social.place; })[0] || PLACES[0];
    var country = place[1] === "region" ? place[2] : place[0];
    var shown = place[1] === "region" && social.placeTab === "country" ? country : place[0];
    var day = dateAt(T, state.korea);
    html += '<div class="rs-place"><div><b>' + esc(place[0]) + "</b><small>" + day.getUTCDate() + " " + MONTHS[day.getUTCMonth()] + " " + day.getUTCFullYear() + "</small></div>" + (place[0] !== "France" ? '<button type="button" class="rs-home-pill" data-rs="pick" data-place="France">Your country</button>' : "") +
      '<button type="button" class="rs-ricon" data-rs="refresh" title="Load new posts (one AI request)" aria-label="Load new posts (one AI request)">' + REFRESH_ICON + "</button></div>";
    if (place[1] === "region") html += '<div class="rs-ptabs"><button type="button" class="' + (social.placeTab !== "country" ? "on" : "") + '" data-rs="ptab" data-ptab="region">' + esc(place[0]) + '</button><button type="button" class="' + (social.placeTab === "country" ? "on" : "") + '" data-rs="ptab" data-ptab="country">' + esc(country) + "</button></div>";
    var people = social.people[shown];
    if (people === "done") html += '<div class="rs-trend"><div class="rs-label">Trending</div><div class="chips">' + (TRENDS[shown] || TRENDS["*"]).map(function (t) { return "<span>" + esc(t.replace("{place}", shown)) + "</span>"; }).join("") + "</div></div>";
    if (place[1] === "country" || social.placeTab === "country") {
      var own = feed.filter(function (p) { return p.country === country; }).slice(0, 6);
      html += '<div class="rs-label pad">On Rostra</div>' + (own.length ? own.map(function (p) { return postCard(p, feed, T); }).join("") : '<p class="rs-empty">Nobody from ' + esc(country) + " has posted on Rostra yet.</p>");
    }
    html += '<div class="rs-label pad">What people are saying</div>';
    if (people === "loading") html += '<div class="rs-tuning">Tuning in…</div>' + [0, 1, 2].map(function () { return '<div class="rs-skel"><i class="av"></i><div><i style="width:45%"></i><i style="width:92%"></i><i style="width:70%"></i></div></div>'; }).join("");
    else if (people === "done") html += (PEOPLE[shown] || PEOPLE["*"]).map(function (p, i) { return personPost(p, shown, i); }).join("") + '<div class="rs-written">Written by your AI model. Each new feed is one AI request.</div>';
    else html += '<div class="rs-refresh"><b>Nothing has been posted here yet.</b><span>Refresh to see what ordinary people in ' + esc(shown) + ' are posting.</span><button type="button" class="rs-rbtn" data-rs="refresh">' + REFRESH_ICON + 'Refresh</button><small>One AI request</small></div>';
    return html;
  }
  function renderSocial(T) {
    if (state.pop !== "social") return;
    social.seen = Math.max(social.seen, T);
    var feed = feedAt(T);
    var posts = feed.filter(function (p) { return inTab(p, social.tab, feed); });
    var mentions = feed.filter(function (p) { return isMention(p, feed) && p.t >= Math.floor(T); }).length;
    var day = postDate(isoDate(dateAt(T, state.korea)));
    var html = '<span class="rs-side one" aria-hidden="true"></span><span class="rs-side two" aria-hidden="true"></span><span class="rs-side three" aria-hidden="true"></span><div class="rs-screen">' +
      '<div class="rs-status" aria-hidden="true"><span>' + day + '</span><i class="rs-island"></i><span class="rs-marks">' + STATUS_MARKS + "</span></div>" +
      '<div class="rs-head">' + ROSTRA_MARK + '<div class="rs-name"><b>Rostra</b><small>What the world is saying</small></div><span class="rs-day">' + day + "</span>" +
      '<button type="button" class="rs-pen' + (social.composing ? " on" : "") + '" data-rs="pen" aria-pressed="' + social.composing + '" title="' + (social.composing ? "Put the post away" : "Write a post") + '" aria-label="' + (social.composing ? "Put the post away" : "Write a post") + '">' + PEN_ICON + "</button>" +
      '<button type="button" class="rs-x" data-rs="close" aria-label="Close Rostra">' + CLOSE_ICON + "</button></div>";
    if (social.posted && !social.composing) html += '<div class="rs-posted">Posted. The world answers with the next time skip.</div>';
    html += '<div class="rs-scroll">' + (social.composing ? composerHtml(feed) : "");
    if (social.tab === "search") html += searchHtml(feed, T);
    else if (social.tab === "all" && !posts.length) html += '<div class="rs-refresh"><b>Nothing has been posted yet.</b><span>Refresh to see what the people who make the news are posting.</span><button type="button" class="rs-rbtn" data-rs="first"' + (social.refreshing ? " disabled" : "") + ">" + REFRESH_ICON + (social.refreshing ? "Refreshing…" : "Refresh") + "</button><small>One AI request</small></div>";
    else html += posts.length ? posts.map(function (p) { return postCard(p, feed, T); }).join("") : '<p class="rs-empty">' + RS_EMPTY[social.tab] + "</p>";
    html += '</div><div class="rs-bar" role="tablist">' + RS_TABS.map(function (tab) {
      var on = social.tab === tab[0];
      var count = tab[0] === "mentions" ? mentions : 0;
      return '<button type="button" role="tab" aria-selected="' + on + '" class="rs-tab' + (on ? " on" : "") + '" data-rs="tab" data-tab="' + tab[0] + '"><span class="rs-ticon">' + tab[2] + (count ? '<span class="rs-tcount">' + (count > 9 ? "9+" : count) + "</span>" : "") + "</span><span class=\"rs-tlabel\">" + tab[1] + "</span></button>";
    }).join("") + '</div><div class="rs-home" aria-hidden="true"><i></i></div></div>';
    if (!changed("social", html)) return;
    var focused = document.activeElement && el.social.contains(document.activeElement) && document.activeElement.getAttribute("data-field");
    var caret = focused ? document.activeElement.selectionStart : 0;
    var scroller = el.social.querySelector(".rs-scroll");
    var scroll = scroller ? scroller.scrollTop : 0;
    el.social.innerHTML = html;
    Array.prototype.forEach.call(el.social.querySelectorAll("[data-field]"), function (input) {
      var key = input.getAttribute("data-field");
      input.value = fields[key] || "";
      if (key === focused) { input.focus(); try { input.setSelectionRange(caret, caret); } catch (error) { /* no caret */ } }
    });
    el.social.querySelector(".rs-scroll").scrollTop = scroll;
    posts.forEach(function (p) { social.drawn[p.id] = true; });
    syncPost();
  }
  function pollChoices() {
    var out = [];
    for (var i = 0; i < social.choices; i += 1) { var c = (fields["rs-c" + i] || "").trim(); if (c) out.push(c); }
    return out;
  }
  function syncPost() {
    var input = el.social.querySelector(".rs-input");
    if (!input) return;
    var length = Array.from(input.value.trim()).length;
    var len = el.social.querySelector(".rs-len");
    len.textContent = length + "/" + RS_MAX;
    len.classList.toggle("over", length > RS_MAX);
    el.social.querySelector(".rs-send").classList.toggle("on", length > 0 && length <= RS_MAX && (!social.pollOn || pollChoices().length >= 2));
  }
  function submitPost() {
    var text = (fields["rs-input"] || "").trim();
    if (!text || Array.from(text).length > RS_MAX) return;
    var choices = social.pollOn ? pollChoices() : null;
    if (social.pollOn && choices.length < 2) return;
    var n = social.user.length + 1;
    var post = { t: state.T, n: n, id: "u" + n, author: ME.author, role: ME.role, country: "France", date: isoDate(dateAt(state.T, state.korea)), kind: "player", round: Math.floor(state.T), user: true, quote: social.quoting, text: text };
    if (choices) {
      var raw = choices.map(function (c, i) { return 1 + hash(n, i, 13) * 4; });
      var sum = raw.reduce(function (a, b) { return a + b; }, 0);
      var shares = raw.map(function (r) { return Math.round(r / sum * 100); });
      shares[0] += 100 - shares.reduce(function (a, b) { return a + b; }, 0);
      post.poll = { choices: choices, results: { shares: shares, votes: Math.round(400000 + hash(n, 5, 9) * 1200000), consensus: "" } };
    }
    social.user.push(post);
    fields["rs-input"] = "";
    for (var i = 0; i < 4; i += 1) fields["rs-c" + i] = "";
    social.quoting = "";
    social.pollOn = false;
    social.choices = 2;
    social.posted = true;
    social.composing = false;
    if (social.tab !== "all" && social.tab !== "mine") social.tab = "all";
  }
  function socialClick(event) {
    var act = event.target.closest("[data-rs]");
    if (!act) return;
    var what = act.getAttribute("data-rs");
    state.manual.pop = "social";
    if (what === "close") { setPop(null, true); return; }
    if (what === "tab") social.tab = act.getAttribute("data-tab");
    else if (what === "unquote") social.quoting = "";
    else if (what === "post") submitPost();
    else if (what === "pen") {
      social.composing = !social.composing;
      social.posted = false;
      if (!social.composing) { social.quoting = ""; social.pollOn = false; social.choices = 2; }
    } else if (what === "quote") { social.quoting = act.getAttribute("data-id"); social.posted = false; social.composing = true; }
    else if (what === "poll") { social.pollOn = !social.pollOn; social.choices = 2; fields["rs-c0"] = fields["rs-c1"] = fields["rs-c2"] = fields["rs-c3"] = ""; }
    else if (what === "addchoice") social.choices = Math.min(4, social.choices + 1);
    else if (what === "rmchoice") {
      for (var i = +act.getAttribute("data-i"); i < 3; i += 1) fields["rs-c" + i] = fields["rs-c" + (i + 1)] || "";
      fields["rs-c3"] = "";
      social.choices = Math.max(2, social.choices - 1);
    } else if (what === "first") {
      social.refreshing = true;
      setTimeout(function () { social.refreshing = false; social.refreshed = true; state.keys.social = ""; renderSocial(state.T); }, 1200);
    } else if (what === "pick") { social.place = act.getAttribute("data-place"); social.placeTab = "region"; fields["rs-search"] = ""; }
    else if (what === "sclear") fields["rs-search"] = "";
    else if (what === "ptab") social.placeTab = act.getAttribute("data-ptab");
    else if (what === "refresh") {
      var place = PLACES.filter(function (p) { return p[0] === social.place; })[0] || PLACES[0];
      var shown = place[1] === "region" && social.placeTab === "country" ? place[2] : place[0];
      if (social.people[shown] === "loading") return;
      social.people[shown] = "loading";
      setTimeout(function () { social.people[shown] = "done"; state.keys.social = ""; renderSocial(state.T); }, 1200);
    } else if (what === "like") { var key = act.getAttribute("data-key"); social.liked[key] = !social.liked[key]; }
    else return;
    renderSocial(state.T);
    if (what === "pen" || what === "quote") {
      el.social.querySelector(".rs-scroll").scrollTop = 0;
      var input = el.social.querySelector(".rs-input");
      if (input) setTimeout(function () { input.focus(); }, 60);
    }
  }
  function socialBadge(T) {
    var unseen = state.pop === "social" ? 0 : POSTS.filter(function (p) { return p.t <= T && p.t > social.seen; }).length;
    el.socialBadge.hidden = !unseen;
    el.socialBadge.textContent = unseen > 9 ? "9+" : String(unseen);
    el.socialBtn.setAttribute("aria-label", unseen ? "Rostra, " + unseen + " new post" + (unseen === 1 ? "" : "s") : "Rostra");
  }

  // ---- the Diplomacy panel (chat.jsx: the workspace, ChatListItem, ConversationView) ----------------
  var BACK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  var CONTACTS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  var INSTITUTIONS = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V10M19 21V10M9 21V10M15 21V10"/><path d="M2 10 12 3l10 7z"/></svg>';
  var INTELLIGENCE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var dip = { view: "list", thread: -1, tab: "chats", typed: {}, seen: {} };
  function threadLines(i, T) {
    var shown = CHATS[i].lines.filter(function (l) { return l[0] <= T; }).map(function (l) { return [l[1], typed(l[2], l[0], 0.06, T), l[0]]; });
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
        '<div class="dp-convtitle"><b>' + thread.with + ' <span class="dp-edit" title="Rename"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20H4v-4z"/></svg></span></b><small>Direct diplomatic channel</small></div><button type="button" class="dp-add"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Add Country</button><button type="button" class="dp-ic env" title="Mark unread" aria-label="Mark unread"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></button><button type="button" class="dp-ic trash" title="Delete chat" aria-label="Delete chat"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg></button><button type="button" class="dp-x" data-dip="back" aria-label="Close conversation">✕</button></div>';
      // ConversationView: the country speaks under its own name; each game day opens with its date.
      var lastDay = "", lastWho = "";
      html += '<div class="dp-msgs">' + (lines.length ? lines.map(function (l) {
        var day = shortDate(dateAt(l[2] != null ? l[2] : state.T, state.korea));
        var out = day !== lastDay ? '<div class="dp-day"><span>' + day + "</span></div>" : "";
        var same = l[0] === lastWho && day === lastDay;
        lastDay = day;
        lastWho = l[0];
        return out + '<div class="dp-msg' + (l[0] === "u" ? " me" : "") + (same ? " same" : "") + '">' + (l[0] === "u" || same ? "" : '<span class="dp-speaker">' + tricolour(thread.flag, "dp-sflag") + "<strong>" + thread.with + "</strong></span>") + '<div class="dp-bubble" style="--accent:' + thread.flag[thread.flag.length - 1] + '">' + esc(l[1]) + "</div>" + (l[0] === "u" ? "" : '<span class="dp-when">' + day + "</span>") + "</div>";
      }).join("") : '<div class="dp-empty">Begin the diplomatic conversation.</div>') + "</div>";
      html += '<form class="dp-compose" data-dip="send"><div class="dp-crow"><textarea rows="1" placeholder="Send a diplomatic message…" aria-label="Send a diplomatic message"></textarea><button type="submit" aria-label="Send"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg></button></div><div class="dp-hint">Enter to send · Shift+Enter for a new line</div></form>';
    } else {
      var unread = CHATS.filter(function (c, i) { return threadUnread(i, T); }).length;
      html += '<div class="dp-head"><div class="dp-title"><span class="dp-icon">' + CONTACTS + '</span><div><b>Diplomacy</b><small>Conversations, institutions and statecraft</small></div></div><button type="button" class="dp-x" data-dip="close" aria-label="Close diplomacy panel">✕</button></div>';
      html += '<div class="dp-tabs">' + [["chats", CONTACTS, "Contacts", unread], ["institutions", INSTITUTIONS, "Institutions", pendingBallots(T).length], ["spy", INTELLIGENCE, "Intelligence", 0]].map(function (tab) {
        return '<button type="button" class="dp-tab' + (dip.tab === tab[0] ? " on" : "") + '" data-tab="' + tab[0] + '"><span class="ic">' + tab[1] + "</span><span>" + tab[2] + "</span>" + (tab[3] ? '<span class="dp-count">' + tab[3] + "</span>" : "") + "</button>";
      }).join("") + "</div>";
      if (dip.tab === "chats") {
        var open = CHATS.map(function (c, i) { return i; }).filter(function (i) { return threadLines(i, T).length; });
        if (open.length) html += '<div class="dp-unreadbar"><button type="button" class="dp-unread' + (dip.unreadOnly ? " on" : "") + '" data-dip="unread">' + (dip.unreadOnly ? "<i></i>" : "") + "Unread (" + unread + ")</button>" + (unread ? '<button type="button" class="dp-markall" data-dip="markall">Mark all read</button>' : "") + "</div>";
        html += '<div class="dp-list">';
        var listed = open.filter(function (i) { return !dip.unreadOnly || threadUnread(i, T); });
        if (!open.length) html += '<div class="dp-empty">No diplomatic conversations yet.<br>Start one below.</div>';
        else if (!listed.length) html += '<div class="dp-empty">No unread chats — you\'re all caught up.</div>';
        else {
          // ChatList: grouped under the date of each chat's last message.
          var group = "";
          listed.slice().reverse().forEach(function (i) {
            var lines = threadLines(i, T);
            var last = lines[lines.length - 1];
            var lastT = CHATS[i].lines.filter(function (l) { return l[0] <= T; }).map(function (l) { return l[0]; }).pop();
            var d = dateAt(lastT == null ? T : lastT, state.korea);
            var label = MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear();
            if (label !== group) { html += '<div class="dp-group">' + label + "</div>"; group = label; }
            var isUnread = threadUnread(i, T);
            html += '<div class="dp-rowwrap"><button type="button" class="dp-row' + (isUnread ? " unread" : "") + '" data-thread="' + i + '"><span class="dp-dot">' + (isUnread ? "<i></i>" : "") + "</span>" + tricolour(CHATS[i].flag, "dp-flag") +
              '<span class="dp-rowtext"><span class="dp-rowtop"><b>' + CHATS[i].with + '</b><em>Direct channel</em></span><span class="dp-preview">' + esc(last ? last[1] : "No messages yet") + '</span></span></button><span class="dp-rowacts"><button type="button" class="dp-ic env" data-dip="markread" data-i="' + i + '" title="Mark read" aria-label="Mark read"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></button><button type="button" class="dp-ic trash" title="Delete chat" aria-label="Delete chat"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg></button></span></div>';
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
    else if (act && act.getAttribute("data-dip") === "unread") dip.unreadOnly = !dip.unreadOnly;
    else if (act && act.getAttribute("data-dip") === "markall") CHATS.forEach(function (c, i) { dip.seen[i] = c.lines.filter(function (l) { return l[0] <= state.T && l[1] === "t"; }).length; });
    else if (act && act.getAttribute("data-dip") === "markread") { var mi = +act.getAttribute("data-i"); dip.seen[mi] = CHATS[mi].lines.filter(function (l) { return l[0] <= state.T && l[1] === "t"; }).length; }
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
    el.panel.hidden = which !== "events" && which !== "timeline";
    el.actions.hidden = which !== "actions";
    state.keys.actions = "";
    el.social.hidden = which !== "social";
    state.keys.social = "";
    el.dip.hidden = which !== "chat";
    if (which === "chat" && !byHand && state.step === "talks") { dip.view = "thread"; dip.thread = CHATS.length - 1; }
    // main.jsx: on a phone a bottom panel opening closes the advisor and the country panel.
    if (which && byHand && phone()) setDrawer(null, true);
    el.eventsBtn.classList.toggle("on", which === "events");
    $("gxSkipBtn").classList.toggle("on", which === "timeline");
    Array.prototype.forEach.call(el.root.querySelectorAll("[data-pop]"), function (b) { b.classList.toggle("on", b.getAttribute("data-pop") === which); });
    renderPanel(state.T);
    renderDip(state.T);
    renderActions(state.T);
    renderSocial(state.T);
    socialBadge(state.T);
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
      html += '<div class="wr-general wr-tray' + (lit ? " lit" : "") + '"><span class="wr-num"' + (lit ? ' style="background:#c9a54c;color:#1c1608"' : "") + ">" + (i + 1) + '</span><div class="who"><b>' + g[0] + ' <span class="wr-stencil army">' + g[1] + '</span></b><div class="wr-soft">' + left + " formations at " + strength + "% · holding the line near " + esc(next) + '</div><div class="orders">Ordered: ' + (i % 2 ? "Dig in" : "Fall back toward " + esc(after)) + '</div></div><button type="button" class="wr-link">Pick</button></div>';
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
  // warRoomRail.jsx: the count is the troops picked out (Select picks the 1st Army's); the orders that need
  // troops wait until some are picked, and Aircraft until the side has air units.
  var NEEDS_TROOPS = ["Route", "Advance", "Dig in", "Hold", "Fall back", "Release", "Transport"];
  function renderRail() {
    var picked = state.tool === "Select" ? GENERALS[0][2] : 0;
    var html = '<span class="wr-rivet" style="left:0.25rem"></span><span class="wr-rivet" style="right:0.25rem"></span><span class="wr-stencil lbl">Troops</span><span class="wr-count' + (picked ? " on" : "") + '">' + picked + '</span><span class="wr-rule"></span>';
    RAIL.forEach(function (key) {
      if (!key) { html += '<span class="wr-rule"></span>'; return; }
      var off = (!picked && NEEDS_TROOPS.indexOf(key[0]) >= 0) || key[0] === "Aircraft";
      html += '<button type="button" class="wr-railkey' + (state.tool === key[0] ? " on" : "") + (off ? " off" : "") + '" data-tool="' + key[0] + '"' + (off ? ' aria-disabled="true"' : "") + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + key[1] + "</svg>" + key[0] + "</button>";
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
  // Called every frame the story draws. When nothing has moved since the last call it does nothing but
  // let the advisor's "Thinking…" dots tick, four times a second; the reader's own clicks redraw at once.
  var lastUpdate = { key: "", at: 0 };
  function update(T, step, extra) {
    if (!el.root) return;
    var key = T.toFixed(4) + step + (extra ? extra.korea : "");
    var now = Date.now();
    if (key === lastUpdate.key && now - lastUpdate.at < 250) return;
    lastUpdate.key = key;
    lastUpdate.at = now;
    state.T = T;
    state.korea = extra && extra.korea >= 0 ? extra.korea : 0;
    if (step !== state.step) {
      state.step = step;
      state.manual = {};
      // On a phone a sheet covers the map, so a chapter opens one only where the map is not the point,
      // and never with a bottom panel (main.jsx: they take turns).
      setDrawer(!phone() ? DRAWER[step] || "advisor" : POP[step] || step === "launch" || step === "korea" ? null : DRAWER[step] || null);
      if (VIEW[step]) setView(VIEW[step]);
      acts.tab = ACTIONS_TAB[step] || "actions";
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
      el.date.textContent = step === "yours" ? "Your turn" : phone() ? MONTHS[date.getUTCMonth()].slice(0, 3) + " " + ordinal(date.getUTCDate()) + ", " + date.getUTCFullYear() : longDate(date);
      el.session.textContent = "Modern Day / France / " + isoDate(date);
    }
    if (state.drawer === "advisor") renderAdvisor(T);
    if (state.drawer === "country") renderCountry(T);
    renderPanel(T);
    renderDip(T);
    renderActions(T);
    renderSocial(T);
    socialBadge(T);
    var unread = CHATS.filter(function (c, i) { return threadUnread(i, T); }).length;
    el.chatBadge.hidden = !unread || state.pop === "chat";
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
    el.ask.querySelector("textarea").addEventListener("input", syncComposer);
    $("gxRecipient").addEventListener("click", function () {
      var list = $("gxRecipientList");
      list.hidden = !list.hidden;
      $("gxRecipient").setAttribute("aria-expanded", String(!list.hidden));
      $("gxRecipient").querySelector(".chev").textContent = list.hidden ? "▾" : "▴";
    });
    $("gxContact").addEventListener("click", function () { $("gxRecipientList").hidden = false; $("gxRecipient").setAttribute("aria-expanded", "true"); $("gxRecipient").querySelector(".chev").textContent = "▴"; });
    el.view.addEventListener("click", dossierClick);
    el.view.addEventListener("input", dossierInput);
    el.view.addEventListener("change", dossierInput);
    el.ask.addEventListener("submit", ask);
    el.ask.querySelector("textarea").addEventListener("keydown", function (event) { if (event.key === "Enter" && !event.shiftKey) ask(event); });
    el.country.querySelector(".gx-dos-tabs").addEventListener("click", function (event) {
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
      var tag = event.target.closest("[data-etag]");
      if (tag) { events.filter[tag.getAttribute("data-etag")] = !events.filter[tag.getAttribute("data-etag")]; state.keys.panel = ""; renderPanel(state.T); return; }
      if (!go || go.classList.contains("off")) return;
      if (state.pop === "timeline") setPop(null, true);
      opts.goTo(go.getAttribute("data-go") === "end" ? STEPS.length - 1 : Math.floor(state.T) + 1);
    });
    el.panelSub.addEventListener("click", function (event) {
      var turn = event.target.closest("[data-turn]");
      if (!turn || turn.disabled) return;
      var count = eventTurns(state.T).length;
      var at = events.turn < 0 || events.turn >= count ? count - 1 : events.turn;
      events.turn = Math.max(0, Math.min(count - 1, at + +turn.getAttribute("data-turn")));
      state.manual.pop = "events";
      state.keys.panel = "";
      renderPanel(state.T);
    });
    var timelineField = function (event) {
      var key = event.target.getAttribute && event.target.getAttribute("data-field");
      if (!key) return;
      fields[key] = event.target.value;
      state.keys.panel = "";
      renderPanel(state.T);
    };
    el.panelBody.addEventListener("input", timelineField);
    el.panelBody.addEventListener("change", timelineField);
    // » opens the Timeline (time.jsx TimelineSkipPanel); any length skips on to the next chapter.
    $("gxSkipBtn").addEventListener("click", function () { setPop(state.pop === "timeline" ? null : "timeline", true); });
    var menuButton = $("gxMenuBtn");
    var menu = $("gxMenu");
    menuButton.addEventListener("click", function () { menu.hidden = !menu.hidden; menuButton.setAttribute("aria-expanded", String(!menu.hidden)); });
    var search = $("gxSearch");
    var searchInput = search.querySelector("input");
    var searchList = search.querySelector(".gx-search-list");
    var closeSearch = function () { search.classList.remove("open", "listing"); searchInput.value = ""; searchInput.hidden = true; searchList.hidden = true; };
    search.addEventListener("click", function (event) {
      if (event.target.closest(".gx-search-ic") && search.classList.contains("open")) { closeSearch(); return; }
      var hit = event.target.closest("[data-place]");
      if (hit) { closeSearch(); return; }
      if (search.classList.contains("open")) return;
      search.classList.add("open");
      searchInput.hidden = false;
      searchInput.focus();
    });
    // The places it finds, opening upwards from the bar (search.jsx): countries, cities and regions on the map.
    var SEARCH_PLACES = [["France", "Country", "globe"], ["Paris", "Île-de-France · France", "city"], ["Strasbourg", "Grand Est · France", "city"], ["Germany", "Country", "globe"], ["Berlin", "Berlin · Germany", "city"], ["Russia", "Country", "globe"], ["Moscow", "Moscow · Russia", "city"], ["Plesetsk", "Arkhangelsk Oblast · Russia", "pin"], ["United States", "Country", "globe"], ["Washington", "District of Columbia · United States", "city"], ["Montana", "United States", "region"], ["China", "Country", "globe"], ["Beijing", "Beijing · China", "city"], ["North Korea", "Country", "globe"], ["Pyongyang", "Pyongyang · North Korea", "city"], ["South Korea", "Country", "globe"], ["Seoul", "Seoul · South Korea", "city"], ["Busan", "Busan · South Korea", "city"], ["Daejeon", "Daejeon · South Korea", "city"]];
    var SEARCH_ICONS = { globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', city: '<path d="M4 21V9l6-4v16M10 21V3l10 4v14M4 21h16"/>', region: '<path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z"/>', pin: '<path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>' };
    searchInput.addEventListener("input", function () {
      var q = searchInput.value.trim().toLowerCase();
      var hits = q ? SEARCH_PLACES.filter(function (p) { return p[0].toLowerCase().indexOf(q) >= 0; }).slice(0, 7) : [];
      search.classList.toggle("listing", hits.length > 0);
      searchList.hidden = !hits.length;
      searchInput.placeholder = "Search place...";
      search.classList.toggle("missing", !!q && !hits.length);
      searchList.innerHTML = hits.map(function (p, i) { return '<button type="button" class="' + (i ? "" : "hi") + '" data-place="' + esc(p[0]) + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + SEARCH_ICONS[p[2]] + "</svg><b>" + esc(p[0]) + "</b><small>" + esc(p[1]) + "</small>" + (p[2] === "globe" ? "" : "<em>In world</em>") + "</button>"; }).join("");
    });
    searchInput.addEventListener("keydown", function (event) { if (event.key === "Escape" || event.key === "Enter") closeSearch(); });
    searchInput.addEventListener("blur", function () { setTimeout(function () { if (!searchInput.value && document.activeElement !== searchInput) closeSearch(); }, 150); });
    // Political / Diplomatic: the story's map takes France's stance towards each country.
    var mapMode = $("gxMapMode");
    mapMode.addEventListener("click", function (event) {
      var button = event.target.closest("[data-mm]");
      if (!button) return;
      var mode = button.getAttribute("data-mm");
      var legend = mapMode.querySelector(".gx-mm-legend");
      if (mode === "hide") { legend.hidden = true; return; }
      Array.prototype.forEach.call(mapMode.querySelectorAll(".gx-mm-bar button"), function (b) { b.classList.toggle("on", b.getAttribute("data-mm") === mode); });
      legend.hidden = mode !== "diplomatic";
      if (opts.mapMode) opts.mapMode(mode);
    });
    el.actions = $("gxActions");
    el.actions.addEventListener("click", actionsClick);
    el.actions.addEventListener("input", function (event) {
      var key = event.target.getAttribute("data-field");
      if (!key) return;
      fields[key] = event.target.value;
      if (key === "pj-sort") projects.sort = event.target.value;
      if (key === "pj-search" || key === "pj-sort") { state.keys.actions = ""; renderActions(state.T); }
      else syncSend();
    });
    el.actions.addEventListener("change", function (event) {
      if (event.target.getAttribute && event.target.getAttribute("data-field") === "pj-sort") { projects.sort = event.target.value; fields["pj-sort"] = event.target.value; state.keys.actions = ""; renderActions(state.T); }
    });
    el.actions.addEventListener("keydown", function (event) {
      var key = event.target.getAttribute && event.target.getAttribute("data-field");
      if (!key || event.key !== "Enter" || event.shiftKey || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) return;
      event.preventDefault();
      actionsClick({ target: el.actions.querySelector(key === "ac-goal" ? '[data-ac="goal-save"]' : '[data-ac="submit"]') });
    });
    el.social = $("gxSocial");
    el.socialBtn = $("gxSocialBtn");
    el.socialBadge = $("gxSocialBadge");
    el.social.addEventListener("click", socialClick);
    el.social.addEventListener("input", function (event) {
      var key = event.target.getAttribute("data-field");
      if (!key) return;
      fields[key] = event.target.value;
      if (key === "rs-search") { state.keys.social = ""; renderSocial(state.T); return; }
      if (key === "rs-input" && social.posted) { social.posted = false; renderSocial(state.T); }
      syncPost();
    });
    el.social.addEventListener("keydown", function (event) {
      if (event.target.getAttribute("data-field") === "rs-search" && (event.key === "Enter" || event.key === "Escape")) {
        var first = event.key === "Enter" && el.social.querySelector(".rs-hit");
        if (first) socialClick({ target: first }); else { fields["rs-search"] = ""; state.keys.social = ""; renderSocial(state.T); }
        event.preventDefault();
        return;
      }
      if (event.target.getAttribute("data-field") !== "rs-input" || event.key !== "Enter" || event.shiftKey || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) return;
      event.preventDefault();
      socialClick({ target: el.social.querySelector('[data-rs="post"]') });
    });
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
      if (!key || key.classList.contains("off")) return;
      state.tool = state.tool === key.getAttribute("data-tool") ? "" : key.getAttribute("data-tool");
      renderRail();
      state.keys.war = "";
      renderWar(state.T, state.korea);
    });
    setDrawer("advisor");
  }

  window.OH_GAME_UI = { init: init, update: update };
})();
