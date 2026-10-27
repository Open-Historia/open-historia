const bridgeMain = () => {
  const FMG_PATH = "/fmg/index.html";
  const READY_TIMEOUT_MS = 90000;
  const MAX_CULTURES = 30;
  const MAP_W = 1920;
  const MAP_H = 1080;
  const SYNC_TEMPLATES = ["continents", "archipelago", "pangea", "mediterranean", "peninsula", "isthmus", "atoll", "highIsland", "lowIsland", "volcano", "shattered", "fractious"];
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

  const setup = (win, params) => {
    const states = Math.min(100, Math.max(1, Math.round(Number(params.states) || 12)));
    const cultures = Math.min(MAX_CULTURES, Math.max(1, Math.round(Number(params.cultures) || 8)));
    const cities = Math.max(0, Math.round(Number(params.cities) || 0));
    const towns = cities > 0 ? Math.min(999, Math.max(0, cities - states)) : -1;
    const points = Number(params.points) || 0;
    const density = points >= 20000 ? 5 : points >= 10000 ? 4 : 3;
    const template = resolveTemplate(params);
    evalIn(
      win,
      `(function(){
        function byId(id){return document.getElementById(id);}
        function set(id,v){var el=byId(id); if(el&&v!=null){el.value=v; try{el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}}}
        function lk(id){try{ if(typeof lock==='function') lock(id); }catch(e){}}
        set('mapWidthInput',${MAP_W}); set('mapHeightInput',${MAP_H});
        try{ if(typeof changeCellsDensity==='function') changeCellsDensity(${density}); }catch(e){}
        lk('points');
        set('statesNumber',${states}); lk('statesNumber');
        set('culturesInput',${cultures}); set('culturesOutput',${cultures}); lk('cultures');
        ${towns >= 0 ? `set('manorsInput',${towns}); lk('manors');` : ``}
        (function(){var s=byId('templateInput'); if(!s) return; var v=${JSON.stringify(template)};
          if(typeof applyOption==='function'){ applyOption(s,v,v); }
          else { if(!Array.from(s.options).some(function(o){return o.value===v;})) s.options.add(new Option(v,v)); s.value=v; }
        })();
        lk('template');
      })()`,
    );
  };

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

  const generateFmgWorld = async (params = {}, onLog = () => {}) => {
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
          throw new Error("The /fmg/ page isn't the Fantasy Map Generator — this build has no copy of it. In a source checkout, run `node scripts/fetch-fmg.mjs`, then restart the server.");
        }
        throw new Error("FMG scripts didn't finish loading in time.");
      }
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

  const hash = new URLSearchParams(window.location.hash.slice(1));
  const port = Number(hash.get("port"));
  const token = String(hash.get("token") || "");
  let params = {};
  try {
    params = JSON.parse(hash.get("params") || "{}");
  } catch {
    params = {};
  }
  history.replaceState(null, "", window.location.pathname);
  const lines = document.getElementById("log");
  const status = document.getElementById("status");
  const send = (kind, body) => fetch(`http://127.0.0.1:${port}/${kind}?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
  const log = (line) => {
    const row = document.createElement("div");
    row.textContent = line;
    lines.appendChild(row);
    send("log", { line }).catch(() => {});
  };
  (async () => {
    try {
      const raw = await generateFmgWorld(params, log);
      status.textContent = "Sending the world to Open Historia…";
      const answer = await send("world", raw);
      if (!answer.ok) throw new Error(`Open Historia did not take the world (HTTP ${answer.status}).`);
      status.textContent = "Done. The world is in the Workshop; you can close this tab.";
    } catch (error) {
      const message = error?.message || String(error);
      status.textContent = message;
      await send("fail", { message }).catch(() => {});
    }
  })();
};

export const FMG_BRIDGE_FILE = "oh-native-bridge.html";

export const FMG_BRIDGE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Historia: generating a world</title>
<style>
body { margin: 0; padding: 32px; background: #131315; color: #fff; font-family: system-ui, sans-serif; }
h1 { font-size: 18px; margin: 0 0 8px; }
#status { color: rgba(255,255,255,0.7); font-size: 14px; margin-bottom: 16px; }
#log { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.55; color: rgba(180,230,190,0.92); background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 8px 10px; max-width: 720px; }
</style>
</head>
<body>
<h1>Generating a world for the Open Historia Workshop</h1>
<div id="status">Keep this tab open until the world reaches the Workshop.</div>
<div id="log"></div>
<script>(${bridgeMain.toString()})();</script>
</body>
</html>
`;

export const register = () => ({});
