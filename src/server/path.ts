import {
  distance,
  isPassable,
  mapHeight,
  mapWidth,
  type Point,
  type Target,
} from "../shared/world.js";

const stride = 8;
const offsets = [
  { x: stride, y: 0 },
  { x: -stride, y: 0 },
  { x: 0, y: stride },
  { x: 0, y: -stride },
];
type Node = Point & { cost: number; score: number; previous?: Node };

function push(queue: Node[], node: Node) {
  let index = queue.length;
  queue.push(node);
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (queue[parent].score <= node.score) break;
    queue[index] = queue[parent];
    index = parent;
  }
  queue[index] = node;
}

function pop(queue: Node[]): Node {
  const first = queue[0];
  const tail = queue.pop()!;
  if (!queue.length) return first;
  let index = 0;
  while (index * 2 + 1 < queue.length) {
    let child = index * 2 + 1;
    if (child + 1 < queue.length && queue[child + 1].score < queue[child].score)
      child++;
    if (queue[child].score >= tail.score) break;
    queue[index] = queue[child];
    index = child;
  }
  queue[index] = tail;
  return first;
}

/** A* over eight-pixel cardinal edges, including their intermediate clearance. */
export function findPath(
  start: Point,
  target: Target,
  repaired: boolean,
  occupants: Point[] = [],
): Point[] | undefined {
  const columns = Math.ceil(mapWidth / stride) + 1;
  const rows = Math.ceil(mapHeight / stride) + 1;
  const cost = new Float64Array(columns * rows).fill(Infinity);
  const key = (p: Point) =>
    Math.floor(p.x / stride) + Math.floor(p.y / stride) * columns;
  const heuristic = (p: Point) =>
    Math.max(0, distance(p, target) - target.range);
  const clear = (p: Point, from: Point) =>
    isPassable(p.x, p.y, repaired) &&
    occupants.every((other) => canApproach(from, p, other));
  const queue: Node[] = [
    { x: start.x, y: start.y, cost: 0, score: heuristic(start) },
  ];
  cost[key(start)] = 0;
  while (queue.length) {
    const current = pop(queue);
    if (current.cost !== cost[key(current)]) continue;
    if (heuristic(current) === 0) {
      const points: Point[] = [];
      for (let path = current; path.previous; path = path.previous)
        points.push({ x: path.x, y: path.y });
      return points.reverse();
    }
    for (const { x: dx, y: dy } of offsets) {
      const point = { x: current.x + dx, y: current.y + dy };
      const nextCost = current.cost + stride;
      const index = key(point);
      if (!clear(point, current) || nextCost >= cost[index]) continue;
      if (!clear({ x: current.x + dx / 2, y: current.y + dy / 2 }, current))
        continue;
      cost[index] = nextCost;
      push(queue, {
        ...point,
        cost: nextCost,
        score: nextCost + heuristic(point),
        previous: current,
      });
    }
  }
}

/** An overlapping actor can leave (including when a legacy save loads). */
export function canApproach(from: Point, to: Point, other: Point) {
  const gap = distance(to, other);
  return gap >= 8 || gap > distance(from, other);
}
