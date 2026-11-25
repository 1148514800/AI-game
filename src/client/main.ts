import Phaser from "phaser";
import "./style.css";
import { Connection, type ConnectionStatus } from "./connection.js";
import { bindDialogue } from "./dialogue.js";
import { bindInput } from "./input.js";
import { ValleyScene } from "./scene.js";
import {
  element,
  enableActions,
  furnishJournal,
  render,
  selectedAction,
  setText,
  showFeedback,
  showFinished,
  showResult,
} from "./ui.js";
import type { Action, ClientMessage, Snapshot } from "../shared/protocol.js";
import { valley } from "../shared/world.js";

furnishJournal();
const stage = element("game");
const screen = element("screen-message");
const connectionLabel = element("connection");
const retry = element<HTMLButtonElement>("retry");
const music = element<HTMLButtonElement>("music");
const pause = element<HTMLButtonElement>("pause");
const overview = element<HTMLButtonElement>("overview");
const reset = element<HTMLButtonElement>("reset");
const resetDialog = element<HTMLDialogElement>("reset-dialog");
const sound = element<HTMLButtonElement>("sound");

let assetState: "loading" | "ready" | "failed" = "loading";
let failures: string[] = [];
let service: ConnectionStatus = {
  kind: "connecting",
  detail: "正在读取存档。",
};
let snapshot: Snapshot | undefined;
let paused = false;
let soundEnabled = true;
let showingOverview = false;
let pending: { id: string; timer: number } | undefined;

function online() {
  return (
    assetState === "ready" && service.kind === "online" && Boolean(snapshot)
  );
}

function canPlay() {
  return online() && !paused && !resetDialog.open && !dialogue.active();
}

function updateControls() {
  const connected = online();
  const ready = String(connected);
  if (stage.dataset.ready !== ready) stage.dataset.ready = ready;
  scene.setHalted(!connected || paused || resetDialog.open);
  const state =
    assetState === "failed" || service.kind === "failed"
      ? "error"
      : connected
        ? "online"
        : service.kind;
  if (connectionLabel.dataset.state !== state)
    connectionLabel.dataset.state = state;
  setText(
    connectionLabel,
    assetState === "failed"
      ? "素材缺失"
      : connected
        ? "本地存档已连接"
        : {
            online: "正在读取素材",
            connecting: "正在连接",
            retrying: "重连中",
            failed: "服务不可用",
            occupied: "旅程已切换",
          }[service.kind],
  );
  if (pause.disabled === connected) pause.disabled = !connected;
  setText(pause, paused ? "继续" : "暂停");
  if (pause.getAttribute("aria-pressed") !== String(paused))
    pause.setAttribute("aria-pressed", String(paused));
  if (overview.disabled === connected) overview.disabled = !connected;
  const disableReset = !connected || Boolean(pending);
  if (reset.disabled !== disableReset) reset.disabled = disableReset;
  if (music.disabled === (assetState === "ready"))
    music.disabled = assetState !== "ready";
  setText(element("save-status"), connected ? "本地自动存档" : "等待本地存档");
  if (snapshot) render(snapshot, canPlay() && !pending);
  else {
    enableActions(false);
    setText(element("cenyan-status"), "岑砚 · 等待连接");
  }

  const hideScreen = connected && !paused;
  if (screen.hidden !== hideScreen) screen.hidden = hideScreen;
  if (screen.hidden) return;
  retry.hidden = true;
  let title = "正在进入雾灯谷";
  let detail = "正在读取本地素材和存档。";
  if (assetState === "failed") {
    title = "游戏素材加载失败";
    detail = `无法读取 ${failures.join("、")}。请检查本地文件后重新加载页面。`;
  } else if (service.kind !== "online") {
    title =
      service.kind === "retrying"
        ? "正在重连雾灯谷"
        : service.kind === "failed" || service.kind === "occupied"
          ? "暂时无法进入雾灯谷"
          : "正在连接雾灯谷";
    detail = service.detail;
    retry.hidden = service.kind === "connecting";
  } else if (paused) {
    title = "旅程暂停";
    detail = "按 Esc 或点击「继续」回到雾灯谷。";
  }
  setText(element("screen-title"), title);
  setText(element("screen-detail"), detail);
}

const scene = new ValleyScene((missing) => {
  failures = missing;
  assetState = missing.length ? "failed" : "ready";
  updateControls();
});

function clearPending() {
  if (pending) clearTimeout(pending.timer);
  pending = undefined;
}

const connection = new Connection({
  status(status) {
    service = status;
    if (status.kind !== "online") {
      dialogue.close(false);
      snapshot = undefined;
      clearPending();
      input.clear();
    } else if (paused) {
      connection.send({ type: "pause", paused: true });
    }
    updateControls();
  },
  snapshot(next) {
    const completed =
      snapshot && !snapshot.state.bridge.repaired && next.state.bridge.repaired;
    snapshot = next;
    scene.apply(next);
    updateControls();
    if (completed) {
      showFinished();
      if (soundEnabled && assetState === "ready") scene.playSound();
    }
  },
  result(result) {
    if (pending?.id !== result.id) return;
    clearPending();
    updateControls();
    showResult(result);
    if (result.ok && soundEnabled && assetState === "ready") scene.playSound();
  },
  dialogue(event) {
    dialogue.receive(event);
  },
  error: showFeedback,
});

function request(
  message: Omit<Action, "id"> | { type: "reset"; confirm: true },
) {
  if (!online() || pending) return;
  const id = crypto.randomUUID();
  if (!connection.send({ ...message, id })) return;
  pending = {
    id,
    timer: window.setTimeout(() => {
      clearPending();
      updateControls();
      showFeedback("还没收到行动回执。请查看存档状态后再试。");
    }, 3500),
  };
  updateControls();
}

function interact() {
  const action = selectedAction();
  if (!canPlay() || !action) return;
  if (action.target === "cenyan") dialogue.open();
  else request({ type: "action", target: action.target, verb: action.verb });
}

function setPaused(active: boolean) {
  if (!online() || paused === active) return;
  paused = active;
  if (active) dialogue.close();
  input.clear();
  connection.send({ type: "pause", paused });
  updateControls();
}

const input = bindInput({
  canMove: canPlay,
  send: (message: ClientMessage) =>
    service.kind === "online" && connection.send(message),
  interact,
  pause: () => setPaused(!paused),
  blurred: () => setPaused(true),
});

const dialogue = bindDialogue({
  send: (message) => connection.send(message),
  feedback: showFeedback,
  changed() {
    input.clear();
    updateControls();
  },
});

retry.addEventListener("click", () => void connection.connect());
pause.addEventListener("click", () => setPaused(!paused));
element("interact").addEventListener("click", interact);
element("bridge-check").addEventListener("click", () => {
  if (canPlay() && selectedAction()?.target === valley.bridge.id)
    request({ type: "action", target: valley.bridge.id, verb: "inspect" });
});
overview.addEventListener("click", () => {
  showingOverview = !showingOverview;
  overview.setAttribute("aria-pressed", String(showingOverview));
  overview.textContent = showingOverview ? "返回场景" : "全谷地图";
  scene.setOverview(showingOverview);
});
reset.addEventListener("click", () => {
  dialogue.close();
  resetDialog.returnValue = "";
  input.clear();
  resetDialog.showModal();
});
resetDialog.addEventListener("close", () => {
  if (resetDialog.returnValue === "reset")
    request({ type: "reset", confirm: true });
  updateControls();
});
music.addEventListener("click", async () => {
  try {
    const active = await scene.toggleMusic();
    music.setAttribute("aria-pressed", String(active));
    music.textContent = active ? "音乐开" : "音乐关";
  } catch {
    showFeedback("环境音乐启动失败，可以再次点击重试。");
  }
});
sound.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  sound.setAttribute("aria-pressed", String(soundEnabled));
  sound.textContent = soundEnabled ? "音效开" : "音效关";
});

new Phaser.Game({
  type: Phaser.CANVAS,
  scale: { mode: Phaser.Scale.NONE, width: 428, height: 282 },
  parent: stage,
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  backgroundColor: "#283c32",
  scene,
  banner: false,
});
void connection.connect();
