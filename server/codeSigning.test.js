// Run: node --test server/codeSigning.test.js
//
// Windows code signing through SignPath (docs/code-signing.md): the feed
// rewrite for an installer signed after electron-builder hashed it
// (scripts/refresh-update-feed.mjs), and the wiring in both release workflows,
// which has to leave an unconfigured repository's builds exactly as they were.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { refreshFeed, refreshFeedFile, sha512Base64 } from "../scripts/refresh-update-feed.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

// As electron-builder 26 writes it for an NSIS target.
const FEED = [
  "version: 0.0.312",
  "files:",
  "  - url: Open-Historia-Setup.exe",
  "    sha512: OLDHASH==",
  "    size: 100",
  "    blockMapSize: 150",
  "path: Open-Historia-Setup.exe",
  "sha512: OLDHASH==",
  "releaseDate: '2026-11-09T10:00:00.000Z'",
  "",
].join("\n");

test("the feed takes the signed installer's hash and size, and nothing else changes", () => {
  const after = refreshFeed(FEED, { name: "Open-Historia-Setup.exe", sha512: "NEW+/=", size: 4242 });
  assert.equal(after, [
    "version: 0.0.312",
    "files:",
    "  - url: Open-Historia-Setup.exe",
    "    sha512: NEW+/=",
    "    size: 4242",
    "path: Open-Historia-Setup.exe",
    "sha512: NEW+/=",
    "releaseDate: '2026-11-09T10:00:00.000Z'",
    "",
  ].join("\n"));
});

test("only the named file's entry is rewritten, and CRLF stays CRLF", () => {
  const feed = [
    "version: 1.0.0",
    "files:",
    "  - url: Other.exe",
    "    sha512: KEEP==",
    "    size: 7",
    "  - url: 'Open-Historia-Beta-Setup.exe'",
    "    sha512: OLD==",
    "    size: 9",
    "path: Other.exe",
    "sha512: KEEP==",
    "releaseDate: '2026-11-09T10:00:00.000Z'",
  ].join("\r\n");
  const after = refreshFeed(feed, { name: "Open-Historia-Beta-Setup.exe", sha512: "NEW==", size: 10 });
  assert.ok(!/[^\r]\n/.test(after), "line endings kept");
  const lines = after.split("\r\n");
  assert.deepEqual(lines.slice(2, 5), ["  - url: Other.exe", "    sha512: KEEP==", "    size: 7"]);
  assert.deepEqual(lines.slice(5, 8), ["  - url: 'Open-Historia-Beta-Setup.exe'", "    sha512: NEW==", "    size: 10"]);
  assert.equal(lines[9], "sha512: KEEP==", "the top-level hash belongs to `path`, which is another file");
});

test("a feed that does not name the installer is an error, not a silent no-op", () => {
  assert.throws(() => refreshFeed(FEED, { name: "Open-Historia-Beta-Setup.exe", sha512: "X", size: 1 }), /no files: entry for Open-Historia-Beta-Setup\.exe/);
});

test("the file on disk is hashed as electron-updater hashes it, and its stale blockmap goes", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-feed-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const installer = path.join(dir, "Open-Historia-Setup.exe");
  const data = Buffer.from("MZ signed installer bytes");
  fs.writeFileSync(installer, data);
  fs.writeFileSync(`${installer}.blockmap`, "stale");
  const feed = path.join(dir, "latest.yml");
  fs.writeFileSync(feed, FEED);

  const result = refreshFeedFile({ feed, file: installer });
  assert.equal(result.size, data.length);
  const text = fs.readFileSync(feed, "utf8");
  const expected = sha512Base64(data);
  assert.equal(expected.length, 88, "base64 of 64 bytes, as electron-builder writes it");
  assert.match(text, new RegExp(`^ {4}sha512: ${expected.replace(/[+/]/g, "\\$&")}$`, "m"));
  assert.match(text, new RegExp(`^ {4}size: ${data.length}$`, "m"));
  assert.doesNotMatch(text, /blockMapSize/);
  assert.ok(!fs.existsSync(`${installer}.blockmap`));
});

for (const [workflow, installer, config] of [
  [".github/workflows/desktop-installer.yml", "Open-Historia-Setup.exe", ""],
  [".github/workflows/desktop-beta.yml", "Open-Historia-Beta-Setup.exe", " --config electron-builder.beta.yml"],
]) {
  test(`${workflow}: signing is Windows-only, off without the owner's settings, and done before anything is hashed`, () => {
    const text = read(workflow);
    // The switch: the secret and all three variables, on the Windows job only.
    assert.match(text, /SIGNPATH_ENABLED: \$\{\{ matrix\.os == 'windows-latest' && secrets\.SIGNPATH_API_TOKEN != '' && vars\.SIGNPATH_ORGANIZATION_ID != '' && vars\.SIGNPATH_PROJECT_SLUG != '' && vars\.SIGNPATH_SIGNING_POLICY_SLUG != '' \}\}/);
    assert.match(text, /^ {2}actions: read$/m);

    const steps = text.replace(/^ *#.*\n/gm, "").split(/\n(?= {6}- (?:name|uses):)/);
    const signing = steps.filter((step) => /SIGNPATH|signpath|signed-|refresh-update-feed|--prepackaged/.test(step) && !/^ {4}env:/m.test(step));
    assert.ok(signing.length >= 8, "the signing steps are there");
    for (const step of signing) {
      const condition = step.match(/^ {8}if: (.+)$/m)?.[1] ?? "";
      assert.ok(
        condition === "env.SIGNPATH_ENABLED == 'true'" || condition.startsWith("steps.signed.outputs.signed == 'true'"),
        `every signing step is skipped without the settings:\n${step}`,
      );
    }
    // The original build step is untouched, so an unconfigured run builds what it always built.
    assert.match(text, new RegExp(`- name: Build the installer\\n {8}run: node scripts/package-desktop\\.mjs \\$\\{\\{ matrix\\.args \\}\\}${config.replace(/\./g, "\\.")} --publish never\\n`));

    const at = (needle) => {
      const index = text.indexOf(needle);
      assert.notEqual(index, -1, needle);
      return index;
    };
    const order = [
      "- name: Build the installer",
      "- name: Sign the app's programs",
      "- name: Put the signed programs back in the app",
      `run: node scripts/package-desktop.mjs --win --prepackaged release/win-unpacked${config} --publish never`,
      "- name: Sign the installer",
      `node scripts/refresh-update-feed.mjs --feed release/latest.yml --file release/${installer}`,
      "- name: Check the Windows signatures",
      "- name: Cut the app's files into update chunks",
      "- name: Upload as a build artifact",
      "- name: Attach to the",
      "- name: Say on the release that the Windows build is signed",
    ].map(at);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), "signed before the chunks are cut, the feed rewritten before it is published");
    assert.match(text, new RegExp(`path: release/${installer.replace(/\./g, "\\.")}\\n`));
    assert.match(text, new RegExp(`cp -v signed-installer/${installer.replace(/\./g, "\\.")} release/${installer.replace(/\./g, "\\.")}\\n`));
    assert.equal(text.match(/uses: signpath\/github-action-submit-signing-request@v3\n/g)?.length, 2);
  });
}

test("the artifact configuration signs the app, its speech program and the installer, and no upstream DLL", () => {
  const xml = read(".signpath/artifact-configuration.xml");
  assert.match(xml, /<artifact-configuration xmlns="http:\/\/signpath\.io\/artifact-configuration\/v1">/);
  assert.match(xml, /<zip-file>/, "a GitHub artifact reaches SignPath as a zip");
  assert.match(xml, /<include path="\*\.exe" min-matches="1" max-matches="1" \/>/);
  assert.match(xml, /<include path="resources\/app\.asar\.unpacked\/\*\*\/\*\.exe"/);
  assert.doesNotMatch(xml, /\.dll/);
  assert.match(xml, /<authenticode-sign \/>/);
});

test("the README carries the code signing policy SignPath Foundation asks for", () => {
  const readme = read("README.md");
  assert.match(readme, /^#+ Code signing policy$/m);
  assert.ok(readme.includes("Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org)"));
  assert.match(read("docs/code-signing.md"), /SIGNPATH_API_TOKEN/);
});
