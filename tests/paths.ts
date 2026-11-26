import {
  distance,
  isPassable,
  speed,
  tickMs,
  type Point,
} from "../src/shared/world.js";
import { canApproach } from "../src/server/path.js";

type Stop = Point & { axis: "x" | "y" };
const grid = 8;
const keyboardStep = (speed * tickMs) / 1000;
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
  occupants: Point[] = [],
): Stop[] {
  const stops = search(start, reached, repaired, occupants, grid);
  if (!stops) throw Error("No walkable route from current position");
  return stops;
}

export function findKeyboardRoute(
  start: Point,
  reached: (point: Point) => boolean,
  repaired: boolean,
  occupants: Point[],
): Stop[] | undefined {
  // Prefer room for keyboard release and turns. Near a wall even the finer
  // grid can need to start with a step that uses the actual collision limits.
  return (
    search(start, reached, repaired, occupants, grid) ??
    search(start, reached, repaired, occupants, keyboardStep) ??
    search(start, reached, repaired, occupants, keyboardStep, false)
  );
}

function search(
  start: Point,
  reached: (point: Point) => boolean,
  repaired: boolean,
  occupants: Point[],
  stride: number,
  padded = true,
): Stop[] | undefined {
  if (reached(start)) return [];
  const queue = [{ point: start, parent: -1, axis: "x" as Stop["axis"] }];
  const visited = new Set(["0,0"]);
  let found = -1;
  function clear(point: Point, from: Point) {
    const { x, y } = point;
    if (!padded)
      return (
        isPassable(x, y, repaired) &&
        occupants.every((other) => canApproach(from, point, other))
      );
    return (
      occupants.every((other) => distance(point, other) >= 14) &&
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
      const next = { x: point.x + dx * stride, y: point.y + dy * stride };
      const middle = {
        x: point.x + (dx * stride) / 2,
        y: point.y + (dy * stride) / 2,
      };
      // Lattice indices stay stable when the start is a fractional server position.
      const key = `${Math.round((next.x - start.x) / stride)},${Math.round((next.y - start.y) / stride)}`;
      if (visited.has(key) || !clear(middle, point) || !clear(next, middle))
        continue;
      visited.add(key);
      queue.push({ point: next, parent: i, axis: dx ? "x" : "y" });
    }
  }
  if (found < 0) return;
  const steps: Stop[] = [];
  for (let i = found; queue[i].parent >= 0; i = queue[i].parent) {
    const { point, axis } = queue[i];
    if (steps.at(-1)?.axis !== axis) steps.push({ ...point, axis });
  }
  return steps.reverse();
}
