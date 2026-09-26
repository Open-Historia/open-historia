/*! Open Historia — every fixed interface string, read out of the source © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The in-game translator (src/runtime/translator.js) swaps the English text the
// game renders for the player's language, by exact text. Anything it has no
// translation for used to go to the player's AI provider, one request per few
// hundred strings, which on a free key is most of a day's allowance for a
// language nobody had played before. So the shipped language packs have to hold
// every string the interface can show, and a hand-kept list of them (the old
// catalog) fell behind within a week of every feature.
//
// This reads them out of the source instead. It parses every interface file
// with Babel and collects:
//
//   - JSX text, exactly as React renders it (the JSX whitespace rules);
//   - the text-bearing attributes the translator touches (title, placeholder,
//     aria-label, alt) and the string props a component renders as text
//     (label, hint, description…);
//   - string values under display keys in objects and in [key, "Label"] rows
//     (tab lists, registries such as the prompt sections or the difficulty
//     levels), and messages passed to status setters;
//   - in .jsx files, any other string that reads like prose and is not in a
//     technical position (a style, a class name, an import, a log call, a
//     comparison, an event or storage key).
//
// Text that is built at render time becomes a PATTERN with named slots in
// double braces: `${count} events` gives "{{count}} events", and an element
// whose children are text around expressions (<span>{n} of {total}</span>)
// gives one pattern for the whole run, so a language can put the words in its
// own order. A slot holding a choice of strings (`event${n === 1 ? "" : "s"}`)
// is expanded into each variant. Patterns carry the braces so the translator
// can tell them from plain strings (plain interface text never contains "{{").
//
// Text inside an element marked data-no-translate is skipped, as the runtime
// skips it: names, codes and player-written text.

import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;

// ---------------------------------------------------------------------------
// What counts as prose.

const CSS_WORD = /^(?:auto|none|inherit|initial|unset|center|left|right|top|bottom|flex|grid|block|inline|inline-flex|inline-block|contents|absolute|relative|fixed|sticky|hidden|visible|scroll|nowrap|normal|bold|bolder|italic|uppercase|lowercase|capitalize|pointer|default|transparent|solid|dashed|dotted|column|row|wrap|stretch|baseline|start|end|space-between|space-around|ease|linear|both|forwards|monospace|sans-serif|serif|ltr|rtl|button|submit|text|number|checkbox|radio|file|range|email|password|search|url|tel|date|color)$/i;

const looksTechnical = (text) => {
  const t = text.trim();
  if (!t) return true;
  if (/^[a-z][a-z0-9]*(?:[-_.:/][a-z0-9]+)*$/.test(t)) return true; // ids, keys, kebab/snake/paths
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(t)) return true; // camelCase
  if (/^[A-Z0-9_]{2,}$/.test(t)) return true; // CONSTANTS, codes
  if (/^(?:https?:|data:|blob:|mailto:|\/|\.\/|\.\.\/|#)/i.test(t)) return true; // urls, paths, anchors
  if (/(?:^|\s)(?:-?\d*\.?\d+(?:px|rem|em|vh|vw|%|ms|s|deg|fr)\b)/.test(t) && !/[a-z]{4,}\s+[a-z]{3,}/i.test(t.replace(/-?\d*\.?\d+(?:px|rem|em|vh|vw|%|ms|s|deg|fr)\b/g, ""))) return true;
  if (/rgba?\(|hsla?\(|#[0-9a-f]{3,8}\b|var\(--|calc\(|color-mix\(|linear-gradient|cubic-bezier|translate[XY]?\(|scale\(|rotate\(/i.test(t)) return true;
  if (CSS_WORD.test(t)) return true;
  if (/^[\w.-]+(?:\s+[\w.-]+)*$/.test(t) && t.split(/\s+/).every((w) => CSS_WORD.test(w) || /^-?\d*\.?\d+$/.test(w))) return true; // "0 1 auto"
  if (/^[\w.-]+\.(?:js|jsx|mjs|json|png|jpg|webp|svg|geojson|pmtiles|css|html|zip)$/i.test(t)) return true;
  if (/^application\/|^text\/|^image\//.test(t)) return true;
  if (/^\p{Extended_Pictographic}+$/u.test(t)) return true;
  if (/^[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+$/.test(t)) return true; // PascalCase tokens: AbortError, GitHub
  if (/^(?:[YMDdHhmsAaZzEo]+|[\s,./:()\-–·])+$/.test(t) && /YY|MM|DD|HH|mm/.test(t)) return true; // date formats: "MMMM Do, YYYY"
  return false;
};

// The runtime's own test (translator.js isTranslatable): two Latin letters.
const translatable = (text) => {
  const t = text.trim();
  return t.length > 1 && t.length < 3000 && /[A-Za-z]{2}/.test(t);
};

// Prose: translatable, not technical, and either several words or a
// capitalised word ("Cancel", "Advisor").
const proseLike = (text) => {
  const t = text.trim();
  if (!translatable(t) || looksTechnical(t)) return false;
  return /\s/.test(t) || /^[A-Z][a-z]/.test(t) || /[.!?…:]$/.test(t);
};

// ---------------------------------------------------------------------------
// JSX text, as React renders it (Babel's cleanJSXElementLiteralChild).

export const cleanJsxText = (raw) => {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((line, i) => { if (/[^ \t]/.test(line)) lastNonEmpty = i; });
  let out = "";
  lines.forEach((line, i) => {
    let s = line.replace(/\t/g, " ");
    if (i !== 0) s = s.replace(/^[ ]+/, "");
    if (i !== lines.length - 1) s = s.replace(/[ ]+$/, "");
    if (s) {
      if (i !== lastNonEmpty) s += " ";
      out += s;
    }
  });
  return out;
};

// ---------------------------------------------------------------------------
// Expressions: what text can this produce?
//
// A "shape" is a list of alternatives, each a list of parts: { text } or
// { slot: name }. A string literal is one alternative of one text part; a
// ternary of literals is two alternatives; a template is one alternative of
// text and slots (its interpolations that are themselves choices of strings are
// expanded); anything else is one slot.

const MAX_VARIANTS = 8;

const slotName = (node, code) => {
  if (!node) return "value";
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
    const prop = node.property?.name ?? node.property?.value;
    if (prop === "length") return `${slotName(node.object, code)}Count`;
    return typeof prop === "string" ? prop : "value";
  }
  if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
    const callee = node.callee;
    if (callee.type === "Identifier") return callee.name;
    if (callee.type === "MemberExpression") {
      const prop = callee.property?.name;
      if (["toLocaleString", "toFixed", "toString", "join", "trim", "toUpperCase", "toLowerCase"].includes(prop)) return slotName(callee.object, code);
      return prop || "value";
    }
  }
  if (node.type === "TSAsExpression" || node.type === "ParenthesizedExpression") return slotName(node.expression, code);
  return "value";
};

const cleanSlot = (name) => String(name || "value").replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "value";

const cross = (a, b) => {
  const out = [];
  for (const x of a) for (const y of b) {
    out.push([...x, ...y]);
    if (out.length >= MAX_VARIANTS) return out;
  }
  return out;
};

export const shapeOf = (node, code) => {
  if (!node) return null;
  switch (node.type) {
    case "StringLiteral":
      return [[{ text: node.value }]];
    case "TemplateLiteral": {
      let alts = [[]];
      node.quasis.forEach((quasi, i) => {
        alts = alts.map((alt) => [...alt, { text: quasi.value.cooked ?? quasi.value.raw }]);
        if (i < node.expressions.length) {
          const inner = node.expressions[i];
          const innerShape = choiceShape(inner, code);
          alts = cross(alts, innerShape ?? [[{ slot: cleanSlot(slotName(inner, code)) }]]);
        }
      });
      return alts;
    }
    case "ConditionalExpression": {
      // A choice of strings, however short: `event{n === 1 ? "" : "s"}` is
      // "event" or "events", never "event{{value}}" (a language cannot
      // translate a suffix).
      const choice = choiceShape(node, code);
      if (choice) return choice.slice(0, MAX_VARIANTS);
      const a = branchShape(node.consequent, code);
      const b = branchShape(node.alternate, code);
      if (!hasText(a) && !hasText(b)) return null;
      return [...a, ...b].slice(0, MAX_VARIANTS);
    }
    case "LogicalExpression": {
      // `{many && "s"}`: nothing, or the suffix, as above.
      const suffix = node.operator === "&&" ? choiceShape(node.right, code) : null;
      if (suffix) return [[], ...suffix].slice(0, MAX_VARIANTS);
      const right = branchShape(node.right, code);
      if (!hasText(right)) return null;
      // cond && "Text": nothing, or the text. x || "Fallback" (and ??): x
      // itself, whatever it is, or the fallback.
      const left = node.operator === "&&" ? [[]] : [[{ slot: cleanSlot(slotName(node.left, code)) }]];
      return [...left, ...right].slice(0, MAX_VARIANTS);
    }
    case "BinaryExpression": {
      if (node.operator !== "+") return null;
      const l = shapeOf(node.left, code) ?? [[{ slot: cleanSlot(slotName(node.left, code)) }]];
      const r = shapeOf(node.right, code) ?? [[{ slot: cleanSlot(slotName(node.right, code)) }]];
      if (!l.some((alt) => alt.some((p) => p.text)) && !r.some((alt) => alt.some((p) => p.text))) return null;
      return cross(l, r);
    }
    case "ParenthesizedExpression":
    case "TSAsExpression":
      return shapeOf(node.expression, code);
    default:
      return null;
  }
};

// One branch of a ternary or &&/||: text, nothing (null, false), an element
// (which a run of text cannot pass through), or an unknown value (a slot).
const isNothing = (node) => !node || node.type === "NullLiteral" || (node.type === "BooleanLiteral" && !node.value) || (node.type === "Identifier" && node.name === "undefined");
const isElement = (node) => node && (node.type === "JSXElement" || node.type === "JSXFragment");
const branchShape = (node, code) => {
  if (isNothing(node)) return [[]];
  if (isElement(node)) return [[{ element: true }]];
  return shapeOf(node, code) ?? [[{ slot: cleanSlot(slotName(node, code)) }]];
};
const hasText = (shape) => Boolean(shape?.some((alt) => alt.some((part) => part.text != null && /[A-Za-z]{2}/.test(part.text))));

// A choice of texts (for an interpolation inside a template, or a ternary
// child): expands into each. A branch may be a string, nothing, or a template
// with values of its own: `Agenda${n ? ` (${n})` : ""}` is "Agenda" or
// "Agenda ({{n}})". Anything else in a branch makes the whole choice one slot.
const choiceShape = (node, code) => {
  if (!node) return null;
  if (node.type === "StringLiteral") return [[{ text: node.value }]];
  if (node.type === "TemplateLiteral") return shapeOf(node, code);
  if (node.type === "ParenthesizedExpression") return choiceShape(node.expression, code);
  if (node.type === "ConditionalExpression") {
    const a = isNothing(node.consequent) ? [[]] : choiceShape(node.consequent, code);
    const b = isNothing(node.alternate) ? [[]] : choiceShape(node.alternate, code);
    if (a && b) return [...a, ...b].slice(0, MAX_VARIANTS);
    return null;
  }
  if (node.type === "LogicalExpression" && node.operator === "&&") {
    const right = choiceShape(node.right, code);
    return right ? [[], ...right].slice(0, MAX_VARIANTS) : null;
  }
  return null;
};

// Parts → the string the translator will see, and whether it has slots. An
// alternative that renders an element is not one string: null.
const render = (parts) => {
  if (parts.some((part) => part.element)) return null;
  const used = new Map();
  let text = "";
  let slots = 0;
  for (const part of parts) {
    if (part.text != null) {
      text += part.text;
    } else if (part.slot) {
      const base = part.slot;
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      text += `{{${n === 1 ? base : `${base}${n}`}}}`;
      slots += 1;
    }
  }
  return { text: text.replace(/\s+/g, (ws) => (ws.includes("\n") ? " " : ws)).trim(), slots };
};

// A pattern is only worth keeping when it has words of its own around the
// slots; "{{a}} {{b}}" or "({{count}})" translates to itself.
const patternHasWords = (text) => /[A-Za-z]{2}/.test(text.replace(/\{\{[^}]+\}\}/g, ""));

// ---------------------------------------------------------------------------
// Where a string sits.

const UI_ATTRS_DOM = new Set(["title", "placeholder", "aria-label", "alt", "aria-description", "aria-roledescription"]);
const NON_TEXT_PROPS = new Set([
  "className", "style", "key", "id", "type", "href", "src", "icon", "color", "variant", "size", "tone", "align",
  "direction", "role", "target", "rel", "mode", "kind", "as", "value", "defaultValue", "htmlFor", "accept",
  "autoComplete", "inputMode", "width", "height", "fill", "stroke", "viewBox", "d", "transform", "points",
  "sectionKey", "taskKey", "tab", "section", "view", "status", "position", "placement", "anchor", "name",
  "fontFamily", "font", "background", "border", "accent", "accentColor", "flag", "flagUrl", "code", "lang",
  "dir", "method", "encType", "download", "pattern", "step", "min", "max", "path", "url", "query", "filter",
  "sort", "order", "ref", "testId", "field", "prop", "keyName", "storageKey", "eventName", "format", "unit",
]);
const DISPLAY_KEYS = new Set([
  "label", "title", "description", "hint", "placeholder", "subtitle", "blurb", "eyebrow", "heading", "text",
  "message", "tooltip", "caption", "summary", "emptyText", "emptyLabel", "confirmLabel", "cancelLabel",
  "actionLabel", "buttonLabel", "heroTitle", "heroSubtitle", "shortLabel", "longLabel", "question", "answer",
  "explanation", "detail", "details", "note", "warning", "helper", "help", "intro", "tagline", "headline",
  "prompt_label", "noun", "plural", "singular", "verb", "phase", "stage", "step", "publicDescription",
]);
// A camelCase key ending in "Label" (mappedLabel, centerSubLabel) holds display
// text too, and may be a single lowercase word ("landscape").
const LABEL_KEY = /^[a-z][A-Za-z0-9]*Label$/;
const isDisplayKey = (key) => DISPLAY_KEYS.has(key) || LABEL_KEY.test(key ?? "");
const STATUS_CALLS = new Set([
  "setStatus", "setError", "setMessage", "setNotice", "setToast", "showToast", "notify", "alert", "confirm",
  "setHint", "setLabel", "setWarning", "setInfo", "setBanner", "setNote", "setSaveMessage", "setStatusText",
  "setErrorText", "setFeedback", "setResult", "setProgress", "setPhase", "setStage", "showError", "showNotice",
  "reportStatus", "setPromptTransferStatus", "setTransferStatus", "setLoadError", "setImportError",
  "setExportStatus", "setMessageText", "setDetail",
]);
const NON_UI_CALLS = new Set([
  "require", "import", "fetch", "readJson", "writeJson", "logDebugEvent", "logSettingChange", "logTelemetry",
  "setItem", "getItem", "removeItem", "addEventListener", "removeEventListener", "dispatchEvent", "querySelector",
  "querySelectorAll", "getElementById", "closest", "matches", "setAttribute", "getAttribute", "removeAttribute",
  "createElement", "setProperty", "getPropertyValue", "matchMedia", "postMessage", "setData", "getData",
  "RegExp", "Error", "TypeError", "RangeError", "callAI", "sendMessage", "startChat", "runJsonTask",
  "structuredClone", "localeCompare", "includes", "startsWith", "endsWith", "indexOf", "split", "replace",
  "replaceAll", "match", "test", "has", "get", "set", "delete", "on", "off", "once", "emit", "setState",
  "encodeURIComponent", "decodeURIComponent", "open", "useRuntimeState", "primeRuntimeValue", "refreshRuntimeState",
  "useState", "useRef", "useMemo", "useCallback", "createContext", "lazy", "Symbol", "hasOwnProperty",
  "toLocaleDateString", "toLocaleTimeString", "Intl", "DateTimeFormat", "NumberFormat", "padStart", "padEnd",
  "getComputedStyle", "setPointerCapture", "releasePointerCapture", "requestAnimationFrame", "execCommand",
  "writeText", "readText", "download", "saveBlobToDisk", "saveFile", "downloadJson", "downloadBlob",
  "warn", "log", "info", "debug", "error", "trace", "assert", "table", "group", "groupEnd", "time", "timeEnd",
]);

const calleeName = (callee) => {
  if (!callee) return "";
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") {
    const obj = callee.object?.name;
    if (obj === "console") return "console";
    return callee.property?.name ?? callee.property?.value ?? "";
  }
  return "";
};

const jsxName = (nameNode) => {
  if (!nameNode) return "";
  if (nameNode.type === "JSXIdentifier") return nameNode.name;
  if (nameNode.type === "JSXMemberExpression") return `${jsxName(nameNode.object)}.${jsxName(nameNode.property)}`;
  if (nameNode.type === "JSXNamespacedName") return `${nameNode.namespace.name}:${nameNode.name.name}`;
  return "";
};

const isComponent = (name) => /^[A-Z]/.test(name) || name.includes(".");

// data-no-translate, always: bare, a string, or {true}. A conditional one
// (`data-no-translate={isPlayer ? "" : undefined}`) is off for some of what
// the element shows, so its text is still collected.
const hasNoTranslate = (openingElement) =>
  openingElement?.attributes?.some((a) => {
    if (a.type !== "JSXAttribute" || jsxName(a.name) !== "data-no-translate") return false;
    const value = a.value;
    if (!value || value.type === "StringLiteral") return true;
    return value.type === "JSXExpressionContainer" && value.expression?.type === "BooleanLiteral" && value.expression.value === true;
  });

// ---------------------------------------------------------------------------
// The walk.

// A constant named for what it holds: STRUCTURED_MODE_LABELS = { auto: "…" },
// STRUCTURED_MODE_INTRO = "…", ERROR_MESSAGES = ["…"]. Every string in it is
// text the screen shows.
const DISPLAY_CONSTANT = /^[A-Z][A-Z0-9_]*$/;
const DISPLAY_CONSTANT_SUFFIX = /(?:^|_)(?:LABELS?|HINTS?|INTRO|NOTES?|TEXTS?|MESSAGES?|TITLES?|DESCRIPTIONS?|BLURBS?|CAPTIONS?|TOOLTIPS?|PLACEHOLDERS?)$/;
// Named like display text, but written for the model (schema hints).
const MODEL_CONSTANTS = new Set(["GENERATED_OP_NOTES", "TERRITORY_BASIS_DESCRIPTION"]);

// `messages`: a module whose functions return or throw what the player reads
// (a provider's failure, why a turn could not run). Its returned and thrown
// prose is collected as well.
export const extractFromSource = (code, file, { jsx = true, catchAll = jsx, factories = {}, messages = false } = {}) => {
  const exact = new Map(); // text -> first location
  const patterns = new Map();
  const add = (map, text, node) => {
    if (!map.has(text)) map.set(text, `${file}:${node?.loc?.start?.line ?? 0}`);
  };
  // `word`: a lone lowercase word is display text here (a *Label key), not an id.
  const addText = (raw, node, { requireProse = false, word = false } = {}) => {
    const t = String(raw ?? "").trim();
    if (!translatable(t)) return;
    if (requireProse ? !proseLike(t) : looksTechnical(t) && !(word && /^[a-z]{2,}$/.test(t))) return;
    add(exact, t, node);
  };
  // Each alternative of a shape is one string the translator will see whole:
  // plain text, or a pattern when it has slots.
  const addShape = (shape, node, opts = {}) => {
    if (!shape) return;
    for (const alt of shape) {
      const rendered = render(alt);
      if (!rendered?.text) continue;
      const { text, slots } = rendered;
      if (slots === 0) addText(text, node, opts);
      else if (
        patternHasWords(text) && translatable(text)
        && !looksTechnical(text.replace(/\{\{[^}]+\}\}/g, "x"))
        && !(opts.requireProse && !proseLike(text.replace(/\{\{[^}]+\}\}/g, "x")))
      ) add(patterns, text, node);
    }
  };

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      errorRecovery: true,
      plugins: ["jsx", "classProperties", "optionalChaining", "nullishCoalescingOperator", "topLevelAwait", "importMeta", "dynamicImport", "objectRestSpread"],
    });
  } catch (error) {
    return { exact, patterns, error: `${file}: ${error.message}` };
  }

  // Inside an element the runtime skips. Its own text attributes are skipped
  // with it; its other attributes (an onBlur's status message, a prop) are not
  // rendered inside it.
  const insideNoTranslate = (p) => {
    let child = p;
    for (let q = p.parentPath; q; child = q, q = q.parentPath) {
      if (!q.isJSXElement() || !hasNoTranslate(q.node.openingElement)) continue;
      if (child.isJSXOpeningElement()) {
        const attribute = p.findParent((r) => r.isJSXAttribute() && r.parentPath === child);
        if (attribute && !UI_ATTRS_DOM.has(jsxName(attribute.node.name))) continue;
      }
      return true;
    }
    return false;
  };

  // Is this string node in a technical position (not a candidate for the
  // catch-all)?
  const technicalPosition = (p) => {
    const parent = p.parentPath;
    if (!parent) return true;
    const pn = parent.node;
    if (parent.isImportDeclaration() || parent.isExportNamedDeclaration() || parent.isExportAllDeclaration()) return true;
    if (parent.isObjectProperty() && pn.key === p.node) return true; // a key
    if (parent.isObjectProperty()) {
      const key = pn.key?.name ?? pn.key?.value;
      if (isDisplayKey(key)) return false;
      if (NON_TEXT_PROPS.has(key)) return true;
      // Inside a style object: the whole object is technical.
      const obj = parent.parentPath;
      const holder = obj?.parentPath;
      if (holder?.isJSXExpressionContainer() && holder.parentPath?.isJSXAttribute() && jsxName(holder.parentPath.node.name) === "style") return true;
      if (holder?.isVariableDeclarator() && /style/i.test(holder.node.id?.name ?? "")) return true;
      if (/^[a-z]+[A-Z]/.test(key || "") && /(?:color|size|width|height|margin|padding|border|radius|shadow|family|weight|align|justify|transform|transition|animation|opacity|index|overflow|position|display|cursor|gap|flex|grid|filter|spacing|decoration|space|wrap|style|content)/i.test(key)) return true;
    }
    if (parent.isMemberExpression() && pn.property === p.node) return true;
    if (parent.isBinaryExpression() && ["===", "!==", "==", "!=", "in", "instanceof"].includes(pn.operator)) return true;
    if (parent.isSwitchCase()) return true;
    if (parent.isCallExpression() || parent.isNewExpression() || parent.isOptionalCallExpression()) {
      const name = calleeName(pn.callee);
      if (name === "console" || NON_UI_CALLS.has(name)) return true;
    }
    if (parent.isJSXAttribute()) {
      const attr = jsxName(pn.name);
      const el = jsxName(parent.parentPath?.node?.name);
      if (UI_ATTRS_DOM.has(attr)) return false;
      if (isComponent(el) && !NON_TEXT_PROPS.has(attr) && !attr.startsWith("data-") && !attr.startsWith("on")) return false;
      return true;
    }
    if (parent.isTaggedTemplateExpression()) return true;
    if (parent.isAssignmentExpression()) {
      const left = pn.left;
      const prop = left?.property?.name;
      if (prop && /^(?:className|id|href|src|cssText|type|name|value|key)$/.test(prop)) return true;
    }
    return false;
  };

  // React renders each JSX text child and each expression child as its own
  // text node, and an element child between them ends the run. The translator
  // sees each node alone, and (translator.js) a parent whose children are all
  // text nodes as one run, so both are collected. A fragment's children are
  // rendered the same way, into whatever element holds the fragment.
  const collectChildren = (p) => {
    const runs = [];
    let current = [];
    const flush = () => {
      if (current.length) runs.push(current);
      current = [];
    };
    for (const child of p.node.children) {
      if (child.type === "JSXText") {
        const cleaned = cleanJsxText(child.value);
        // JSX text is always on screen: no prose test, only the runtime's.
        if (cleaned) current.push({ node: child, alts: [[{ text: cleaned }]], jsxText: true });
      } else if (child.type === "JSXExpressionContainer") {
        const expr = child.expression;
        if (expr.type === "JSXEmptyExpression") continue;
        if (isElement(expr) || (expr.type === "CallExpression" && /map$/.test(calleeName(expr.callee)))) {
          flush();
          continue;
        }
        const shape = shapeOf(expr, code);
        current.push({ node: expr, alts: shape ?? [[{ slot: cleanSlot(slotName(expr, code)) }]] });
      } else {
        flush();
      }
    }
    flush();
    for (const run of runs) {
      for (const item of run) {
        if (item.jsxText) {
          const t = item.alts[0][0].text.trim();
          if (translatable(t)) add(exact, t, item.node);
        } else addShape(item.alts, item.node);
      }
      if (run.length > 1) {
        let alts = [[]];
        for (const item of run) alts = cross(alts, item.alts);
        addShape(alts, p.node);
      }
    }
  };

  traverse(ast, {
    JSXElement(p) {
      if (hasNoTranslate(p.node.openingElement) || insideNoTranslate(p)) return;
      collectChildren(p);
    },
    JSXFragment(p) {
      if (insideNoTranslate(p)) return;
      collectChildren(p);
    },
    JSXAttribute(p) {
      if (insideNoTranslate(p)) return;
      const attr = jsxName(p.node.name);
      const el = jsxName(p.parentPath?.node?.name);
      const dom = !isComponent(el);
      const wanted = dom ? UI_ATTRS_DOM.has(attr) : (!NON_TEXT_PROPS.has(attr) && !attr.startsWith("data-") && !/^on[A-Z]/.test(attr));
      if (!wanted) return;
      const value = p.node.value;
      if (!value) return;
      if (value.type === "StringLiteral") {
        addText(value.value, value, { requireProse: !dom && !["label", "title", "hint", "description", "placeholder", "subtitle", "text", "message", "heading", "caption", "tooltip", "eyebrow"].includes(attr) });
      } else if (value.type === "JSXExpressionContainer") {
        addShape(shapeOf(value.expression, code), value, { requireProse: !dom });
      }
    },
    ObjectProperty(p) {
      const key = p.node.key?.name ?? p.node.key?.value;
      if (!isDisplayKey(key) || p.node.computed) return;
      if (insideNoTranslate(p)) return;
      const shape = shapeOf(p.node.value, code);
      if (shape) addShape(shape, p.node.value, { requireProse: !["label", "title", "hint", "description", "placeholder", "subtitle", "blurb", "heroTitle", "heroSubtitle", "eyebrow"].includes(key) && !LABEL_KEY.test(key), word: LABEL_KEY.test(key) });
    },
    ArrayExpression(p) {
      // [key, "Label"] rows (tab lists).
      const els = p.node.elements;
      if (els.length < 2 || els.length > 4) return;
      if (els[0]?.type !== "StringLiteral" || !/^[a-z][A-Za-z0-9_-]*$/.test(els[0].value)) return;
      for (const el of els.slice(1)) {
        const shape = shapeOf(el, code);
        if (shape) addShape(shape, el, { requireProse: true });
      }
    },
    CallExpression(p) {
      const name = calleeName(p.node.callee);
      if (STATUS_CALLS.has(name)) {
        for (const arg of p.node.arguments) {
          const shape = shapeOf(arg, code);
          if (shape) addShape(shape, arg, { requireProse: true });
        }
      }
      const factory = Object.hasOwn(factories, name) ? factories[name] : null;
      if (factory) {
        for (const index of factory) {
          const arg = p.node.arguments[index];
          const shape = arg ? shapeOf(arg, code) : null;
          if (shape) addShape(shape, arg);
        }
      }
    },
    VariableDeclarator(p) {
      const name = p.node.id?.type === "Identifier" ? p.node.id.name : "";
      if (!DISPLAY_CONSTANT.test(name) || !DISPLAY_CONSTANT_SUFFIX.test(name) || MODEL_CONSTANTS.has(name) || !p.node.init) return;
      const collect = (node, depth) => {
        if (!node || depth > 4) return;
        if (node.type === "CallExpression" && calleeName(node.callee) === "freeze") {
          collect(node.arguments[0], depth);
        } else if (node.type === "ObjectExpression") {
          for (const property of node.properties) if (property.type === "ObjectProperty") collect(property.value, depth + 1);
        } else if (node.type === "ArrayExpression") {
          for (const element of node.elements) collect(element, depth + 1);
        } else {
          const shape = shapeOf(node, code);
          if (shape) addShape(shape, node, { requireProse: true });
        }
      };
      collect(p.node.init, 0);
    },
    ReturnStatement(p) {
      if (!messages || !p.node.argument) return;
      const shape = shapeOf(p.node.argument, code);
      if (shape) addShape(shape, p.node.argument, { requireProse: true });
    },
    NewExpression(p) {
      if (!messages || !/Error$/.test(calleeName(p.node.callee)) || !p.node.arguments[0]) return;
      const shape = shapeOf(p.node.arguments[0], code);
      if (shape) addShape(shape, p.node.arguments[0], { requireProse: true });
    },
    StringLiteral(p) {
      if (!catchAll) return;
      if (p.parentPath.isJSXAttribute() || p.parentPath.isObjectProperty() && isDisplayKey(p.parentPath.node.key?.name)) return; // handled above
      if (technicalPosition(p) || insideNoTranslate(p)) return;
      if (p.findParent((q) => q.isCallExpression() && (calleeName(q.node.callee) === "console" || NON_UI_CALLS.has(calleeName(q.node.callee))))) return;
      addText(p.node.value, p.node, { requireProse: true });
    },
    TemplateLiteral(p) {
      if (!catchAll) return;
      if (p.parentPath.isJSXExpressionContainer() || p.parentPath.isTaggedTemplateExpression()) return;
      if (technicalPosition(p) || insideNoTranslate(p)) return;
      if (p.findParent((q) => q.isCallExpression() && (calleeName(q.node.callee) === "console" || NON_UI_CALLS.has(calleeName(q.node.callee))))) return;
      addShape(shapeOf(p.node, code), p.node, { requireProse: true });
    },
  });

  return { exact, patterns };
};

// ---------------------------------------------------------------------------
// Files.

const walkFiles = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walkFiles(full, out);
    } else out.push(full);
  }
  return out;
};

// The interface: every .jsx file, and the .js registries whose display fields
// reach the screen. The AI directory is prompts and parsers except for the
// registries that feed the Prompts tab and Settings → AI, and the modules
// whose messages the player reads (MESSAGE_FILES). A .jsx file's thrown and
// returned prose is read too: its screen shows error.message.
const JS_REGISTRY_DIRS = ["src/runtime", "src/Game/GameUI", "src/Game/Selection", "src/Game/Map", "src/Editor"];
const MESSAGE_FILES = [
  "src/Game/AI/providerErrors.js", "src/Game/AI/fallbackRunner.js", "src/Game/AI/contextWindow.js",
  "src/Game/AI/requestBudget.js",
  // The institutions: what their commands refuse with shows in the Institutions
  // tab, and the events and channel lines they write are read in the log.
  "src/runtime/institutionLifecycle.js", "src/runtime/institutionLifecycleCore.js",
  "src/runtime/institutionalChannels.js", "src/runtime/institutionalGovernance.js",
  "src/runtime/institutionAuthoring.js", "src/runtime/politicalWorldCapability.js",
  "src/Game/GameUI/advisorInstitutionDrafts.js", "src/Game/GameUI/countryEditorPolitical.js",
];
const JS_REGISTRY_FILES = [
  "src/Game/AI/gameplayPrompts.js", "src/Game/AI/promptGuidance.js", "src/Game/AI/providerConfig.js",
  "src/Game/AI/structuredMode.js", "src/Game/AI/playerFocus.js", "src/Game/AI/simulationStatus.js",
  "src/Game/AI/historyConsolidation.js", "src/Game/AI/interactiveRewind.js", ...MESSAGE_FILES,
];
const FACTORIES = { segment: [1, 4] }; // promptGuidance.js: segment(id, label, start, end, hint)

export const interfaceFiles = (root) => {
  const all = walkFiles(path.join(root, "src"));
  return all.filter((file) => {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (/\.test\.|\/__tests__\//.test(rel)) return false;
    if (rel.endsWith(".jsx")) return true;
    if (!rel.endsWith(".js")) return false;
    if (JS_REGISTRY_FILES.includes(rel)) return true;
    if (rel.startsWith("src/Game/AI/")) return false;
    return JS_REGISTRY_DIRS.some((dir) => rel.startsWith(`${dir}/`));
  });
};

export const extractTree = (root) => {
  const exact = new Map();
  const patterns = new Map();
  const errors = [];
  for (const file of interfaceFiles(root)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const code = fs.readFileSync(file, "utf8");
    const jsx = rel.endsWith(".jsx");
    const result = extractFromSource(code, rel, { jsx, catchAll: jsx, factories: FACTORIES, messages: jsx || MESSAGE_FILES.includes(rel) });
    if (result.error) errors.push(result.error);
    for (const [t, where] of result.exact) if (!exact.has(t)) exact.set(t, where);
    for (const [t, where] of result.patterns) if (!patterns.has(t)) patterns.set(t, where);
  }
  return { exact, patterns, errors };
};
