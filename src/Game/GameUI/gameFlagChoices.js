// The flag picker's "In this game" list (GameFlagPicker.jsx): every image the
// campaign's flags.json holds, once each, with every name that uses it.
//
// The search runs over the whole store before anything is cut, and matches any
// of an image's names, so a flag several polities share is found by each of
// them. Only what is drawn is capped (GAME_FLAG_LIMIT), and the picker says so.

export const GAME_FLAG_LIMIT = 120;

const str = (value) => String(value ?? "").trim();

// { choices: [{ imageUrl, label, names }], stored } — `stored` counts the
// distinct images in the store, whatever the query; `label` is the first name
// that matches the query (the first name when there is none).
export const gameFlagChoices = (flags, query = "") => {
    const byImage = new Map();
    for (const [name, value] of Object.entries(flags && typeof flags === "object" ? flags : {})) {
        const imageUrl = str(value);
        if (!imageUrl) continue;
        const names = byImage.get(imageUrl);
        if (names) names.push(name);
        else byImage.set(imageUrl, [name]);
    }
    const q = str(query).toLowerCase();
    const choices = [];
    for (const [imageUrl, names] of byImage) {
        const label = q ? names.find((name) => str(name).toLowerCase().includes(q)) : names[0];
        if (label === undefined) continue;
        choices.push({ imageUrl, label, names });
    }
    return { choices, stored: byImage.size };
};
