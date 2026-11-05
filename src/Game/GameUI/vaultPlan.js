/*! Open Historia — the vault door's plan © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The numbers of the vault door the app opens on (VaultDoor.jsx draws it):
// how long each part of its opening takes, the three leaves it is made of,
// and how deep it looks as they part. Plain data and arithmetic, apart from
// the drawing, so that it can be checked.

// How long each part takes, in milliseconds. The door is left alone at
// first: it shudders only once it has gone ten seconds without being touched,
// and every five seconds after that (the owner, 2026-10-13: "only start
// shaking after 10 seconds of not being touched, then every 5 seconds after
// that"). A touch that is not on the wheel starts the ten seconds again.
export const VAULT_TIMING = Object.freeze({
  firstShake: 10000,
  shakeEvery: 5000,
  shake: 520,
  spin: 1500,
  bolts: 380,
  open: 1800,
  fade: 350,
});

// The three leaves, as shapes over the whole screen (percentages of it), and
// where each goes when the door opens. They meet at the middle of the screen;
// the two upper seams reach the sides at 15% of the height.
//   `away`  where it goes, as the leaf's own translate();
//   `move`  the same, as shares of the screen's width and height;
//   `seams` its sides that meet the other leaves, each from the middle of the
//           screen outward, as shares of the screen: the sides that are seen
//           as it moves away.
export const VAULT_LEAVES = Object.freeze([
  Object.freeze({
    name: "top",
    shape: "polygon(0% 0%, 100% 0%, 100% 15%, 50% 50%, 0% 15%)",
    away: "translate(0%, -66%)",
    move: Object.freeze([0, -0.66]),
    seams: Object.freeze([Object.freeze([[0.5, 0.5], [1, 0.15]]), Object.freeze([[0.5, 0.5], [0, 0.15]])]),
  }),
  Object.freeze({
    name: "left",
    shape: "polygon(0% 15%, 50% 50%, 50% 100%, 0% 100%)",
    away: "translate(-72%, 72%)",
    move: Object.freeze([-0.72, 0.72]),
    seams: Object.freeze([Object.freeze([[0.5, 0.5], [0, 0.15]]), Object.freeze([[0.5, 0.5], [0.5, 1]])]),
  }),
  Object.freeze({
    name: "right",
    shape: "polygon(100% 15%, 100% 100%, 50% 100%, 50% 50%)",
    away: "translate(72%, 72%)",
    move: Object.freeze([0.72, 0.72]),
    seams: Object.freeze([Object.freeze([[0.5, 0.5], [1, 0.15]]), Object.freeze([[0.5, 0.5], [0.5, 1]])]),
  }),
]);

// How deep the door looks as it opens. Its leaves are slabs of steel, not
// sheets (the owner, 2026-10-14: "the vault doors currently look thin and 2d
// when they open"; "make a paralax effect on an inner visible side of the vault
// doors to make it very realistic"). So as a leaf moves away, its inner sides,
// the faces along its seams, come into view, seen from where the eye is: in
// front of the middle of the screen. The back of a side is `back` of the way
// from its front to the middle of the screen, so it moves with the leaf by
// less than the front does: the far edge lags behind the near one, as it
// would. The farther a seam has gone from the middle, the more of its side is
// seen.
//   back          of the way from a side's front to the middle of the screen
//                 (0.2 at first, which shifted too much: "the perspective
//                 shift on the inner edge of the safe is too extreme. it shifts
//                 too much", the owner, 2026-10-14);
//   thickness     the door's thickness seen face-on, a share of the shorter
//                 side of the screen (for the size of what is on a side);
//   door          the round door's radius (DoorFace: 440 of 1000), the same
//                 share: along a seam, the door is up to here and the wall
//                 beyond;
//   sockets       where the locking bolts' sockets are along each side of the
//                 round door, the same share, from the middle;
//   socketRadius  their radius, a share of the door's thickness.
export const VAULT_DEPTH = Object.freeze({
  back: 0.07,
  thickness: 0.3,
  door: 0.44,
  sockets: Object.freeze([0.15, 0.26, 0.37]),
  socketRadius: 0.17,
});

// The curve the leaves move on, as CSS draws cubic-bezier(x1, y1, x2, y2): t
// (the share of the time gone, 0 to 1) to the share of the way gone.
export const cubicBezier = (x1, y1, x2, y2) => {
  const along = (a, b, s) => 3 * a * (1 - s) * (1 - s) * s + 3 * b * (1 - s) * s * s + s * s * s;
  const slope = (a, b, s) => 3 * a * (1 - s) * (1 - s) + 6 * (b - a) * (1 - s) * s + 3 * (1 - b) * s * s;
  return (t) => {
    if (!(t > 0)) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let step = 0; step < 8; step += 1) {
      const off = along(x1, x2, s) - t;
      if (Math.abs(off) < 1e-7) break;
      const rate = slope(x1, x2, s);
      if (Math.abs(rate) < 1e-7) break;
      s -= off / rate;
    }
    if (!(s >= 0 && s <= 1) || Math.abs(along(x1, x2, s) - t) > 1e-5) {
      let low = 0;
      let high = 1;
      for (let step = 0; step < 50; step += 1) {
        s = (low + high) / 2;
        if (along(x1, x2, s) < t) low = s;
        else high = s;
      }
    }
    return along(y1, y2, s);
  };
};

// The leaves' own curve: slow to start, as a heavy thing is.
export const VAULT_EASE = cubicBezier(0.55, 0.05, 0.3, 1);

// Where a leaf is, `progress` of the way out (0 shut, 1 open), on a screen
// `width` × `height` pixels: [x, y] in pixels.
export const leafOffset = (leaf, progress, width, height) => [leaf.move[0] * width * progress, leaf.move[1] * height * progress];

// A leaf's inner sides `progress` of the way out, in pixels: for each seam,
// its `front` (two points, moved with the leaf, the first at the middle end)
// and its `back` (the same two drawn `back` of the way toward the middle of the
// screen), and `facing`, the way the side looks: a unit vector across the
// screen, from its front toward its back.
export const vaultSides = (leaf, progress, width, height, back = VAULT_DEPTH.back) => {
  const [dx, dy] = leafOffset(leaf, progress, width, height);
  const cx = width / 2;
  const cy = height / 2;
  const toBack = ([x, y]) => [cx + (x - cx) * (1 - back), cy + (y - cy) * (1 - back)];
  return leaf.seams.map(([from, to]) => {
    const front = [[from[0] * width + dx, from[1] * height + dy], [to[0] * width + dx, to[1] * height + dy]];
    const behind = front.map(toBack);
    const across = [(behind[0][0] + behind[1][0] - front[0][0] - front[1][0]) / 2, (behind[0][1] + behind[1][1] - front[0][1] - front[1][1]) / 2];
    const length = Math.hypot(across[0], across[1]);
    return { front, back: behind, facing: length > 1e-9 ? [across[0] / length, across[1] / length] : [0, 0] };
  });
};

// How much light a side catches, 0 to 1: the light comes from the upper left
// and from in front, and a side turned toward the upper left catches most.
export const sideLight = (facing) => {
  const toLight = -(facing[0] + facing[1]) / Math.SQRT2;
  return Math.max(0, Math.min(1, 0.42 + 0.5 * toLight));
};
