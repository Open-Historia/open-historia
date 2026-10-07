/*! Open Historia — military posts on other powers' land © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A garrison or a base is placed straight onto a power's own land: holding
// ground is what lets it post one there. On another power's land it is a
// deployment, and something has to deploy it: one of the power's formations
// standing within POST_REACH_KM, or sent there by the same turn. Asked for by a
// player (2026-09-29): "a garrison or forward operating base in another
// polity's land needs a unit to deploy it."
//
// Pure, and imports only placement.js, so it runs under bare node.

import { distanceKm } from "./placement.js";

export const POST_REACH_KM = 50;

const text = (value) => String(value ?? "").trim();

// A structure's kind is free-form, so a military post is known by its words.
const POST_WORDS = /\b(?:garrisons?|bases?|airbases?|air ?fields?|outposts?|forts?|fortress(?:es)?|camps?|barracks|cantonments?|fob|forward operating)\b/i;

// Whether a new unit or structure is a military post: a garrison unit, or a
// structure whose kind or name says base, fort, garrison and the like.
export const isMilitaryPost = (thing, family) => (family === "unit"
    ? text(thing?.type).toLowerCase() === "garrison"
    : POST_WORDS.test(`${text(thing?.kind)} ${text(thing?.name)}`));

// Whether a post at `point`, owned by `owner` on ground `groundOwner` holds, is
// refused: on another power's ground with none of its owner's formations within
// reach. `formations` are [{ owner, point: [lng, lat] }]; `same(a, b)` says two
// names are one power. Ground no one holds (the sea) is no one's to refuse it.
export const postWantsFormation = ({ owner, groundOwner, point, formations = [], same = (a, b) => text(a) === text(b) }) => {
    if (!text(groundOwner) || !text(owner) || same(owner, groundOwner)) return false;
    return !formations.some((formation) => same(formation?.owner, owner)
        && Array.isArray(formation?.point)
        && distanceKm(formation.point, point) <= POST_REACH_KM);
};

// The note for the model: what was refused, and what to do instead.
export const describeRefusedPost = ({ title = "", name = "", owner = "", groundOwner = "" }) =>
    `${text(title) ? `Event "${text(title)}": ` : ""}${text(name) || "A post"} was not placed: it stands on ${text(groundOwner)}'s land, `
    + `and none of ${text(owner)}'s formations is within ${POST_REACH_KM} km to deploy it. `
    + `Move one of ${text(owner)}'s formations there first; the post can follow once it has arrived.`;
