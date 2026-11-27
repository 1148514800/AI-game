import data from "../../data/foglamp-valley.json" with { type: "json" };

import development from "../../data/valley-development.json" with { type: "json" };

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
export type Item = Material | "food" | "toolbox";
export type Stock = Record<Material, number> &
  Partial<Record<"food" | "toolbox", number>>;
export type Resource = Target & {
  item: Item;
  asset: string;
  spent: string;
  yieldCount: number;
  cooldownMs: number;
};
export type Project = Target & {
  required: Partial<Record<Item, number>>;
  workMs: number;
  done: string;
  capacity?: Partial<Record<Item, number>>;
};
export const localProjects = development.projects as Project[];
export const projects = new Map(
  [
    {
      ...valley.bridge,
      done: "旧桥已修通。",
    },
    ...localProjects,
  ].map((project): [string, Project] => [project.id, project]),
);
export const clues = [
  { ...valley.ruin, asset: "ruin-stone", text: valley.ruin.clue },
  ...development.clues,
];
export const clueTargets = new Map(clues.map((clue) => [clue.id, clue]));
export const resourceNodes: Resource[] = [
  ...valley.resources,
  ...(development.resources as Resource[]),
];

export function gameTime(seconds: number) {
  const minute = (360 + Math.floor(seconds * 2)) % 1440;
  const hour = Math.floor(minute / 60);
  return {
    day: 1 + Math.floor((360 + seconds * 2) / 1440),
    hour,
    minute: minute % 60,
    period:
      hour < 6 || hour >= 20
        ? "夜晚"
        : hour < 9
          ? "早晨"
          : hour < 17
            ? "白天"
            : "傍晚",
  };
}

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
  resourceNodes.map((entry) => [entry.id, entry]),
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
  ...resourceNodes,
  ...projects.values(),
  ...clues,
];

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nearbyTarget(
  player: Point,
  actors?: Point | Partial<Record<string, Point>>,
) {
  let nearby: Target | undefined;
  let closest = Infinity;
  for (const entry of targets) {
    const actor =
      actors && typeof actors.x === "number"
        ? entry.id === "cenyan"
          ? (actors as Point)
          : undefined
        : (actors as Partial<Record<string, Point>> | undefined)?.[entry.id];
    const target = actor ? { ...entry, x: actor.x, y: actor.y } : entry;
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
