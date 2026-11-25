import {
  dialogueInputLimit,
  type ClientMessage,
  type DialogueEvent,
} from "../shared/protocol.js";
import { residents } from "../shared/world.js";
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
  const mode = element("dialogue-mode");
  const transcript = element("dialogue-transcript");
  const pending = element("dialogue-pending");
  const error = element("dialogue-error");
  let opening: string | undefined;
  let dialogId: string | undefined;
  let request: { id: string; text: string } | undefined;
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

  function open() {
    if (active()) return;
    const id = crypto.randomUUID();
    if (!callbacks.send({ type: "dialogue-open", id, npc: "cenyan" })) {
      callbacks.feedback("暂时无法开启对话，连接恢复后再试。");
      return;
    }
    opening = id;
    callbacks.changed();
  }

  function submit(text: string, repeat = false) {
    if (!dialogId || request || composing) return;
    text = text.trim();
    if (!text || text.length > dialogueInputLimit) {
      showError(`请输入 1 至 ${dialogueInputLimit} 个字符。`);
      return;
    }
    const id = crypto.randomUUID();
    if (!callbacks.send({ type: "dialogue-send", id, dialogId, text })) {
      showError("连接暂不可用。可以再试一次。", repeat);
      return;
    }
    if (!repeat) {
      append("旅人", text);
      input.value = "";
    }
    request = { id, text };
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
      callbacks.feedback(residents.get("cenyan")!.intro);
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
    const text = request.text;
    request = undefined;
    progress(false);
    if (message.event === "reply") {
      append("岑砚", message.text);
      if (message.action)
        append(
          "行动回执",
          {
            accepted: "计划已接受，等待规则执行。",
            deferred: "岑砚有进行中的计划，这次请求暂缓。",
            rejected: "这次没有接受行动计划。",
          }[message.action],
        );
    } else {
      failedText = text;
      showError(message.text, true);
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
  return { active, open, close, receive };
}
