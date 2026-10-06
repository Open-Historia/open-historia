/*! Open Historia — keeping an answer that is wrong in one place © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Schema validation is all or nothing: one unit op with a strength of 1200, one
// event with an unknown field, and the whole answer is rejected. The task runner
// then asks again, which re-sends the entire prompt — a second REQUEST, on a key
// that may have a few hundred a day (requestBudget.js) — to fix something the
// game could simply have left out.
//
// salvageBySchema does the leaving out. It reads WHERE the validator says the
// answer is wrong and removes the smallest thing at that place: a property the
// schema does not know, a malformed optional field, the surplus of an over-long
// list, and failing those the one list item the fault sits in. Then it validates
// again. Nothing is ever invented or rewritten, only removed, every removal is
// reported so the model can be told (runtime/applicationReceipt.js), and an
// answer whose fault is not inside any list — a missing top-level field, a list
// that is too short — is not salvageable and is returned as it came.
//
// DELIBERATELY IMPORT-FREE: the caller hands in the validator.

const PATH_PATTERN = /^\$(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d+\]|\["(?:[^"\\]|\\.)*"\])*/;

// "$.events[3].impacts.unitOps[1].unit.strength must be at most 1000."
//   → ["events", 3, "impacts", "unitOps", 1, "unit", "strength"]
export const parseErrorPath = (error) => {
    const text = String(error ?? "");
    const match = text.match(PATH_PATTERN);
    if (!match || match[0].length < 1) return null;
    const segments = [];
    const tokens = match[0].slice(1).match(/\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d+\]|\["(?:[^"\\]|\\.)*"\]/g) ?? [];
    for (const token of tokens) {
        if (token.startsWith(".")) segments.push(token.slice(1));
        else if (token.startsWith("[\"")) {
            try {
                segments.push(JSON.parse(token.slice(1, -1)));
            } catch {
                return null;
            }
        } else segments.push(Number(token.slice(1, -1)));
    }
    return { segments, rest: text.slice(match[0].length).trim() };
};

const formatPath = (segments) => segments.reduce((path, segment) => (
    typeof segment === "number" ? `${path}[${segment}]`
        : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment) ? `${path}.${segment}` : `${path}[${JSON.stringify(segment)}]`
), "$");

const valueAt = (root, segments) => segments.reduce(
    (node, segment) => (node === null || node === undefined ? undefined : node[segment]),
    root,
);

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

// The one removal this error allows, or null. In order of how little it takes
// away: surplus items, a property, the list item around the fault.
const planRemoval = (root, segments, rest) => {
    const parent = valueAt(root, segments.slice(0, -1));
    const leaf = segments.at(-1);
    const target = valueAt(root, segments);

    // "must contain at most N items": keep the first N, in the model's own order.
    const surplus = rest.match(/^must contain at most (\d+) items/);
    if (surplus && Array.isArray(target)) {
        const keep = Number(surplus[1]);
        return { kind: "truncate", path: segments, keep, removedCount: target.length - keep };
    }

    // A property that is wrong in itself and can simply go: one the schema does
    // not know, or one with a bad value. A MISSING property, or a list that is too
    // short, cannot be fixed by removing it — that falls to the list item below.
    const unfixableHere = /^(is required|must contain at least)/.test(rest);
    if (!unfixableHere && segments.length > 0 && typeof leaf === "string" && isRecord(parent)
        && Object.prototype.hasOwnProperty.call(parent, leaf)) {
        return { kind: "property", path: segments };
    }

    // The innermost list item the fault sits in.
    for (let depth = segments.length; depth > 0; depth -= 1) {
        if (typeof segments[depth - 1] !== "number") continue;
        const list = valueAt(root, segments.slice(0, depth - 1));
        if (Array.isArray(list) && segments[depth - 1] < list.length) {
            return { kind: "item", path: segments.slice(0, depth) };
        }
    }
    return null;
};

const applyRemoval = (root, removal) => {
    const parent = valueAt(root, removal.path.slice(0, -1));
    const leaf = removal.path.at(-1);
    if (removal.kind === "truncate") {
        valueAt(root, removal.path).length = removal.keep;
        return;
    }
    if (removal.kind === "property") {
        delete parent[leaf];
        return;
    }
    parent.splice(leaf, 1);
};

export const SCHEMA_SALVAGE_MAX_REMOVALS = 24;

// validate(value) → { valid, error }. `value` is repaired IN PLACE (the caller
// owns it: it is a fresh parse of the model's answer) and also returned.
//
// `describe(value, path)` may name what a path belongs to ("the event "Fall of
// Kyiv""), so a removal can be reported in the model's own terms.
// `protectedPathPrefixes` marks state-bearing subtrees that salvage may inspect
// but must never repair by deletion; the original validation error is retained.
export const salvageBySchema = (value, validate, {
    maxRemovals = SCHEMA_SALVAGE_MAX_REMOVALS,
    describe = null,
    protectedPathPrefixes = [],
} = {}) => {
    const removed = [];
    let verdict = validate(value);
    // Every pass takes something away, so this ends; the cap is what stops an
    // answer that is wrong everywhere from being taken apart piece by piece.
    while (!verdict.valid && removed.length < maxRemovals) {
        if (!isRecord(value) && !Array.isArray(value)) break;
        const parsed = parseErrorPath(verdict.error);
        if (!parsed) break;
        const removal = planRemoval(value, parsed.segments, parsed.rest);
        if (!removal) break;
        const removalPath = formatPath(removal.path);
        const protectedRemoval = protectedPathPrefixes.some((prefix) => {
            const normalized = String(prefix ?? "").trim();
            if (!normalized) return false;
            return removalPath === normalized
                || removalPath.startsWith(`${normalized}[`)
                || removalPath.startsWith(`${normalized}.`);
        });
        if (protectedRemoval) break;
        let label = "";
        try {
            label = describe ? String(describe(value, removal.path) ?? "") : "";
        } catch {
            label = "";
        }
        applyRemoval(value, removal);
        removed.push({
            kind: removal.kind,
            path: formatPath(removal.path),
            error: String(verdict.error),
            ...(removal.kind === "truncate" ? { removedCount: removal.removedCount } : {}),
            ...(label ? { label } : {}),
        });
        verdict = validate(value);
    }
    return { value, valid: Boolean(verdict.valid), error: verdict.valid ? "" : String(verdict.error ?? ""), removed };
};

// One line per removal, in words the model can act on next turn.
export const describeSchemaRemoval = (removal) => {
    const where = removal.label ? `${removal.label}: ` : "";
    const why = String(removal.error ?? "").replace(/\s+/g, " ").trim();
    if (removal.kind === "truncate") return `${where}${removal.removedCount} item(s) beyond the allowed length were left out (${why})`;
    if (removal.kind === "property") return `${where}the field ${removal.path} was malformed and was left out (${why})`;
    return `${where}${removal.path} was malformed and was left out whole (${why})`;
};
