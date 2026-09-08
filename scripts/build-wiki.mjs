/*! Open Historia — wiki generator © 2026 Nicholas Krol, MIT. */
// Renders wiki/*.md into public/wiki/<slug>/index.html, one directory per page.
//
// It lives in public/ rather than site/ for the same reason the guides do (see the comment in
// assemble-site.mjs): a local desktop install serves public/ at ITS root, so the wiki works
// offline inside the app too, and openhistoria.com gets the same files lifted to / by the
// assembler. One source, two surfaces, no hand-edited second copy to desync.
//
// The generated HTML is COMMITTED as well as generated. assemble-site.mjs hard-fails if a
// ROOT_PAGES entry is missing from dist-web/, and `npm run build` (desktop) and `build:web`
// never invoke this script — committing the output is what keeps all three honest without
// threading the generator through every build path.
//
// Run: node scripts/build-wiki.mjs   (also runs as the first stage of `npm run build:site`)
//
// The maintenance runbook is docs/wiki.md — editing rules, the screenshot harness and its
// pitfalls, how the URL redirects work, and how to add a page.
//
// Wondering whether the wiki is out of date? `npm run wiki:check` diffs the commits recorded in
// wiki/provenance.json against the current tips of main and beta and tells you which pages cite
// files that have changed since. Update provenance.json when you finish a pass, or the next
// person will trust a stale answer.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, cpSync } from "node:fs";
import path from "node:path";
import { Marked } from "marked";

const root = process.cwd();
const srcDir = path.join(root, "wiki");
const outDir = path.join(root, "public", "wiki");
const sitemapPath = path.join(root, "public", "sitemap.xml");

const SITE = "https://openhistoria.com";
const GTAG = "G-H9EQ4JFZXZ";               // same property as the landing page and the guides
const OG_IMAGE = "https://raw.githubusercontent.com/Open-Historia/open-historia/main/public/loading_screen.jpg";

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The game is under active development on two channels at once, so any page here can be
// overtaken between one release and the next. Rather than a vague "may be out of date", every
// page carries the date and the two commits the wiki was last checked against — the same record
// wiki:check reads, so the note cannot drift from the truth and cannot be forgotten.
const prov = JSON.parse(readFileSync(path.join(srcDir, "provenance.json"), "utf8"));
const verified = prov.verifiedAgainst || {};
const verifiedNote = [
  verified.date ? `Last checked against the game on <b>${esc(verified.date)}</b>` : "Last checked against the game",
  verified.main ? `main <code>${esc(verified.main.slice(0, 8))}</code>` : null,
  verified.beta ? `beta <code>${esc(verified.beta.slice(0, 8))}</code>` : null,
].filter(Boolean).join(" · ");


// Heading ids double as the on-page TOC anchors and as the fragment in a shared link, so they
// have to stay stable across rebuilds — derived from the text alone, never from position.
const slugify = (s) => String(s)
  .toLowerCase()
  .replace(/<[^>]*>/g, "")
  .replace(/[^\w\s-]/g, "")
  .trim()
  .replace(/\s+/g, "-")
  .slice(0, 60) || "section";

const stripTags = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// marked has already HTML-escaped the heading text by the time the renderer sees it, so the
// stored form must be decoded back to plain text — otherwise esc() runs over it a second time
// and an apostrophe reaches the contents list as a literal "&#39;".
const decodeEntities = (s) => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&");

// ---------------------------------------------------------------- load the nav

if (!existsSync(path.join(srcDir, "nav.json"))) {
  console.error("wiki/nav.json is missing — it is the source of truth for page order, the sidebar and the sitemap.");
  process.exit(1);
}
const nav = JSON.parse(readFileSync(path.join(srcDir, "nav.json"), "utf8"));

// One flat, ordered list drives prev/next paging; the hub is always first.
const pages = [{ ...nav.hub, url: "/wiki/", section: null, nav: nav.hub.nav || "Overview" }];
for (const section of nav.sections) {
  for (const page of section.pages) {
    pages.push({ ...page, url: `/wiki/${page.slug}/`, section: section.title });
  }
}

const seen = new Set();
for (const page of pages) {
  if (seen.has(page.url)) { console.error(`wiki/nav.json: duplicate page url ${page.url}`); process.exit(1); }
  seen.add(page.url);
  if (!existsSync(path.join(srcDir, page.file))) {
    console.error(`wiki/nav.json lists ${page.file}, which does not exist under wiki/.`);
    process.exit(1);
  }
}

// Every .md under wiki/ must be reachable from the nav. A page nobody links is a page nobody
// reads, and it would silently miss the sidebar, the sitemap and the search index.
const listed = new Set(pages.map((p) => p.file.replace(/\\/g, "/")));
const walk = (dir, prefix = "") => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full, `${prefix}${name}/`) : [`${prefix}${name}`];
});
const orphans = walk(srcDir).filter((f) => f.endsWith(".md") && !listed.has(f));
if (orphans.length > 0) {
  console.error(`Unreferenced wiki page(s): ${orphans.join(", ")} — add them to wiki/nav.json or delete them.`);
  process.exit(1);
}

// ---------------------------------------------------------------- markdown

// Collected per page, then reset — marked has no per-parse state we can hang this off.
let headings = [];

const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      // h1 is the page title, rendered from nav.json above the body — a second one in the
      // markdown would be a duplicate, so only h2/h3 get ids and TOC entries.
      if (depth === 1) return `<h1>${text}</h1>\n`;
      const id = slugify(stripTags(text));
      if (depth === 2 || depth === 3) headings.push({ depth, id, text: decodeEntities(stripTags(text)) });
      return `<h${depth} id="${id}">${text}</h${depth}>\n`;
    },
  },
});

// Wide tables must scroll inside their own box rather than pushing the whole page sideways —
// the systems pages carry some genuinely wide reference tables. Done as a post-pass rather than
// a custom table renderer so the stock GFM table output is used verbatim.
const wrapTables = (html) => html.replace(/<table>[\s\S]*?<\/table>/g, (t) => `<div class="table-scroll">${t}</div>`);

// ---------------------------------------------------------------- page shell

const sidebarHtml = (current) => {
  const item = (page) => {
    const on = page.url === current;
    // Beta-only pages are marked in the sidebar too — a reader on the stable build should be
    // able to see that a feature is not missing from their game by accident.
    const chip = page.beta ? ' <em>beta</em>' : "";
    return `<li><a href="${page.url}"${on ? ' class="on" aria-current="page"' : ""}>${esc(page.nav)}${chip}</a></li>`;
  };
  const hub = pages[0];
  const sections = nav.sections.map((section) => `
        <li class="sec">
          <span>${esc(section.title)}</span>
          <ul>${section.pages.map((p) => item(pages.find((q) => q.url === `/wiki/${p.slug}/`))).join("")}</ul>
        </li>`).join("");
  return `<ul class="wiki-nav">
        <li class="sec"><ul>${item(hub)}</ul></li>${sections}
      </ul>`;
};

const tocHtml = (list) => {
  // A two-entry contents list is noise, not navigation.
  if (list.filter((h) => h.depth === 2).length < 2) return "";
  const items = list.map((h) =>
    `<li class="d${h.depth}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join("");
  return `<nav class="wiki-toc" aria-label="On this page"><b>On this page</b><ul>${items}</ul></nav>`;
};

const pagerHtml = (index) => {
  const prev = pages[index - 1];
  const next = pages[index + 1];
  if (!prev && !next) return "";
  return `<nav class="wiki-pager" aria-label="Pagination">
        ${prev ? `<a class="prev" href="${prev.url}"><span>← Previous</span><b>${esc(prev.nav)}</b></a>` : "<span></span>"}
        ${next ? `<a class="next" href="${next.url}"><span>Next →</span><b>${esc(next.nav)}</b></a>` : "<span></span>"}
      </nav>`;
};

const breadcrumbJsonLd = (page) => {
  const items = [
    { name: "Open Historia", item: `${SITE}/` },
    { name: "Wiki", item: `${SITE}/wiki/` },
  ];
  if (page.url !== "/wiki/") items.push({ name: page.title, item: SITE + page.url });
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.item })),
  }, null, 2);
};

const renderPage = (page, index, body, toc) => {
  const url = SITE + page.url;
  const title = page.url === "/wiki/" ? `${page.title} — Open Historia` : `${page.title} — Open Historia Wiki`;
  const crumbTail = page.url === "/wiki/"
    ? `<span aria-hidden="true">/</span> Wiki`
    : `<span aria-hidden="true">/</span> <a href="/wiki/">Wiki</a> <span aria-hidden="true">/</span> ${esc(page.title)}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GTAG}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());

    gtag('config', '${GTAG}');
  </script>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#e9dcc0" />
  <link rel="icon" type="image/jpeg" href="/logo.png" />
  <title>${esc(title)}</title>
  <link rel="canonical" href="${url}" />
  <meta name="description" content="${esc(page.description)}" />

  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Open Historia" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="${esc(page.title)} — Open Historia Wiki" />
  <meta property="og:description" content="${esc(page.description)}" />
  <meta property="og:image" content="${OG_IMAGE}" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="1280" />
  <meta property="og:image:height" content="720" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(page.title)} — Open Historia Wiki" />
  <meta name="twitter:description" content="${esc(page.description)}" />
  <meta name="twitter:image" content="${OG_IMAGE}" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap" />
  <link rel="stylesheet" href="/wiki.css" />

  <script type="application/ld+json">
${breadcrumbJsonLd(page)}
  </script>
</head>
<body>
<header>
  <div class="wrap nav">
    <a class="brand" href="/"><span class="globe">🏛️</span> Open Historia</a>
    <nav class="nav-links">
      <a href="/#features">Features</a>
      <a class="nav-keep" href="/wiki/">Wiki</a>
      <a href="/#download">Download</a>
      <a href="https://github.com/Open-Historia/open-historia" target="_blank" rel="noopener">GitHub</a>
      <a class="nav-cta" href="/play/">▶ Play</a>
    </nav>
  </div>
</header>

<div class="wrap wiki-layout">
  <aside class="wiki-sidebar">
    <div class="wiki-search">
      <input type="search" id="wikiSearch" placeholder="Search the wiki…" aria-label="Search the wiki" autocomplete="off" />
      <ul id="wikiResults" hidden></ul>
    </div>
    ${sidebarHtml(page.url)}
  </aside>

  <main class="wiki-main">
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <a href="/">Open Historia</a> ${crumbTail}
    </nav>
    <h1>${esc(page.title)}</h1>
    <p class="tagline">${esc(page.description)}</p>
    ${page.beta ? `<p class="beta-note"><b>Beta channel only.</b> This system is not in the stable release yet. To try it, install the
      <a href="https://github.com/Open-Historia/open-historia/releases/tag/desktop-beta">beta build</a>, which installs alongside
      the stable app and keeps its own saves.</p>` : ""}
    ${toc}
    ${body}
    ${pagerHtml(index)}
    <p class="wiki-stale">Open Historia is under active development on two channels, and this
      wiki is written by hand — a page can fall behind a release. ${verifiedNote}. If something
      here does not match what you see in the game, trust the game and
      <a href="https://discord.gg/QaqAK7fQAg" target="_blank" rel="noopener">say so on Discord</a>.</p>
  </main>
</div>

<footer>
  <div class="wrap">
    <span class="globe">🏛️</span> <b>Open Historia</b> · MIT licensed ·
    <a href="/">Home</a> ·
    <a href="/wiki/">Wiki</a> ·
    <a href="https://github.com/Open-Historia/open-historia" target="_blank" rel="noopener">GitHub</a> ·
    <a href="https://discord.gg/QaqAK7fQAg" target="_blank" rel="noopener">Discord</a> ·
    <a href="/sitemap.xml">Sitemap</a>
  </div>
</footer>

<script>
// Client-side search over a generated index — no dependency, no server, no network call.
// The index is small enough (a few tens of KB) that a plain substring scan is instant.
(function () {
  var input = document.getElementById("wikiSearch");
  var list = document.getElementById("wikiResults");
  if (!input || !list) return;
  var index = null, pending = false;

  function load() {
    if (index || pending) return;
    pending = true;
    fetch("/wiki/search-index.json")
      .then(function (r) { return r.json(); })
      .then(function (data) { index = data; pending = false; render(); })
      .catch(function () { pending = false; });
  }

  function render() {
    var q = input.value.trim().toLowerCase();
    if (!q || !index) { list.hidden = true; list.innerHTML = ""; return; }
    var hits = [];
    for (var i = 0; i < index.length && hits.length < 12; i++) {
      var page = index[i];
      if (page.haystack.indexOf(q) === -1) continue;
      // A title match is what the reader almost always meant, so float those first.
      hits.push({ page: page, rank: page.title.toLowerCase().indexOf(q) === -1 ? 1 : 0 });
    }
    hits.sort(function (a, b) { return a.rank - b.rank; });
    if (hits.length === 0) {
      list.innerHTML = "<li class='none'>No matches</li>";
    } else {
      list.innerHTML = hits.map(function (h) {
        return "<li><a href='" + h.page.url + "'>" + h.page.title +
               "<span>" + (h.page.section || "Wiki") + "</span></a></li>";
      }).join("");
    }
    list.hidden = false;
  }

  input.addEventListener("focus", load);
  input.addEventListener("input", function () { load(); render(); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { input.value = ""; list.hidden = true; input.blur(); }
    if (e.key === "Enter") { var a = list.querySelector("a"); if (a) window.location.href = a.getAttribute("href"); }
  });
  document.addEventListener("click", function (e) {
    if (!list.hidden && !input.contains(e.target) && !list.contains(e.target)) list.hidden = true;
  });
})();
</script>
</body>
</html>
`;
};

// ---------------------------------------------------------------- build

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const searchIndex = [];
const internalLinks = [];

pages.forEach((page, index) => {
  headings = [];
  const md = readFileSync(path.join(srcDir, page.file), "utf8");
  const body = wrapTables(marked.parse(md));
  const toc = tocHtml(headings);

  for (const m of body.matchAll(/href="(\/wiki\/[^"#]*)/g)) internalLinks.push({ from: page.file, to: m[1] });

  const dir = page.url === "/wiki/" ? outDir : path.join(outDir, page.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), renderPage(page, index, body, toc), "utf8");

  const text = stripTags(body).toLowerCase();
  searchIndex.push({
    url: page.url,
    title: page.title,
    section: page.section,
    // Title, headings and the opening prose are what a reader searches by; indexing the whole
    // page would balloon the file for matches nobody scrolls to.
    haystack: [page.title, page.description, headings.map((h) => h.text).join(" "), text.slice(0, 1200)]
      .join(" ").toLowerCase(),
  });
});

// A typo'd internal link is invisible until a reader hits a 404, so fail the build on it.
const known = new Set(pages.map((p) => p.url));
const broken = internalLinks.filter((l) => !known.has(l.to.endsWith("/") ? l.to : `${l.to}/`));
if (broken.length > 0) {
  for (const b of broken) console.error(`Broken wiki link in ${b.from}: ${b.to}`);
  process.exit(1);
}

const imgSrc = path.join(srcDir, "img");
if (existsSync(imgSrc)) {
  cpSync(imgSrc, path.join(outDir, "img"), { recursive: true });
}

writeFileSync(path.join(outDir, "search-index.json"), JSON.stringify(searchIndex), "utf8");

// ---------------------------------------------------------------- sitemap

// Regenerated from nav.json every build. It used to be hand-maintained, which is exactly how a
// sitemap ends up advertising URLs that no longer exist.
const urls = [
  ...(nav.extraSitemap || []),
  ...pages.map((p) => ({ loc: p.url, changefreq: "monthly", priority: p.url === "/wiki/" ? "0.9" : "0.7" })),
];
writeFileSync(sitemapPath, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${SITE}${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>
`, "utf8");

console.log(`Built public/wiki/: ${pages.length} page(s), search index, sitemap with ${urls.length} URL(s).`);
