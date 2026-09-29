/*! Open Historia — Country Editor: what a Save writes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Country Editor (Cheats) loads a country's sheet into a form once, and a
// turn may change the country while the form is open. A Save therefore writes
// only what the player changed since the form loaded: writing every field put
// back the stability, leader and party the turn had just moved.

export const editorNumber = (value, { min = -Infinity, max = Infinity, label = "Value" } = {}) => {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} must be a number.`);
    if (number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}.`);
    return number;
};

// The form keys whose value differs from the one the form loaded with.
export const changedEditorFields = (form = {}, loaded = {}) => {
    const keys = new Set([...Object.keys(form ?? {}), ...Object.keys(loaded ?? {})]);
    return new Set([...keys].filter((key) => String(form?.[key] ?? "") !== String(loaded?.[key] ?? "")));
};

// Whether a structured editor state (the Political World form) was edited.
export const editorStateChanged = (current, loaded) => JSON.stringify(current ?? null) !== JSON.stringify(loaded ?? null);

const INDEX_FIELDS = [
    ["sovereignty", "Sovereignty"],
    ["foodAutonomy", "Food autonomy"],
    ["energyAutonomy", "Energy autonomy"],
    ["economicIndependence", "Economic independence"],
    ["internalSecurity", "Internal security"],
    ["internationalReputation", "International reputation"],
];

const SECTOR_FIELDS = [
    ["agriculture", "Agriculture share"],
    ["industry", "Industry share"],
    ["services", "Services share"],
];

const actorLeaderName =(actor) => {
    const leader = actor?.government?.headOfGovernment || actor?.government?.headOfState || actor?.leader;
    if (!leader) return "";
    return String(typeof leader === "string" ? leader : leader?.name || "").trim();
};

// The stat-sheet patch a Save writes, from the fields in `changed` only; the
// government form and leader come from `politicalActor`, passed only when the
// political form was edited. A field left blank is not written. Null when
// there is nothing to write.
export const countryStatPatchFromForm = ({ form = {}, changed = new Set(), politicalActor = null } = {}) => {
    const number = (key, bounds) => (changed.has(key) ? editorNumber(form[key], bounds) : null);
    const text = (key) => (changed.has(key) ? String(form[key] ?? "").trim() : "");

    const populationM = number("populationM", { min: 0.001, max: 20000, label: "Population (millions)" });
    const gdpB = number("gdpB", { min: 0.001, max: 1000000, label: "GDP (billions)" });
    const stability = number("stability", { min: 0, max: 100, label: "Stability" });
    const economy = {};
    const gdpGrowth = number("gdpGrowth", { min: -1000, max: 1000, label: "GDP growth" });
    const inflation = number("inflation", { min: -1000, max: 1000, label: "Inflation" });
    const unemployment = number("unemployment", { min: 0, max: 100, label: "Unemployment" });
    const publicDebt = number("publicDebt", { min: 0, max: 1000, label: "Public debt" });
    const budgetBalance = number("budgetBalance", { min: -1000, max: 1000, label: "Budget balance" });
    if (gdpB != null) economy.gdp = Math.round(gdpB * 1e9);
    if (gdpGrowth != null) economy.gdpGrowth = gdpGrowth;
    if (inflation != null) economy.inflation = inflation;
    if (unemployment != null) economy.unemployment = unemployment;
    if (publicDebt != null) economy.publicDebt = publicDebt;
    if (budgetBalance != null) economy.budgetBalance = budgetBalance;
    if (text("currency")) economy.currency = text("currency");

    const indices = {};
    for (const [key, label] of INDEX_FIELDS) {
        const value = number(key, { min: 0, max: 100, label });
        if (value != null) indices[key] = value;
    }

    // The three shares move together (the form rebalances the other two), so
    // a change to any of them writes all three.
    let gdpBreakdown = null;
    if (SECTOR_FIELDS.some(([key]) => changed.has(key))) {
        const shares = SECTOR_FIELDS.map(([key, label]) => editorNumber(form[key], { min: 0, max: 100, label }));
        if (shares.some((value) => value != null)) {
            if (shares.some((value) => value == null)) throw new Error("Set all three GDP-sector shares together.");
            gdpBreakdown = { agriculture: shares[0], industry: shares[1], services: shares[2] };
        }
    }

    const government = String(politicalActor?.government?.form ?? "").trim();
    const leader = politicalActor ? actorLeaderName(politicalActor) : "";

    const patch = {
        ...(text("capital") ? { capital: text("capital") } : {}),
        ...(text("continent") ? { continent: text("continent") } : {}),
        ...(government ? { government } : {}),
        ...(leader ? { leader } : {}),
        ...(stability == null ? {} : { stability }),
        ...(Object.keys(indices).length ? { indices } : {}),
        ...(populationM == null ? {} : { population: { total: Math.round(populationM * 1e6) } }),
        ...(Object.keys(economy).length ? { economy } : {}),
        ...(gdpBreakdown ? { gdpBreakdown } : {}),
    };
    return Object.keys(patch).length ? patch : null;
};
