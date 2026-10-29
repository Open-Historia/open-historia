import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export const startFeedServer = ({ dir, port = 0, log = () => {}, pause = 0 } = {}) => new Promise((resolve) => {
  const knobs = { dir, pause, corrupt: "", corruptTimes: 0, cut: "", cutAfter: 0, cutTimes: 0, missing: "" };
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const range = req.headers.range || "";
    requests.push({ path: url.pathname, range });
    log(`${req.method} ${url.pathname}${url.search}${range ? ` ${range}` : ""}`);
    const base = `http://127.0.0.1:${server.address().port}`;
    if (url.pathname === "/set") {
      for (const key of Object.keys(knobs)) {
        if (!url.searchParams.has(key)) continue;
        const value = url.searchParams.get(key);
        knobs[key] = typeof knobs[key] === "number" ? Number(value) || 0 : value;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(knobs));
      return;
    }
    const downloads = { "native-latest.json": "Open-Historia-Native-Setup.exe", "native-latest-mac.json": "Open-Historia-Native-macOS.zip", "native-latest-linux.json": "Open-Historia-Native-Linux-x86_64.tar.gz" };
    const feedName = Object.hasOwn(downloads, url.pathname.slice(1)) ? url.pathname.slice(1) : "";
    if (feedName && fs.existsSync(path.join(knobs.dir, feedName))) {
      const feed = JSON.parse(fs.readFileSync(path.join(knobs.dir, feedName), "utf8"));
      feed.url = `${base}/setup/${downloads[feedName]}`;
      if (feed.chunks) feed.chunks.base = `${base}/chunks/`;
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(feed));
      return;
    }
    let file = "";
    let name = "";
    if (Object.values(downloads).some((name) => url.pathname === `/setup/${name}`)) {
      file = path.join(knobs.dir, path.basename(url.pathname));
      name = "setup";
    } else {
      const match = url.pathname.match(/^\/chunks\/([A-Za-z0-9._-]+)$/);
      if (match) {
        name = match[1];
        file = path.join(knobs.dir, "chunks", name);
      }
    }
    if (!file || !fs.existsSync(file) || knobs.missing === name) {
      res.writeHead(404);
      res.end();
      return;
    }
    let bytes = fs.readFileSync(file);
    if (knobs.corrupt && (knobs.corrupt === name || (knobs.corrupt === "all" && name.startsWith("c-"))) && knobs.corruptTimes !== 0) {
      knobs.corruptTimes -= 1;
      bytes = Buffer.from(bytes);
      bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    }
    let start = 0;
    const asked = range.match(/^bytes=(\d+)-$/);
    if (asked && Number(asked[1]) < bytes.length) start = Number(asked[1]);
    const body = bytes.subarray(start);
    const headers = { "Content-Type": "application/octet-stream", "Content-Length": body.length, "Accept-Ranges": "bytes" };
    if (start > 0) {
      headers["Content-Range"] = `bytes ${start}-${bytes.length - 1}/${bytes.length}`;
      res.writeHead(206, headers);
    } else {
      res.writeHead(200, headers);
    }
    const cutting = knobs.cut && (knobs.cut === name || (knobs.cut === "any" && name.startsWith("c-"))) && knobs.cutTimes !== 0 && knobs.cutAfter > 0 && knobs.cutAfter < body.length;
    if (cutting) knobs.cutTimes -= 1;
    const piece = 64 * 1024;
    for (let at = 0; at < body.length; at += piece) {
      if (res.destroyed) return;
      const end = Math.min(body.length, at + piece);
      if (cutting && end >= knobs.cutAfter) {
        res.write(body.subarray(at, knobs.cutAfter));
        await new Promise((done) => setTimeout(done, 30));
        res.destroy();
        return;
      }
      res.write(body.subarray(at, end));
      if (knobs.pause) await new Promise((done) => setTimeout(done, knobs.pause));
    }
    res.end();
  });
  server.listen(port, "127.0.0.1", () => {
    const address = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, address, feedUrl: `${address}/native-latest.json`, knobs, requests, close: () => new Promise((done) => server.close(done)) });
  });
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (isMain) {
  const [dir, port = "0", portFile = "", logFile = ""] = process.argv.slice(2);
  const note = (line) => {
    if (logFile) fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  };
  const feed = await startFeedServer({ dir: path.resolve(dir), port: Number(port), log: note, pause: Number(process.env.OH_FEED_PAUSE || 0) });
  if (portFile) fs.writeFileSync(portFile, String(feed.server.address().port));
  note(`serving ${dir} at ${feed.feedUrl}`);
}
