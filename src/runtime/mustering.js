/*! Open Historia — how long calling up an army takes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2. A country's levies are not all there on a war's first
// morning (runtime/fronts/muster.js). How long they take is a CURVE through
// (0, 0) and two points a scenario's designer gives (warSettings.js muster,
// or a country's own: militaryStats.js), each [share of the army, days]:
//
//   days(p) = A (e^(B p) - 1)
//
// the more of its people a country calls up, the longer each further share
// takes. With the second point further out than a straight line through the
// first would put it, the curve bends up (B > 0): the first levies come
// quickly and the last slowly. A designer may also give one that bends the
// other way (B < 0), or lies on the straight line (B = 0).
//
// The engine may not use an exponential (its rule: only + - * / and square
// roots), so it is handed the curve as a TABLE: the share of the army
// mustered on each day since the call-up began (musterTable), worked out
// here and rounded, the same on every machine.

export const DEFAULT_MUSTER = Object.freeze([Object.freeze([0.5, 21]), Object.freeze([1, 90])]);
// The longest a table runs, in days: past its end everybody has come.
export const MUSTER_TABLE_DAYS_MOST = 730;

const valid = (points) => Array.isArray(points) && points.length === 2
  && points.every((point) => Array.isArray(point) && point[0] > 0 && point[0] <= 1 && point[1] > 0)
  && points[1][0] > points[0][0] && points[1][1] > points[0][1];

// A and B of the curve through (0, 0) and the two points. { A, B }, with B = 0
// for the straight line (days = A p).
export const fitMuster = (points) => {
  const [[p1, d1], [p2, d2]] = valid(points) ? points : DEFAULT_MUSTER;
  const wanted = d2 / d1;
  const straight = p2 / p1;
  if (Math.abs(wanted - straight) < 1e-9) return { A: d1 / p1, B: 0 };
  // r(B) = (e^(B p2) - 1) / (e^(B p1) - 1) runs from p2 / p1 (B = 0) upward as B grows, downward as it falls.
  const ratio = (B) => (Math.abs(B) < 1e-12 ? straight : Math.expm1(B * p2) / Math.expm1(B * p1));
  let low = wanted > straight ? 0 : -60;
  let high = wanted > straight ? 60 : 0;
  for (let step = 0; step < 200; step += 1) {
    const middle = (low + high) / 2;
    if (ratio(middle) < wanted) low = middle;
    else high = middle;
  }
  const B = (low + high) / 2;
  return { A: d1 / Math.expm1(B * p1), B };
};

// The days the curve gives a share of the army, 0 to 1.
export const musterDays = ({ A, B }, share) => (B === 0 ? A * share : A * Math.expm1(B * share));

// The share of the army mustered on each day since the call-up began: day 0
// is 0, and the table ends on the first day everybody has come (or at
// MUSTER_TABLE_DAYS_MOST). Rounded to 1e-4, never falling.
export const musterTable = (points) => {
  const curve = fitMuster(points);
  const share = (day) => {
    if (curve.B === 0) return day / curve.A;
    const inside = 1 + day / curve.A;
    return inside > 0 ? Math.log(inside) / curve.B : 1;
  };
  const table = [0];
  for (let day = 1; day <= MUSTER_TABLE_DAYS_MOST; day += 1) {
    const value = Math.round(Math.min(1, Math.max(table[day - 1], share(day))) * 1e4) / 1e4;
    table.push(value);
    if (value >= 1) break;
  }
  return table;
};

// A curve's points for drawing it (MusterChart.jsx): `count` points [days, share] from 0 to everybody.
export const musterCurvePoints = (points, count = 48) => {
  const curve = fitMuster(points);
  return Array.from({ length: count + 1 }, (_, index) => {
    const part = index / count;
    return [Math.round(musterDays(curve, part) * 10) / 10, part];
  });
};
