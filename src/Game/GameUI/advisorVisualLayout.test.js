import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const advisor = read("./advisor.jsx");
const recipients = read("./AdvisorRecipients.jsx");
const styles = read("./advisorDossier.css");

test("Advisor drawer is a separately styled conversation surface with safe-area geometry intact", () => {
  assert.match(advisor, /import "\.\/advisorDossier\.css";/);
  assert.match(advisor, /className="oh-advisor-drawer"/);
  assert.match(advisor, /className="oh-advisor-header"/);
  assert.match(advisor, /className="oh-advisor-composer"/);
  assert.match(advisor, /SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP/);
  assert.match(advisor, /position: "fixed", top: 0, bottom: 0, right: 0/);
  assert.match(advisor, /ADVISOR_SLIDE/);
  assert.match(styles, /\.oh-advisor-drawer\s*\{/);
  assert.match(styles, /\.oh-advisor-header\s*\{/);
  assert.match(styles, /\.oh-advisor-composer\s*\{/);
  assert.doesNotMatch(styles, /(?:linear|radial|conic)-gradient\s*\(/i);
});

test("Conversation rows are unboxed for narration but user/error roles stay distinguishable", () => {
  assert.match(advisor, /const AdvisorMessageRow = React\.memo\(/);
  assert.match(advisor, /const AdvisorMessageList = React\.memo\(/);
  assert.match(advisor, /className="oh-advisor-message-row" data-role=\{msg\.role\}/);
  assert.match(advisor, /className="oh-advisor-message-body" data-role=\{msg\.role\}/);
  assert.match(styles, /\.oh-advisor-message-body\[data-role="advisor"\]/);
  assert.match(styles, /\.oh-advisor-message-body\[data-role="user"\]/);
  assert.match(styles, /\.oh-advisor-message-body\[data-role="error"\]/);
  assert.match(advisor, /<AdvisorReplyBody/);
  assert.match(advisor, /<AdvisorChart config=\{chartConfig\}/);
  assert.match(advisor, /<AdvisorActionProposalCard/);
  assert.match(advisor, /<AdvisorDocumentNotice/);
  assert.match(styles, /\.oh-advisor-message-body \.advisor-markdown/);
  assert.match(styles, /\.oh-advisor-message-body \.advisor-markdown blockquote/);
});

test("Conversation picker is a low-chrome ledger and preserves contact maintenance and privacy", () => {
  assert.match(recipients, /className="oh-advisor-recipients"/);
  assert.match(recipients, /className="oh-advisor-recipient-trigger"/);
  assert.match(recipients, /className="oh-advisor-contact-list"/);
  assert.match(recipients, /className="oh-advisor-contact-row"/);
  assert.match(recipients, /className="oh-advisor-contact-select"/);
  assert.match(recipients, /className="oh-advisor-contact-action"/);
  assert.match(recipients, /aria-expanded=\{expanded\}/);
  assert.match(recipients, /onSelect\(CHIEF_ADVISOR_THREAD\)/);
  assert.match(recipients, /onSelect\(contact\.id\)/);
  assert.match(recipients, /onClick=\{openChiefEditor\}/);
  assert.match(recipients, /onClick=\{\(\) => openEditor\(contact\)\}/);
  assert.match(recipients, /onClick=\{\(\) => contact\.archived \? retire\(contact, false\)/);
  assert.match(recipients, /This character uses only the public scenario timeline and their own conversation history/);
  assert.match(styles, /\.oh-advisor-contact-select\[aria-current="true"\]/);
});

test("Composer retains send/key/disabled mechanics but uses a conventional accessible send glyph", () => {
  assert.match(advisor, /className="oh-advisor-composer-input"/);
  assert.match(advisor, /className="oh-advisor-send"/);
  assert.match(advisor, /aria-label="Send message"/);
  assert.match(advisor, /<svg[^>]+aria-hidden="true"/);
  assert.doesNotMatch(advisor, />🚀<\/button>/);
  assert.match(advisor, /onClick=\{handleSend\}/);
  assert.match(advisor, /onKeyDown=\{handleKeyDown\}/);
  assert.match(advisor, /disabled=\{recipientLocked\}/);
  assert.match(advisor, /disabled=\{isLoading \|\| recipientLocked \|\| !hasBootstrapped \|\| loadFailed \|\| saveFailed \|\| !input\.trim\(\)\}/);
  assert.match(styles, /\.oh-advisor-composer-input:focus/);
  assert.match(styles, /\.oh-advisor-send:disabled/);
  assert.match(styles, /@media \(max-width: 450px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
