import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  dialogueInputLimit,
  type ClientMessage,
  type DialogueEvent,
} from "../../shared/protocol.js";
import {
  buildMessages,
  mockReply,
  type PublicBridge,
  type Turn,
} from "./cenyan.js";
import {
  historyTurns,
  npcId,
  readDialogueConfig,
  type DialogueConfig,
} from "./config.js";
import { DialogueLedger } from "./ledger.js";
import { DialogueFailure, generate, type Usage } from "./provider.js";

const failures: Record<string, string> = {
  config: "对话配置有误，请检查服务端的模型设置。",
  ledger: "对话用量记录不可用，请检查后重启服务。",
  distance: "请走近岑砚后再交谈。",
  npc: "这位居民暂未接入自由对话。",
  inactive: "当前无法交谈，请继续旅程后再试。",
  stale: "这次对话已结束。",
  invalid_input: "请输入 1 至 480 个字符。",
  duplicate: "这条请求已处理。",
  busy: "岑砚正在等上一条回复。",
  budget: "对话额度已用完。请稍后再试，或检查服务端预算。",
  network: "无法连接对话服务，请重试。",
  auth: "对话服务拒绝了凭据，请检查服务端配置。",
  model: "对话地址、模型或请求参数不可用，请检查服务端配置。",
  "rate-limit": "对话服务请求过多，请稍后重试。",
  provider: "对话服务暂时不可用，请稍后重试。",
  timeout: "等候回复超时，可手动重试。",
  empty: "对话服务返回了空回复，可手动重试。",
  invalid: "对话服务返回了无法使用的内容，可手动重试。",
  cancelled: "这次请求已取消。",
};

type OpenDialog = { id: string; owner: WebSocket; epoch: number };
type Request = { dialog: OpenDialog; id: string; abort: AbortController };
type State = { near: boolean; bridge?: PublicBridge } | undefined;

export class DialogueSession {
  private config?: DialogueConfig;
  private ledger?: DialogueLedger;
  private unavailable?: "config" | "ledger";
  private dlg?: OpenDialog;
  private pending?: Request;
  private running?: Promise<void>;
  private epoch = 0;
  private history: Turn[] = [];

  constructor(
    path: string,
    private readonly state: (socket: WebSocket) => State,
    private readonly send: (socket: WebSocket, event: DialogueEvent) => void,
    env?: NodeJS.ProcessEnv,
    private readonly stopMovement?: () => void,
  ) {
    try {
      this.config = readDialogueConfig(env);
    } catch {
      this.disable("config");
      return;
    }
    try {
      this.ledger = new DialogueLedger(path);
    } catch {
      this.disable("ledger");
    }
  }

  private disable(code: "config" | "ledger") {
    this.unavailable = code;
    console.warn(`[dialogue] ${code}`);
  }

  private error(
    owner: WebSocket,
    requestId: string,
    code: keyof typeof failures,
    dialogId?: string,
  ) {
    this.send(owner, {
      type: "dialogue",
      event: "error",
      requestId,
      dialogId,
      code,
      text: failures[code],
    });
  }

  handle(
    owner: WebSocket,
    msg: Extract<ClientMessage, { type: `dialogue-${string}` }>,
  ) {
    if (msg.type === "dialogue-close") {
      if (this.dlg?.owner === owner && this.dlg.id === msg.dialogId)
        this.cancel("对话已关闭。", false);
      return;
    }
    const state = this.state(owner);
    const dialogId = msg.type === "dialogue-send" ? msg.dialogId : undefined;
    const fail = (code: keyof typeof failures) =>
      this.error(owner, msg.id, code, dialogId);
    if (!state) return fail("inactive");
    if (msg.type === "dialogue-open" && msg.npc !== npcId) return fail("npc");
    if (!state.near || !state.bridge) return fail("distance");
    const bridge = state.bridge;
    if (this.unavailable || !this.config || !this.ledger)
      return fail(this.unavailable ?? "ledger");
    const config = this.config;
    if (msg.type === "dialogue-open") {
      if (this.dlg) this.cancel("旧对话已关闭。", false);
      this.stopMovement?.();
      const id = randomUUID();
      this.dlg = { id, owner, epoch: this.epoch };
      this.send(owner, {
        type: "dialogue",
        event: "opened",
        requestId: msg.id,
        dialogId: id,
        mode: config.mode,
      });
      return;
    }
    const dialog = this.dlg;
    if (!dialog || dialog.owner !== owner || dialog.id !== msg.dialogId)
      return fail("stale");
    if (this.pending?.id === msg.id && this.pending.dialog === dialog) return;
    if (this.pending) return fail("busy");
    const text = msg.text.trim();
    if (
      !text ||
      text.length > dialogueInputLimit ||
      /[\u0000-\u0008\u000e-\u001f]/.test(text)
    )
      return fail("invalid_input");
    const player = config.live
      ? text.replaceAll(config.live.key, "[已隐藏]")
      : text;
    const history = this.history.slice();
    const { messages, reservedInputTokens } = buildMessages(
      bridge,
      history,
      player,
    );
    try {
      const status = this.ledger.reserve(config, msg.id, reservedInputTokens);
      if (status !== "ok") return fail(status);
    } catch {
      this.disable("ledger");
      return fail("ledger");
    }
    const request: Request = {
      dialog,
      id: msg.id,
      abort: new AbortController(),
    };
    this.pending = request;
    this.send(owner, {
      type: "dialogue",
      event: "pending",
      requestId: msg.id,
      dialogId: dialog.id,
    });
    this.running = this.run(
      request,
      config,
      this.ledger,
      messages,
      () => mockReply(bridge, history, player),
      player,
    );
  }

  private async run(
    request: Request,
    config: DialogueConfig,
    ledger: DialogueLedger,
    messages: ReturnType<typeof buildMessages>["messages"],
    mock: () => string,
    player: string,
  ) {
    const start = performance.now();
    const { dialog, id, abort } = request;
    let result: Awaited<ReturnType<typeof generate>> | undefined;
    let status = "ok";
    let usage: Usage | undefined;
    try {
      result = await generate(config, messages, mock, abort.signal);
      usage = result.usage;
    } catch (error) {
      status = error instanceof DialogueFailure ? error.code : "provider";
      if (error instanceof DialogueFailure) usage = error.usage;
    }
    const current =
      this.dlg === dialog &&
      this.epoch === dialog.epoch &&
      this.state(dialog.owner)?.near &&
      !abort.signal.aborted;
    if (!current) status = "cancelled";
    try {
      ledger.finish(config, id, status, performance.now() - start, usage);
    } catch {
      this.disable("ledger");
      status = "ledger";
    }
    this.pending = undefined;
    if (!current) return;
    if (status !== "ok" || !result) {
      this.error(dialog.owner, id, status, dialog.id);
      return;
    }
    this.history.push({ player, reply: result.text });
    if (this.history.length > historyTurns) this.history.shift();
    this.send(dialog.owner, {
      type: "dialogue",
      event: "reply",
      requestId: id,
      dialogId: dialog.id,
      text: result.text,
    });
  }

  checkDistance() {
    if (this.dlg && !this.state(this.dlg.owner)?.near)
      this.cancel("已离开交谈范围。");
  }

  cancel(text: string, notify = true) {
    const dialog = this.dlg;
    if (!dialog) return;
    this.dlg = undefined;
    if (this.pending?.dialog === dialog) this.pending.abort.abort();
    if (notify)
      this.send(dialog.owner, {
        type: "dialogue",
        event: "closed",
        dialogId: dialog.id,
        text,
      });
  }

  reset() {
    this.cancel("旅程已重开。");
    this.epoch++;
    this.history = [];
  }

  async close() {
    this.cancel("服务正在关闭。", false);
    await this.running;
    this.ledger?.close();
    this.ledger = undefined;
  }
}
