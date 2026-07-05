/*! Open Historia — Fantasy Map Generator driver © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Runs Azgaar's Fantasy Map Generator (pinned v1.109, vendored at /fmg/) headlessly
// in a hidden same-origin iframe, drives a generation from a few inputs, and pulls
// out the data fmgImport needs.
//
// Hard-won details this handles:
//  • FMG state (pack, grid, …) are `let` globals in classic scripts — global lexical
//    bindings, NOT window.pack — so we read them via the frame's own eval().
//  • A hidden/headless frame reports innerWidth 0, so we set the map size explicitly
//    (else FMG builds an empty 0×0 map and crashes).
//  • We call FMG's generate() DIRECTLY (the data pipeline) — NOT regenerateMap, whose
//    undraw()/drawLayers()/fitMapToScreen() rendering hangs in a zero-layout frame.
//  • FMG's randomizeOptions() keeps LOCKED options and randomizes the rest, so we set
//    AND lock our options to make them stick. Crucially we force a SYNCHRONOUS heightmap
//    template: the "precreated" real-world heightmaps load a PNG whose onload never
//    fires on a 404 (no onerror handler), hanging generate() at the heightmap forever.
//  • The FMG frame shares this origin's localStorage; a prior session can persist a bad
//    template there, so we reset it before loading.

const FMG_PATH = "/fmg/index.html";
const READY_TIMEOUT_MS = 90000;
const MAP_W = 1920;
const MAP_H = 1080;
// Synchronous, in-memory heightmap templates (no image load → never hang).
const SYNC_TEMPLATES = ["continents", "archipelago", "pangea", "mediterranean", "peninsula", "isthmus", "atoll", "highIsland", "lowIsland", "volcano", "shattered", "fractious"];
// For "random" (or an unknown template) pick only from world-scale shapes — skip the
// tiny-island templates (atoll/volcano/lowIsland) that make poor whole-world basemaps.
// Deterministic for a given seed so re-running the same seed reproduces the same map.
const WORLD_TEMPLATES = ["continents", "archipelago", "pangea", "mediterranean", "peninsula", "isthmus", "highIsland", "fractious"];
const resolveTemplate = (params) => {
  if (SYNC_TEMPLATES.includes(params.template)) return params.template;
  const s = String(params.seed || "").replace(/[^0-9]/g, "");
  const idx = s ? Number(s.slice(-4)) % WORLD_TEMPLATES.length : Math.floor(Math.random() * WORLD_TEMPLATES.length);
  return WORLD_TEMPLATES[idx];
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evalIn = (win, expr) => { try { return win.eval(expr); } catch { return undefined; } };

const cellCount = (win) =>
  Number(evalIn(win, "typeof pack!=='undefined' && pack.cells && pack.cells.i ? pack.cells.i.length : 0")) || 0;
const fmgReady = (win) =>
  evalIn(win, "typeof generate==='function' && typeof d3!=='undefined' && typeof pack!=='undefined'") === true;
const mapValid = (win) =>
  cellCount(win) > 0 &&
  Number(evalIn(win, "typeof pack!=='undefined' && pack.states ? pack.states.length : 0")) > 1 &&
  Number(evalIn(win, "typeof mapCoordinates!=='undefined' && mapCoordinates.lonT ? mapCoordinates.lonT : 0")) > 0;

const waitUntil = async (win, pred, timeout = READY_TIMEOUT_MS) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (pred(win)) return true;
    await wait(300);
  }
  return false;
};

const need = (cond, what) => {
  if (!cond) throw new Error(`FMG data shape changed — ${what} not found. The v1.109 adapter needs updating.`);
};

// Set our options and LOCK them so randomizeOptions() (which keeps locked options
// and randomizes/resets the rest) uses them. Every id/mechanism here was verified
// against FMG v1.109's own source:
//  • template  — the <select> is populated LAZILY by the options UI, so it's EMPTY
//    when we run headless. Setting .value to a template key would fail silently (no
//    matching <option>) leaving value="" → generate() takes the fromPrecreated()
//    branch and loads ./heightmaps/.png, which 404s and hangs forever (onload never
//    fires, there's no onerror). So we ADD the option first (what applyOption does).
//  • points    — the real cell count is pointsInput.dataset.cells, set by
//    changeCellsDensity(level); randomizeOptions() resets it to 10k unless locked.
//  • states    — a <slider-input> custom element whose .value setter updates both
//    inner inputs; clamped to FMG's 1–100 range (120 silently fails).
const setup = (win, params) => {
  const states = Math.min(100, Math.max(1, Math.round(Number(params.states) || 12)));
  const cultures = Math.min(30, Math.max(1, Math.round(Number(params.cultures) || 8)));
  const points = Number(params.points) || 0;
  const density = points >= 20000 ? 5 : points >= 10000 ? 4 : 3; // cellsDensityMap level
  const template = resolveTemplate(params);
  evalIn(
    win,
    `(function(){
      function byId(id){return document.getElementById(id);}
      function set(id,v){var el=byId(id); if(el&&v!=null){el.value=v; try{el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}}}
      function lk(id){try{ if(typeof lock==='function') lock(id); }catch(e){}}
      // A hidden/headless frame reports innerWidth 0 → FMG builds a 0×0 map and crashes.
      set('mapWidthInput',${MAP_W}); set('mapHeightInput',${MAP_H});
      try{ if(typeof changeCellsDensity==='function') changeCellsDensity(${density}); }catch(e){}
      lk('points');
      set('statesNumber',${states}); lk('statesNumber');
      set('culturesInput',${cultures}); set('culturesOutput',${cultures}); lk('cultures');
      (function(){var s=byId('templateInput'); if(!s) return; var v=${JSON.stringify(template)};
        if(typeof applyOption==='function'){ applyOption(s,v,v); }
        else { if(!Array.from(s.options).some(function(o){return o.value===v;})) s.options.add(new Option(v,v)); s.value=v; }
      })();
      lk('template');
    })()`,
  );
};

// Clear the current cells (so mapValid only turns true once OUR generate rebuilds
// the map, not the leftover on-load one), fire generate(), and POLL for completion.
// We don't await generate()'s promise — awaiting a cross-realm iframe promise from
// the parent doesn't resolve reliably. Retries a couple of times.
const runGenerate = async (win, params, onLog) => {
  const seed = params.seed ? String(params.seed).replace(/[^0-9]/g, "") : "";
  const arg = seed ? `{seed:${JSON.stringify(seed)}}` : "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    evalIn(win, "try{ if(pack && pack.cells) pack.cells.i = []; }catch(e){}");
    evalIn(win, `try{ generate(${arg}); }catch(e){}`);
    const start = Date.now();
    while (Date.now() - start < 20000) {
      await wait(400);
      if (mapValid(win)) return;
    }
    onLog?.(`attempt ${attempt}: no map yet (cells=${cellCount(win)}) — retrying…`);
  }
  throw new Error("FMG didn't produce a valid map. If it keeps failing, clear this site's data (localStorage) and retry.");
};

// Read all needed globals in one eval, then copy everything into plain JS.
const extract = (win, onLog) => {
  const G = evalIn(win, "({pack:pack, biomesData:biomesData, mapCoordinates:mapCoordinates, graphWidth:graphWidth, graphHeight:graphHeight})");
  need(G && G.pack && G.pack.cells && G.pack.vertices?.p, "pack.cells / pack.vertices");
  const { cells, vertices } = G.pack;
  need(cells.v && cells.h && cells.biome && cells.state, "cell arrays (v/h/biome/state)");
  const mc = G.mapCoordinates, gw = G.graphWidth, gh = G.graphHeight;
  need(mc && gw && gh && mc.lonT != null && mc.latT != null, "mapCoordinates / graph dimensions");

  const toGeo = (x, y) => [
    +(mc.lonW + (x / gw) * mc.lonT).toFixed(4),
    +(mc.latN - (y / gh) * mc.latT).toFixed(4),
  ];

  const features = [];
  const n = cells.i.length;
  for (let i = 0; i < n; i += 1) {
    const vs = cells.v[i];
    if (!vs || vs.length < 3) continue;
    const ring = vs.map((v) => { const p = vertices.p[v]; return toGeo(p[0], p[1]); });
    ring.push(ring[0]);
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        height: cells.h[i],
        biome: cells.biome[i],
        type: G.pack.features?.[cells.f?.[i]]?.type,
        state: cells.state[i],
        province: cells.province ? cells.province[i] : 0,
        population: cells.pop ? Math.round(cells.pop[i]) : 0,
      },
    });
  }
  need(features.length, "any cells");

  const states = Array.from(G.pack.states || []).map((s) => ({ i: s.i, name: s.name, color: s.color, removed: s.removed }));
  const provinces = Array.from(G.pack.provinces || []).map((p) => ({ i: p.i, name: p.name, color: p.color, state: p.state, removed: p.removed }));
  const burgs = Array.from(G.pack.burgs || [])
    .filter((b) => b && b.i && !b.removed && b.x != null && b.y != null)
    .map((b) => { const [lon, lat] = toGeo(b.x, b.y); return { i: b.i, name: b.name, population: b.population, capital: b.capital, lon, lat }; });

  const bd = G.biomesData;
  const biomes = bd && bd.name ? Array.from(bd.name).map((name, idx) => ({ i: idx, name, color: bd.color?.[idx] || "#8aa66a" })) : [];

  onLog?.(`Extracted ${features.length} cells, ${states.length} states, ${burgs.length} burgs.`);
  return { cells: { type: "FeatureCollection", features }, states, provinces, burgs, biomes };
};

// Public entry: generate a world and return the raw bundle for fmgImport.
export const generateFmgWorld = async (params = {}, onLog = () => {}) => {
  // The FMG frame shares this origin's localStorage; a prior session can persist a
  // heightmap template (or "load last saved") that hangs the on-load generation.
  // Reset the risky keys before the frame loads.
  try {
    window.localStorage.removeItem("template");
    window.localStorage.removeItem("onloadBehavior");
  } catch { /* ignore */ }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${MAP_W}px;height:${MAP_H}px;border:0;visibility:hidden;`;
  iframe.src = new URL(FMG_PATH, window.location.origin).toString();

  onLog("Loading Fantasy Map Generator…");
  const loaded = new Promise((resolve, reject) => {
    iframe.onload = resolve;
    iframe.onerror = () => reject(new Error("Could not load /fmg/ — is FMG vendored and the server restarted?"));
  });
  document.body.appendChild(iframe);

  try {
    await loaded;
    const win = iframe.contentWindow;
    if (!win) throw new Error("No access to the FMG frame (must be served same-origin).");
    onLog("Starting the generator…");
    if (!(await waitUntil(win, fmgReady))) {
      if (evalIn(win, "typeof d3!=='undefined'") !== true) {
        throw new Error("The /fmg/ page isn't the Fantasy Map Generator — it isn't vendored yet. Run the updater (or `node scripts/fetch-fmg.mjs`), then restart the server.");
      }
      throw new Error("FMG scripts didn't finish loading in time.");
    }
    // Let FMG's own on-load generation settle (or fail fast) before we drive ours.
    await waitUntil(win, (w) => cellCount(w) > 0, 12000);
    await wait(800);
    onLog("Generating the world…");
    setup(win, params);
    await runGenerate(win, params, onLog);
    return extract(win, onLog);
  } finally {
    iframe.remove();
  }
};
