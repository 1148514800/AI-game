import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [compiledRoot, savePath] = process.argv.slice(2);
if (!compiledRoot || !savePath || existsSync(savePath)) {
  throw Error("Construction fixture requires a new isolated SQLite path.");
}
const { SaveFile, freshState } = await import(
  pathToFileURL(join(compiledRoot, "server/save.js")).href
);
const { isPassable, nearbyTarget, valley } = await import(
  pathToFileURL(join(compiledRoot, "shared/world.js")).href
);
const state = freshState();
const bridge = valley.bridge;
state.player = { x: bridge.x, y: bridge.y, facing: "right" };
if (
  !isPassable(bridge.x, bridge.y, false) ||
  nearbyTarget(state.player)?.id !== bridge.id
) {
  throw Error(
    "Construction fixture is outside the playable bridge interaction area.",
  );
}
Object.assign(state.bridge, bridge.required, { discovered: true });
if (state.contributions) Object.assign(state.contributions.legacy, bridge.required);
const save = new SaveFile(savePath);
try {
  // Benchmark load only: the materials are already on site; the bag stays empty.
  save.write(state);
} finally {
  save.close();
}
