/*! Open Historia — the troops that take a region the story says was taken, away from any battlefield © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A REGION AN EVENT SAYS WAS TAKEN, AWAY FROM ANY BATTLEFIELD. "make sure the
// simulation ai is able to say that a region is taken by an army which causes
// the nearest troops to move accordingly so when that event happens, the region
// has been taken"; "the max number of nearby units redirected should be based
// on the size of the region. there should also be a minimum number and if that
// minimum is not met then the region transfer fails" (the owner, 2026-10-28).
// A control operation giving a region to a power asks as many of its land
// formations (not garrisons, not covert, not fighting on a battlefield) as the
// region's size does (fronts/constants.js takersFor): those already in it, those
// the event itself sends there, and those within STORY_MARCH_KM. With fewer than
// the least, the operation comes off the event and the region is not taken;
// otherwise the nearest march in, up to the most. A region on an open
// battlefield the taker fights on is the front engine's (engine.js
// captureRefused, marchInto).
//
// The answer's events are read in their order, and a formation that marched in
// one event stands where it marched for the events after it: the army that took
// a port in March is the army that is near the capital in April. It used to
// count from where it stood before the whole answer and was spent on the first
// capture, so an invasion's second city (Baghdad, after Basra) was refused for
// want of troops the first had just brought up. Within one event a formation
// goes to one region only.
//
// Moved out of gameplay.js so it can be tested; the map is read by the caller
// (lookupContext: rows with geometry, bbox and centroid, and resolveOwner).

import { noteReceipt } from "../../runtime/applicationReceipt.js";
import { takersFor } from "../../runtime/fronts/constants.js";
import { pointInFrame } from "../../runtime/fronts/frame.js";
import { normalizeBattlefields } from "../../runtime/fronts/record.js";
import { currentMapMeasure } from "../../runtime/mapMeasure.js";
import { kmPerDegreeAt } from "../../../server/mapDistance.js";
import { distanceKm as placementDistanceKm, nearestInteriorPoint, pointInGeometry } from "./placement.js";
import { foldRegionKey } from "./regionMatch.js";

const normalizeString = (value) => (typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim());
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

export const STORY_MARCH_KM = 800;
export const STORY_MARCHERS = new Set(["infantry", "armor", "artillery"]);
const LAND_UNIT_TYPES = new Set(["infantry", "armor", "artillery", "garrison"]);

// A region's area in km², near enough: each ring's own shoelace on a plane
// scaled to the ring's latitude (by the map's measure, server/mapDistance.js,
// where it is not plain Mercator), holes taken off.
export const geometryAreaKm2 = (geometry) => {
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  const ringKm2 = (ring) => {
    const points = normalizeArray(ring);
    if (points.length < 3) return 0;
    const lat = points.reduce((sum, point) => sum + Number(point?.[1] || 0), 0) / points.length;
    const measure = currentMapMeasure();
    const per = measure.plain ? null : kmPerDegreeAt(measure, points.reduce((sum, point) => sum + Number(point?.[0] || 0), 0) / points.length, lat);
    const kx = per ? per.x : 111.32 * Math.cos((lat * Math.PI) / 180);
    const ky = per ? per.y : 110.57;
    let twice = 0;
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];
      twice += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky);
    }
    return Math.abs(twice) / 2;
  };
  let total = 0;
  for (const polygon of normalizeArray(polygons)) {
    normalizeArray(polygon).forEach((ring, index) => {
      total += index === 0 ? ringKm2(ring) : -ringKm2(ring);
    });
  }
  return Math.max(0, total);
};

// Mutates the events' impacts; returns how many formations moved.
export const marchStoryCapturers = (containers, world, { receipt = null, context } = {}) => {
  const units = normalizeArray(world?.units);
  const pending = normalizeArray(containers).filter(({ impacts }) => normalizeArray(impacts?.regionControlOps)
    .some((op) => normalizeString(op?.op).toLowerCase() === "control" && op?.wholeCountry !== true && normalizeString(op?.regionId) && normalizeString(op?.toCode)));
  if (!pending.length || !units.length || !context) return 0;
  const rowById = new Map(normalizeArray(context.rows).filter((row) => row.geometry).map((row) => [normalizeString(row.id), row]));
  const labelOf = (name) => context.resolveOwner?.(name) || normalizeString(name);
  const samePower = (a, b) => Boolean(foldRegionKey(labelOf(a))) && foldRegionKey(labelOf(a)) === foldRegionKey(labelOf(b));
  const pointOf = (unit) => (Number.isFinite(Number(unit?.lng)) && Number.isFinite(Number(unit?.lat)) && !(Number(unit.lng) === 0 && Number(unit.lat) === 0)
    ? [Number(unit.lng), Number(unit.lat)] : null);
  // Where each formation stands as the answer is read: moved by an event's own
  // unitOps and by the marches below, for the events after.
  const standsAt = new Map();
  const whereIs = (unit) => standsAt.get(unit.id) ?? pointOf(unit);
  const inside = (row, point) => Boolean(point) && point[0] >= row.bbox[0] && point[0] <= row.bbox[2] && point[1] >= row.bbox[1] && point[1] <= row.bbox[3]
    && pointInGeometry(point, row.geometry);
  // The open battlefields, by their frames, and who fights on each.
  const fronts = normalizeBattlefields(world?.battlefields).filter((record) => record.status === "active" && record.frame);
  const onFront = (row, taker) => {
    const middle = row.centroid ?? [(row.bbox[0] + row.bbox[2]) / 2, (row.bbox[1] + row.bbox[3]) / 2];
    return fronts.some((record) => pointInFrame(record.frame, middle[0], middle[1])
      && record.sides.some((members) => members.some((member) => samePower(member, taker))));
  };
  let moved = 0;
  for (const { event, impacts, path } of pending) {
    const ownMoves = normalizeArray(impacts.unitOps).map((op) => {
      const kind = normalizeString(op?.op).toLowerCase();
      if (kind === "move") {
        const unit = units.find((entry) => entry.id === normalizeString(op.unitId));
        return unit ? { unit, point: pointOf({ lng: op.toLng, lat: op.toLat }) } : null;
      }
      if (kind === "spawn") {
        const unit = op.unit && typeof op.unit === "object" ? op.unit : op;
        return { unit: { ...unit, ownerCode: unit.ownerCode ?? unit.owner ?? op.ownerCode }, point: pointOf(unit) };
      }
      return null;
    }).filter(Boolean);
    // Sent somewhere by this event: not sent anywhere else in it.
    const sent = new Set();
    const refused = [];
    for (const op of normalizeArray(impacts.regionControlOps)) {
      if (normalizeString(op?.op).toLowerCase() !== "control" || op?.wholeCountry === true) continue;
      const row = rowById.get(normalizeString(op.regionId));
      const taker = normalizeString(op.toCode);
      if (!row || !taker || onFront(row, taker)) continue;
      const centre = nearestInteriorPoint(row.geometry, row.centroid ?? [(row.bbox[0] + row.bbox[2]) / 2, (row.bbox[1] + row.bbox[3]) / 2]);
      if (!centre) continue;
      const { least, most } = takersFor(geometryAreaKm2(row.geometry));
      const arriving = ownMoves.filter(({ unit, point }) => samePower(unit.ownerCode, taker) && LAND_UNIT_TYPES.has(normalizeString(unit.type).toLowerCase()) && inside(row, point)).length;
      const standing = units.filter((unit) => samePower(unit.ownerCode, taker) && STORY_MARCHERS.has(unit.type) && inside(row, whereIs(unit))).length;
      const near = units
        .filter((unit) => !sent.has(unit.id) && STORY_MARCHERS.has(unit.type) && !unit.covert && !normalizeString(unit.committedTo) && samePower(unit.ownerCode, taker)
          && !ownMoves.some((entry) => entry.unit?.id === unit.id) && !inside(row, whereIs(unit)))
        .map((unit) => ({ unit, from: whereIs(unit) }))
        .map((entry) => ({ ...entry, km: entry.from ? placementDistanceKm(entry.from, centre) : Infinity }))
        .filter((entry) => entry.km <= STORY_MARCH_KM)
        .sort((a, b) => a.km - b.km);
      const title = normalizeString(event?.title);
      if (arriving + standing + near.length < least) {
        refused.push(op);
        noteReceipt(receipt, "dropped",
          `${title ? `Event "${title}": ` : ""}${labelOf(taker)} could not take ${row.name}: too few of its troops near `
          + `(${arriving + standing + near.length} of the ${least} a region that size needs). A region is taken only where enough of the taker's troops stand near it, more for a larger region: move them up first, in an earlier event.`);
        console.info(`[story capture] ${path}: ${row.name} not taken by ${labelOf(taker)}, ${arriving + standing + near.length} of ${least} near.`);
        continue;
      }
      for (const { unit, from, km } of near.slice(0, Math.max(0, most - arriving - standing))) {
        const to = nearestInteriorPoint(row.geometry, from) ?? centre;
        sent.add(unit.id);
        standsAt.set(unit.id, to);
        impacts.unitOps = [...normalizeArray(impacts.unitOps), {
          op: "move", unitId: unit.id, toLng: to[0], toLat: to[1],
          note: `Into ${row.name}, which it took.`,
        }];
        moved += 1;
        noteReceipt(receipt, "adjusted",
          `${title ? `Event "${title}": ` : ""}${row.name} was taken by ${labelOf(taker)}, `
          + `so its formation ${unit.name} marched in (${Math.round(km)} km). Move the formation that takes a place in the event that takes it.`);
        console.info(`[story capture] ${path}: ${unit.name} (${labelOf(taker)}) into ${row.name}, ${Math.round(km)} km.`);
      }
    }
    // The event's own moves stand for the events after it.
    for (const { unit, point } of ownMoves) if (unit?.id && point) standsAt.set(unit.id, point);
    if (refused.length) impacts.regionControlOps = normalizeArray(impacts.regionControlOps).filter((op) => !refused.includes(op));
  }
  return moved;
};
