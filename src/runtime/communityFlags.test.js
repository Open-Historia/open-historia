/*! Open Historia — community flags client tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/communityFlags.test.js
//
// The flag picker's Community tab lists dedicated flag posts and, from scenario
// posts tagged Flags-Count, one installable pack per scenario. Opening a pack
// downloads the scenario's bundle and offers its custom flags. Against a
// stubbed hub: which posts become what, and which flags a pack yields.
import test from "node:test";
import assert from "node:assert/strict";

import { zipBundle } from "./bundleZip.js";
import { splitBundleFiles } from "./bundleFiles.js";
import {
  fetchCommunityFlags,
  flagDataUrlToBlob,
  flagFileName,
  flagPostInstallable,
  flagPublishQuery,
  loadCommunityFlagPack,
} from "./communityFlags.js";

const technicalOf = (query) => decodeURIComponent(query.split("&").find((part) => part.startsWith("technical=")).slice("technical=".length));

test("the form carries the polity's exact name as Flag-Polity", () => {
  const query = flagPublishQuery({ name: "Holy Roman Empire flag", author: "arkniem", polity: "Holy Roman Empire" });
  assert.equal(technicalOf(query), "Flag-Polity: Holy Roman Empire");
  assert.ok(query.includes(`title=${encodeURIComponent("[Flag] Holy Roman Empire flag")}`));
  assert.ok(query.startsWith("template=flag.yml&"));
});

test("a code-like name also goes in as the Flag-Code hint; a longer name is not cut to its first word", () => {
  assert.equal(technicalOf(flagPublishQuery({ polity: "DEU" })), "Flag-Code: DEU\nFlag-Polity: DEU");
  assert.equal(technicalOf(flagPublishQuery({ polity: "Kuizltan" })), "Flag-Code: KUIZLTAN\nFlag-Polity: Kuizltan");
  assert.ok(!technicalOf(flagPublishQuery({ polity: "Holy Roman Empire" })).includes("Flag-Code"));
  assert.equal(technicalOf(flagPublishQuery({})), "");
  assert.equal(technicalOf(flagPublishQuery({ polity: "Two\nLines" })), "Flag-Polity: Two Lines");
});

test("an old My flags code hint goes in as Flag-Code only, never as the polity's name", () => {
  assert.equal(technicalOf(flagPublishQuery({ code: "DEU" })), "Flag-Code: DEU");
  assert.equal(technicalOf(flagPublishQuery({ code: "HOLY ROMAN E" })), "");
  assert.equal(technicalOf(flagPublishQuery({ polity: "Holy Roman Empire", code: "HOLY ROMAN E" })), "Flag-Polity: Holy Roman Empire");
});

test("a shared flag is saved under its name with its image type's extension", () => {
  assert.equal(flagFileName("Holy Roman Empire flag", "data:image/png;base64,AAAA"), "holy-roman-empire-flag.png");
  assert.equal(flagFileName("Kuizltan", "data:image/jpeg;base64,AAAA"), "kuizltan.jpg");
  assert.equal(flagFileName("", "data:image/svg+xml;base64,AAAA"), "flag.svg");
  assert.equal(flagFileName("***", "data:application/octet-stream;base64,AAAA"), "flag.png");
});

test("the flag's data URL becomes the file's bytes", async () => {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const dataUrl = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  const blob = flagDataUrlToBlob(dataUrl);
  assert.equal(blob.type, "image/png");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], bytes);
  assert.throws(() => flagDataUrlToBlob("https://flagcdn.com/de.svg"), /no image to share/);
  assert.throws(() => flagDataUrlToBlob(null), /no image to share/);
});

test("a hub post keeps Flag-Polity exactly, beside the upper-cased Flag-Code hint", async (t) => {
  const issue = (number, body) => ({
    number,
    title: `[Flag] Post ${number}`,
    body,
    user: { login: "someone" },
    html_url: `https://github.com/x/y/issues/${number}`,
  });
  const flags = [
    issue(1, "![flag](https://github.com/user-attachments/assets/a.png)\n\n### Technical\n\nFlag-Code: KUIZLTAN\nFlag-Polity: Holy Roman Empire\n"),
    issue(2, "![flag](https://github.com/user-attachments/assets/b.png)\n\nFlag-Code: deu\n"),
  ];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes("labels=flag") ? flags : []),
  });
  t.after(() => { globalThis.fetch = original; });

  const posts = await fetchCommunityFlags({ force: true });
  const byId = Object.fromEntries(posts.map((post) => [post.id, post]));
  assert.equal(byId[1].polity, "Holy Roman Empire");
  assert.equal(byId[1].code, "KUIZLTAN");
  assert.equal(byId[2].polity, null);
  assert.equal(byId[2].code, "DEU");
});

const ISSUES_FLAGS = /issues\?state=open&labels=flag/;
const ISSUES_SCENARIOS = /issues\?state=open&labels=scenario/;

const files = new Map();
let flagIssues = [];
let scenarioIssues = [];

globalThis.fetch = async (input) => {
  const url = String(input);
  if (ISSUES_FLAGS.test(url)) return Response.json(flagIssues);
  if (ISSUES_SCENARIOS.test(url)) return Response.json(scenarioIssues);
  if (url.startsWith("/api/hub/file?url=")) {
    const file = files.get(decodeURIComponent(url.slice("/api/hub/file?url=".length)));
    if (!file) return Response.json({ error: "Not found on the hub." }, { status: 404 });
    return new Response(file, { headers: { "content-type": "application/octet-stream" } });
  }
  throw new Error(`unexpected fetch ${url}`);
};

const issue = (number, title, body, extra = {}) => ({
  number,
  title,
  body,
  user: { login: `author${number}`, avatar_url: "" },
  html_url: `https://github.com/Open-Historia/Open-historia-scenarios/issues/${number}`,
  created_at: "2026-09-01T00:00:00Z",
  author_association: number === 1 ? "OWNER" : "NONE",
  reactions: { "+1": 2 },
  ...extra,
});

const FLAG_PNG = "https://github.com/user-attachments/assets/1111-flag.png";
const FLAG_SVG = "https://github.com/user-attachments/files/201/banner.svg";
const PACK_ZIP = "https://github.com/user-attachments/files/202/empire-scenario.zip";
const PACK_JSON = "https://github.com/user-attachments/files/203/old-empire.json";
const RED = "data:image/png;base64,UkVE";
const BLUE = "data:image/png;base64,QkxVRQ==";

const flagsAsset = (data) => ({ assets: { flags: { data, fileName: "flags.json", mode: "embedded" } } });

test("flag posts and flag-carrying scenario posts are listed as what they are", async () => {
  flagIssues = [
    issue(1, "[Flag] Red Banner", `### Flag\n![red](${FLAG_PNG})\n\nFlag-Code: rom`),
    issue(2, "[Flag] Svg Banner", `### Flag\n[banner.svg](${FLAG_SVG})`),
    issue(3, "[Flag] Nothing attached", "No image here."),
    issue(4, "[Flag] A pull request", `![x](${FLAG_PNG})`, { pull_request: {} }),
  ];
  scenarioIssues = [
    issue(10, "[Scenario] Empire", `![cover](https://github.com/user-attachments/assets/cover.png)\n[empire-scenario.zip](${PACK_ZIP})\nFlags-Count: 2`),
    issue(11, "[Scenario] No flags", "[plain.zip](https://github.com/user-attachments/files/204/plain.zip)"),
  ];
  const posts = await fetchCommunityFlags({ force: true });
  assert.deepEqual(posts.map((post) => post.id), [1, 2, "scenario-10"]);

  const [red, svg, pack] = posts;
  assert.equal(red.title, "Red Banner");
  assert.equal(red.imageUrl, FLAG_PNG);
  assert.equal(red.code, "ROM");
  assert.equal(red.official, true);
  assert.equal(svg.imageUrl, FLAG_SVG, "an attached .svg is the flag itself");
  assert.equal(pack.fromScenario, true);
  assert.equal(pack.flagCount, 2);
  assert.equal(pack.packUrl, PACK_ZIP);
  assert.equal(pack.title, "Empire");
  assert.equal(pack.imageUrl, "https://github.com/user-attachments/assets/cover.png");
  for (const post of posts) assert.equal(flagPostInstallable(post), true);
  assert.equal(flagPostInstallable({ fromScenario: true }), false);
});

test("a pack yields the scenario's custom flags, from a zip or a bare JSON bundle", async () => {
  const data = { Rome: RED, Carthage: BLUE, France: "https://flagcdn.com/fr.svg" };
  files.set(PACK_ZIP, new Uint8Array(await (await zipBundle({ "scenario.json": JSON.stringify(flagsAsset(data)) })).arrayBuffer()));
  files.set(PACK_JSON, new TextEncoder().encode(JSON.stringify(flagsAsset(data))));

  const expected = [{ code: "Rome", dataUrl: RED }, { code: "Carthage", dataUrl: BLUE }];
  assert.deepEqual(await loadCommunityFlagPack({ packUrl: PACK_ZIP }), expected, "built-in flagcdn flags are left out");
  assert.deepEqual(await loadCommunityFlagPack({ packUrl: PACK_JSON }), expected);
});

test("a pack whose flags ride in the zip as their own entry still yields them", async () => {
  // Past 64 KB the exporter lifts the flags out of scenario.json (bundleFiles.js).
  const heavy = `data:image/png;base64,${"A".repeat(70 * 1024)}`;
  const lifted = splitBundleFiles(flagsAsset({ Rome: heavy, Carthage: BLUE }));
  assert.equal(lifted.bundle.assets.flags.mode, "file");
  const url = "https://github.com/user-attachments/files/207/heavy-scenario.zip";
  files.set(url, new Uint8Array(await (await zipBundle({ ...lifted.files, "scenario.json": JSON.stringify(lifted.bundle) })).arrayBuffer()));
  assert.deepEqual(await loadCommunityFlagPack({ packUrl: url }), [{ code: "Rome", dataUrl: heavy }, { code: "Carthage", dataUrl: BLUE }]);
});

test("a pack with no custom flags, or no bundle, says so", async () => {
  const empty = "https://github.com/user-attachments/files/205/empty.json";
  files.set(empty, new TextEncoder().encode(JSON.stringify(flagsAsset({ France: "https://flagcdn.com/fr.svg" }))));
  await assert.rejects(loadCommunityFlagPack({ packUrl: empty }), /No custom flags found/);
  await assert.rejects(loadCommunityFlagPack({}), /no scenario bundle/);
  await assert.rejects(loadCommunityFlagPack({ packUrl: "https://github.com/user-attachments/files/206/gone.zip" }), /Not found on the hub/);
});
