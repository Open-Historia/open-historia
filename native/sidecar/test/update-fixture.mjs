import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const native = path.resolve(here, "..", "..");
const kit = await import(pathToFileURL(path.join(native, "sidecar", "updateChunks.mjs")).href);

export const BUILD_A = "20261028100000";
export const BUILD_B = "20261028110000";
export const framework = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319");

const csc = (out, sources, target = "winexe") => {
  const result = spawnSync(path.join(framework, "csc.exe"), [
    "/nologo",
    `/target:${target}`,
    "/optimize+",
    `/out:${out}`,
    "/reference:System.IO.Compression.dll",
    "/reference:System.IO.Compression.FileSystem.dll",
    "/reference:System.Windows.Forms.dll",
    "/reference:System.Drawing.dll",
    ...sources,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`csc failed: ${result.stdout}${result.stderr}`);
};

export const buildTools = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const updater = path.join(dir, "updater.exe");
  csc(updater, [path.join(native, "installer", "Setup.cs")]);
  const games = {};
  for (const [name, code] of [["ok", 0], ["fail", 3]]) {
    const source = path.join(dir, `${name}.cs`);
    fs.writeFileSync(source, `class Game { static int Main() { System.Threading.Thread.Sleep(1500); return ${code}; } }\n`);
    games[name] = path.join(dir, `${name}.exe`);
    csc(games[name], [source], "exe");
  }
  return { updater, games };
};

const write = (root, relative, data) => {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

const copyTree = (from, to) => fs.cpSync(from, to, { recursive: true });

export const listTree = (root) => kit.listFiles(root).filter((name) => name !== kit.INSTALLED_MANIFEST);

export const treeHashes = (root) => Object.fromEntries(listTree(root).map((name) => [name, kit.sha256(fs.readFileSync(path.join(root, ...name.split("/"))))]));

export const makeFixture = (root, { tools, breakGame = false, bigChange = false, setupBytes = 12 * 1024 * 1024 } = {}) => {
  fs.rmSync(root, { recursive: true, force: true });
  const a = path.join(root, "A");
  const random = (bytes, seed) => {
    const out = Buffer.alloc(bytes);
    let block = crypto.createHash("sha256").update(seed).digest();
    for (let at = 0; at < bytes; at += 32) {
      block.copy(out, at);
      block = crypto.createHash("sha256").update(block).digest();
    }
    return out;
  };
  write(a, "runtime/Open Historia.exe", fs.readFileSync(tools.games.ok));
  write(a, "runtime/node.exe", random(6 * 1024 * 1024, "node"));
  write(a, kit.UPDATER_EXE, fs.readFileSync(tools.updater));
  write(a, "native/godot/bin/oh_gdext.dll", random(3 * 1024 * 1024, "dll"));
  for (let index = 0; index < 60; index += 1) write(a, `native/godot/scripts/s${String(index).padStart(2, "0")}.gd`, `extends Node\n# ${index}\n${"var x := 1\n".repeat(300 + index)}`);
  write(a, "native/godot/version.json", JSON.stringify({ version: "0.1.0", build: BUILD_A, commit: "aaaa" }));
  write(a, "public/audio/theme.mp3", random(2 * 1024 * 1024, "mp3"));
  write(a, "old.txt", "this file is gone in B\n");
  write(a, ".oh-native-install", "A\n");
  kit.writeRelease({ stage: a, out: path.join(root, "a-chunks"), details: { build: BUILD_A, version: "0.1.0" } });

  const b = path.join(root, "B");
  copyTree(a, b);
  fs.rmSync(path.join(b, kit.INSTALLED_MANIFEST), { force: true });
  fs.rmSync(path.join(b, "old.txt"));
  write(b, "native/godot/scripts/s07.gd", `extends Node\n# changed in B\n${"var y := 2\n".repeat(320)}`);
  write(b, "native/godot/scripts/added.gd", "extends Node\n# new in B\n");
  write(b, "native/godot/version.json", JSON.stringify({ version: "0.1.1", build: BUILD_B, commit: "bbbb", notes: "B brings a changed script." }));
  write(b, ".oh-native-install", "B\n");
  if (breakGame) write(b, "runtime/Open Historia.exe", fs.readFileSync(tools.games.fail));
  if (bigChange) write(b, "native/godot/bin/oh_gdext.dll", random(3 * 1024 * 1024, "dll-b"));

  const release = path.join(root, "release");
  const chunks = kit.writeRelease({ stage: b, out: path.join(release, "chunks"), details: { build: BUILD_B, version: "0.1.1" } });
  const setup = random(setupBytes, "setup");
  write(release, "Open-Historia-Native-Setup.exe", setup);
  write(release, "native-latest.json", JSON.stringify({
    version: "0.1.1",
    build: BUILD_B,
    commit: "bbbb",
    sha256: kit.sha256(setup),
    size: setup.length,
    url: "https://example.invalid/Open-Historia-Native-Setup.exe",
    notes: "B brings a changed script.",
    published: new Date().toISOString(),
    chunks: kit.feedChunks(chunks, "https://example.invalid/"),
  }));
  return { root, a, b, release, chunks, setupSize: setup.length };
};
