/*! Open Historia — language-pack catalog builder © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Collects the English strings that seed the shipped language packs
// (public/lang/<code>.json): every country name, the preset scenarios'
// card text, difficulty levels, and the interface's fixed strings.
// Usage: node scripts/i18n/build-catalog.mjs  → public/lang/catalog-en.json
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { loadCountryCatalog } from "../presets/lib/regionCatalog.mjs";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "public", "lang");

// The interface's fixed strings (exact text as rendered).
const UI_STRINGS = [
  // Top bar / library
  "Games", "Scenarios", "Community", "New Game", "Edit", "Clone Scenario",
  "Refresh", "Import JSON", "Open Historia", "Loading Community…",
  // New-game dialog
  "Choose your country", "Choose your difficulty", "How hard should the world fight back?",
  "Scenario default", "Keep scenario default", "Cancel", "Done", "Back",
  "Search countries…",
  // Settings
  "Game Settings", "AI Provider", "Language", "Search languages...", "Fullscreen",
  "3D Globe", "3D Terrain", "Model reasoning", "Cheats", "Discord", "GitHub",
  "Stored only in this browser.",
  // Timeline / events
  "Timeline", "Events", "Auto-jump", "1 week", "1 month", "3 months", "6 months",
  "1 year", "No world events were recorded for this time skip.",
  "No event chain is available yet.", "Next event", "Show on map", "Loading...", "Undated",
  // Chat / actions / forces / advisor
  "Advisor", "No messages yet. Ask your advisor something!", "Ask your advisor...",
  "Clear chat", "Close advisor", "Diplomatic Chats", "Actions", "Forces",
  // Country panel
  "Related Events", "Search events...", "Filters", "All", "Major", "Minor",
  "No events found for this country.", "Details", "Alternative Names", "None",
  "Advisor Report", "Open Diplomacy", "Unclaimed Territory", "No flag available",
  // Map editor — country colour + flag picker
  "Choose flag", "Colour", "Country code that drives the fill color",
  "Go back to this country's standard colour",
  "Already on this map", "My flags", "Built-in flags", "In the game",
  "Use this flag", "Use the standard flag again", "Remove from My flags",
  "Share a flag", "Share this flag with the community", "Open hub ↗",
  "Loading community flags…", "Could not load community flags.",
  "Could not download that flag.", "Could not read that image.",
  "No community flags yet — “⬆ Share a flag” posts one to the hub for everyone.",
  "Opens the hub's flag form — drag your image in and submit", "Posted by the project",
  "Applying…", "Search…",
  // Cheats menu (titles + subtitles)
  "Master AI", "Full control over the game with AI assistance",
  "Your Country", "Change which country you're playing as",
  "Difficulty", "Adjust the game difficulty level",
  "Annex Country", "Click a country to annex it into another",
  "Annex Regions", "Click individual regions to transfer them to a country",
  "Modify existing country properties",
  "Add Country", "Create a new country on the map",
  "Regions", "Edit region names, tags, and properties",
  "Edit Map Feature", "Edit existing map features like cities and landmarks",
  "Add Map Feature", "Create new map features with custom properties",
  "Clear Map Features", "Clean up old and irrelevant features",
  "Edit historical events and their descriptions",
  "Edit Country", "Name", "Color (hex)", "Command", "Execute", "Switch country",
  "Save changes", "Create country", "Save region", "Save event", "Save feature",
  "Place on map", "Search features…", "Search events…", "Title", "Date", "Description",
  "Start clicking the map", "Pick a region on the map",
  // National statistics pane (indices + economy)
  "Stats", "Sovereignty", "Food autonomy", "Energy autonomy", "Economic independence",
  "Internal security", "International reputation", "Stability", "GDP breakdown",
  "Budget balance", "Public debt", "Unemployment", "Inflation", "Agriculture",
  "Industry", "Services", "Surplus", "Deficit",
  // Military units / forces
  "Infantry", "Armor", "Air", "Naval", "Artillery", "Garrison", "Strength",
  // Assorted controls
  "Custom", "Reduce motion", "Unclaimed",
];

const collectSpecStrings = () => {
  const strings = [];
  const dir = path.join(ROOT, "scripts", "presets");
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".spec.mjs")) continue;
    const source = readFileSync(path.join(dir, file), "utf8");
    // Card text fields only — the fields scenario cards render.
    for (const match of source.matchAll(/\b(?:name|description|subtitle|eyebrow|heroTitle|heroSubtitle)\s*:\s*"((?:[^"\\]|\\.)+)"/g)) {
      strings.push(JSON.parse(`"${match[1]}"`));
    }
  }
  return strings;
};

const collectDifficulty = async () => {
  const { DIFFICULTY_LEVELS } = await import(url.pathToFileURL(path.join(ROOT, "src/runtime/difficulty.js")));
  return DIFFICULTY_LEVELS.flatMap((level) => [level.label, level.blurb]);
};

const countries = (await loadCountryCatalog()).map((entry) => entry.COUNTRY).filter(Boolean);
const catalog = [...new Set([
  ...UI_STRINGS,
  ...(await collectDifficulty()),
  ...collectSpecStrings(),
  ...countries,
])].filter((value) => typeof value === "string" && value.trim().length > 1).sort();

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "catalog-en.json"), JSON.stringify(catalog, null, 1));
console.log(`catalog-en.json: ${catalog.length} strings`);
