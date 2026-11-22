import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authoringCardStyle, authoringShellStyle, authoringHeaderStyle, authoringInputStyle, authoringOptionStyle, authoringSelectedStyle } from "./scenarioAuthoringStyles.js";
import { uiThemeTokens, UI_THEME_PRESETS } from "../../runtime/uiTheme.js";
const read=f=>readFileSync(new URL(f,import.meta.url),"utf8");
test("scenario authoring surfaces use the same editor card, shell, heading and control styles",()=>{
 for(const f of ["PoliticalWorldAuthoringPanel.jsx","InstitutionAuthoringPanel.jsx","DiplomaticRelationsAuthoringPanel.jsx"]){
  const source=read(f);
  for(const style of ["authoringCardStyle","authoringCardRow","authoringCardCopy","authoringShellStyle","authoringHeaderStyle","authoringInputStyle","authoringOptionStyle","authoringHeadingStyle"])assert.ok(source.includes(style),f+" "+style);
  assert.doesNotMatch(source,/rgba\(24,24,27,0\.(?:985|96)\)|#1a1b1f/);
 }
 assert.match(read("libraryBar.jsx"),/const editorCardStyle = authoringCardStyle/);
 assert.match(read("PoliticalWorldGenerationPanel.jsx"),/const panelStyle = authoringCardStyle/);
 const picker=read("InstitutionsWorkspace.jsx").split("export const PolityMultiPicker =")[1].split("const FoundInstitutionForm =")[0];
 assert.doesNotMatch(picker,/rgba\(20,20,25|rgba\(8,8,12/);
 assert.match(picker,/var\(--oh-grey-surface\)/);
});
test("every supported preset supplies all shared modal and form chrome colors",()=>{
 assert.equal(authoringShellStyle.background,"var(--oh-grey-bg)");
 assert.equal(authoringHeaderStyle.background,"var(--oh-grey-surface)");
 assert.equal(authoringInputStyle.background,"var(--oh-grey-raised)");
 assert.equal(authoringOptionStyle.backgroundColor,"var(--oh-grey-surface)");
 assert.equal(authoringCardStyle.background,"var(--oh-ui-raised, #171a22)");
 assert.match(authoringSelectedStyle.borderColor,/--oh-ui-accent/);
 for(const {id,colors} of UI_THEME_PRESETS){
  const tokens=uiThemeTokens({preset:id});
  assert.equal(tokens["--oh-grey-bg"],colors.background);
  assert.equal(tokens["--oh-grey-surface"],colors.surface);
  assert.equal(tokens["--oh-ui-accent"],colors.accent);
  assert.notEqual(tokens["--oh-grey-bg"],tokens["--oh-grey-raised"]);
 }
});
