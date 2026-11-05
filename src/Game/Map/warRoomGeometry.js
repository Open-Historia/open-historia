/*! Open Historia — the war room's planned movements as shapes for the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A plan (runtime/fronts/plans.js) is drawn as an arrow that has not been
// walked: a broken line along its way with a head at the end, in a colour that
// says whose it is and what kind. Of the player's own, only a movement still
// to be made is drawn: once time has passed over it, it is being carried out
// (or has been), what its troops did is on the map already, and its arrow is
// shown only while the panel points at it:
//
//   own      a movement the player's troops are to make: an order, a route
//   project  a Board operation's, brighter when it is under way
//   decoy    a diversion: dotted, to be stolen
//   known    what the player's agents and Board have of the other side's
//   deploy   the line the player's new troops come in on (runtime/fronts/deploy.js):
//            a line and no head, since nothing moves along it; or, for a swarm
//            (runtime/fronts/swarms.js), the place they gather at: a spot
//
// Pure: it takes the plans and gives GeoJSON, so it is tested without a map.

const RAD = Math.PI / 180;

export const PLAN_COLOURS = Object.freeze({
  own: "#f4f7fb",
  project: "#2bc1f3",
  idle: "#93a1b5",
  decoy: "#ffd24a",
  known: "#ff6b6b",
  deploy: "#3ddc84",
});

// Which of the five a plan is drawn as.
//   theirs   true for a plan of the other side
export const planTone = (plan, { theirs = false } = {}) => {
  if (theirs) return "known";
  if (plan.kind === "deploy") return "deploy";
  if (plan.kind === "diversion") return "decoy";
  if (plan.kind === "project") return plan.live && !plan.done ? "project" : "idle";
  if (plan.project) return "project";
  return "own";
};

// A way with its corners cut, so that a route of a dozen points reads as one
// stroke. The ends stay where they are.
export const smoothWay = (way, rounds = 2) => {
  let points = way;
  for (let round = 0; round < rounds && points.length >= 3; round += 1) {
    const next = [points[0]];
    for (let index = 0; index + 1 < points.length; index += 1) {
      const [ax, ay] = points[index];
      const [bx, by] = points[index + 1];
      if (index > 0) next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      if (index + 2 < points.length) next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(points[points.length - 1]);
    points = next;
  }
  return points;
};

// How long a way is, in degrees of latitude (longitude shortened as it is on the ground).
const lengthOf = (way) => {
  let total = 0;
  for (let index = 1; index < way.length; index += 1) {
    const shrink = Math.cos(((way[index][1] + way[index - 1][1]) / 2) * RAD);
    const dx = (way[index][0] - way[index - 1][0]) * shrink;
    const dy = way[index][1] - way[index - 1][1];
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
};

// The head of an arrow at the end of a way: a triangle whose point is the
// way's last point, as a ring of [lng, lat]. null for a way with no direction.
export const arrowHead = (way) => {
  if (way.length < 2) return null;
  const tip = way[way.length - 1];
  // The direction of the last stretch long enough to have one.
  let from = null;
  for (let index = way.length - 2; index >= 0; index -= 1) {
    const dx = tip[0] - way[index][0];
    const dy = tip[1] - way[index][1];
    if (dx * dx + dy * dy > 1e-8) {
      from = way[index];
      break;
    }
  }
  if (!from) return null;
  const shrink = Math.max(0.1, Math.cos(tip[1] * RAD));
  const dx = (tip[0] - from[0]) * shrink;
  const dy = tip[1] - from[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / length;
  const uy = dy / length;
  // A head an eighth as long as its arrow, held between two sizes.
  const size = Math.max(0.09, Math.min(0.32, lengthOf(way) * 0.13));
  const back = [tip[0] - (ux * size) / shrink, tip[1] - uy * size];
  const half = size * 0.55;
  const left = [back[0] - (uy * half) / shrink, back[1] + ux * half];
  const right = [back[0] + (uy * half) / shrink, back[1] - ux * half];
  return [tip, left, right, tip];
};

// The middle of a way by its length, for the name that goes with it.
const middleOf = (way) => {
  const half = lengthOf(way) / 2;
  let walked = 0;
  for (let index = 1; index < way.length; index += 1) {
    const shrink = Math.cos(((way[index][1] + way[index - 1][1]) / 2) * RAD);
    const dx = (way[index][0] - way[index - 1][0]) * shrink;
    const dy = way[index][1] - way[index - 1][1];
    const step = Math.sqrt(dx * dx + dy * dy);
    if (walked + step >= half && step > 0) {
      const part = (half - walked) / step;
      return [way[index - 1][0] + (way[index][0] - way[index - 1][0]) * part, way[index - 1][1] + (way[index][1] - way[index - 1][1]) * part];
    }
    walked += step;
  }
  return way[way.length - 1];
};

// The plans of both sides as one GeoJSON collection: for each way a line and
// a head, and for a plan with a name its name once.
//   plans, known   as plansOf / knownPlans give them
//   pointed        the id of the plan the panel points at
//   labelOf(plan)  the words to set beside a plan, or ""
export const planFeatures = ({ plans = [], known = [], pointed = "", labelOf = () => "" } = {}) => {
  const features = [];
  const add = (plan, theirs) => {
    const tone = planTone(plan, { theirs });
    const properties = { plan: plan.id, tone, colour: PLAN_COLOURS[tone], pointed: plan.id === pointed, decoy: tone === "decoy", deploy: tone === "deploy" };
    // A swarm's deployment is a place, not a line.
    if (tone === "deploy" && plan.form === "swarm") {
      const spot = Array.isArray(plan.ways?.[0]?.[0]) ? plan.ways[0][0] : null;
      if (spot && Number.isFinite(Number(spot[0])) && Number.isFinite(Number(spot[1]))) {
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: [Number(spot[0]), Number(spot[1])] }, properties: { ...properties, what: "spot" } });
      }
      return;
    }
    let named = false;
    for (const raw of Array.isArray(plan.ways) ? plan.ways : []) {
      if (!Array.isArray(raw) || raw.length < 2) continue;
      const way = smoothWay(raw);
      const head = tone === "deploy" ? null : arrowHead(way);
      // The line stops short of the point of its head, so the two do not blur.
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: way }, properties: { ...properties, what: "way" } });
      if (head) features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [head] }, properties: { ...properties, what: "head" } });
      const label = named ? "" : String(labelOf(plan, theirs) ?? "").trim();
      if (label) {
        named = true;
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: middleOf(way) }, properties: { ...properties, what: "name", label } });
      }
    }
  };
  for (const plan of plans) if ((!plan.begun && !plan.done) || plan.id === pointed) add(plan, false);
  for (const plan of known) add(plan, true);
  return { type: "FeatureCollection", features };
};
