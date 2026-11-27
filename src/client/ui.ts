import { destinationNames, goalName, type Step } from "../shared/cenyan.js";
import {
  actorName,
  agreementText,
  npcIds,
  npcSchema,
  trustLabels,
  type ActorId,
  type NpcId,
} from "../shared/social.js";
import type { Action, Result, Snapshot } from "../shared/protocol.js";
import {
  distance,
  items,
  nearbyTarget,
  residents,
  resources,
  valley,
} from "../shared/world.js";

export function element<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}

const targetName = element("target");
const feedback = element("feedback");
const feedbackIcon = element<HTMLImageElement>("feedback-icon");
const primary = element<HTMLButtonElement>("interact");
const inspect = element<HTMLButtonElement>("bridge-check");
const progress = element<HTMLProgressElement>("progress");
const location = element("location");
const percentLabel = element("percent");
const deliveredWood = element("bridge-wood");
const deliveredStone = element("bridge-stone");
const objective = element("objective");
const nextStep = element("next-step");
const goal = document.querySelector(".goal")!;
const itemCounts = new Map<string, HTMLElement>();
const bridge = valley.bridge;

export function setText(node: HTMLElement, value: string) {
  if (node.textContent !== value) node.textContent = value;
}

function icon(key: string, className = "pixel") {
  const image = document.createElement("img");
  image.className = className;
  image.src = `/assets/${key}.png`;
  image.alt = "";
  return image;
}

function label(value: string, tag = "span") {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

export function furnishJournal() {
  for (const [key, name] of Object.entries(items)) {
    const item = label("", "li");
    item.className = "item";
    const count = label("0", "strong");
    count.dataset.item = key;
    item.append(icon(key), label(name), count);
    element("inventory").append(item);
    itemCounts.set(key, count);
  }
  for (const resident of valley.residents) {
    const row = label("", "li");
    row.className = "resident";
    const face = label("");
    face.className = "resident-face";
    face.append(icon(`${resident.asset}-face`));
    row.append(
      face,
      label(resident.name, "strong"),
      label(resident.role, "small"),
    );
    const talk = label("交谈", "button") as HTMLButtonElement;
    talk.type = "button";
    talk.id = "talk-" + resident.id;
    talk.dataset.talk = resident.id;
    talk.setAttribute("aria-label", `找${resident.name}聊聊`);
    talk.hidden = true;
    row.append(talk);
    element("residents").append(row);
  }
}

let selection:
  (Pick<Action, "target" | "verb"> & { label: string }) | undefined;
let lastTarget: string | undefined;
let lastVerb: string | undefined;
let lastHint = "";
let shownResult = false;
let renderedSelection = false;

export function showResult(result: Result) {
  if (result.code === "RESET") {
    shownResult = false;
    lastTarget = undefined;
  } else shownResult = true;
  feedback.textContent = result.text;
}

export function showFinished() {
  shownResult = true;
  feedback.textContent = "旧桥修好了。沿桥向东，去查看航标遗迹。";
}

export function showFeedback(text: string) {
  shownResult = true;
  feedback.textContent = text;
}

export function selectedAction() {
  return selection;
}

export function enableActions(enabled: boolean) {
  const disabled = !enabled || !selection;
  if (primary.disabled !== disabled) primary.disabled = disabled;
  if (inspect.disabled === enabled) inspect.disabled = !enabled;
}

const activities = {
  idle: "空闲",
  moving: "赶路",
  collecting: "正在采集",
  delivering: "正在交材",
  working: "正在施工",
  waiting: "在等待",
  resting: "在休息",
  talking: "在交谈",
  paused: "已暂停",
};
const steps = {
  move_to: "前往",
  follow: "跟随",
  give_item: "提议赠送给",
  collect: "采集",
  deliver: "交付给",
  work: "施工",
  wait: "等待",
  rest: "休息",
  social: "处理正式约定",
  wait_until: "等待条件",
  talk: "邀谈",
};
const triggerNames: Record<string, string> = {
  "first-active": "首次活跃",
  "plan-complete": "计划完成",
  "step-failed": "行动受阻",
  "bridge-repaired": "旧桥完工",
  "bridge-materials": "材料交齐",
  "goal-changed": "目标变化",
  periodic: "定期",
  "player-action": "旅人请求",
  dialogue: "对话",
};
const memoryLabels = {
  fact: "规则事实",
  claim: "他人声称",
  opinion: "自身观点",
  commitment: "约定",
};

function stepText(step: Step) {
  return (
    steps[step.type] +
    ("target_id" in step
      ? " " +
        (step.target_id === "player"
          ? "旅人"
          : (destinationNames.get(step.target_id) ??
            residents.get(step.target_id)?.name ??
            step.target_id)) +
        ("item" in step && step.item ? ` ${items[step.item]} ×${step.qty}` : "")
      : "seconds" in step
        ? ` ${step.seconds} 秒`
        : "")
  );
}

let shownMemory = "";
function renderResidents(snapshot: Snapshot) {
  for (const id of npcIds) {
    const { activity, model } = snapshot.actors[id];
    const label =
      activity === "idle" && model?.kind === "pending"
        ? "正在斟酌"
        : activities[activity];
    const mode =
      model?.mode === "mock" &&
      (model.kind !== "disabled" || snapshot.state.actors[id].plan)
        ? " · Mock 模拟"
        : "";
    setText(element(id + "-status"), actorName(id) + " · " + label + mode);
  }
  const selected = npcSchema.parse(
    element<HTMLSelectElement>("debug-actor").value,
  );
  const actor = snapshot.state.actors[selected];
  const { model, memory } = snapshot.actors[selected];
  const relations = Object.entries(actor.relations).map(
    ([id, record]) =>
      `${actorName(id as ActorId)} ${trustLabels[record.level + 2]}（${record.reason}）`,
  );
  setText(element("actor-relations"), relations.join("、") || "普通");
  const own = [...snapshot.state.deals, ...snapshot.state.pledges].filter(
    (entry) =>
      (entry.from === selected || entry.to === selected) &&
      entry.expiresAt > snapshot.now &&
      (entry.status === "proposed" || entry.status === "accepted"),
  );
  setText(
    element("actor-agreements"),
    own.map(agreementText).join("、") || "暂无",
  );
  setText(element("cenyan-goal"), goalName(actor.goal));
  setText(
    element("cenyan-plan"),
    actor.plan
      ? actor.plan.steps
          .map(
            (step, index) =>
              `${index + 1}. ${stepText(step)}${index === actor.plan!.index ? "（当前）" : ""}`,
          )
          .join(" → ")
      : "暂无计划",
  );
  setText(
    element("cenyan-bag"),
    `木材 ${actor.bag.wood} · 石材 ${actor.bag.stone}`,
  );
  setText(element("cenyan-result"), actor.last?.text ?? "暂无回执");
  setText(
    element("cenyan-pending"),
    actor.pending
      ? `${goalName(actor.pending.goal)} · ${actor.pending.steps.map(stepText).join(" → ")}`
      : "暂无",
  );
  setText(
    element("cenyan-decision"),
    actor.decision ? JSON.stringify(actor.decision, undefined, 2) : "暂无",
  );
  setText(
    element("cenyan-results"),
    actor.results
      .slice(1)
      .map((result) => `${result.code} · ${result.text}`)
      .join("\n"),
  );
  const modelNames = {
    disabled: "自主关闭",
    idle: "等待",
    pending: "请求中",
    backoff: "冷却",
    blocked: "受限",
  };
  setText(
    element("cenyan-model"),
    model
      ? [
          model.mode === "mock"
            ? "Mock 模拟"
            : model.mode === "live"
              ? "Live"
              : "",
          modelNames[model.kind],
          model.trigger ? (triggerNames[model.trigger] ?? "") : "",
          model.result ?? "",
          model.elapsedMs === undefined ? "" : `${model.elapsedMs} ms`,
          model.tokens === undefined ? "" : `计入 ${model.tokens} Token`,
          model.sharedUsage
            ? `累计 ${model.sharedUsage.requests} 次 / ${model.sharedUsage.tokens} Token`
            : "",
          model.sharedUsage?.chargedUsd === undefined
            ? ""
            : `累计占用 $${model.sharedUsage.chargedUsd.toFixed(6)}`,
          model.estimatedUsd === undefined
            ? ""
            : `估算 $${model.estimatedUsd.toFixed(6)}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : "暂无调用",
  );
  const memoryKey = memory.map(({ id }) => id).join("|");
  if (shownMemory !== memoryKey) {
    shownMemory = memoryKey;
    element("cenyan-memory").replaceChildren(
      ...memory.map((entry) =>
        label(
          `${
            entry.kind === "claim"
              ? entry.source === "traveler"
                ? "旅人声称"
                : entry.source === "rules"
                  ? memoryLabels.claim
                  : actorName(entry.source) + "声称"
              : memoryLabels[entry.kind]
          } · ${entry.content}`,
          "li",
        ),
      ),
    );
  }
}

export function render(snapshot: Snapshot, enabled: boolean) {
  const { state, now, working } = snapshot;
  renderResidents(snapshot);
  for (const id of npcIds) {
    const button = element<HTMLButtonElement>("talk-" + id);
    button.hidden = !nearPlayer(snapshot, id);
    button.disabled = !enabled;
  }
  for (const [key, amount] of Object.entries(state.inventory))
    setText(itemCounts.get(key)!, String(amount));
  setText(
    location,
    valley.regions.find(
      (region) => distance(region, state.player) < region.radius,
    )?.name ?? "雾灯谷小径",
  );
  const built = state.bridge;
  const hasMaterials =
    built.wood === bridge.required.wood &&
    built.stone === bridge.required.stone;
  const percent = Math.floor((built.progressMs / bridge.workMs) * 100);
  if (progress.value !== percent) progress.value = percent;
  setText(percentLabel, `${percent}%`);
  setText(deliveredWood, `${built.wood} / ${bridge.required.wood}`);
  setText(deliveredStone, `${built.stone} / ${bridge.required.stone}`);
  for (const key of ["player", ...npcIds, "legacy"] as const) {
    const node = element(`bridge-${key}-contribution`);
    const { wood, stone, workMs } = state.contributions[key];
    if (key !== "player" && key !== "cenyan")
      node.hidden = !wood && !stone && !workMs;
    setText(
      node,
      `${key === "legacy" ? "旧档记录" : actorName(key)} · 木材 ${wood} · 石材 ${stone} · 施工 ${(workMs / 1000).toFixed(2)} 秒`,
    );
  }
  const shared = element("bridge-shared-work");
  shared.hidden = !state.sharedWorkMs;
  setText(shared, `同时施工 ${(state.sharedWorkMs / 1000).toFixed(2)} 秒`);
  const atBridge = distance(state.player, bridge) <= bridge.range;
  element("bridge-delivery").hidden = !atBridge || hasMaterials;
  element<HTMLButtonElement>("delivery-send").disabled = !enabled;
  const incoming =
    state.gift &&
    state.gift.from !== "player" &&
    (state.gift.to ?? "player") === "player" &&
    state.gift.expiresAt > now
      ? state.gift
      : undefined;
  element("gift-incoming").hidden = !incoming;
  if (incoming) {
    const npc = npcSchema.parse(incoming.from);
    setText(
      element("gift-description"),
      `${actorName(npc)}提议赠你${items[incoming.item]} ×${incoming.qty}`,
    );
    for (const choice of ["accept", "reject"])
      element<HTMLButtonElement>(`gift-${choice}`).disabled =
        !enabled || !nearPlayer(snapshot, npc);
  }
  const follow = element<HTMLButtonElement>("stop-follow");
  const follower = npcIds.find((id) => {
    const plan = state.actors[id].plan;
    const step = plan?.steps[plan.index];
    return step?.type === "follow" && step.target_id === "player";
  });
  follow.hidden = !follower;
  follow.disabled = !enabled;
  follow.dataset.actor = follower ?? "";
  const waiting = element<HTMLButtonElement>("stop-wait");
  const waiter = npcIds.find((id) => {
    const plan = state.actors[id].plan;
    return (
      nearPlayer(snapshot, id) && plan?.steps[plan.index].type === "wait_until"
    );
  });
  waiting.hidden = !waiter;
  waiting.disabled = !enabled;
  waiting.dataset.actor = waiter ?? "";
  const workers = npcIds
    .filter((id) => snapshot.actors[id].activity === "working")
    .map(actorName)
    .join("、");
  setText(
    objective,
    state.explored
      ? "旅程完成"
      : built.repaired
        ? "查看航标遗迹"
        : "修复雾灯旧桥",
  );
  setText(
    nextStep,
    state.explored
      ? "你已在东岸找到航标线索，可以继续探索雾灯谷。"
      : built.repaired
        ? "穿过旧桥，顺着东岸小路前往航标遗迹。"
        : working
          ? workers
            ? `你和${workers}正在一起铺设桥板。`
            : "正在铺设桥板。留在渡口，直到施工完成。"
          : workers
            ? `${workers}正在旧桥施工。`
            : hasMaterials
              ? "材料已到位。在渡口开始施工。"
              : built.discovered
                ? "北坡林地采木，南坡岩场取石，再回渡口交付。"
                : "向东走到河边，查看雾灯旧桥。",
  );
  if (goal.hasAttribute("data-complete") !== built.repaired)
    goal.toggleAttribute("data-complete", built.repaired);

  const alternateWork = element<HTMLButtonElement>("bridge-work");
  const alternateChat = element<HTMLButtonElement>("nearby-cenyan");
  const target = nearbyTarget(state.player, state.actors);
  alternateWork.hidden =
    !atBridge || !hasMaterials || built.repaired || target?.id === bridge.id;
  alternateWork.disabled = !enabled;
  setText(alternateWork, working ? "暂停施工" : "开始施工");
  const nearby = npcIds.find(
    (id) => id !== target?.id && nearPlayer(snapshot, id),
  );
  alternateChat.hidden = !nearby;
  alternateChat.dataset.actor = nearby ?? "";
  if (nearby) setText(alternateChat, `与${actorName(nearby)}交谈`);
  alternateChat.disabled = !enabled;
  let nextSelection: typeof selection;
  let hint = "沿小路探索，靠近居民或采集点后按 E。";
  let image = "player-face";
  if (target) {
    const resident = residents.get(target.id);
    const resource = resources.get(target.id);
    if (resident) {
      image = `${resident.asset}-face`;
      hint = `${resident.role} · 和${resident.name}聊聊。`;
      nextSelection = {
        target: target.id,
        verb: "inspect",
        label: `与${resident.name}交谈`,
      };
    } else if (resource) {
      image = resource.item;
      const wait = Math.ceil(((state.cooldowns[target.id] ?? 0) - now) / 1000);
      hint =
        wait > 0
          ? `约 ${wait} 秒后可再次采集。`
          : `可采集${items[resource.item]} ×${resource.yieldCount}。`;
      nextSelection = {
        target: target.id,
        verb: "collect",
        label: `采集${items[resource.item]}`,
      };
    } else if (target.id === bridge.id) {
      image = "toolbox";
      if (!built.discovered || built.repaired) {
        hint = built.repaired
          ? "桥面已经恢复，从渡口向东可以过河。"
          : "桥板断裂，河水截断了去东岸的路。";
        nextSelection = {
          target: bridge.id,
          verb: "inspect",
          label: "查看旧桥",
        };
      } else if (!hasMaterials) {
        hint = `尚缺木材 ×${bridge.required.wood - built.wood}、石材 ×${bridge.required.stone - built.stone}。`;
        nextSelection = {
          target: bridge.id,
          verb: "deliver",
          label: "交付材料",
        };
      } else if (working) {
        hint = "留在渡口完成施工，走动会暂停。";
        nextSelection = { target: bridge.id, verb: "stop", label: "暂停施工" };
      } else {
        hint = workers
          ? `${workers}正在施工，可以一起动手。`
          : "材料已就位，按 E 开始施工。";
        nextSelection = { target: bridge.id, verb: "work", label: "开始施工" };
      }
    } else {
      image = "letter";
      hint = "石面刻着磨损的星纹。";
      nextSelection = { target: target.id, verb: "inspect", label: "查看航标" };
    }
  }
  const changed = target?.id !== lastTarget;
  const actionChanged = nextSelection?.verb !== lastVerb;
  if (changed) shownResult = false;
  if (changed || actionChanged || !renderedSelection) {
    renderedSelection = true;
    targetName.textContent = target?.name ?? "探索雾灯谷";
    if (target) {
      feedbackIcon.src = `/assets/${image}.png`;
      feedbackIcon.hidden = false;
    } else feedbackIcon.hidden = true;
    primary.replaceChildren(
      document.createTextNode((nextSelection?.label ?? "附近无交互") + " "),
      label("E", "kbd"),
    );
    inspect.hidden =
      target?.id !== bridge.id || nextSelection?.verb === "inspect";
  }
  if (!shownResult && (changed || hint !== lastHint))
    feedback.textContent = hint;
  lastTarget = target?.id;
  lastVerb = nextSelection?.verb;
  lastHint = hint;
  selection = nextSelection;
  enableActions(enabled);
}

function nearPlayer({ state }: Snapshot, id: NpcId) {
  return distance(state.player, state.actors[id]) <= residents.get(id)!.range;
}

let shownEvents = "";
const agreementKeys = new WeakMap<HTMLElement, string>();
export function renderSociety(
  snapshot: Snapshot,
  available: boolean,
  dialogNpc?: NpcId,
) {
  const events = snapshot.state.events.slice(0, 4);
  const key = events.map((event) => event.id).join("|");
  if (key !== shownEvents) {
    shownEvents = key;
    element("valley-events").replaceChildren(
      ...events.map((event) => label(event.text, "li")),
    );
  }
  const player = [...snapshot.state.deals, ...snapshot.state.pledges].filter(
    (entry) =>
      (entry.from === "player" || entry.to === "player") &&
      entry.expiresAt > snapshot.now &&
      (entry.status === "proposed" || entry.status === "accepted"),
  );
  const renderList = (node: HTMLElement, entries: typeof player) => {
    const key = JSON.stringify(
      entries.map((entry) => [
        entry.id,
        entry.status,
        "progress" in entry ? entry.progress : 0,
        nearPlayer(
          snapshot,
          (entry.from === "player" ? entry.to : entry.from) as NpcId,
        ),
        available,
      ]),
    );
    if (agreementKeys.get(node) === key) return;
    agreementKeys.set(node, key);
    node.replaceChildren(
      ...entries.map((entry) => {
        const other = (
          entry.from === "player" ? entry.to : entry.from
        ) as NpcId;
        const row = label(
          `${actorName(other)} · ${agreementText(entry)} · ${entry.status === "accepted" ? "已接受" : "待回应"}`,
          "li",
        );
        const add = (command: string, name: string, needsNear = false) => {
          const button = label(name, "button") as HTMLButtonElement;
          button.type = "button";
          button.dataset.agreement = entry.id;
          button.dataset.command = command;
          button.disabled =
            !available || (needsNear && !nearPlayer(snapshot, other));
          row.append(button);
        };
        if (entry.to === "player" && entry.status === "proposed") {
          add("accept", "接受", true);
          add("reject", "拒绝");
        } else if (
          entry.from === "player" &&
          "condition" in entry &&
          entry.condition.kind === "return"
        )
          add("return", "归还", true);
        else if (entry.from === "player") add("cancel", "取消");
        return row;
      }),
    );
  };
  element("valley-news").hidden = events.length === 0 && player.length === 0;
  renderList(element("player-agreements"), player);
  renderList(
    element("dialogue-agreements"),
    player.filter((entry) =>
      [entry.from, entry.to].includes(dialogNpc ?? "player"),
    ),
  );
}
