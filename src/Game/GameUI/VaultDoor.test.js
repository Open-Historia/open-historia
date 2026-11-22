import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VAULT_DEPTH, VAULT_EASE, VAULT_LEAVES, VAULT_TIMING, cubicBezier, leafOffset, sideLight, vaultSides } from "./vaultPlan.js";
import { DISC_SIZE, PLATE_SIZE, brushedDisc, brushedPlate, seeded, vaultMetal } from "./vaultMetal.js";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const door = read("./VaultDoor.jsx");
const app = read("../../App.jsx");

// A leaf's corners, as percentages of the screen.
const cornersOf = (shape) => [...shape.matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)].map((match) => [Number(match[1]), Number(match[2])]);
const areaOf = (corners) => Math.abs(corners.reduce((sum, [x, y], index) => {
  const [nextX, nextY] = corners[(index + 1) % corners.length];
  return sum + x * nextY - nextX * y;
}, 0)) / 2;
const moveOf = (away) => /translate\((-?[\d.]+)%, (-?[\d.]+)%\)/.exec(away).slice(1).map(Number);

test("the door is three leaves that cover the whole screen and meet in its middle", () => {
  assert.deepEqual(VAULT_LEAVES.map((leaf) => leaf.name), ["top", "left", "right"]);
  // Together they are the screen, no more and no less: nothing of the menu
  // shows through a shut door.
  const total = VAULT_LEAVES.reduce((sum, leaf) => sum + areaOf(cornersOf(leaf.shape)), 0);
  assert.equal(total, 100 * 100);
  for (const leaf of VAULT_LEAVES) {
    assert.ok(cornersOf(leaf.shape).some(([x, y]) => x === 50 && y === 50), `${leaf.name} reaches the middle`);
  }
});

test("the top leaf is drawn up, and the two below are drawn down and outward", () => {
  const moves = Object.fromEntries(VAULT_LEAVES.map((leaf) => [leaf.name, moveOf(leaf.away)]));
  assert.equal(moves.top[0], 0);
  assert.ok(moves.top[1] < 0);
  assert.ok(moves.left[0] < 0 && moves.left[1] > 0);
  assert.ok(moves.right[0] > 0 && moves.right[1] > 0);
  // Mirror images of each other.
  assert.equal(moves.left[0], -moves.right[0]);
  assert.equal(moves.left[1], moves.right[1]);
});

test("each leaf goes far enough to be off the screen altogether", () => {
  for (const leaf of VAULT_LEAVES) {
    const [dx, dy] = moveOf(leaf.away);
    const moved = cornersOf(leaf.shape).map(([x, y]) => [x + dx, y + dy]);
    const off = moved.every(([x]) => x <= 0) || moved.every(([x]) => x >= 100) || moved.every(([, y]) => y <= 0) || moved.every(([, y]) => y >= 100);
    assert.ok(off, `${leaf.name} is clear of the screen when open`);
  }
});

test("left alone for ten seconds it shakes, and every five seconds after that", () => {
  assert.equal(VAULT_TIMING.firstShake, 10000);
  assert.equal(VAULT_TIMING.shakeEvery, 5000);
  assert.ok(VAULT_TIMING.shakeEvery > VAULT_TIMING.shake * 3);
  // The five seconds are counted from the first shake, not from the door appearing.
  assert.match(door, /const first = setTimeout\(\(\) => \{\s+shudder\(\);\s+again = setInterval\(shudder, VAULT_TIMING\.shakeEvery\);\s+\}, VAULT_TIMING\.firstShake\);/);
  // A touch that is not on the wheel starts the ten seconds again.
  assert.match(door, /onPointerDown=\{\(\) => \{ if \(stage === "closed"\) setTouches\(\(count\) => count \+ 1\); \}\}/);
  assert.match(door, /\}, \[stage, still, touches\]\);/);
  assert.match(door, /const shudder = \(\) => \{\s+setShaking\(true\);\s+soundsRef\.current\?\.rattle\(\);/);
  assert.match(door, /animation: shaking \? `oh-vault-shake \$\{VAULT_TIMING\.shake\}ms/);
});

test("clicked, the wheel turns, the bolts draw back, and only then do the leaves part: each with its sound", () => {
  const open = door.slice(door.indexOf("const open = () => {"), door.indexOf('if (stage === "gone") return null;'));
  const order = ["voice?.spin(", "voice?.unlock(), VAULT_TIMING.spin", "voice?.open(", 'setStage("gone")'];
  let from = open.indexOf('setStage("spinning")');
  assert.ok(from > 0);
  for (const step of order) {
    const at = open.indexOf(step, from);
    assert.ok(at > from, step);
    from = at;
  }
  // The leaves start when the bolts are back, and the door is gone when they have gone.
  assert.match(open, /\}, VAULT_TIMING\.spin \+ VAULT_TIMING\.bolts\);/);
  assert.match(open, /VAULT_TIMING\.spin \+ VAULT_TIMING\.bolts \+ VAULT_TIMING\.open \+ \d+\);/);
  // It is the mark that turns, more than once round.
  assert.match(door, /rotate\(\$\{turned && !still \? 540 : 0\}deg\)/);
});

test("the wheel is a button with a name, focused when the door appears, and clicked once", () => {
  assert.match(door, /<button\s+type="button"\s+className="oh-vault-knob"\s+aria-label="Open"\s+autoFocus\s+disabled=\{stage !== "closed"\}\s+onClick=\{open\}/);
  assert.match(door, /if \(stage !== "closed"\) return;/);
});

test("the wheel's shadow turns with it and always falls the same way", () => {
  // The shadow is drawn apart from the wheel: moved outside the turning, turned inside it.
  assert.match(door, /transform: "translate\(1\.3%, 2\.4%\)" \}\}>\s+<div style=\{\{[^\n]+rotate\(\$\{turned && !still \? 540 : 0\}deg\)[^\n]+\}\}>\s+<WheelShadow \/>/);
  // It lies still while the wheel shakes: it is beside the button that shakes, before it, not in it.
  const shadowAt = door.indexOf("<WheelShadow />");
  const buttonAt = door.indexOf('className="oh-vault-knob"');
  assert.ok(shadowAt > 0 && shadowAt < buttonAt);
  assert.doesNotMatch(door.slice(buttonAt, door.indexOf("</button>", buttonAt)), /WheelShadow/);
  // It has the handles' shapes, three of them.
  const shadow = door.slice(door.indexOf("const WheelShadow = "), door.indexOf("// `onOpening`"));
  assert.match(shadow, /\[0, 120, 240\]\.map/);
  assert.match(shadow, /<rect [^>]+\/>\s+<circle cy="-136"/);
  // And nothing inside the turning wheel is a shadow moved off its centre.
  const wheel = door.slice(door.indexOf("const Wheel = "), door.indexOf("const WheelShadow = "));
  assert.doesNotMatch(wheel, /fill="#000"/);
});

test("the mark is nearly the whole of the wheel", () => {
  const wheel = door.slice(door.indexOf("const Wheel = "), door.indexOf("const WheelShadow = "));
  const rim = Number(/<circle r="(\d+)" fill=\{STEEL\.edge\} \/>/.exec(wheel)[1]);
  const mark = Number(/<clipPath id="oh-vault-hub"><circle r="(\d+)" \/><\/clipPath>/.exec(wheel)[1]);
  assert.ok(mark / rim >= 0.8, `the mark is ${mark} of a rim of ${rim}`);
});

test("with Reduce motion on nothing shakes, turns or slides: a click fades the door", () => {
  assert.match(door, /const still = useMemo\(\(\) => reduceMotionEnabled\(\), \[\]\);/);
  assert.match(door, /if \(stage !== "closed" \|\| still\) return undefined;/);
  assert.match(door, /if \(still\) \{[\s\S]+?voice\?\.unlock\(\);[\s\S]+?VAULT_TIMING\.fade\);\s+return;\s+\}/);
  // The leaves are moved, and their sides drawn, only when they may move.
  assert.match(door, /if \(stage !== "opening" \|\| still\) return undefined;/);
});

test("the app shows the door once the startup screen is done, over the menu, and takes it away when it has opened", () => {
  // After the first-time setup, when it is owed (GameUI/FirstSetup.jsx).
  assert.match(app, /\{menuReady && !setupDue && door === "shut" && \(\s+<DoorFrame onFailed=\{doorGone\}>\s+<VaultDoor onOpening=\{letMusicIn\} onOpened=\{doorOpened\} \/>/);
  // The menu is already there behind it.
  assert.ok(app.indexOf("{menuReady && (\r\n      <UI") > 0 || app.indexOf("{menuReady && (\n      <UI") > 0);
  // Whether this opening shows the door is decided before the startup screen
  // ends, so the menu never shows for a moment before a door shuts over it.
  assert.match(app, /const menuReady = isReady && door !== "deciding";/);
  assert.match(app, /\{!menuReady && <StartupScreen \{\.\.\.startupState\} \/>\}/);
  assert.match(app, /decideVaultDoor\(\{\s+always: vaultDoorAlways\(\),\s+resolveBuild: \(\) => appBuildId\(\{ env: import\.meta\.env \}\),\s+\}\)/);
  // The menu's music waits behind the door and begins as it opens; with the
  // door not shown this time, there is no door and nothing waits.
  assert.match(app, /useState\(\(\) => \{\s+if \(isWebsiteBuild\(import\.meta\.env\)\) return "open";\s+holdMusicBehindDoor\(true\);\s+return "deciding";\s+\}\)/);
  assert.match(app, /const shut = show \|\| setupRef\.current;\s+\/\/[^\n]*\n\s+if \(!shut\) holdMusicBehindDoor\(false\);\s+setDoor\(shut \? "shut" : "open"\);/);
  // (As the leaves part, what the update brings is shown behind them: Game/GameUI/updates/.)
  assert.match(app, /const letMusicIn = useCallback\(\(\) => \{\s+setParting\(true\);\s+holdMusicBehindDoor\(false\);\s+\}, \[\]\);/);
  // A door that cannot be drawn does not shut the menu in.
  assert.match(app, /componentDidCatch\(error\) \{[\s\S]+?this\.props\.onFailed\?\.\(\);/);
  assert.match(app, /const doorGone = useCallback\(\(\) => \{\s+holdMusicBehindDoor\(false\);\s+setDoor\("open"\);/);
  // Only a door that opened is remembered, with the build it was shown for: one
  // that could not be drawn, or a page closed before it opened, shows again.
  assert.match(app, /const doorOpened = useCallback\(\(\) => \{\s+rememberVaultDoorBuild\(doorBuildRef\.current\);\s+doorGone\(\);\s+\}, \[doorGone\]\);/);
  assert.equal(app.match(/rememberVaultDoorBuild\(/g)?.length, 1);
});

test("the same steel every time", () => {
  const first = seeded(5);
  const second = seeded(5);
  for (let i = 0; i < 20; i += 1) {
    const value = first();
    assert.equal(value, second());
    assert.ok(value >= 0 && value < 1);
  }
  assert.deepEqual(brushedDisc(24), brushedDisc(24));
  assert.deepEqual(brushedPlate(24), brushedPlate(24));
});

test("the steel is a dark, slightly blue picture with no holes in it", () => {
  for (const pixels of [brushedDisc(64), brushedPlate(64)]) {
    assert.equal(pixels.length, 64 * 64 * 4);
    let red = 0;
    let blue = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      assert.equal(pixels[at + 3], 255);
      assert.ok(pixels[at + 1] < 140, "never bright: the door sits in the grey of the interface");
      red += pixels[at];
      blue += pixels[at + 2];
    }
    assert.ok(blue > red);
  }
});

test("the round steel is brushed in circles", () => {
  const size = 128;
  const pixels = brushedDisc(size);
  const green = (x, y) => pixels[(y * size + x) * 4 + 1];
  // Along one ring the picture changes slowly; across the rings it changes at
  // every step. Compared a quarter of the way out, to the right of the middle.
  let along = 0;
  let across = 0;
  for (let step = 0; step < 20; step += 1) {
    const angle = (step / 20) * 0.3;
    const next = ((step + 1) / 20) * 0.3;
    const at = (a) => [Math.round(64 + Math.cos(a) * 40), Math.round(64 + Math.sin(a) * 40)];
    along += Math.abs(green(...at(angle)) - green(...at(next)));
    across += Math.abs(green(84 + step, 64) - green(85 + step, 64));
  }
  assert.ok(across > along, `across the rings ${across}, along one ${along}`);
});

test("the wall's steel is brushed straight across", () => {
  const size = 64;
  const pixels = brushedPlate(size);
  const green = (x, y) => pixels[(y * size + x) * 4 + 1];
  let along = 0;
  let across = 0;
  for (let step = 0; step < size - 1; step += 1) {
    along += Math.abs(green(step, 20) - green(step + 1, 20));
    across += Math.abs(green(20, step) - green(20, step + 1));
  }
  assert.ok(across > along);
});

test("where no picture can be made the door is drawn in its flat colours", () => {
  assert.ok(DISC_SIZE >= 512 && PLATE_SIZE >= 128);
  // node has no document.
  assert.deepEqual(vaultMetal(), { disc: null, plate: null });
  assert.match(door, /\{metal\.disc \? \(/);
  assert.match(door, /backgroundImage: metal\.plate \? `url\(\$\{metal\.plate\}\)` : "none"/);
});

// "the vault doors currently look thin and 2d when they open"; "make a paralax
// effect on an inner visible side of the vault doors to make it very
// realistic" (the owner, 2026-10-14).
test("each leaf moves where its `away` says, on the leaves' own curve", () => {
  for (const leaf of VAULT_LEAVES) assert.deepEqual(leaf.move.map((share) => Math.round(share * 100)), moveOf(leaf.away), leaf.name);
  // As CSS draws cubic-bezier(0.55, 0.05, 0.3, 1): still at the start, there at the end, slow to begin.
  assert.equal(VAULT_EASE(0), 0);
  assert.equal(VAULT_EASE(1), 1);
  assert.ok(VAULT_EASE(0.25) < 0.15, `a quarter of the time in, ${VAULT_EASE(0.25)} of the way`);
  assert.ok(VAULT_EASE(0.75) > 0.85);
  for (let t = 0; t < 1; t += 0.05) assert.ok(VAULT_EASE(t + 0.05) >= VAULT_EASE(t), "never back");
  // The straight curve is the time itself.
  const straight = cubicBezier(0.25, 0.25, 0.75, 0.75);
  for (const t of [0.1, 0.33, 0.5, 0.9]) assert.ok(Math.abs(straight(t) - t) < 1e-4);
  assert.deepEqual(leafOffset(VAULT_LEAVES[0], 0.5, 1000, 800), [0, -264]);
});

test("a leaf's inner sides are seen as it leaves: their far edge lags behind the near one", () => {
  const [width, height] = [1600, 900];
  for (const leaf of VAULT_LEAVES) {
    // Shut, its sides are no more than its seams: nothing of them is seen.
    for (const side of vaultSides(leaf, 0, width, height)) {
      assert.deepEqual(side.front[0], [800, 450]);
      assert.deepEqual(side.back[0], [800, 450]);
    }
    for (const side of vaultSides(leaf, 0.5, width, height)) {
      const [dx, dy] = leafOffset(leaf, 0.5, width, height);
      // The near edge goes with the leaf; the far edge goes by less, toward the middle.
      assert.deepEqual(side.front[0], [800 + dx, 450 + dy]);
      const far = side.back[0];
      assert.ok(Math.abs(far[0] - (800 + dx * (1 - VAULT_DEPTH.back))) < 1e-9 && Math.abs(far[1] - (450 + dy * (1 - VAULT_DEPTH.back))) < 1e-9);
      // And not by much less: "it shifts too much" at 0.2 (the owner).
      assert.ok(VAULT_DEPTH.back <= 0.08);
      // The farther the leaf has gone, the more of its side is seen.
      const seen = (progress) => {
        const at = vaultSides(leaf, progress, width, height)[0];
        return Math.hypot(at.back[0][0] - at.front[0][0], at.back[0][1] - at.front[0][1]);
      };
      assert.ok(seen(0.2) < seen(0.5) && seen(0.5) < seen(0.9));
      // A side looks back toward the middle of the screen.
      assert.ok(side.facing[0] * -dx + side.facing[1] * -dy > 0, `${leaf.name} faces the middle`);
    }
  }
  // Lit from the upper left: a side turned up and left is bright, one turned down is dark.
  assert.ok(sideLight([-Math.SQRT1_2, -Math.SQRT1_2]) > 0.85);
  assert.ok(sideLight([0, 1]) < 0.15);
  // The locking bolts' sockets are on the round door, which is inside the door's own circle.
  assert.ok(VAULT_DEPTH.sockets.every((at) => at > 0 && at < VAULT_DEPTH.door));
});

test("the sides and shadows are drawn under the leaves, for the same moment as the leaves are moved", () => {
  const canvasAt = door.indexOf("<canvas ref={depthRef}");
  const leavesAt = door.indexOf("{VAULT_LEAVES.map((leaf, index) => (");
  assert.ok(canvasAt > 0 && canvasAt < leavesAt, "the canvas is under the leaves");
  const loop = door.slice(door.indexOf("const step = (now) => {"), door.indexOf("const open = () => {"));
  assert.match(loop, /const progress = VAULT_EASE\(gone\);/);
  assert.match(loop, /element\.style\.transform = `translate\(\$\{x\.toFixed\(1\)\}px, \$\{y\.toFixed\(1\)\}px\)`;/);
  assert.match(loop, /drawDepth\(depthRef\.current, progress\);/);
  // No transition of its own that the sides could not follow.
  const leaves = door.slice(leavesAt, door.indexOf("<DoorFace metal={metal} />"));
  assert.doesNotMatch(leaves, /transition:/);
  // Shadows first, then the sides; every leaf's face is in front of every side.
  const depth = door.slice(door.indexOf("const drawDepth = "), door.indexOf("// `onOpening`"));
  assert.ok(depth.indexOf("drawShadow(") < depth.indexOf("drawSide("));
});

// "remove the Vault door at start setting, just have the Every time the game opens setting" (the owner, 2026-10-16).
test("the vault door has no switch of its own: Every time the game opens is its only one", () => {
  const settings = read("./settings.jsx");
  const mapSettings = read("../../runtime/mapSettings.js");
  assert.doesNotMatch(mapSettings, /vault_door_at_start|vaultDoorEnabled/);
  assert.doesNotMatch(settings, /Vault door at start|MAP_SETTING_KEYS\.vaultDoor\b/);
  assert.doesNotMatch(read("../../runtime/settingsLog.js"), /Vault door at start/);
  assert.match(app, /import \{ vaultDoorAlways \} from "\.\/runtime\/mapSettings\.js";/);
});

// "vault door by default only after a new update, setting to make it always
// when opening game" (the owner, 2026-10-14). When it is due is
// runtime/vaultDoorDue.test.js; this is the switch.
test("a switch shows the door every time the game opens: off by default", () => {
  const settings = read("./settings.jsx");
  const mapSettings = read("../../runtime/mapSettings.js");
  assert.match(mapSettings, /vaultDoorAlways: "vault_door_every_time",/);
  assert.match(mapSettings, /export const vaultDoorAlways = \(\) => \{\s+try \{\s+return getMapSetting\(MAP_SETTING_KEYS\.vaultDoorAlways\);\s+\} catch \{\s+return false;/);
  assert.match(mapSettings, /\[MAP_SETTING_KEYS\.vaultDoorAlways\]: "Vault door every time the game opens",/);
  const display = settings.slice(settings.indexOf('<SettingsSection title="Display"'), settings.indexOf('<SettingsSection title="Accessibility"'));
  assert.match(display, /<Toggle\s+label="Show the vault door every time"\s+enabled=\{mapSettings\.vaultDoorAlways\}\s+onToggle=\{\(\) => updateMapSetting\("vaultDoorAlways", MAP_SETTING_KEYS\.vaultDoorAlways, !mapSettings\.vaultDoorAlways\)\}/);
  assert.match(display, /\{"On: the vault door appears every time you start the game\. Off: only the first time you start it after an update\."\}/);
  assert.match(settings, /vaultDoorAlways: getMapSetting\(MAP_SETTING_KEYS\.vaultDoorAlways\),/);
  // The Logging file says how it is set, by the panel's name for it.
  assert.match(read("../../runtime/settingsLog.js"), /\["Show the vault door every time", onOff\(getMapSetting\(MAP_SETTING_KEYS\.vaultDoorAlways\)\)\],/);
});
