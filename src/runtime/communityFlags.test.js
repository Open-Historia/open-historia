import test from "node:test";
import assert from "node:assert/strict";
import { fetchCommunityFlags, flagDataUrlToBlob, flagFileName, flagPublishQuery } from "./communityFlags.js";

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
