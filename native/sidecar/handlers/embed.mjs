import crypto from "node:crypto";
import http from "node:http";

const VIDEO_ID = /^[A-Za-z0-9_-]{6,32}$/;
const EMBED_HOST = "https://www.youtube-nocookie.com";

export const videoPage = (id) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${EMBED_HOST}; style-src 'unsafe-inline'">
<title>Video</title>
<style>html, body { margin: 0; height: 100%; background: #000; overflow: hidden; } iframe { border: 0; display: block; width: 100%; height: 100%; }</style>
</head>
<body>
<iframe title="How to get a Gemini API key (tutorial)" src="${EMBED_HOST}/embed/${id}?rel=0&amp;autoplay=1" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
</body>
</html>
`;

export const register = () => {
  const token = crypto.randomBytes(18).toString("hex");
  let listening = null;

  const listen = () => {
    if (listening) return listening;
    listening = new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const match = /^\/video\/([^/]+)$/.exec(url.pathname);
        if (req.method !== "GET" || !match || !VIDEO_ID.test(match[1]) || url.searchParams.get("t") !== token) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Content-Type-Options": "nosniff" });
        res.end(videoPage(match[1]));
      });
      server.on("error", (error) => {
        listening = null;
        reject(error);
      });
      server.listen(0, "127.0.0.1", () => {
        server.unref();
        resolve(`http://127.0.0.1:${server.address().port}`);
      });
    });
    return listening;
  };

  return {
    "embed.video": async ({ id = "" } = {}) => {
      const video = String(id || "");
      if (!VIDEO_ID.test(video)) return { error: "That is not a video id." };
      try {
        const origin = await listen();
        return { url: `${origin}/video/${video}?t=${token}`, origin };
      } catch (error) {
        return { error: error?.message || String(error) };
      }
    },
  };
};
