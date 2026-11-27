import {
  dialogueInputLimit,
  type ClientMessage,
  type DialogueEvent,
} from "../shared/protocol.js";
import { materialAmount, type MaterialAmount } from "../shared/cenyan.js";
import { actorName, type NpcId } from "../shared/social.js";
import { items, residents } from "../shared/world.js";
import { element } from "./ui.js";

export function bindDialogue(callbacks: {
  send: (message: ClientMessage) => boolean;
  feedback: (text: string) => void;
  changed: () => void;
}) {
  const panel = element<HTMLDialogElement>("cenyan-dialogue");
  const input = element<HTMLTextAreaElement>("dialogue-input");
  const send = element<HTMLButtonElement>("dialogue-send");
  const retry = element<HTMLButtonElement>("dialogue-retry");
  const giftSend = element<HTMLButtonElement>("gift-send");
  const mode = element("dialogue-mode");
  const transcript = element("dialogue-transcript");
  const pending = element("dialogue-pending");
  const error = element("dialogue-error");
  let npc: NpcId = "cenyan";
  let opening: string | undefined;
  let dialogId: string | undefined;
  let request:
    | { id: string; text: string; gift?: MaterialAmount; agreement?: string }
    | undefined;
  let failedText: string | undefined;
  let composing = false;
  let composedAt = -Infinity;

  input.maxLength = dialogueInputLimit;
  const active = () => Boolean(dialogId || opening);
  function append(who: string, text: string) {
    const row = document.createElement("p");
    const name = document.createElement("strong");
    name.textContent = who;
    const content = document.createElement("span");
    content.textContent = text;
    row.append(name, content);
    transcript.append(row);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function progress(busy: boolean) {
    pending.hidden = !busy;
    send.disabled = busy;
    giftSend.disabled = busy;
    retry.disabled = busy;
  }

  function showError(text: string, allowRetry = false) {
    error.textContent = text;
    error.hidden = !text;
    retry.hidden = !allowRetry;
  }

  function close(notify = true) {
    if (!active() && !panel.open) return;
    const current = dialogId;
    opening = undefined;
    dialogId = undefined;
    request = undefined;
    failedText = undefined;
    composing = false;
    if (notify && current)
      callbacks.send({ type: "dialogue-close", dialogId: current });
    if (panel.open) panel.close();
    callbacks.changed();
  }

  function open(target: NpcId = "cenyan") {
    if (active()) return;
    const id = crypto.randomUUID();
    if (!callbacks.send({ type: "dialogue-open", id, npc: target })) {
      callbacks.feedback("暂时无法开启对话，连接恢复后再试。");
      return;
    }
    npc = target;
    opening = id;
    callbacks.changed();
  }

  function submit(
    text: string,
    repeat = false,
    gift?: MaterialAmount,
    agreement?: string,
  ) {
    if (!dialogId || request || composing) return;
    text = text.trim();
    if (!text || text.length > dialogueInputLimit) {
      showError(`请输入 1 至 ${dialogueInputLimit} 个字符。`);
      return;
    }
    const id = crypto.randomUUID();
    const message = agreement
      ? {
          type: "dialogue-agreement" as const,
          id,
          dialogId,
          offerId: agreement,
        }
      : gift
        ? { type: "dialogue-gift" as const, id, dialogId, gift }
        : { type: "dialogue-send" as const, id, dialogId, text };
    if (!callbacks.send(message)) {
      showError("连接暂不可用。可以再试一次。", repeat);
      return;
    }
    if (!repeat) {
      append("旅人", text);
      if (!gift) input.value = "";
    }
    request = { id, text, gift, agreement };
    failedText = undefined;
    showError("");
    progress(true);
    input.focus();
  }

  function receive(message: DialogueEvent) {
    if (message.event === "opened") {
      if (opening !== message.requestId) {
        callbacks.send({ type: "dialogue-close", dialogId: message.dialogId });
        return;
      }
      opening = undefined;
      dialogId = message.dialogId;
      npc = message.npc ?? npc;
      const resident = residents.get(npc)!;
      element("dialogue-title").textContent = resident.name;
      element("dialogue-pending").textContent = resident.name + "正在斟酌……";
      panel.querySelector(".dialogue-input-label")!.textContent =
        "对" + resident.name + "说";
      input.placeholder = "想和" + resident.name + "聊什么？";
      const requestBridge = panel.querySelector<HTMLButtonElement>(
        '[data-suggestion="请你帮忙修桥，可以吗？"]',
      );
      if (requestBridge)
        requestBridge.textContent = "请" + resident.name + "修桥";
      panel.querySelector(".dialogue-header p")!.textContent = resident.role;
      const portrait = panel.querySelector<HTMLImageElement>(
        ".dialogue-header img",
      );
      if (portrait) portrait.src = `/assets/${resident.asset}-face.png`;
      element("social-feedback").textContent = "";
      mode.dataset.mode = message.mode;
      mode.textContent =
        message.mode === "mock" ? "模拟对话 · Mock" : "已配置模型 · Live";
      transcript.replaceChildren();
      input.value = "";
      failedText = undefined;
      composedAt = -Infinity;
      showError("");
      progress(false);
      panel.show();
      input.focus();
      callbacks.feedback(resident.intro);
      callbacks.changed();
      return;
    }
    if (message.event === "error" && message.requestId === opening) {
      close(false);
      callbacks.feedback(message.text);
      return;
    }
    if (!dialogId || message.dialogId !== dialogId) return;
    if (message.event === "closed") {
      close(false);
      callbacks.feedback(message.text);
      return;
    }
    if (
      !request ||
      message.requestId !== request.id ||
      message.event === "pending"
    )
      return;
    const { text, gift, agreement } = request;
    request = undefined;
    progress(false);
    if (message.event === "reply") {
      append(actorName(npc), message.text);
      if (message.action)
        append(
          "行动回执",
          {
            accepted: "计划已接受，等待规则执行。",
            deferred: "已保存待执行计划，当前行动结束后执行。",
            continued: "继续当前计划。",
            rejected: "这次没有接受行动计划。",
          }[message.action],
        );
      if (message.gift) append("赠送回执", message.gift.text);
      if (message.agreement) append("约定回执", message.agreement.text);
    } else {
      failedText = gift || agreement ? undefined : text;
      showError(message.text, !gift && !agreement);
    }
  }

  element("dialogue-close").addEventListener("click", () => close());
  panel.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" ||
      event.isComposing ||
      composing ||
      event.keyCode === 229
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    composedAt = performance.now();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.isComposing || composing || event.keyCode === 229) return;
    event.preventDefault();
    // Some IMEs dispatch the candidate Enter after compositionend.
    if (performance.now() - composedAt >= 70) submit(input.value);
  });
  send.addEventListener("click", () => submit(input.value));
  element<HTMLFormElement>("dialogue-gift").addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      const parsed = materialAmount.safeParse({
        item: element<HTMLSelectElement>("gift-item").value,
        qty: element<HTMLInputElement>("gift-qty").valueAsNumber,
      });
      if (parsed.success)
        submit(
          `提议赠送${items[parsed.data.item]} ×${parsed.data.qty}`,
          false,
          parsed.data,
        );
    },
  );
  retry.addEventListener("click", () => {
    if (failedText) submit(failedText, true);
  });
  for (const suggestion of panel.querySelectorAll<HTMLButtonElement>(
    "[data-suggestion]",
  )) {
    suggestion.addEventListener("click", () => {
      input.value = suggestion.dataset.suggestion ?? "";
      input.focus();
    });
  }
  return {
    active,
    open,
    close,
    receive,
    askAgreement: (id: string) =>
      submit("请回应这项约定。", false, undefined, id),
    get npc() {
      return dialogId ? npc : undefined;
    },
  };
}
