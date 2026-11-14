import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Read as LF whatever the checkout's line endings: a function is cut out of it
// by the closing brace on a line of its own.
const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const prompts = fs.readFileSync(new URL("./gameplayPrompts.js", import.meta.url), "utf8");

test("generated Political Actor operations are dry-run against scratch canonical state before acceptance", () => {
  assert.match(gameplay, /politicalValidationWorld/);
  assert.match(gameplay, /applyPoliticalActorOperation\(politicalValidationWorld, operation\)/);
  assert.match(gameplay, /nativeOutcome\?\.applied/);
  assert.match(gameplay, /was refused: \$\{reason\}/);
});

test("GM prompt receives exact current Political Actor ids only for relevant request context", () => {
  assert.match(prompts, /gameMasterPoliticalActorContext/);
  assert.match(prompts, /exact ids; reuse existing ids instead of inventing replacements/i);
  assert.match(gameplay, /gameMasterPoliticalActorReferenceContext/);
  assert.match(gameplay, /Canonical parties:/);
  assert.match(gameplay, /id=\$\{JSON\.stringify/);
});

// The polities listed were those whose names were found in the request's text,
// with the player's added only for an English political word ("government",
// "election"). The request is not read now: the player's polity is listed, and
// any other polity's ids come from the political_actor lookup by its exact
// name (or, without the lookups, from the list that follows the player's).
// gameplay.js does not load under bare node, so the function is cut out of it
// and run beside stand-ins for what it reads.
test("the GM's Political Actor references are the player's polity, whatever the request says", () => {
  const start = gameplay.indexOf("const gameMasterPoliticalActorReferenceContext = ");
  const end = gameplay.indexOf("\n};\n", start);
  assert.ok(start > 0 && end > start);
  const source = gameplay.slice(start, end + 3);
  assert.doesNotMatch(source, /request|isPoliticalRequest|includes\(/);
  const actor = (party) => ({ government: { rulingPartyIds: [party] }, parties: [{ id: party, name: party }], powerBlocs: [] });
  const world = { politicalActors: { byPolity: { France: actor("fr-party"), Germany: actor("de-party"), Russia: actor("ru-party") } } };
  const scope = {
    normalizeWorldState: (value) => value,
    getPoliticalProfileKey: (value, polity) => (Object.keys(value.politicalActors.byPolity).includes(polity) ? polity : ""),
    normalizeArray: (value) => (Array.isArray(value) ? value : []),
    normalizeString: (value) => String(value ?? "").trim(),
  };
  const build = new Function(...Object.keys(scope), `${source}\nreturn gameMasterPoliticalActorReferenceContext;`)(...Object.values(scope));
  const withLookups = build(world, "France", { lookups: true });
  assert.match(withLookups, /POLITY: France/);
  assert.match(withLookups, /id="fr-party"/);
  assert.doesNotMatch(withLookups, /POLITY: Germany|POLITY: Russia/);
  assert.match(withLookups, /political_actor lookup, with the polity's exact name/);
  const withoutLookups = build(world, "France", { lookups: false });
  assert.match(withoutLookups, /^[\s\S]*POLITY: France[\s\S]*POLITY: Germany[\s\S]*POLITY: Russia/);
  assert.equal(build(world, "Atlantis", { lookups: true }).includes("No Political Actor is recorded for the player's polity."), true);
});

test("same-event polity rename is mirrored before Political Actor dry-run", () => {
  assert.match(gameplay, /Runtime polity renames are applied before Political Actor operations/);
  assert.match(gameplay, /getPoliticalProfileKey\(politicalValidationWorld, from\)/);
  assert.match(gameplay, /normalizePoliticalActorRecord/);
});
