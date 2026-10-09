/*! Open Historia — military posts on other powers' land © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A garrison or a base is placed straight onto a power's own land: holding
// ground is what lets it post one there. On another power's land it is a
// deployment, and something deploys it: one of the power's formations
// standing within POST_REACH_KM, or sent there by the same turn. Asked for by a
// player (2026-09-29): "a garrison or forward operating base in another
// polity's land needs a unit to deploy it."
//
// The post is ALWAYS placed. It used to be taken out of its turn when no
// formation was in reach, and the turn's own event went on saying it had been
// built: a 45-skip test (2026-10-09) emplaced a missile battery in an ally's
// country, in words, and the map never showed it. What an event says was built
// stands on the map. Where no formation of its owner is near, the model is
// told so, and told to station one there: the rule is kept by what happens
// next, not by losing the post.
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

// Whether a post at `point`, owned by `owner` on ground `groundOwner` holds,
// stands with nothing to deploy it: on another power's ground with none of its
// owner's formations within reach. `formations` are [{ owner, point: [lng, lat] }]; `same(a, b)` says two
// names are one power. Ground no one holds (the sea) is no one's to refuse it.
export const postWantsFormation = ({ owner, groundOwner, point, formations = [], same = (a, b) => text(a) === text(b) }) => {
    if (!text(groundOwner) || !text(owner) || same(owner, groundOwner)) return false;
    return !formations.some((formation) => same(formation?.owner, owner)
        && Array.isArray(formation?.point)
        && distanceKm(formation.point, point) <= POST_REACH_KM);
};

// The note for the model: the post stands, and what it still wants.
export const describeUndeployedPost = ({ title = "", name = "", owner = "", groundOwner = "" }) =>
    `${text(title) ? `Event "${text(title)}": ` : ""}${text(name) || "A post"} was placed on ${text(groundOwner)}'s land, as the event says, `
    + `with none of ${text(owner)}'s formations within ${POST_REACH_KM} km of it. `
    + `Station one of ${text(owner)}'s formations there to hold it: move one there in an event of the next period.`;
