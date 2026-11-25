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

export function render(snapshot: Snapshot, enabled: boolean) {
  const { state, now, working } = snapshot;
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
          ? "正在铺设桥板。留在渡口，直到施工完成。"
          : hasMaterials
            ? "材料已到位。在渡口开始施工。"
            : built.discovered
              ? "北坡林地采木，南坡岩场取石，再回渡口交付。"
              : "向东走到河边，查看雾灯旧桥。",
  );
  if (goal.hasAttribute("data-complete") !== built.repaired)
    goal.toggleAttribute("data-complete", built.repaired);

  const target = nearbyTarget(state.player);
  let nextSelection: typeof selection;
  let hint = "沿小路探索，靠近居民或采集点后按 E。";
  let image = "player-face";
  if (target) {
    const resident = residents.get(target.id);
    const resource = resources.get(target.id);
    if (resident) {
      image = `${resident.asset}-face`;
      const conversational = target.id === "cenyan";
      hint = conversational
        ? "木匠 · 和岑砚聊聊。"
        : `${resident.role} · 听听${resident.name}的介绍。`;
      nextSelection = {
        target: target.id,
        verb: "inspect",
        label: conversational ? "与岑砚交谈" : "认识居民",
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
        hint = `交付木材 ×${bridge.required.wood - built.wood}、石材 ×${bridge.required.stone - built.stone}。`;
        nextSelection = {
          target: bridge.id,
          verb: "deliver",
          label: "交付材料",
        };
      } else if (working) {
        hint = "留在渡口完成施工，走动会暂停。";
        nextSelection = { target: bridge.id, verb: "stop", label: "暂停施工" };
      } else {
        hint = "材料已就位，按 E 开始施工。";
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
