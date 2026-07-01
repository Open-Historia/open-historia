// One-shot inspector: dumps the region catalog so specs can be authored against
// real GID_1 codes. Usage:
//   node scripts/presets/lib/dumpCatalog.mjs            -> summary + per-country counts
//   node scripts/presets/lib/dumpCatalog.mjs CZE ITA    -> detailed region lists for those GID_0
import { loadRegionCatalog, buildCountryRegionIndex } from "./regionCatalog.mjs";

const wanted = process.argv.slice(2).map((s) => s.toUpperCase());
const catalog = await loadRegionCatalog();
const index = buildCountryRegionIndex(catalog);

console.log(`Total regions: ${catalog.length}`);
console.log(`Total countries (GID_0): ${index.size}`);

if (wanted.length === 0) {
  // Country-level summary: GID_0  COUNTRY  regionCount
  const byCountry = new Map();
  for (const row of catalog) {
    if (!byCountry.has(row.GID_0)) byCountry.set(row.GID_0, { country: row.COUNTRY, n: 0 });
    byCountry.get(row.GID_0).n += 1;
  }
  const rows = [...byCountry.entries()].sort((a, b) => String(a[0]).localeCompare(b[0]));
  for (const [gid0, { country, n }] of rows) {
    console.log(`${String(gid0).padEnd(5)} ${String(n).padStart(4)}  ${country}`);
  }
} else {
  for (const gid0 of wanted) {
    const rows = catalog
      .filter((r) => r.GID_0 === gid0)
      .sort((a, b) => String(a.GID_1).localeCompare(String(b.GID_1), undefined, { numeric: true }));
    console.log(`\n=== ${gid0} (${rows[0]?.COUNTRY ?? "?"}) — ${rows.length} regions ===`);
    for (const r of rows) {
      console.log(`  ${String(r.GID_1).padEnd(12)} ${String(r.HASC_1 ?? "").padEnd(8)} ${r.NAME_1}`);
    }
  }
}
