/*! Open Historia — the landing page's downloads and viewer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The visitor's own platform first, download sizes from the GitHub releases
// API, the setup tabs, the screenshot viewer, and sections that rise into view.
(function () {
  "use strict";

  var ua = navigator.userAgent || "";
  var os = "desktop";
  if (/Android/i.test(ua)) os = "android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "ios";
  else if (/Windows/i.test(ua)) os = "windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "mac";
  else if (/Linux/i.test(ua)) os = "linux";

  function byId(id) { return document.getElementById(id); }

  // ---------- the buttons point at the visitor's own build ----------
  var RELEASES = "https://github.com/Open-Historia/open-historia/releases/download/";
  var label = { windows: "Download for Windows", mac: "Download for macOS", linux: "Download for Linux",
                android: "Download the Android app", ios: "Download the Desktop app", desktop: "Download for Desktop" }[os];
  // Mac goes to the downloads: Apple Silicon and Intel need different builds,
  // and the user agent can't tell them apart.
  var href = os === "android" ? RELEASES + "android/open-historia.apk"
           : os === "windows" ? RELEASES + "desktop-stable/Open-Historia-Setup.exe"
           // The .deb installs a root-owned chrome-sandbox, so Chromium's sandbox works (#658).
           : os === "linux" ? RELEASES + "desktop-stable/Open-Historia-amd64.deb"
           : "#download";
  var betaLabel = { windows: "Beta for Windows", mac: "Beta for macOS", linux: "Beta for Linux",
                    android: "Beta Android app", ios: "Download the Beta", desktop: "Download the Beta" }[os];
  var betaHref = os === "android" ? RELEASES + "android-beta/open-historia-beta.apk"
               : os === "windows" ? RELEASES + "desktop-beta/Open-Historia-Beta-Setup.exe"
               : os === "linux" ? RELEASES + "desktop-beta/Open-Historia-Beta-amd64.deb"
               : "#download";

  function point(id, textId, url, text) {
    var link = byId(id);
    var span = byId(textId);
    if (link) link.href = url;
    if (span) span.textContent = text;
  }
  point("primaryDownload", "primaryLabel", href, label);
  point("bandDownload", "bandLabel", href, label);
  point("betaDownload", "betaLabel", betaHref, betaLabel);
  if (os === "ios") {
    var note = byId("heroNote");
    if (note) note.innerHTML = "On iPhone &amp; iPad, tap <b>Demo</b> to try it in Safari — expect lag, and add it to your Home Screen for fullscreen.";
  }

  // ---------- the visitor's platform is the recommended card ----------
  (function recommend() {
    var want = ["windows", "mac", "linux", "android"].indexOf(os) >= 0 ? os : "windows";
    Array.prototype.forEach.call(document.querySelectorAll(".dl .card[data-os-card]"), function (card) {
      var mine = card.getAttribute("data-os-card") === want;
      card.classList.toggle("feature", mine);
      var tag = card.querySelector(".tag");
      if (mine && !tag) {
        tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "Recommended";
        card.insertBefore(tag, card.firstChild);
      } else if (!mine && tag) {
        tag.parentNode.removeChild(tag);
      }
      Array.prototype.forEach.call(card.querySelectorAll(".btn"), function (button, i) {
        var primary = mine && i === 0;
        button.classList.toggle("btn-primary", primary);
        button.classList.toggle("btn-ghost", !primary);
      });
    });
  })();

  // ---------- download sizes, read from the GitHub releases API ----------
  var GH_REPO = "Open-Historia/open-historia";
  var GH_TAGS = ["desktop-stable", "android"];   // the rolling tags the cards link to
  var SIZE_KEY = "oh:asset-sizes:v1";
  var SIZE_TTL = 6 * 60 * 60 * 1000;

  function fmtSize(bytes) {
    var mb = bytes / 1048576;
    if (mb >= 1024) return (Math.round(mb / 102.4) / 10) + " GB";
    return (mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10) + " MB";
  }
  function sizeLabel(spec, sizes) {
    var vals = [];
    spec.split("|").forEach(function (name) {
      var v = sizes[name.trim()];
      if (typeof v === "number") vals.push(v);
    });
    if (!vals.length) return null;
    var lo = fmtSize(Math.min.apply(null, vals));
    var hi = fmtSize(Math.max.apply(null, vals));
    if (lo === hi) return lo;
    var loU = lo.split(" ")[1];
    var hiU = hi.split(" ")[1];
    return (loU === hiU ? lo.split(" ")[0] : lo) + "–" + hi;
  }
  function applySizes(sizes) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-size]"), function (el) {
      var text = sizeLabel(el.getAttribute("data-size") || "", sizes);
      if (text) el.textContent = text;
    });
  }
  // Unauthenticated GitHub allows 60 requests an hour, and this costs two, so
  // the answer is kept: repeat visits within the TTL send nothing.
  (function loadSizes() {
    if (!document.querySelector("[data-size]")) return;
    try {
      var cached = JSON.parse(localStorage.getItem(SIZE_KEY) || "null");
      if (cached && cached.t && Date.now() - cached.t < SIZE_TTL) { applySizes(cached.s); return; }
    } catch (e) { /* storage blocked: ask GitHub */ }
    if (!window.fetch || !window.Promise) return;
    Promise.all(GH_TAGS.map(function (tag) {
      return fetch("https://api.github.com/repos/" + GH_REPO + "/releases/tags/" + tag, { headers: { Accept: "application/vnd.github+json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    })).then(function (releases) {
      var sizes = {};
      releases.forEach(function (rel) {
        if (rel && rel.assets) rel.assets.forEach(function (a) { sizes[a.name] = a.size; });
      });
      if (!Object.keys(sizes).length) return;
      try { localStorage.setItem(SIZE_KEY, JSON.stringify({ t: Date.now(), s: sizes })); } catch (e) { /* not kept */ }
      applySizes(sizes);
    });
  })();

  // ---------- the setup tabs ----------
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var bodies = Array.prototype.slice.call(document.querySelectorAll(".tab-body"));
  function select(name) {
    tabs.forEach(function (t) { t.setAttribute("aria-selected", String(t.getAttribute("data-os") === name)); });
    bodies.forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-os") === name); });
  }
  tabs.forEach(function (t) { t.addEventListener("click", function () { select(t.getAttribute("data-os")); }); });
  if (["windows", "mac", "linux"].indexOf(os) >= 0) select(os);

  // ---------- the screenshot viewer ----------
  var shots = Array.prototype.slice.call(document.querySelectorAll(".shot"));
  var lb = byId("lightbox");
  var lbImg = byId("lbImg");
  var lbCap = byId("lbCap");
  var at = 0;
  var back = null;
  function render(i) {
    at = (i + shots.length) % shots.length;
    var img = shots[at].querySelector("img");
    var cap = shots[at].querySelector("figcaption");
    lbImg.src = img.getAttribute("src");
    lbImg.alt = img.alt;
    lbCap.textContent = (cap ? cap.textContent + " · " : "") + (at + 1) + " / " + shots.length;
  }
  function open(i) {
    back = document.activeElement;
    render(i);
    lb.hidden = false;
    requestAnimationFrame(function () { requestAnimationFrame(function () { lb.classList.add("on"); }); });
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", keys, true);
    lb.focus();
  }
  function close() {
    lb.classList.remove("on");
    setTimeout(function () { lb.hidden = true; }, 200);
    document.body.style.overflow = "";
    document.removeEventListener("keydown", keys, true);
    if (back && back.focus) back.focus();
  }
  function keys(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); render(at + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); render(at - 1); }
  }
  if (lb && shots.length) {
    shots.forEach(function (shot, i) {
      shot.setAttribute("tabindex", "0");
      shot.setAttribute("role", "button");
      shot.setAttribute("aria-label", "View screenshot " + (i + 1) + " full size");
      shot.addEventListener("click", function () { open(i); });
      shot.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i); }
      });
    });
    byId("lbClose").addEventListener("click", close);
    byId("lbPrev").addEventListener("click", function () { render(at - 1); });
    byId("lbNext").addEventListener("click", function () { render(at + 1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) close(); });
  }

  // ---------- sections rise into view ----------
  var risers = document.querySelectorAll(".rise");
  if ("IntersectionObserver" in window) {
    var watcher = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        watcher.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    Array.prototype.forEach.call(risers, function (el) { watcher.observe(el); });
  } else {
    Array.prototype.forEach.call(risers, function (el) { el.classList.add("in"); });
  }
})();
