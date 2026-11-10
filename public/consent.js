/*! Open Historia — the visit counters wait for a yes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Google Analytics and Umami are loaded by this file and by nothing else, and
// only after the person looking at the page has said yes.
//
// Why: Google Analytics sets cookies, and both tools read things about the
// device. In the EU and the UK that needs agreement first (ePrivacy Directive
// art. 5(3), PECR reg. 6), freely given, with "no" as easy as "yes". Until
// 2026-10-13 both loaded on every page before anyone was asked, while the
// privacy policy named consent as the reason they were allowed.
//
// The rules, all of them here:
//   * no stored answer            -> ask, and load nothing meanwhile;
//   * "yes"                       -> load both;
//   * "no"                        -> load nothing, and never ask again until
//                                    the answer is old (ANSWER_DAYS) or changed;
//   * Global Privacy Control or   -> the same as "no", without asking. Somebody
//     Do Not Track is switched on    who then says yes by hand is counted: that
//                                    is a choice, and the signal is a default;
//   * taking a yes back           -> both are switched off at once and the
//                                    Google Analytics cookies are deleted.
//
// Every page uses this one file, so there is one answer for a whole site:
//   - a page of the website or of a guide carries
//         <script defer src="/consent.js"></script>
//     and is counted only on the project's own address, or on this computer's
//     own server, which is asked what it is (GET /api/app-kind);
//   - the game adds it itself (src/runtime/visitCount.js) with data-tag, the
//     application it is counted under. The Android app never adds it.
// A page on anybody else's address counts nothing and asks nothing.
//
// The answer is kept in localStorage under ANSWER_KEY. Keeping an answer about
// cookies is the one thing that may be stored without asking.
//
// Plain ES5 on purpose: no build step touches this file, and the wiki's oldest
// supported browsers read it as it is.
(function () {
  "use strict";
  if (window.ohConsent) return;

  var GA_ID = "G-H9EQ4JFZXZ";
  var UMAMI_SRC = "https://cloud.umami.is/script.js";
  var UMAMI_ID = "452a6cce-d389-4c2d-bc09-e221194c93a2";
  var ANSWER_KEY = "oh:analytics-consent";
  // An answer is asked for again after this long (the French regulator's six months).
  var ANSWER_DAYS = 180;
  var SITE_HOSTS = ["openhistoria.com", "www.openhistoria.com"];
  // The applications, as src/runtime/visitCount.js names them.
  var DESKTOP_TAGS = { stable: "desktop-main", beta: "desktop-beta" };
  var LOCAL_TAG = "self-hosted";
  var WEBSITE_TAG = "website";

  // The words. src/runtime/visitCount.js holds the same ones so that the
  // game's language packs carry them (visitCount.test.js keeps the two equal).
  var TEXT = {
    title: "Count your visit?",
    what: "Open Historia would like to count visits with Google Analytics and Umami, to see how many people play and which version they use.",
    how: "Google Analytics sets cookies. Nothing is loaded unless you say yes, and you can change your answer at any time.",
    no: "No, thanks",
    yes: "Yes, count my visits",
    policy: "Privacy policy"
  };

  var self = document.currentScript;
  var attribute = function (name) { return self && self.getAttribute ? self.getAttribute(name) : null; };
  var privacyUrl = attribute("data-privacy") || "/privacy/";

  // ---- the answer -------------------------------------------------------------

  var readAnswer = function () {
    try {
      var stored = JSON.parse(window.localStorage.getItem(ANSWER_KEY) || "null");
      if (!stored || (stored.choice !== "yes" && stored.choice !== "no")) return "";
      var age = Date.now() - Date.parse(stored.at);
      if (!(age >= 0) || age > ANSWER_DAYS * 86400000) return "";
      return stored.choice;
    } catch (error) {
      return "";
    }
  };
  var writeAnswer = function (choice) {
    try {
      window.localStorage.setItem(ANSWER_KEY, JSON.stringify({ choice: choice, at: new Date().toISOString() }));
    } catch (error) { /* a browser that keeps nothing asks again next time */ }
  };

  // Global Privacy Control, or Do Not Track: the browser has already answered.
  var signalsNo = function () {
    try {
      if (navigator.globalPrivacyControl === true) return true;
      var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
      return dnt === "1" || dnt === "yes";
    } catch (error) {
      return false;
    }
  };

  // ---- the two counters -------------------------------------------------------

  var counting = null; // { tag } once it is known that this page is counted at all
  var loaded = false;

  var addScript = function (attributes) {
    var element = document.createElement("script");
    for (var name in attributes) {
      if (Object.prototype.hasOwnProperty.call(attributes, name)) element.setAttribute(name, attributes[name]);
    }
    element.onerror = function () { if (element.parentNode) element.parentNode.removeChild(element); };
    document.head.appendChild(element);
    return element;
  };

  var load = function () {
    if (!counting) return;
    // A yes after a no on the same page: the two switches unload() set come off again.
    try { window.localStorage.removeItem("umami.disabled"); } catch (error) { /* nothing kept */ }
    window["ga-disable-" + GA_ID] = false;
    if (loaded) return;
    loaded = true;

    // Google Analytics, for counting only: no advertising use of what it sees.
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted"
    });
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
    addScript({ async: "", src: "https://www.googletagmanager.com/gtag/js?id=" + GA_ID });

    // Umami. In an application the page's query and fragment are not sent.
    var umami = { defer: "", src: UMAMI_SRC, "data-website-id": UMAMI_ID, "data-do-not-track": "true" };
    if (counting.tag) umami["data-tag"] = counting.tag;
    if (counting.tag && counting.tag !== WEBSITE_TAG) {
      umami["data-exclude-search"] = "true";
      umami["data-exclude-hash"] = "true";
    }
    addScript(umami);
  };

  // A yes taken back: switched off at once, and Google's cookies deleted.
  var unload = function () {
    window["ga-disable-" + GA_ID] = true;
    try { window.localStorage.setItem("umami.disabled", "1"); } catch (error) { /* nothing kept */ }
    try {
      var names = document.cookie.split(";");
      var host = window.location.hostname;
      var domains = ["", host, "." + host];
      var parts = host.split(".");
      while (parts.length > 2) { parts.shift(); domains.push("." + parts.join(".")); }
      for (var i = 0; i < names.length; i += 1) {
        var name = names[i].split("=")[0].replace(/^\s+/, "");
        if (name !== "_ga" && name.indexOf("_ga_") !== 0 && name !== "_gid" && name !== "_gat") continue;
        for (var d = 0; d < domains.length; d += 1) {
          document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/" + (domains[d] ? "; domain=" + domains[d] : "");
        }
      }
    } catch (error) { /* a cookie that cannot be reached expires by itself */ }
  };

  // ---- the question -----------------------------------------------------------

  var panel = null;
  var closePanel = function () {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
  };

  var announce = function (choice) {
    try {
      window.dispatchEvent(new CustomEvent("oh:consent", { detail: { choice: choice } }));
    } catch (error) { /* an old browser hears nothing, and reads get() */ }
  };

  var answer = function (choice) {
    var before = readAnswer();
    writeAnswer(choice);
    closePanel();
    if (choice === "yes") load();
    else if (before === "yes" || loaded) unload();
    announce(choice);
  };

  // Both buttons are drawn alike: saying no is exactly as easy as saying yes.
  var BUTTON = "appearance:none;background:#26262c;border:1px solid rgba(255,255,255,0.32);border-radius:10px;color:#f3f1ec;cursor:pointer;" +
    "font:600 14px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif;min-height:44px;padding:10px 18px;flex:1 1 150px";

  var openPanel = function () {
    if (panel || !document.body) return;
    panel = document.createElement("div");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", TEXT.title);
    panel.setAttribute("data-oh-consent-panel", "");
    panel.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;margin:0 auto;max-width:560px;box-sizing:border-box;" +
      "background:#17171b;border:1px solid rgba(255,255,255,0.22);border-radius:14px;color:#e9e6df;padding:16px 18px;" +
      "font:400 14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;text-align:left;box-shadow:0 10px 30px rgba(0,0,0,0.55)";

    var line = function (text, style) {
      var element = document.createElement("div");
      element.textContent = text;
      element.style.cssText = style;
      panel.appendChild(element);
    };
    line(TEXT.title, "font-weight:700;font-size:15px;color:#ffffff;margin-bottom:6px");
    line(TEXT.what, "margin-bottom:4px");
    line(TEXT.how, "margin-bottom:12px");

    var row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;align-items:center";
    var button = function (text, choice) {
      var element = document.createElement("button");
      element.type = "button";
      element.textContent = text;
      element.style.cssText = BUTTON;
      element.onclick = function () { answer(choice); };
      row.appendChild(element);
    };
    button(TEXT.no, "no");
    button(TEXT.yes, "yes");
    var link = document.createElement("a");
    link.href = privacyUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = TEXT.policy;
    link.style.cssText = "color:#e9e6df;text-decoration:underline;flex:0 0 auto;padding:10px 4px";
    row.appendChild(link);
    panel.appendChild(row);
    document.body.appendChild(panel);
  };

  // ---- which page this is -----------------------------------------------------

  var isThisComputer = function (hostname) {
    return /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i.test(String(hostname || ""));
  };

  // What the page is counted as: { tag } or null. A page the game added says so
  // itself; any other page is counted on the project's own address, or on this
  // computer's own server once that has said which application it is.
  var decide = function (done) {
    var given = attribute("data-tag");
    if (given) { done({ tag: given }); return; }
    var hostname = window.location.hostname;
    if (SITE_HOSTS.indexOf(String(hostname).toLowerCase()) >= 0) { done({ tag: "" }); return; }
    if (!isThisComputer(hostname) || !window.fetch) { done(null); return; }
    window.fetch("/api/app-kind", { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (kind) {
        if (kind && kind.app === "desktop") done({ tag: DESKTOP_TAGS[kind.channel] || DESKTOP_TAGS.stable });
        else if (kind && kind.app === "local") done({ tag: LOCAL_TAG });
        else done(null);
      })
      .catch(function () { done(null); });
  };

  // ---- what a page may ask ----------------------------------------------------

  var ready = false;
  window.ohConsent = {
    // "yes", "no", or "" while nobody has answered.
    get: function () { return readAnswer(); },
    // The browser's own signal says no (Global Privacy Control, Do Not Track).
    refusedBySignal: signalsNo,
    // Whether this page is counted at all. False until that is known.
    counted: function () { return Boolean(counting); },
    set: function (choice) { if (choice === "yes" || choice === "no") answer(choice); },
    // Ask again: the footer's "Privacy choices", the policy's button.
    open: function () { if (counting) openPanel(); },
    whenReady: function (callback) { if (ready) callback(); else document.addEventListener("oh:consent-ready", callback); }
  };

  var start = function () {
    decide(function (mode) {
      counting = mode;
      ready = true;
      try { document.dispatchEvent(new CustomEvent("oh:consent-ready")); } catch (error) { /* read counted() */ }
      // A page that is not counted: any control that would reopen the question is hidden.
      var openers = document.querySelectorAll ? document.querySelectorAll("[data-consent-open]") : [];
      for (var i = 0; i < openers.length; i += 1) {
        if (!mode) { openers[i].style.display = "none"; continue; }
        openers[i].addEventListener("click", function (event) { event.preventDefault(); openPanel(); });
      }
      if (!mode) return;
      var stored = readAnswer();
      if (stored === "yes") load();
      else if (stored === "" && !signalsNo()) openPanel();
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
