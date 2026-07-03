/*! Open Historia — country name registry generator © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Emits server/country-names.json (code -> display name) from the countries
// archive. The server uses it to let scenario/map authors write FULL NAMES
// anywhere a country is referenced; names canonicalize to codes internally.
// Usage: node scripts/generate-country-names.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { loadCountryCatalog } from "./presets/lib/regionCatalog.mjs";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const entries = {};
for (const country of await loadCountryCatalog()) {
  if (country.GID_0 && country.COUNTRY) entries[country.GID_0] = country.COUNTRY;
}
const out = path.join(ROOT, "server", "country-names.json");
writeFileSync(out, JSON.stringify(entries, null, 1));
console.log(`server/country-names.json: ${Object.keys(entries).length} countries`);
