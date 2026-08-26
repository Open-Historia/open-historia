// The one markdown renderer the advisor and the diplomacy chat both use.
//
// Both panels used to call ReactMarkdown directly with a short stylesheet each,
// which meant plain CommonMark: no tables, no strikethrough, no task lists — a
// model that reached for a table got a wall of pipes, and one that reached for
// <br> got the literal tag. remark-gfm adds the table/strikethrough/task-list
// half of the vocabulary, normalizeMarkdown (markdownText.js) repairs the HTML
// and block spacing a model gets wrong, and the stylesheet below makes the
// result look like part of the game rather than like a README.
//
// Raw HTML stays OFF (no rehype-raw). Every string rendered here came out of a
// model, and the handful of tags one actually reaches for are already handled by
// normalizeMarkdown; turning raw HTML on to catch the rest would hand model
// output a direct line to the DOM for no gain the player would ever notice.
import React, { useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

import { normalizeMarkdown } from "./markdownText.js";

// remark-breaks makes a single newline a real line break. The panels used to get
// that from `white-space: pre-wrap` on the bubble, which cannot work once there
// are tables and code blocks in the reply (pre-wrap applies to the markup the
// renderer emits, not to the source) — so the bubbles keep pre-wrap for the
// player's own typed text, `.oh-md` below turns it back off, and the line breaks
// come from here instead.
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

// A table in a 20rem side panel will overflow sooner or later; scrolling it
// inside its own box beats forcing the whole panel sideways.
const TableWrap = ({ node, ...props }) => (
    <div className="oh-md-table-wrap"><table {...props} /></div>
);

// Links go to the OS browser (electron/main.cjs's window-open handler sends
// http(s) to shell.openExternal), never in-app.
const ExternalLink = ({ node, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer noopener" />
);

const COMPONENTS = { table: TableWrap, a: ExternalLink };

const markdownStyles = `
.oh-md {
    --oh-md-accent: #3b82f6;
    --oh-md-rule: rgba(255,255,255,0.14);
    --oh-md-dim: rgba(255,255,255,0.62);
    /* The bubbles set pre-wrap for the player's own typed text; inside rendered
       markdown it would double every line break and wreck table layout. */
    white-space: normal;
    overflow-wrap: anywhere;
}
.advisor-markdown { --oh-md-accent: #60a5fa; }
.chat-markdown { --oh-md-accent: #a78bfa; }

.oh-md > *:first-child { margin-top: 0; }
.oh-md > *:last-child { margin-bottom: 0; }

.oh-md p { margin: 0 0 0.5rem 0; }
.oh-md strong { color: rgba(255,255,255,0.97); font-weight: 700; }
.oh-md em { color: rgba(255,255,255,0.78); }
.oh-md del { color: rgba(255,255,255,0.4); text-decoration-color: rgba(255,255,255,0.35); }
.oh-md a { color: var(--oh-md-accent); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--oh-md-accent) 40%, transparent); }
.oh-md a:hover { border-bottom-color: var(--oh-md-accent); }

/* Three levels that read as three levels at 0.85rem in a narrow column: a
   titled rule, a plain bold line, then a small-caps label. */
.oh-md h1, .oh-md h2, .oh-md h3, .oh-md h4, .oh-md h5, .oh-md h6 {
    color: rgba(255,255,255,0.95);
    font-weight: 700;
    line-height: 1.3;
    margin: 0.9rem 0 0.4rem;
}
.oh-md h1 { font-size: 1.02rem; letter-spacing: 0.01em; border-bottom: 1px solid var(--oh-md-rule); padding-bottom: 0.28rem; }
.oh-md h2 { font-size: 0.94rem; border-bottom: 1px solid rgba(255,255,255,0.09); padding-bottom: 0.22rem; }
.oh-md h3 { font-size: 0.88rem; }
.oh-md h4, .oh-md h5, .oh-md h6 {
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: color-mix(in srgb, var(--oh-md-accent) 65%, rgba(255,255,255,0.85));
}

.oh-md ul, .oh-md ol { margin: 0.3rem 0 0.6rem 0; padding-left: 1.15rem; }
.oh-md li { margin-bottom: 0.22rem; }
.oh-md li > ul, .oh-md li > ol { margin: 0.22rem 0 0.1rem 0; }
.oh-md li::marker { color: color-mix(in srgb, var(--oh-md-accent) 70%, transparent); }
.oh-md ol > li::marker { font-variant-numeric: tabular-nums; font-weight: 600; }

/* Task lists: the checkbox replaces the bullet rather than sitting beside it.
   (remark-gfm marks the list .contains-task-list and each item .task-list-item.) */
.oh-md ul.contains-task-list { padding-left: 0.1rem; }
.oh-md li.task-list-item { list-style: none; }
.oh-md li.task-list-item input[type="checkbox"] {
    accent-color: var(--oh-md-accent);
    margin: 0 0.45rem 0 0;
    vertical-align: -0.08em;
}

.oh-md blockquote {
    border-left: 2px solid var(--oh-md-accent);
    background: color-mix(in srgb, var(--oh-md-accent) 7%, transparent);
    border-radius: 0 6px 6px 0;
    margin: 0.55rem 0;
    padding: 0.4rem 0.7rem;
    color: rgba(255,255,255,0.82);
}
.oh-md blockquote p:last-child { margin-bottom: 0; }

.oh-md hr {
    border: 0;
    border-top: 1px solid var(--oh-md-rule);
    margin: 0.85rem 0;
}

.oh-md code {
    background: rgba(0,0,0,0.32);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    font-size: 0.8em;
    padding: 0.08rem 0.3rem;
    white-space: pre-wrap;
}
.oh-md pre {
    background: rgba(0,0,0,0.32);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    margin: 0.5rem 0;
    overflow-x: auto;
    padding: 0.65rem 0.75rem;
}
.oh-md pre code { background: none; border: 0; padding: 0; white-space: pre; }

.oh-md-table-wrap { margin: 0.55rem 0; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.oh-md-table-wrap table {
    border-collapse: collapse;
    font-size: 0.78rem;
    line-height: 1.4;
    width: 100%;
}
.oh-md-table-wrap th, .oh-md-table-wrap td {
    border: 1px solid rgba(255,255,255,0.10);
    padding: 0.3rem 0.5rem;
    text-align: left;
    vertical-align: top;
}
.oh-md-table-wrap thead th {
    background: color-mix(in srgb, var(--oh-md-accent) 16%, rgba(255,255,255,0.05));
    color: rgba(255,255,255,0.95);
    font-weight: 700;
    letter-spacing: 0.02em;
    white-space: nowrap;
}
.oh-md-table-wrap tbody tr:nth-child(even) { background: rgba(255,255,255,0.035); }
.oh-md-table-wrap td:first-child { color: rgba(255,255,255,0.9); font-weight: 600; }

.oh-md .footnotes { border-top: 1px solid var(--oh-md-rule); color: var(--oh-md-dim); font-size: 0.78rem; margin-top: 0.8rem; padding-top: 0.4rem; }
.oh-md .footnotes h2 { border: 0; font-size: 0.72rem; letter-spacing: 0.07em; text-transform: uppercase; }
`;

// One stylesheet for every panel that renders markdown, injected once.
export const MarkdownStyleInjector = () => {
    useEffect(() => {
        if (document.getElementById("oh-md-styles")) return;
        const style = document.createElement("style");
        style.id = "oh-md-styles";
        style.textContent = markdownStyles;
        document.head.appendChild(style);
    }, []);
    return null;
};

// `className` picks the accent (advisor-markdown / chat-markdown); everything
// else comes from the shared sheet above.
const Markdown = ({ children, className }) => {
    const text = useMemo(() => normalizeMarkdown(children), [children]);
    return (
        <div className={className ? `oh-md ${className}` : "oh-md"}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>{text}</ReactMarkdown>
        </div>
    );
};

export default Markdown;
