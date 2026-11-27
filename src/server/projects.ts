import type { ProjectState } from "../shared/protocol.js";
import type { ActorId } from "../shared/social.js";
import { items, type Item, type Project, type Stock } from "../shared/world.js";

export function projectMissing(
  project: Project,
  delivered: Partial<Record<Item, number>>,
  limit = project.required,
) {
  return Object.fromEntries(
    Object.entries(limit).map(([item, required]) => [
      item,
      Math.max(0, required - (delivered[item as Item] ?? 0)),
    ]),
  ) as Partial<Record<Item, number>>;
}

export function deliveryAmounts(
  project: Project,
  received: Partial<Stock>,
  bag: Stock,
  item?: Item,
  quantity?: number,
): Stock {
  const amounts: Stock = { wood: 0, stone: 0 };
  const capacity = project.capacity ?? project.required;
  for (const [key, room] of Object.entries(projectMissing(project, received, capacity))) {
    const material = key as Item;
    if (item && item !== material) continue;
    amounts[material] = Math.min(
      room,
      bag[material] ?? 0,
      quantity ?? Infinity,
    );
  }
  return amounts;
}

export function transferToProject(bag: Stock, amounts: Stock) {
  for (const item of Object.keys(amounts) as Item[]) {
    const amount = amounts[item] ?? 0;
    if (amount) bag[item] = (bag[item] ?? 0) - amount;
  }
}

export function contribution(state: ProjectState, actor: ActorId) {
  return (state.contributions[actor] ??= { wood: 0, food: 0, workMs: 0 });
}

export function materialText(materials: Partial<Record<Item, number>>) {
  return (Object.entries(materials) as [Item, number][])
    .filter(([, quantity]) => quantity > 0)
    .map(([item, quantity]) => `${items[item]} ×${quantity}`)
    .join("、");
}

export function distributeWork(
  remaining: number,
  elapsed: number,
  workers: { id: ActorId; toolbox?: number }[],
) {
  const weight = (worker: { toolbox?: number }) => (worker.toolbox ? 1.25 : 1);
  const total = workers.reduce((sum, worker) => sum + weight(worker), 0);
  const applied = Math.min(remaining, total * elapsed);
  return {
    applied,
    shares: workers.map(
      (worker) => [worker.id, (applied * weight(worker)) / total] as const,
    ),
  };
}
