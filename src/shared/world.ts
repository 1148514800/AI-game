import data from "../../data/foglamp-valley.json" with { type: "json" };

export type Direction = "down" | "up" | "left" | "right";
export type Point = { x: number; y: number };
export type Rect = Point & { w: number; h: number };
export type Target = Point & { id: string; name: string; range: number };
export type Material = "wood" | "stone";

export const valley = {
  ...data,
  residents: data.residents as (Target & {
    role: string;
    asset: string;
    facing: Direction;
    intro: string;
  })[],
  resources: data.resources as (Target & {
    item: Material;
    asset: string;
    spent: string;
    yieldCount: number;
    cooldownMs: number;
    solid: Rect;
  })[],
};
export const mapWidth = valley.width * valley.tileSize;
export const mapHeight = valley.height * valley.tileSize;
export const speed = 88;
export const tickMs = 50;
export const footRadius = 4;
export const inventoryLimit = 999;
export const residents = new Map(
  valley.residents.map((entry) => [entry.id, entry]),
);
export const resources = new Map(
  valley.resources.map((entry) => [entry.id, entry]),
);
export const items = {
  wood: "木材",
  stone: "石材",
  food: "食物",
  toolbox: "工具箱",
};

const solids = [
  ...valley.props.flatMap(
    (prop) => prop.solids ?? (prop.solid ? [prop.solid] : []),
  ),
  ...valley.resources.map((resource) => resource.solid),
];
const targets: Target[] = [
  ...valley.residents,
  ...valley.resources,
  valley.bridge,
  valley.ruin,
];

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nearbyTarget(player: Point, cenyan?: Point) {
  let nearby: Target | undefined;
  let closest = Infinity;
  for (const entry of targets) {
    const target =
      entry.id === "cenyan" && cenyan
        ? { ...entry, x: cenyan.x, y: cenyan.y }
        : entry;
    const distanceToPlayer = distance(player, target);
    if (distanceToPlayer <= target.range && distanceToPlayer < closest) {
      nearby = target;
      closest = distanceToPlayer;
    }
  }
  return nearby;
}

export function isPassable(x: number, y: number, repaired: boolean) {
  const left = x - footRadius,
    right = x + footRadius;
  const top = y - footRadius,
    bottom = y + footRadius;
  if (left < 0 || top < 0 || right >= mapWidth || bottom >= mapHeight)
    return false;
  const tile = valley.tileSize;
  const crossing = valley.bridge.crossing;
  for (
    let row = Math.floor(top / tile);
    row <= Math.floor(bottom / tile);
    row++
  ) {
    for (
      let column = Math.floor(left / tile);
      column <= Math.floor(right / tile);
      column++
    ) {
      if (valley.river[row][column] < 0) continue;
      const onBridge =
        repaired &&
        column >= crossing.column &&
        column < crossing.column + crossing.width &&
        row >= crossing.row &&
        row < crossing.row + crossing.height;
      if (!onBridge) return false;
    }
  }
  return !solids.some(
    (rect) =>
      right > rect.x &&
      left < rect.x + rect.w &&
      bottom > rect.y &&
      top < rect.y + rect.h,
  );
}
