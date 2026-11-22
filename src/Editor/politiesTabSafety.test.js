import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;
const source = readFileSync(new URL("./PolitiesPanel.jsx", import.meta.url), "utf8");

const guardChainFor = (visibleText) => {
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const matches = [];
  traverse(ast, {
    JSXText(path) {
      if (path.node.value.trim() !== visibleText) return;
      const guards = [];
      let current = path.parentPath;
      while (current) {
        const node = current.node;
        if (node.type === "LogicalExpression" && node.operator === "&&") {
          guards.push(source.slice(node.left.start, node.left.end));
        }
        current = current.parentPath;
      }
      matches.push(guards);
    },
  });
  assert.equal(matches.length, 1, `Expected exactly one ${visibleText} UI action`);
  return matches[0];
};

test("destructive country deletion is visible only under Create & manage, never Government & forces", () => {
  const guards = guardChainFor("Remove from the map");
  assert.ok(guards.some((guard) => guard.includes('detailsTab === "manage"')),
    "Country deletion must be inside the Manage tab");
  assert.ok(!guards.some((guard) => guard.includes('detailsTab === "governance"')),
    "Country deletion must not depend on the Government & forces tab");
});

test("new polity setup is accessible directly from Polities, even with a polity selected", () => {
  const createGuards = guardChainFor("+ Create polity");
  assert.ok(!createGuards.some((guard) => guard.includes('detailsTab === "manage"')),
    "Create should not be buried beneath the selected polity's Manage tab");
  const rosterGuards = guardChainFor("Bulk polity roster");
  assert.ok(rosterGuards.some((guard) => guard.includes('detailsTab === "manage"')),
    "Existing roster management remains available in its native section");
  assert.match(source, /if \(creating\) \{/);
  assert.match(source, /<CountryCreationForm/);
  assert.doesNotMatch(source, /placeholder="Name, e.g. Austria-Hungary"/,
    "Obsolete name-only quick creation must not survive");
});

test("new country only registers the validated, fully authored draft", () => {
  const planner = readFileSync(new URL("./countryCreationDraft.js", import.meta.url), "utf8");
  assert.match(source, /planCountryDraft\(\{/);
  // A country must never pass through separate registry/appearance/region
  // mutations. One validated document plan and one native history step are
  // the accepted authoring seam.
  const mapEditor = readFileSync(new URL("./MapEditor.jsx", import.meta.url), "utf8");
  assert.match(source, /(?:live\.)?commitCountryDraft\(plan, plan\.assignSelectedRegions \? (?:live\.)?selection : \[\]\)/);
  assert.match(mapEditor, /planMapPolityCreation\(before, plan\)/);
  assert.match(mapEditor, /api\.setRegionAttrs\(ids, \{ owner: plan\.key \}, \{ deferHistory: true \}\)/);
  assert.match(mapEditor, /api\.pushStep\(\{/);
  assert.doesNotMatch(source, /upsertPolity\(plan\.key, plan\.record\)/);
  assert.match(planner, /aliases: configuredNames.aliases/);
  assert.match(planner, /name: key/);
  assert.match(planner, /formerNames: configuredNames.formerNames/);
});

test("bulk transfer requires informed confirmation before selecting or changing the source territory", () => {
  const start = source.indexOf("const transferAll = async () => {");
  const end = source.indexOf("\n  };", start);
  assert.ok(start >= 0 && end > start, "Expected a bounded native transferAll function");
  const body = source.slice(start, end);
  const confirm = body.indexOf("confirmDialog(");
  const select = body.indexOf("api?.selectOwner?.(");
  assert.ok(confirm >= 0 && select > confirm, "Consent must precede even selection side effects");
  assert.match(body, /if \(!ok\) return;/);
  assert.match(body, /regionCount/);
});

test("new country creation opens its real Overview instead of leaving the user in dangerous Manage actions", () => {
  const body = source.slice(source.indexOf("const createPolity = async (draft) => {"), source.indexOf("\n  };", source.indexOf("const createPolity = async (draft) => {")));
  assert.match(body, /setSelectedKey\(plan.key\)/);
  assert.match(body, /setDetailsTab\("overview"\)/);
  assert.match(body, /setCountryListOpen\(false\)/);
  assert.match(body, /setCreating\(false\)/);
});

test("country overview is view-only and all edit sections continue using canonical handlers", () => {
  for (const expected of [
    "renamePolity?.(", "upsertPolity?.(", "api?.setRegionAttrs?.(", "onPaintPolity?.(",
    "setColorOverride?.(", "setTags?.(", "setPuppets", "importPolityRoster(",
    "removePolity?.(", "onOpenFlagPicker?.(",
  ]) assert.ok(source.includes(expected), `Lost native country handler: ${expected}`);
});

test("the polity picker stays tall and independently scrollable when the selected polity has extensive details", () => {
  // Panel.jsx lays out its scrollable body as a flex column. A shrinkable
  // child list gets compressed to 1-2 polity rows beside long Overview cards.
  const list = source.match(/<div style=\{\{([^}]+)\}\}>\s*\{rows\.map\(\(row\) =>/);
  assert.ok(list, "Expected the native polity picker list, not an unrelated regions list");
  assert.match(list[1], /flexShrink:\s*0/, "The picker must not shrink under selected-polity details");
  assert.match(list[1], /maxHeight:\s*"min\(\d+vh, \d+px\)"/,
    "The list must show multiple polities on desktops but scale down for short viewports");
  assert.match(list[1], /overflowY:\s*"auto"/, "The large roster retains its own scrollbar");
  assert.doesNotMatch(list[1], /minHeight:\s*\d+/, "A one-polity roster should not reserve blank vertical space");
});
