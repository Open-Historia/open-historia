/*! Open Historia — counting who plays, and in which application: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/visitCount.test.js
//
// "Also add this umami tracker real quick and update the privacy policy." "Also,
// make it track the application so how many people are playing in the main, and
// beta apps individually." And, 2026-10-13: "ensure everything follows us, uk,
// and eu privacy laws strictly" — so nothing is counted before a yes. The gate
// that asks is public/consent.js; what it does is tested here by running it.
// The server's side is server/appKind.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  VISIT_CONSENT_LABELS,
  VISIT_GATE_FILE,
  VISIT_GATE_MARK,
  VISIT_PRIVACY_URL,
  VISIT_TAGS,
  countVisit,
  visitGateAttributes,
  visitNeedsKind,
  visitTagOf,
} from "./visitCount.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

// The gate's tag on a page that is not the game.
const GATE = `<script defer src="/consent.js"></script>`;
// The counters as they were given out, which no page may carry itself any more.
const UMAMI_ID = "452a6cce-d389-4c2d-bc09-e221194c93a2";
const GA_ID = "G-H9EQ4JFZXZ";

// A page with nothing on it but a head, that keeps what is added to it.
const page = ({ already = false } = {}) => {
  const added = [];
  return {
    added,
    head: { appendChild: (element) => added.push(element) },
    querySelector: (selector) => (already && selector === `script[${VISIT_GATE_MARK}]` ? {} : null),
    createElement: (name) => ({ name, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, remove() { this.removed = true; } }),
  };
};
const server = (reply) => {
  const asked = [];
  const fetchImpl = async (address) => {
    asked.push(address);
    if (reply instanceof Error) throw reply;
    return { ok: reply !== null, json: async () => reply };
  };
  return { asked, fetchImpl };
};

test("each application is counted under its own tag", () => {
  const desktop = (channel) => visitTagOf({ env: {}, kind: { app: "desktop", channel }, hostname: "localhost" });
  assert.equal(desktop("stable"), "desktop-main");
  assert.equal(desktop("beta"), "desktop-beta");
  assert.equal(desktop(undefined), "desktop-main");
  assert.equal(visitTagOf({ env: {}, kind: { app: "local" }, hostname: "127.0.0.1" }), "self-hosted");
  assert.equal(visitTagOf({ env: { VITE_OH_WEB: true }, hostname: "openhistoria.com" }), "website");
  // No two the same: the count of one is never the count of another.
  assert.equal(new Set(Object.values(VISIT_TAGS)).size, Object.values(VISIT_TAGS).length);
});

test("what is never counted: the Android app, a development run, a page that is not this computer's own", () => {
  // (The Android build is a web build too, and is asked first.)
  assert.equal(visitTagOf({ env: { VITE_OH_NATIVE: true, VITE_OH_WEB: true }, hostname: "localhost" }), "");
  assert.equal(visitTagOf({ env: { DEV: true }, kind: { app: "local" }, hostname: "localhost" }), "");
  // A phone on the local network playing on the desktop app's server, or somebody's own server at its own address.
  assert.equal(visitTagOf({ env: {}, kind: { app: "desktop", channel: "beta" }, hostname: "192.168.1.20" }), "");
  assert.equal(visitTagOf({ env: {}, kind: { app: "local" }, hostname: "historia.example.org" }), "");
  // A server told not to be counted (OH_VISIT_COUNT=0), and one that did not answer.
  assert.equal(visitTagOf({ env: {}, kind: { app: "uncounted" }, hostname: "localhost" }), "");
  assert.equal(visitTagOf({ env: {}, kind: null, hostname: "localhost" }), "");
  // Only a page served by this computer's own server has to ask which application it is.
  assert.equal(visitNeedsKind({}, "localhost"), true);
  assert.equal(visitNeedsKind({}, "192.168.1.20"), false);
  assert.equal(visitNeedsKind({ VITE_OH_WEB: true }, "openhistoria.com"), false);
  assert.equal(visitNeedsKind({ VITE_OH_NATIVE: true, VITE_OH_WEB: true }, "localhost"), false);
  assert.equal(visitNeedsKind({ DEV: true }, "localhost"), false);
});

test("the game adds the gate, never a counter, with the application's name on it", () => {
  assert.deepEqual(visitGateAttributes("desktop-beta"), {
    src: "/consent.js",
    [VISIT_GATE_MARK]: "",
    "data-tag": "desktop-beta",
    "data-privacy": VISIT_PRIVACY_URL,
  });
  // The website's game is served from /play/, and so is its copy of the gate.
  assert.equal(visitGateAttributes("website", "/play/").src, "/play/consent.js");
  assert.equal(visitGateAttributes("website", "/play").src, "/play/consent.js");
  assert.equal(VISIT_GATE_FILE, "consent.js");
  assert.ok(fs.existsSync(path.join(root, "public", VISIT_GATE_FILE)));
  // Nothing of either counter is in the game's own code: only consent.js knows them.
  const own = read("src/runtime/visitCount.js");
  for (const gone of ["cloud.umami.is", UMAMI_ID, "googletagmanager", GA_ID]) assert.equal(own.includes(gone), false, gone);
});

test("the beta app's page asks its server once and adds the gate as the beta", async () => {
  const doc = page();
  const { asked, fetchImpl } = server({ app: "desktop", channel: "beta" });
  assert.equal(await countVisit({ env: {}, doc, hostname: "localhost", fetchImpl }), "desktop-beta");
  assert.deepEqual(asked, ["/api/app-kind"]);
  assert.equal(doc.added.length, 1);
  assert.equal(doc.added[0].name, "script");
  assert.equal(doc.added[0].defer, true);
  assert.equal(doc.added[0].attributes["data-tag"], "desktop-beta");
  assert.equal(doc.added[0].attributes.src, "/consent.js");
  // A gate that cannot be loaded takes itself away again.
  doc.added[0].onerror();
  assert.equal(doc.added[0].removed, true);
});

test("the website asks nobody; and nothing is added where nothing is counted, or twice", async () => {
  const web = page();
  const nobody = server(new Error("the website has no such server"));
  assert.equal(await countVisit({ env: { VITE_OH_WEB: true, BASE_URL: "/play/" }, doc: web, hostname: "openhistoria.com", fetchImpl: nobody.fetchImpl }), "website");
  assert.deepEqual([nobody.asked, web.added.length, web.added[0].attributes["data-tag"], web.added[0].attributes.src], [[], 1, "website", "/play/consent.js"]);

  for (const [env, hostname, reply] of [
    [{ VITE_OH_NATIVE: true, VITE_OH_WEB: true }, "localhost", { app: "desktop", channel: "stable" }],
    [{ DEV: true }, "localhost", { app: "local" }],
    [{}, "192.168.1.20", { app: "desktop", channel: "stable" }],
    [{}, "localhost", { app: "uncounted" }],
    [{}, "localhost", null],
    [{}, "localhost", new Error("no answer")],
  ]) {
    const doc = page();
    assert.equal(await countVisit({ env, doc, hostname, fetchImpl: server(reply).fetchImpl }), "", JSON.stringify([env, hostname]));
    assert.equal(doc.added.length, 0);
  }
  const twice = page({ already: true });
  assert.equal(await countVisit({ env: { VITE_OH_WEB: true }, doc: twice, hostname: "openhistoria.com", fetchImpl: nobody.fetchImpl }), "");
  assert.equal(twice.added.length, 0);
  // No page at all (a test, a worker): nothing, and no error.
  assert.equal(await countVisit({ env: { VITE_OH_WEB: true }, doc: null, hostname: "openhistoria.com" }), "");
});

// ---- public/consent.js, run in a page of its own -------------------------------

const gateSource = fs.readFileSync(path.join(root, "public", "consent.js"), "utf8");

// A page as consent.js sees one: what was added to its head and its body, the
// cookies it holds, and what it has stored.
const browser = ({ hostname = "openhistoria.com", stored = null, gpc = false, dnt = null, attributes = {}, kind = undefined, cookies = "", openers = 0 } = {}) => {
  const head = [];
  const body = [];
  const storage = new Map(stored ? Object.entries(stored) : []);
  const events = [];
  const cookieWrites = [];
  const element = (name) => {
    const node = {
      name, attributes: {}, style: {}, children: [], parentNode: null, listeners: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      getAttribute(key) { return Object.hasOwn(this.attributes, key) ? this.attributes[key] : null; },
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parentNode = null; },
      addEventListener(type, handler) { this.listeners[type] = handler; },
    };
    return node;
  };
  const headNode = element("head");
  headNode.appendChild = (child) => { child.parentNode = headNode; head.push(child); return child; };
  headNode.removeChild = (child) => { head.splice(head.indexOf(child), 1); };
  const bodyNode = element("body");
  bodyNode.appendChild = (child) => { child.parentNode = bodyNode; body.push(child); return child; };
  bodyNode.removeChild = (child) => { body.splice(body.indexOf(child), 1); };
  const self = element("script");
  Object.assign(self.attributes, attributes);
  const openerNodes = Array.from({ length: openers }, () => element("a"));
  const asked = [];
  const document = {
    currentScript: self,
    readyState: "complete",
    head: headNode,
    body: bodyNode,
    createElement: element,
    querySelectorAll: (selector) => (selector === "[data-consent-open]" ? openerNodes : []),
    addEventListener() {},
    dispatchEvent() {},
    get cookie() { return cookies; },
    set cookie(value) { cookieWrites.push(value); },
  };
  const window = {
    location: { hostname },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    dispatchEvent: (event) => events.push(event),
    fetch: kind === undefined ? undefined : async (address) => {
      asked.push(address);
      if (kind instanceof Error) throw kind;
      return { ok: kind !== null, json: async () => kind };
    },
  };
  const navigator = { globalPrivacyControl: gpc, doNotTrack: dnt };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const context = vm.createContext({ window, document, navigator, CustomEvent, Date, JSON, Object, String, Boolean });
  vm.runInContext(gateSource, context);
  const scripts = () => head.filter((node) => node.name === "script").map((node) => node.attributes);
  return { window, head, body, storage, events, cookieWrites, asked, openerNodes, scripts, consent: window.ohConsent };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const answerOf = (choice, daysAgo = 0) => ({ "oh:analytics-consent": JSON.stringify({ choice, at: new Date(Date.now() - daysAgo * 86400000).toISOString() }) });
const pressButton = (pageState, label) => {
  const panel = pageState.body[0];
  const row = panel.children.at(-1);
  row.children.find((node) => node.name === "button" && node.textContent === label).onclick();
};

test("before anybody has answered, the page asks and loads neither counter", () => {
  const first = browser();
  assert.deepEqual(first.scripts(), [], "nothing is requested from Google or Umami");
  assert.equal(first.body.length, 1, "the question is on the page");
  assert.equal(first.window.dataLayer, undefined);
  assert.equal(first.consent.get(), "");
  assert.equal(first.consent.counted(), true);
  // Saying no is as easy as saying yes: two buttons, drawn alike, no before yes.
  const buttons = first.body[0].children.at(-1).children.filter((node) => node.name === "button");
  assert.deepEqual(buttons.map((node) => node.textContent), [VISIT_CONSENT_LABELS.no, VISIT_CONSENT_LABELS.yes]);
  assert.equal(buttons[0].style.cssText, buttons[1].style.cssText);
  const link = first.body[0].children.at(-1).children.find((node) => node.name === "a");
  assert.equal(link.href, "/privacy/");
});

test("a yes loads both, for counting only; a no loads nothing and is not asked again", () => {
  const yes = browser();
  pressButton(yes, VISIT_CONSENT_LABELS.yes);
  assert.equal(yes.body.length, 0, "the question is gone");
  assert.equal(yes.consent.get(), "yes");
  const [google, umami] = yes.scripts();
  assert.equal(google.src, `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`);
  assert.equal(umami.src, "https://cloud.umami.is/script.js");
  assert.equal(umami["data-website-id"], UMAMI_ID);
  assert.equal(umami["data-do-not-track"], "true");
  // A page of the website itself carries no application's name.
  assert.equal(Object.hasOwn(umami, "data-tag"), false);
  // Google is told, before its script runs, that nothing here is for advertising.
  // (Read through JSON: the page's objects are another realm's.)
  const calls = JSON.parse(JSON.stringify(yes.window.dataLayer.map((entry) => Array.from(entry)).filter((entry) => entry[0] !== "js")));
  assert.deepEqual(calls[0], ["consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" }]);
  assert.deepEqual(calls.at(-1), ["config", GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false }]);
  assert.deepEqual(yes.events.map((event) => [event.type, event.detail.choice]), [["oh:consent", "yes"]]);

  const no = browser();
  pressButton(no, VISIT_CONSENT_LABELS.no);
  assert.deepEqual(no.scripts(), []);
  assert.equal(no.consent.get(), "no");
  // The next page: the answer stands.
  const later = browser({ stored: Object.fromEntries(no.storage) });
  assert.deepEqual([later.scripts().length, later.body.length], [0, 0]);
  const laterYes = browser({ stored: Object.fromEntries(yes.storage) });
  assert.deepEqual([laterYes.scripts().length, laterYes.body.length], [2, 0]);
});

test("Global Privacy Control and Do Not Track are a no, without asking; an old answer is asked for again", () => {
  for (const signal of [{ gpc: true }, { dnt: "1" }, { dnt: "yes" }]) {
    const quiet = browser(signal);
    assert.deepEqual([quiet.scripts().length, quiet.body.length], [0, 0], JSON.stringify(signal));
    assert.equal(quiet.consent.refusedBySignal(), true);
    // Somebody who then says yes by hand is counted: that is a choice.
    quiet.consent.set("yes");
    assert.equal(quiet.scripts().length, 2);
  }
  assert.equal(browser().consent.refusedBySignal(), false);
  // Six months: the answer has lapsed, and nothing is loaded on the strength of it.
  const stale = browser({ stored: answerOf("yes", 181) });
  assert.deepEqual([stale.scripts().length, stale.body.length], [0, 1]);
  const fresh = browser({ stored: answerOf("yes", 179) });
  assert.deepEqual([fresh.scripts().length, fresh.body.length], [2, 0]);
  // A stored value that is not an answer is no answer.
  const damaged = browser({ stored: { "oh:analytics-consent": "yes" } });
  assert.deepEqual([damaged.scripts().length, damaged.body.length], [0, 1]);
});

test("a yes taken back switches both off at once and deletes Google's cookies", () => {
  const visitor = browser({ stored: answerOf("yes"), cookies: "_ga=GA1.1.1.1; theme=dark; _ga_H9EQ4JFZXZ=GS1.1.2" });
  assert.equal(visitor.scripts().length, 2);
  visitor.consent.set("no");
  assert.equal(visitor.window[`ga-disable-${GA_ID}`], true);
  assert.equal(visitor.storage.get("umami.disabled"), "1");
  assert.ok(visitor.cookieWrites.some((write) => write.startsWith("_ga=;") && write.includes("domain=.openhistoria.com")));
  assert.ok(visitor.cookieWrites.some((write) => write.startsWith("_ga_H9EQ4JFZXZ=;")));
  assert.equal(visitor.cookieWrites.some((write) => write.startsWith("theme=")), false, "no other cookie is touched");
  assert.equal(visitor.consent.get(), "no");
  // And a yes again clears the switch.
  visitor.consent.set("yes");
  assert.equal(visitor.window[`ga-disable-${GA_ID}`], false);
  assert.equal(visitor.storage.has("umami.disabled"), false);
});

test("a page is counted on the project's own address, on this computer's own server, and nowhere else", async () => {
  // Somebody else's address: nothing is counted, nobody is asked, and the way back to the question is hidden.
  const elsewhere = browser({ hostname: "historia.example.org", kind: { app: "local" }, openers: 1 });
  await settle();
  assert.deepEqual([elsewhere.scripts().length, elsewhere.body.length, elsewhere.asked.length], [0, 0, 0]);
  assert.equal(elsewhere.consent.counted(), false);
  assert.equal(elsewhere.openerNodes[0].style.display, "none");
  elsewhere.consent.open();
  assert.equal(elsewhere.body.length, 0);
  // A phone on the local network.
  const phone = browser({ hostname: "192.168.1.20", kind: { app: "desktop", channel: "beta" } });
  await settle();
  assert.deepEqual([phone.body.length, phone.asked.length], [0, 0]);

  // A guide page opened from the desktop app: the server says which application it is.
  for (const [kind, tag] of [[{ app: "desktop", channel: "beta" }, "desktop-beta"], [{ app: "desktop", channel: "stable" }, "desktop-main"], [{ app: "local" }, "self-hosted"]]) {
    const local = browser({ hostname: "localhost", kind });
    await settle();
    assert.deepEqual(local.asked, ["/api/app-kind"]);
    assert.equal(local.body.length, 1, "asked first, like anywhere");
    local.consent.set("yes");
    const umami = local.scripts()[1];
    assert.equal(umami["data-tag"], tag);
    assert.deepEqual([umami["data-exclude-search"], umami["data-exclude-hash"]], ["true", "true"]);
  }
  // OH_VISIT_COUNT=0, or a server that does not answer: neither counter, no question.
  for (const kind of [{ app: "uncounted" }, null, new Error("no answer")]) {
    const off = browser({ hostname: "127.0.0.1", kind });
    await settle();
    assert.deepEqual([off.scripts().length, off.body.length], [0, 0]);
  }
  // The game says what it is itself, and nothing is asked of the server again.
  const game = browser({ hostname: "localhost", attributes: { "data-tag": "desktop-main", "data-privacy": "/privacy/" }, kind: { app: "local" }, stored: answerOf("yes") });
  await settle();
  assert.deepEqual(game.asked, []);
  assert.equal(game.scripts()[1]["data-tag"], "desktop-main");
  // The website's game: counted as the website, with its page's query as before.
  const play = browser({ attributes: { "data-tag": "website" }, stored: answerOf("yes") });
  assert.equal(play.scripts()[1]["data-tag"], "website");
  assert.equal(Object.hasOwn(play.scripts()[1], "data-exclude-search"), false);
});

test("the footer's Privacy choices asks again", () => {
  const visitor = browser({ stored: answerOf("no"), openers: 1 });
  assert.equal(visitor.body.length, 0);
  let prevented = false;
  visitor.openerNodes[0].listeners.click({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(visitor.body.length, 1);
  visitor.consent.open();
  assert.equal(visitor.body.length, 1, "one question, not two");
});

test("the gate's words are the ones the language packs carry, and its tags the game's", () => {
  for (const [key, text] of Object.entries(VISIT_CONSENT_LABELS)) {
    assert.ok(gateSource.includes(`${key}: ${JSON.stringify(text)}`), key);
  }
  for (const tag of Object.values(VISIT_TAGS)) assert.ok(gateSource.includes(`"${tag}"`), tag);
});

// Every page of the website: what is written by hand under public/ and site/.
const websitePages = (folder, out = []) => {
  for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
    const relative = `${folder}/${entry.name}`;
    if (entry.isDirectory()) websitePages(relative, out);
    else if (entry.name.endsWith(".html")) out.push(relative);
  }
  return out;
};
const HARD_CODED = /<script[^>]*(googletagmanager|cloud\.umami\.is|google-analytics)|gtag\(\s*['"]config['"]/;

test("no page loads a counter itself: the website's pages carry the gate, once each, and the game adds its own", () => {
  const pages = [...websitePages("public"), ...websitePages("site"), "index.html"];
  for (const file of pages) assert.equal(HARD_CODED.test(read(file)), false, `${file} loads a counter without asking`);
  for (const file of ["site/index.html", "site/404.html", "public/sitemap/index.html", "public/pax-historia-alternative/index.html"]) {
    assert.equal(read(file).split(GATE).length - 1, 1, file);
  }
  // Pages written by a script are written with it, or the next writing would lose it.
  const wiki = path.join(root, "scripts", "build-wiki.mjs");
  if (fs.existsSync(wiki)) {
    assert.ok(read("scripts/build-wiki.mjs").includes(GATE));
    assert.equal(HARD_CODED.test(read("scripts/build-wiki.mjs")), false);
  }
  // The game's page is every application's page: it carries neither counter nor the gate, and adds the gate itself.
  const game = read("index.html");
  for (const gone of ["umami", "googletagmanager", "gtag", "consent.js"]) assert.equal(game.includes(gone), false, gone);
  assert.ok(read("src/main.jsx").includes("void countVisit({ env: import.meta.env });"));
  // The website serves the gate at its root, for the pages there.
  assert.match(read("scripts/assemble-site.mjs"), /"guides\.css", "consent\.js", "fonts", "robots\.txt"/);
  // No page of the website asks Google for a font: they are the site's own files.
  for (const file of pages) assert.equal(/fonts\.(googleapis|gstatic)\.com/.test(read(file)), false, `${file} loads a font from Google`);
  assert.ok(fs.existsSync(path.join(root, "public", "fonts", "fonts.css")));
  // And the Android app, which counts nothing, does not carry it.
  const stage = path.join(root, "mobile", "scripts", "stage-www.mjs");
  if (fs.existsSync(stage)) assert.match(read("mobile/scripts/stage-www.mjs"), /"consent\.js"/);
});

// (A branch whose website has no privacy policy page yet has nothing to say it in.)
const hasPolicy = fs.existsSync(path.join(root, "public", "privacy", "index.html"));
test("the privacy policy says so", { skip: hasPolicy ? false : "this branch has no privacy policy page" }, () => {
  const policy = read("public/privacy/index.html");
  assert.ok(policy.includes("<strong>Umami</strong>"));
  assert.ok(policy.includes("which application it is"));
  assert.ok(policy.includes("<code>cloud.umami.is</code>"));
  assert.ok(policy.includes("Data held by Google Analytics, Umami, GitHub, Discord or your AI provider"));
  // Nothing is counted before a yes, and the page offers the way to change the answer.
  assert.ok(policy.includes("only after you say yes"));
  assert.ok(policy.includes("data-consent-open"));
  assert.ok(policy.includes("Global Privacy Control"));
  // The Android app loads neither counter, and the policy does not say it does.
  assert.equal(policy.includes("the desktop app and the Android app when you are online, load <strong>Google Analytics</strong>"), false);
});
