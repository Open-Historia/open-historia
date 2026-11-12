import { spawnSync } from "node:child_process";

const [kind, size] = process.argv.slice(2);
if (!["physical", "retina"].includes(kind) || !/^\d+x\d+$/.test(size || "")) {
  console.error("usage: node native/macos/display-setup.mjs physical|retina <width>x<height>");
  process.exit(2);
}
const run = (args) => {
  const result = spawnSync("displayplacer", args, { encoding: "utf8" });
  return `${result.stdout || ""}${result.stderr || ""}`;
};
const screens = () => run(["list"]).split(/\n(?=Persistent screen id:)/).filter((block) => block.startsWith("Persistent screen id:")).map((block) => ({
  id: /^Persistent screen id: (\S+)/m.exec(block)?.[1] || "",
  type: /^Type: (.*)$/m.exec(block)?.[1] || "",
  resolution: /^Resolution: (\S+)/m.exec(block)?.[1] || "",
  scaling: /^Scaling: (\S+)/m.exec(block)?.[1] || "",
  origin: /^Origin: \((-?\d+),(-?\d+)\)/m.exec(block)?.slice(1, 3).map(Number) || [0, 0],
  modes: [...block.matchAll(/mode (\d+): res:(\d+)x(\d+) hz:(\d+) color_depth:(\d+)( scaling:on)?/g)].map((match) => ({ mode: Number(match[1]), width: Number(match[2]), height: Number(match[3]), scaling: Boolean(match[6]) })),
}));
const before = screens();
console.log(`displays before: ${JSON.stringify(before.map(({ modes, ...rest }) => ({ ...rest, modes: modes.length, hidpiModes: modes.filter((m) => m.scaling).map((m) => `${m.width}x${m.height}`) })))}`);
const [width, height] = size.split("x").map(Number);
let target = null;
let mode = null;
if (kind === "physical") {
  target = before.find((screen) => screen.origin[0] === 0 && screen.origin[1] === 0) || before[0];
  mode = target?.modes.find((m) => m.width === width && m.height === height && !m.scaling);
} else {
  for (const screen of before) {
    const found = screen.modes.find((m) => m.width === width && m.height === height && m.scaling);
    if (found) {
      target = screen;
      mode = found;
      break;
    }
  }
}
if (!target || !mode) {
  console.log(`no ${kind === "retina" ? "HiDPI " : ""}${size} mode is offered`);
  process.exit(1);
}
const args = [`id:${target.id} mode:${mode.mode} origin:(0,0) degree:0`];
let x = width;
for (const screen of before.filter((s) => s.id !== target.id)) {
  args.push(`id:${screen.id} res:${screen.resolution} origin:(${x},0) degree:0`);
  x += Number(screen.resolution.split("x")[0]) || 1024;
}
console.log(`displayplacer ${args.map((a) => JSON.stringify(a)).join(" ")}`);
console.log(run(args).trim());
spawnSync("/bin/sleep", ["3"]);
const after = screens();
const main = after.find((screen) => screen.origin[0] === 0 && screen.origin[1] === 0);
console.log(`displays after: ${JSON.stringify(after.map(({ modes, ...rest }) => rest))}`);
const ok = main && main.id === target.id && main.resolution === size && (kind === "physical" || main.scaling === "on");
console.log(ok ? `main display is now ${main.type} ${main.resolution}${kind === "retina" ? " at 2x" : ""}` : "the display did not take the mode");
process.exit(ok ? 0 : 1);
