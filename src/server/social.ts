import { randomUUID } from "node:crypto";
import type { Result, SaveState } from "../shared/protocol.js";
import {
  actorName,
  agreementText,
  type ActorId,
  type Deal,
  type MaterialAmount,
  type Pledge,
  type SocialCommand,
} from "../shared/social.js";
import { projects, valley, inventoryLimit, items } from "../shared/world.js";
import { projectMissing } from "./projects.js";

const offerMs = 90_000;
const pledgeMs = 300_000;
export const activeAgreement = (entry: Deal | Pledge) =>
  entry.status === "proposed" || entry.status === "accepted";

export function adjustTrust(
  state: SaveState,
  owner: ActorId,
  subject: ActorId,
  delta: number,
  reason: string,
) {
  if (owner === "player" || owner === subject) return;
  const relations = state.actors[owner].relations;
  relations[subject] = {
    level: Math.max(-2, Math.min(2, (relations[subject]?.level ?? 0) + delta)),
    reason,
  };
}

function bag(state: SaveState, id: ActorId) {
  return id === "player" ? state.inventory : state.actors[id].bag;
}

export function projectPledgeCanFinish(
  state: SaveState,
  condition: Pledge["condition"],
  progress = 0,
) {
  if (condition.kind !== "deliver" && condition.kind !== "work") return true;
  const id = condition.project ?? valley.bridge.id;
  const project = projects.get(id)!;
  const row = id === valley.bridge.id ? state.bridge : state.projects[id];
  if (condition.kind === "work")
    return project.workMs > 0 && row.progressMs < project.workMs;
  const { item, qty } = condition;
  const room = projectMissing(project, row, project.capacity)[item] ?? 0;
  return qty - progress <= room;
}

type Effect = {
  people: ActorId[];
  text: string;
  handoff?: boolean;
};
type Resolution = { result: Result; effect?: Effect };

export function socialAction(
  state: SaveState,
  id: string,
  actor: ActorId,
  command: SocialCommand,
  now: number,
  near: (a: ActorId, b: ActorId) => boolean,
): Resolution {
  const result = (
    ok: boolean,
    code: string,
    text: string,
    effect?: Omit<Effect, "text">,
  ): Resolution => ({
    result: { type: "result", id, actor, ok, code, text },
    effect: effect && { ...effect, text },
  });
  const pending = (from: ActorId) =>
    state.pledges.some(
      (entry) =>
        entry.from === from && entry.expiresAt > now && activeAgreement(entry),
    );
  if (command.kind === "offer" || command.kind === "pledge") {
    const to = command.target;
    if (!near(actor, to))
      return result(false, "TOO_FAR", "请走近对方后再提议。");
    const entry = {
      id: randomUUID(),
      from: actor,
      to,
      status: "proposed" as const,
      expiresAt: now + offerMs,
    };
    if (command.kind === "pledge") {
      if (!projectPledgeCanFinish(state, command.condition))
        return result(
          false,
          "PLEDGE_INFEASIBLE",
          "工程已完成或无法接收约定的材料数量。",
        );
      if (pending(actor))
        return result(false, "PLEDGE_BUSY", "请先处理自己尚未完成的承诺。");
      state.pledges = appendAgreement(state.pledges, {
        ...entry,
        condition: command.condition,
        progress: 0,
      });
    } else {
      if (
        state.deals.some(
          (deal) =>
            deal.from === actor &&
            deal.expiresAt > now &&
            activeAgreement(deal),
        )
      )
        return result(false, "OFFER_BUSY", "请先处理自己尚未结束的交接提议。");
      if (
        "give" in command.terms &&
        (bag(state, actor)[command.terms.give.item] ?? 0) <
          command.terms.give.qty
      )
        return result(false, "NO_STOCK", "提议超过自己持有的材料。");
      state.deals = appendAgreement(state.deals, {
        ...entry,
        terms: command.terms,
      });
    }
    const outcome = result(
      true,
      command.kind === "pledge" ? "PLEDGE_PROPOSED" : "OFFER_PROPOSED",
      `${actorName(actor)}向${actorName(to)}提出${command.kind === "pledge" ? "承诺" : "交接"}，等待对方确认。`,
      { people: [actor, to] },
    );
    outcome.result.offerId = entry.id;
    return outcome;
  }

  const deal = state.deals.find((entry) => entry.id === command.offerId);
  const pledge = state.pledges.find((entry) => entry.id === command.offerId);
  const entry = deal ?? pledge;
  if (
    !entry ||
    !activeAgreement(entry) ||
    (entry.to !== actor && entry.from !== actor)
  )
    return result(false, "OFFER_UNKNOWN", "没有可由你处理的提议或承诺。");
  const people = [entry.from, entry.to];
  if (entry.expiresAt <= now) {
    const expired = cancelAgreement(state, entry, true);
    return result(false, "OFFER_EXPIRED", expired.text, expired);
  }
  if (command.kind === "cancel") {
    if (
      entry.from !== actor ||
      (pledge?.condition.kind === "return" && pledge.status === "accepted")
    )
      return result(false, "OFFER_FORBIDDEN", "这项约定不能由你单方面取消。");
    const cancelled = cancelAgreement(
      state,
      entry,
      false,
      !!pledge &&
        !projectPledgeCanFinish(state, pledge.condition, pledge.progress),
    );
    return result(true, "OFFER_CANCELLED", cancelled.text, cancelled);
  }
  if (command.kind === "return") {
    if (
      !pledge ||
      pledge.from !== actor ||
      pledge.status !== "accepted" ||
      pledge.condition.kind !== "return"
    )
      return result(false, "OFFER_FORBIDDEN", "只有借用者能主动归还有效借项。");
    if (!near(pledge.from, pledge.to))
      return result(false, "TOO_FAR", "归还前需要走近出借者。");
    const failure = transfer(state, pledge.from, pledge.to, pledge.condition);
    if (failure)
      return result(false, failure, "背包库存或容量不足，材料留在原处。");
    fulfillPledge(state, pledge);
    return result(
      true,
      "LOAN_RETURNED",
      `${actorName(actor)}归还${`${items[pledge.condition.item]} ×${pledge.condition.qty}`}。`,
      { people, handoff: true },
    );
  }
  if (entry.to !== actor || entry.status !== "proposed")
    return result(false, "OFFER_FORBIDDEN", "这项提议需要接收者明确回应。");
  if (command.choice === "reject") {
    const cancelled = cancelAgreement(state, entry, false);
    if (deal) deal.cancellation = "declined";
    return result(true, "OFFER_REJECTED", cancelled.text, cancelled);
  }
  if (!near(entry.from, entry.to))
    return result(false, "TOO_FAR", "确认前需要走近对方。");
  if (pledge) {
    if (!projectPledgeCanFinish(state, pledge.condition, pledge.progress)) {
      const cancelled = cancelAgreement(state, pledge, false, true);
      return result(false, "PLEDGE_INFEASIBLE", cancelled.text, cancelled);
    }
    pledge.status = "accepted";
    pledge.expiresAt = now + pledgeMs;
    return result(
      true,
      "PLEDGE_ACCEPTED",
      `${actorName(actor)}接受约定：${agreementText(pledge)}。`,
      { people },
    );
  }
  if (!deal) return result(false, "OFFER_UNKNOWN", "提议已结束。");
  const terms = deal.terms;
  if (terms.kind === "loan" && pending(deal.to))
    return result(false, "PLEDGE_BUSY", "请先完成已有的承诺再借用。");
  const failure = transfer(
    state,
    deal.from,
    deal.to,
    "give" in terms ? terms.give : undefined,
    "take" in terms ? terms.take : undefined,
  );
  if (failure) {
    deal.status = "cancelled";
    deal.cancellation = "unavailable";
    return result(false, failure, "库存或容量已变化，交接取消。", { people });
  }
  deal.status = "fulfilled";
  if (terms.kind === "gift")
    adjustTrust(state, deal.to, deal.from, 1, "收到材料赠送");
  if (terms.kind === "request")
    adjustTrust(state, deal.from, deal.to, 1, "对方响应请求赠送材料");
  if (terms.kind === "loan")
    state.pledges = appendAgreement(state.pledges, {
      id: randomUUID(),
      from: deal.to,
      to: deal.from,
      status: "accepted",
      condition: { kind: "return", ...terms.give },
      expiresAt: now + pledgeMs,
      progress: 0,
    });
  return result(
    true,
    "HANDOFF_DONE",
    `${actorName(deal.from)}与${actorName(deal.to)}完成${agreementText(deal)}。`,
    { people, handoff: true },
  );
}

export function fulfillPledge(state: SaveState, pledge: Pledge) {
  pledge.status = "fulfilled";
  adjustTrust(state, pledge.to, pledge.from, 1, "履行已接受的承诺");
}

export function cancelAgreement(
  state: SaveState,
  entry: Deal | Pledge,
  expired: boolean,
  noFault = false,
): Effect {
  const breach = entry.status === "accepted";
  entry.status = "cancelled";
  if ("terms" in entry) entry.cancellation = expired ? "expired" : "cancelled";
  if (breach && !noFault)
    adjustTrust(
      state,
      entry.to,
      entry.from,
      -1,
      expired ? "承诺到期未履行" : "取消已接受的承诺",
    );
  return {
    people: [entry.from, entry.to],
    text: `${actorName(entry.from)}与${actorName(entry.to)}的${agreementText(entry)}${noFault ? "因工程状态变化无责取消" : expired ? "已过期" : "已取消"}。`,
  };
}

function appendAgreement<T extends Deal | Pledge>(entries: T[], entry: T) {
  if (entries.length >= 48)
    entries.splice(
      entries.findIndex((old) => !activeAgreement(old)),
      1,
    );
  return [...entries, entry];
}

function transfer(
  state: SaveState,
  from: ActorId,
  to: ActorId,
  give?: MaterialAmount,
  take?: MaterialAmount,
) {
  const source = bag(state, from);
  const target = bag(state, to);
  if (
    (give && (source[give.item] ?? 0) < give.qty) ||
    (take && (target[take.item] ?? 0) < take.qty)
  )
    return "NO_STOCK";
  for (const item of ["wood", "stone", "food", "toolbox"] as const) {
    const change =
      (give?.item === item ? give.qty : 0) -
      (take?.item === item ? take.qty : 0);
    if (
      (source[item] ?? 0) - change > inventoryLimit ||
      (target[item] ?? 0) + change > inventoryLimit
    )
      return "CAPACITY";
  }
  if (give) {
    source[give.item] = (source[give.item] ?? 0) - give.qty;
    target[give.item] = (target[give.item] ?? 0) + give.qty;
  }
  if (take) {
    target[take.item] = (target[take.item] ?? 0) - take.qty;
    source[take.item] = (source[take.item] ?? 0) + take.qty;
  }
}
