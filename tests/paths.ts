import { isPassable, type Point } from "../src/shared/world.js";

type Stop = Point & { axis: "x" | "y" };
const grid = 8;
const cardinal = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function route(
  start: Point,
  reached: (point: Point) => boolean,
  repaired: boolean,
): Stop[] {
  if (reached(start)) return [];
  const queue = [{ point: start, parent: -1, axis: "x" as Stop["axis"] }];
  const visited = new Set(["0,0"]);
  let found = -1;
  function clear(x: number, y: number) {
    return (
      isPassable(x - 3, y - 3, repaired) &&
      isPassable(x + 3, y + 3, repaired) &&
      isPassable(x + 3, y - 3, repaired) &&
      isPassable(x - 3, y + 3, repaired)
    );
  }
  for (let i = 0; i < queue.length; i++) {
    const { point } = queue[i];
    if (reached(point)) {
      found = i;
      break;
    }
    for (const [dx, dy] of cardinal) {
      const next = { x: point.x + dx * grid, y: point.y + dy * grid };
      // Lattice indices stay stable when the start is a fractional server position.
      const key = `${Math.round((next.x - start.x) / grid)},${Math.round((next.y - start.y) / grid)}`;
      if (
        visited.has(key) ||
        !clear(next.x, next.y) ||
        !clear(point.x + dx * 4, point.y + dy * 4)
      )
        continue;
      visited.add(key);
      queue.push({ point: next, parent: i, axis: dx ? "x" : "y" });
    }
  }
  if (found < 0) throw Error("No walkable route from current position");
  const steps: Stop[] = [];
  for (let i = found; queue[i].parent >= 0; i = queue[i].parent) {
    const { point, axis } = queue[i];
    if (steps.at(-1)?.axis !== axis) steps.push({ ...point, axis });
  }
  return steps.reverse();
}
