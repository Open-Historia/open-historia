import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("institution council is an embedded tab pane, not a routed full-chat takeover", () => {
  const chat = read("./chat.jsx");
  const workspace = read("./InstitutionsWorkspace.jsx");

  assert.match(chat, /activeChat && !activeChat\.institutionId/);
  assert.match(chat, /embeddedInstitution/);
  assert.match(chat, /renderCouncil=\{\(channel\) =>/);
  assert.match(workspace, /data-institution-council-pane="embedded"/);
  assert.match(workspace, /renderCouncil\(selectedChannel\)/);
});

test("institution identity, facts and navigation remain outside the council scroll area", () => {
  const workspace = read("./InstitutionsWorkspace.jsx");

  assert.match(workspace, /data-institution-shell="persistent"/);
  assert.match(workspace, /data-institution-header="persistent"/);
  assert.match(workspace, /data-institution-facts="persistent"/);
  assert.match(workspace, /data-institution-tabs="persistent"/);
  assert.match(workspace, /\[\["overview", "Overview"\], \["council", "Council"\]/);
  assert.match(workspace, /overflowY: section === "council" \? "hidden" : "auto"/);
});

test("only the council message pane auto-scrolls when the conversation grows", () => {
  const chat = read("./chat.jsx");

  assert.match(chat, /const messagesScrollRef\s*= useRef\(null\)/);
  assert.match(chat, /scroller\.scrollTo\(\{ top: scroller\.scrollHeight, behavior: "smooth" \}\)/);
  assert.match(chat, /data-institution-council-scroll=\{isInstitutionCouncil \? "messages" : undefined\}/);
  assert.doesNotMatch(chat, /messagesEndRef\.current\?\.scrollIntoView/);
});

test("institution council visibility participates in read and toast suppression without becoming activeChat", () => {
  const chat = read("./chat.jsx");
  const workspace = read("./InstitutionsWorkspace.jsx");

  assert.match(chat, /visibleCouncilChatId/);
  assert.match(chat, /onCouncilVisibleChange=\{setVisibleCouncilChatId\}/);
  assert.match(chat, /: visibleCouncilChatId;/);
  assert.match(workspace, /onCouncilVisibleChange\?\.\(visibleCouncilId\)/);
});

test("formal action prompts stay pinned above the embedded council pane", () => {
  const workspace = read("./InstitutionsWorkspace.jsx");

  assert.match(workspace, /section === "council" && selectedPendingActions > 0/);
  assert.match(workspace, /Action required/);
  assert.match(workspace, /Review agenda →/);
});
