// Integration tests for the AI relay — the path a self-hosted model's answers
// take when the browser cannot call the endpoint directly (no CORS).
//
// These boot the REAL server against a fake AI endpoint, because the bug they
// exist to prevent is not visible in any single function: the relay used to
// speak through Node's fetch(), whose undici default gave up 300 seconds after
// a request was sent if the endpoint had not answered yet. A big save's prompt
// evaluated by a local model takes longer than that, so the relay killed turns
// the player had not limited — the game then served canned events, exactly as
// though "Limit AI generation" were on, which is how it was reported.
//
// The 300-second number itself is too slow to assert in a test suite. What is
// asserted here is the shape that made it possible: that the relay hands bytes
// back as they arrive rather than waiting for the whole answer, that a slow
// first byte is not fatal, and that the only deadline left is the one this
// project chose (OH_RELAY_TIMEOUT_MS) — which now ANSWERS instead of leaving
// the game waiting on a socket forever.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, before, describe, test } from "node:test";

const SERVER = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "server.js");

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const waitForServer = async (port, child) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/server/network`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not start in time");
};

// Ask the relay to call `upstreamUrl`, the way the game's providerFetch does.
// The Origin matches the server's own, since a relay call is same-origin for
// the browser (and the CSRF guard requires it).
const relay = (port, upstreamUrl, { signal } = {}) =>
  fetch(`http://127.0.0.1:${port}/api/ai/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify({ url: upstreamUrl, method: "POST", payload: { hello: "world" } }),
    signal,
  });

describe("AI relay", () => {
  let dataDir;
  const servers = [];
  const upstreams = [];

  // A stand-in AI endpoint. `handler` gets the raw (req, res) so a case can be
  // as slow, as chunked or as silent as it likes.
  const startUpstream = async (handler) => {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    upstreams.push(server);
    return `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
  };

  const startServer = async (env = {}) => {
    const port = await freePort();
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, OH_DATA_DIR: dataDir, PORT: String(port), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.resume();
    child.stderr.resume();
    servers.push(child);
    await waitForServer(port, child);
    return port;
  };

  before(() => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "oh-relay-test-"));
  });

  after(async () => {
    for (const child of servers) {
      if (child.exitCode === null) {
        child.kill();
        await new Promise((resolve) => child.once("exit", resolve));
      }
    }
    for (const server of upstreams) {
      await new Promise((resolve) => server.close(resolve));
    }
    rmSync(dataDir, { force: true, recursive: true });
  });

  test("a streamed answer reaches the game as it is generated, not at the end", async () => {
    // Three SSE frames spread over time, the way a model emits tokens. If the
    // relay buffers, the first frame cannot arrive before the last one is sent.
    const upstream = await startUpstream((req, res) => {
      req.resume();
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: {\"n\":1}\n\n");
      setTimeout(() => res.write("data: {\"n\":2}\n\n"), 150);
      setTimeout(() => {
        res.write("data: [DONE]\n\n");
        res.end();
      }, 700);
    });

    const port = await startServer();
    const startedAt = Date.now();
    const response = await relay(port, upstream);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);

    const reader = response.body.getReader();
    const firstChunk = await reader.read();
    const firstChunkAt = Date.now() - startedAt;
    assert.match(new TextDecoder().decode(firstChunk.value), /"n":1/);
    // The upstream is still generating for another ~700ms. Buffering would put
    // this number past that; passing it through puts it far below.
    assert.ok(firstChunkAt < 500, `first chunk took ${firstChunkAt}ms — the relay is buffering`);

    await reader.cancel();
  });

  test("an endpoint that is slow to answer at all is still relayed", async () => {
    // The shape that undici's 300s headersTimeout killed: nothing at all comes
    // back for a while (a local model evaluating a long prompt), and then the
    // whole answer arrives at once. Seconds here, minutes in the field.
    const upstream = await startUpstream((req, res) => {
      req.resume();
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "slow but finished" } }] }));
      }, 1500);
    });

    const port = await startServer();
    const response = await relay(port, upstream);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).choices[0].message.content, "slow but finished");
  });

  test("the relay's own deadline answers with an error instead of hanging", async () => {
    // An endpoint that accepts the request and then says nothing, ever. Before,
    // the relay aborted upstream and sent no response at all, so the game waited
    // on an open socket until something else gave up.
    const upstream = await startUpstream((req) => {
      req.resume();
      /* deliberately never responds */
    });

    const port = await startServer({ OH_RELAY_TIMEOUT_MS: "1200" });
    const startedAt = Date.now();
    const response = await relay(port, upstream);
    assert.equal(response.status, 504);
    const { error } = await response.json();
    assert.match(error, /did not finish within 1s/);
    assert.match(error, /OH_RELAY_TIMEOUT_MS/);
    assert.ok(Date.now() - startedAt < 10000, "the deadline must fire promptly");
  });

  test("a transport failure says what actually failed, not just \"fetch failed\"", async () => {
    // Nothing is listening here: the player mistyped a port, or their model
    // server is not running. The reason has to survive into the bug report.
    const deadPort = await freePort();
    const port = await startServer();
    const response = await relay(port, `http://127.0.0.1:${deadPort}/v1/chat/completions`);
    assert.equal(response.status, 502);
    const { error } = await response.json();
    assert.match(error, /ECONNREFUSED/);
  });
});
