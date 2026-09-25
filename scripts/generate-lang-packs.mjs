/*! Open Historia — language pack generator © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Fills public/lang/<code>.json from public/lang/catalog-en.json, and
// public/lang/prompts/<code>.json from public/lang/prompts/catalog-en.json (the
// default prompts' guidance passages), using any OpenAI-compatible chat
// endpoint. Build the catalogs first: node scripts/i18n/build-catalog.mjs
// (docs/i18n.md).
//
// A language with a shipped pack never sends the interface to the player's AI
// (translator.js), so the pack must hold every catalog string. This makes one
// headlessly: catalog in, pack out.
//
// Incremental by default: a string already present in a pack is never re-sent, so
// re-running after adding UI strings only pays for the new ones. --force retranslates.
// Entries the catalog no longer has are dropped. A translation that loses a
// placeholder ({{count}}, ${PLAYER_POLITY}) is not written, so a re-run retries it.
//
//   OH_LLM_BASE_URL=http://localhost:8080/v1 \
//   OH_LLM_KEY=... OH_LLM_MODEL=nemotron-3-super \
//   node scripts/generate-lang-packs.mjs --lang es,fr
//   node scripts/generate-lang-packs.mjs --all          # every language in LANGUAGES
//   node scripts/generate-lang-packs.mjs --lang de --dry-run
//
// The key is read from the environment and never written to disk or logged — packs
// are committed, so nothing secret may reach them.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const LANG_DIR = path.join(ROOT, "public", "lang");
const CATALOG = path.join(LANG_DIR, "catalog-en.json");
const PROMPT_DIR = path.join(LANG_DIR, "prompts");
const PROMPT_CATALOG = path.join(PROMPT_DIR, "catalog-en.json");

// What must survive translation unchanged: pattern slots, prompt placeholders.
const tokensOf = (text) => [
  ...(text.match(/\{\{[^{}]+\}\}/g) ?? []),
  ...(text.match(/\$\{[^{}]+\}/g) ?? []),
].sort().join(" ");

const BASE_URL = (process.env.OH_LLM_BASE_URL || "").replace(/\/$/, "");
const API_KEY = process.env.OH_LLM_KEY || "";
const MODEL = process.env.OH_LLM_MODEL || "";

// Batch size is a correctness knob, not just a speed one: the model must return
// exactly one translation per input, in order. Large batches drift out of
// alignment and get the whole batch rejected below.
const BATCH = Number(process.env.OH_LLM_BATCH) || 25;
const RETRIES = 3;

// code -> endonym (the language's own name). The endonym matters: models translate
// noticeably better when asked for "Deutsch" than for "German".
const LANGUAGES = {
  ar: "العربية", bn: "বাংলা", de: "Deutsch", es: "Español", fa: "فارسی",
  fr: "Français", hi: "हिन्दी", id: "Bahasa Indonesia", it: "Italiano",
  ja: "日本語", ko: "한국어", nl: "Nederlands", pl: "Polski", pt: "Português",
  ru: "Русский", sv: "Svenska", th: "ไทย", tr: "Türkçe", uk: "Українська",
  ur: "اردو", vi: "Tiếng Việt", zh: "中文",
};

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
};

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const argValue = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const chat = async (messages) => {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0, max_tokens: 4096 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("No content in response");
  return content;
};

// Models like to wrap JSON in prose or a fence however firmly you ask them not to.
const extractArray = (text) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("No JSON array in reply");
  const parsed = JSON.parse(body.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("Reply was not an array");
  return parsed;
};

const translateBatch = async (strings, code, endonym) => {
  const system =
    "You translate user-interface strings for a historical strategy game. " +
    "Reply with ONLY a JSON array of strings — no prose, no code fence, no keys. " +
    "Return exactly one translation per input, in the same order. " +
    "Preserve every placeholder EXACTLY as-is: {{name}} slots (the game fills them " +
    "with numbers and names; move them where your grammar needs them), ${NAME}, %s, " +
    "and HTML tags. " +
    "Keep translations short: these are buttons and labels, and a long string " +
    "breaks the layout. " +
    // Do NOT say "leave proper nouns unchanged". Most of this catalog is country
    // and polity names, and those are exactly what needs localising — a German
    // player expects Albanien and Abbasidenkalifat, not Albania and Abbasid
    // Caliphate. That instruction left 56% of the German pack in English, versus
    // 18% in the hand-made es/fr packs.
    "Country, empire, polity and place names MUST use the standard, conventional " +
    "name for that place in the target language (e.g. into German: Albania -> " +
    "Albanien, Abbasid Caliphate -> Abbasidenkalifat). Localise dates and eras to " +
    "the target language's conventions. Return a string unchanged ONLY when that " +
    "language genuinely uses the identical form.";
  const user =
    `Translate these ${strings.length} UI strings into ${endonym} (${code}).\n\n` +
    JSON.stringify(strings, null, 0);

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const out = extractArray(await chat([
        { role: "system", content: system },
        { role: "user", content: user },
      ]));
      // A misaligned batch would silently pair string N with translation N+1 and
      // poison the pack, so reject the batch rather than guess at a repair.
      if (out.length !== strings.length) {
        throw new Error(`got ${out.length} translations for ${strings.length} strings`);
      }
      return out.map((t) => (typeof t === "string" ? t : ""));
    } catch (error) {
      if (attempt === RETRIES) {
        console.warn(`      batch failed after ${RETRIES} tries: ${error.message}`);
        return null;
      }
    }
  }
  return null;
};

// The prompts' guidance: instructions for the model that runs the world, so
// faithfulness over brevity, one passage a request.
const translatePassage = async (passage, code, endonym) => {
  const system =
    "You translate instructions written for an AI model that runs a historical " +
    `strategy game into ${endonym} (${code}). The model will read your translation ` +
    "instead of the English, so keep every rule, nuance, example and emphasis; do not " +
    "summarise or add anything. Keep every ${PLACEHOLDER} exactly as written. Translate " +
    "section headings in square brackets but keep the brackets. Keep the line breaks, " +
    "bullets and **bold**. Reply with ONLY the translated text.";
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const out = (await chat([
        { role: "system", content: system },
        { role: "user", content: passage },
      ])).trim();
      if (tokensOf(out) !== tokensOf(passage)) throw new Error("a placeholder was lost");
      return out;
    } catch (error) {
      if (attempt === RETRIES) {
        console.warn(`      passage failed after ${RETRIES} tries: ${error.message}`);
        return null;
      }
    }
  }
  return null;
};

const generatePrompts = async (code, passages, { dryRun, force }) => {
  const endonym = LANGUAGES[code] || code;
  const packPath = path.join(PROMPT_DIR, `${code}.json`);
  const existing = readJson(packPath, {});
  const todo = force ? passages : passages.filter((p) => !existing[p]);
  console.log(`  ${code} prompts: ${todo.length} of ${passages.length} passages to translate`);
  if (dryRun) return 0;
  const pack = Object.fromEntries(passages.filter((p) => existing[p]).map((p) => [p, existing[p]]));
  let added = 0;
  for (const passage of todo) {
    const out = await translatePassage(passage, code, endonym);
    if (out) { pack[passage] = out; added += 1; }
  }
  const sorted = Object.fromEntries(Object.keys(pack).sort().map((k) => [k, pack[k]]));
  fs.mkdirSync(PROMPT_DIR, { recursive: true });
  fs.writeFileSync(packPath, JSON.stringify(sorted));
  return added;
};

const generate = async (code, catalog, { dryRun, force }) => {
  const endonym = LANGUAGES[code] || code;
  const packPath = path.join(LANG_DIR, `${code}.json`);
  const existing = readJson(packPath, {});
  const todo = force ? catalog : catalog.filter((s) => !existing[s]);

  if (todo.length === 0) {
    console.log(`  ${code} (${endonym}): already complete — ${Object.keys(existing).length} strings`);
    return { code, added: 0, total: Object.keys(existing).length };
  }
  console.log(`  ${code} (${endonym}): ${todo.length} to translate (${Object.keys(existing).length} already done)`);
  if (dryRun) return { code, added: 0, total: Object.keys(existing).length, dryRun: true };

  // Only what the catalog still has.
  const pack = Object.fromEntries(catalog.filter((s) => existing[s]).map((s) => [s, existing[s]]));
  let added = 0, failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    const out = await translateBatch(slice, code, endonym);
    if (!out) { failed += slice.length; continue; }
    slice.forEach((src, n) => {
      const t = (out[n] || "").trim();
      if (!t) return;
      if (tokensOf(t) !== tokensOf(src)) { failed += 1; return; }
      pack[src] = t;
      added += 1;
    });
    process.stdout.write(`      ${Math.min(i + BATCH, todo.length)}/${todo.length}\r`);
  }

  // Sorted so a regenerated pack diffs cleanly instead of reshuffling every line.
  const sorted = Object.fromEntries(Object.keys(pack).sort().map((k) => [k, pack[k]]));
  fs.writeFileSync(packPath, JSON.stringify(sorted));
  console.log(`      wrote ${code}.json — ${Object.keys(sorted).length} strings (+${added}${failed ? `, ${failed} failed` : ""})`);
  return { code, added, failed, total: Object.keys(sorted).length };
};

const main = async () => {
  if (!BASE_URL || !MODEL) {
    console.error("Set OH_LLM_BASE_URL and OH_LLM_MODEL (and OH_LLM_KEY if the endpoint needs one).");
    process.exit(1);
  }
  const catalog = readJson(CATALOG, null);
  if (!Array.isArray(catalog)) {
    console.error(`Catalog missing or not an array: ${CATALOG}`);
    process.exit(1);
  }

  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const only = argValue("--lang");
  const codes = hasFlag("--all")
    ? Object.keys(LANGUAGES)
    : (only ? only.split(",").map((s) => s.trim()).filter(Boolean) : []);

  if (codes.length === 0) {
    console.error("Pass --lang <code[,code]> or --all.");
    process.exit(1);
  }

  const passages = readJson(PROMPT_CATALOG, []);
  console.log(`Catalog: ${catalog.length} strings, ${passages.length} prompt passages — model ${MODEL} at ${BASE_URL}`);
  const results = [];
  for (const code of codes) {
    results.push(await generate(code, catalog, { dryRun, force }));
    if (Array.isArray(passages) && passages.length) await generatePrompts(code, passages, { dryRun, force });
  }

  const totalFailed = results.reduce((n, r) => n + (r.failed || 0), 0);
  console.log(`\nDone: ${results.length} language(s), +${results.reduce((n, r) => n + r.added, 0)} strings` +
    (totalFailed ? `, ${totalFailed} FAILED (re-run to retry — it only re-sends what's missing)` : ""));
};

main().catch((error) => { console.error(error.message); process.exit(1); });
