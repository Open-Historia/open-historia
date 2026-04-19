import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const resolveUrl = (baseUrl, pathname) => new URL(pathname, baseUrl).toString();

const parseResponseBody = async (response) => {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
};

export const createScenarioId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const choosePort = (offset = 0) => 4300 + Math.floor(Math.random() * 300) + offset;

export const request = async (baseUrl, pathname, options = {}) => {
  const response = await fetch(resolveUrl(baseUrl, pathname), options);
  return response;
};

export const requestJson = async (baseUrl, pathname, options = {}) => {
  const response = await request(baseUrl, pathname, options);
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} for ${pathname}: ${
        typeof body === "string" ? body : body?.error || JSON.stringify(body)
      }`,
    );
  }

  return body;
};

export const readKeyFile = async (filename = ".key") => {
  const keyPath = path.join(projectRoot, filename);
  const rawValue = await readFile(keyPath, "utf-8");
  const key = rawValue.trim();

  assert.ok(key, `${filename} is empty.`);
  return key;
};

const waitForServer = async (baseUrl, timeoutMs = 20_000) => {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(resolveUrl(baseUrl, "/api/scenarios"));
      if (response.ok) {
        return;
      }
      lastError = new Error(`Server returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw lastError ?? new Error("Timed out waiting for local server.");
};

const killProcessTree = (child) =>
  new Promise((resolve) => {
    if (!child || child.killed) {
      resolve();
      return;
    }

    const finish = () => resolve();
    child.once("exit", finish);
    child.kill("SIGTERM");

    setTimeout(() => {
      if (child.exitCode !== null) {
        return;
      }

      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });

      killer.once("exit", finish);
      killer.once("error", finish);
    }, 1500);
  });

export const startLocalServer = async ({
  port = choosePort(),
  serverEntry = path.join(projectRoot, "server", "server.js"),
} = {}) => {
  const logs = [];
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => {
    logs.push(chunk.toString());
  });

  child.stderr.on("data", (chunk) => {
    logs.push(chunk.toString());
  });

  child.once("error", (error) => {
    logs.push(String(error));
  });

  try {
    await waitForServer(baseUrl);
  } catch (error) {
    await killProcessTree(child);
    throw new Error(`Could not start local server.\n${logs.join("")}\n${error.message}`);
  }

  return {
    baseUrl,
    logs,
    port,
    stop: async () => {
      await killProcessTree(child);
    },
  };
};
