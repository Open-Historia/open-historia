// Canonical bilateral-relation summaries are plain text, not serialized ledger
// records. The compact relation transport reserves "~" as its field separator;
// a separator inside a decoded summary signals swallowed fields/other updates.
// Use this same invariant when accepting new mutations and reading older saves.
export const hasMalformedRelationSummary = (value) => String(value ?? "").includes("~");
