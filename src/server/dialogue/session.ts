import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  actionReplySchema,
  decisionSchema,
  speechReplySchema,
  type ActionReply,
  type Decision,
  type ModelStatus,
} from "../../shared/cenyan.js";
import {
  dialogueInputLimit,
  type ClientMessage,
  type DialogueEvent,
} from "../../shared/protocol.js";
import type { World } from "../world.js";
import {
  buildMessages,
  mockReply,
  type ChatMessage,
  type PublicBridge,
  type Turn,
} from "./cenyan.js";
import {
  contextBytes,
  historyTurns,
  npcId,
  readDialogueConfig,
  type DialogueConfig,
} from "./config.js";
import { DialogueLedger, type Purpose } from "./ledger.js";
import {
  autonomyMessages,
  dialoguePlanInstructions,
  jsonDialogueInstructions,
  mockAction,
  mockActionRequest,
  mockPlan,
  perceptionText,
  type MockDecision,
  type MockDialogue,
} from "./planning.js";
import {
  containsPrivateThought,
  DialogueFailure,
  generate,
  type Usage,
} from "./provider.js";

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
  gift: "岑砚没有给出有效的赠送答复。请重新提议。",
  cooldown: "上一次行动计划有误，请稍后再请求。",
};

type OpenDialog = { id: string; owner: WebSocket };
type State = { near: boolean; bridge?: PublicBridge } | undefined;
type Job = {
  id: string;
  purpose: Purpose;
  trigger: string;
  messages: ChatMessage[];
  reservedInputTokens: number;
  mock: () => string;
  format: "text" | "optional-plan" | "plan";
  valid: () => boolean;
  invalidated?: () => void;
  done: (status: string, text?: string, plan?: ActionReply) => void;
};

type Options = {
  world: World;
  active: () => boolean;
  storageError: (error: unknown) => void;
  mockDecision?: MockDecision;
  mockDialogue?: MockDialogue;
};

const periodMs = 120_000;
const eventDelayMs = 3500;

export class DialogueSession {
  private config?: DialogueConfig;
  private ledger?: DialogueLedger;
  private unavailable?: "config" | "ledger";
  private dlg?: OpenDialog;
  private pending?: { job: Job; abort: AbortController };
  private queued?: Job;
  private running?: Promise<void>;
  private history: Turn[] = [];
  private epoch = 0;
  private seenEvent = -1;
  private nextPeriod = 0;
  private nextTry = 0;
  private streak = 0;
  private stepFailures = 0;
  private failureEvent = -1;
  private actionRetryAt = 0;
  private focusedTopic?: string;
  private model: ModelStatus = { kind: "disabled" };

  constructor(
    path: string,
    private readonly state: (socket: WebSocket) => State,
    private readonly send: (socket: WebSocket, event: DialogueEvent) => void,
    env?: NodeJS.ProcessEnv,
    private readonly stopMovement?: () => void,
    private readonly options?: Options,
  ) {
    try {
      this.config = readDialogueConfig(env);
    } catch {
      this.disable("config");
      return;
    }
    try {
      this.ledger = new DialogueLedger(path);
      this.model = {
        kind: this.config.autonomy ? "idle" : "disabled",
        mode: this.config.mode,
        sharedUsage: this.ledger.summary(this.config.mode),
      };
    } catch {
      this.disable("ledger");
    }
  }

  get status(): ModelStatus {
    return this.model;
  }
  get load() {
    return { pending: Number(!!this.pending), queued: Number(!!this.queued) };
  }
  get holdsCenyan() {
    return !!this.dlg;
  }

  private disable(code: "config" | "ledger") {
    this.unavailable = code;
    this.model = { kind: "blocked", mode: this.config?.mode, result: code };
    console.warn(`[dialogue] ${code}`);
  }

  private error(
    owner: WebSocket,
    requestId: string,
    code: string,
    dialogId?: string,
  ) {
    this.send(owner, {
      type: "dialogue",
      event: "error",
      requestId,
      dialogId,
      code,
      text: failures[code] ?? failures.provider,
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
    const dialogId = msg.type === "dialogue-open" ? undefined : msg.dialogId;
    const fail = (code: string) => this.error(owner, msg.id, code, dialogId);
    if (!state) return fail("inactive");
    if (msg.type === "dialogue-open" && msg.npc !== npcId) return fail("npc");
    if (!state.near || !state.bridge) return fail("distance");
    const { bridge } = state;
    const config = this.config;
    if (this.unavailable || !config || !this.ledger)
      return fail(this.unavailable ?? "ledger");
    if (msg.type === "dialogue-open") {
      if (this.dlg) this.cancel("旧对话已关闭。", false);
      this.stopMovement?.();
      const id = randomUUID();
      this.dlg = { id, owner };
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
    const occupied =
      this.queued ??
      (this.pending?.job.purpose === "dialogue" ? this.pending.job : undefined);
    if (occupied?.id === msg.id && occupied.valid()) return;
    if (occupied) return fail("busy");
    const world = this.options?.world;
    const gift = msg.type === "dialogue-gift" ? msg.gift : undefined;
    const text =
      msg.type === "dialogue-gift"
        ? "旅人的正式赠送提议，编号 " + msg.id
        : msg.text.trim();
    if (
      !text ||
      text.length > dialogueInputLimit ||
      /[\u0000-\u0008\u000e-\u001f]/.test(text)
    )
      return fail("invalid_input");
    const player = config.live
      ? text.replaceAll(config.live.key, "[已隐藏]")
      : text;
    if (gift) {
      if (!world) return fail("gift");
      const proposed = world.proposePlayerGift(msg.id, gift);
      if (!proposed.ok) {
        this.send(owner, {
          type: "dialogue",
          event: "error",
          requestId: msg.id,
          dialogId,
          code: proposed.code,
          text: proposed.text,
        });
        return;
      }
    }
    const abandon = () => {
      if (!gift) return;
      try {
        world?.discardPlayerGift(msg.id);
      } catch (error) {
        this.options?.storageError(error);
      }
    };
    const history = this.history.slice();
    const mockActionRequested =
      !!world && config.mode === "mock" && mockActionRequest(player);
    const canPlan =
      !!world &&
      (config.mode === "live" ||
        mockActionRequested ||
        !!gift ||
        !!this.options?.mockDialogue);
    if (mockActionRequested && performance.now() < this.actionRetryAt) {
      abandon();
      return fail("cooldown");
    }
    const view = world?.perceive(world.topic(player));
    const context = view ? perceptionText(view) : "";
    const epoch = this.epoch;
    const generation = world?.decisionState.generation;
    let input: ReturnType<typeof buildMessages>;
    try {
      const instructions = config.live?.jsonMode
        ? jsonDialogueInstructions + "\n" + dialoguePlanInstructions
        : dialoguePlanInstructions;
      input = buildMessages(
        bridge,
        history,
        player,
        canPlan ? instructions + "\n" + context : context,
      );
    } catch {
      abandon();
      fail("invalid");
      return;
    }
    const job: Job = {
      id: msg.id,
      purpose: "dialogue",
      trigger: mockActionRequested ? "player-action" : "dialogue",
      ...input,
      format: canPlan ? "optional-plan" : "text",
      mock: () => {
        const fixture =
          view && this.options?.mockDialogue?.(view, player, input.messages);
        if (fixture !== undefined) return fixture;
        if (gift && view)
          return JSON.stringify({
            goal: view.self.goal,
            speech:
              view.self.bag[gift.item] >= 8
                ? "我已经备够了，这份你留着吧。"
                : "那我收下，多谢。",
            gift_response: {
              offer_id: msg.id,
              decision: view.self.bag[gift.item] >= 8 ? "reject" : "accept",
            },
          });
        return mockActionRequested && view
          ? JSON.stringify(mockAction(view, player))
          : mockReply(bridge, history, player);
      },
      valid: () =>
        this.dlg === dialog &&
        this.epoch === epoch &&
        !!this.state(owner)?.near &&
        (!canPlan || world?.decisionState.generation === generation),
      invalidated: () => {
        abandon();
        if (this.dlg === dialog && this.epoch === epoch) fail("stale");
      },
      done: (status, speech, proposal) => {
        if (status !== "ok" || !speech) {
          abandon();
          if (canPlan && ["empty", "invalid"].includes(status))
            this.actionRetryAt = performance.now() + 5000;
          fail(status);
          return;
        }
        if (proposal?.plan && performance.now() < this.actionRetryAt)
          return fail("cooldown");
        const response = proposal?.gift_response;
        if (
          (gift && (!response || response.offer_id !== msg.id)) ||
          (!gift && response)
        ) {
          abandon();
          fail(gift ? "gift" : "invalid");
          return;
        }
        const giftResult =
          response && proposal && world
            ? world.resolveGift(
                msg.id,
                response.offer_id,
                "cenyan",
                response.decision,
                Date.now(),
                proposal,
              )
            : undefined;
        const resolution =
          proposal && !gift
            ? world?.recordActionReply(msg.id, player, proposal)
            : undefined;
        if (!proposal && !gift) world?.rememberExchange(msg.id, player, speech);
        if (proposal && world) this.focusedTopic = world.topic(player);
        this.history.push({ player, reply: speech });
        if (this.history.length > historyTurns) this.history.shift();
        this.send(owner, {
          type: "dialogue",
          event: "reply",
          requestId: msg.id,
          dialogId: dialog.id,
          text: speech,
          action: resolution,
          gift: giftResult,
        });
      },
    };
    if (this.pending) {
      this.queued = job;
      this.pending.abort.abort();
      this.send(owner, {
        type: "dialogue",
        event: "pending",
        requestId: msg.id,
        dialogId: dialog.id,
      });
    } else {
      this.start(job, () =>
        this.send(owner, {
          type: "dialogue",
          event: "pending",
          requestId: msg.id,
          dialogId: dialog.id,
        }),
      );
    }
  }

  tick(clock: number) {
    const options = this.options;
    if (
      !options?.active() ||
      !this.config?.autonomy ||
      this.unavailable ||
      this.pending ||
      this.dlg
    )
      return;
    const state = options.world.decisionState;
    if (state.executing) return;
    if (state.trigger === "step-failed" && this.failureEvent !== state.serial) {
      this.failureEvent = state.serial;
      this.stepFailures = Math.min(5, this.stepFailures + 1);
      this.nextTry = Math.max(
        this.nextTry,
        clock + Math.min(periodMs, 5000 * 2 ** (this.stepFailures - 1)),
      );
    }
    if (state.trigger !== "step-failed") this.stepFailures = 0;
    if (
      clock < this.nextTry ||
      (state.serial === this.seenEvent && clock < this.nextPeriod)
    )
      return;
    const trigger =
      state.serial === this.seenEvent ? "periodic" : state.trigger;
    const view = options.world.perceive(this.focusedTopic ?? state.topic);
    this.focusedTopic = undefined;
    const input = autonomyMessages(view, trigger);
    this.seenEvent = state.serial;
    this.nextPeriod = clock + periodMs;
    const epoch = this.epoch;
    const id = randomUUID();
    if (input.reservedInputTokens > contextBytes) {
      this.autonomyOutcome("invalid");
      return;
    }
    this.start({
      id,
      purpose: "autonomy",
      trigger,
      ...input,
      format: "plan",
      mock: () =>
        options.mockDecision?.(view, trigger) ?? JSON.stringify(mockPlan(view)),
      valid: () =>
        options.active() &&
        this.epoch === epoch &&
        options.world.decisionState.generation === state.generation &&
        !options.world.decisionState.executing,
      done: (status, _speech, plan) => {
        if (status === "ok" && plan?.plan)
          options.world.accept(id, plan as Decision);
        this.autonomyOutcome(status);
      },
    });
  }

  private autonomyOutcome(status: string) {
    const now = performance.now();
    if (status === "ok") {
      this.streak = 0;
      this.nextTry = now + eventDelayMs;
      return;
    }
    this.streak = Math.min(6, this.streak + 1);
    this.nextTry =
      now +
      (status === "budget"
        ? 60_000
        : Math.min(periodMs, 5000 * 2 ** (this.streak - 1)));
    this.nextPeriod = Math.min(this.nextPeriod, this.nextTry);
  }

  private start(job: Job, onStart?: () => void) {
    if (!job.valid()) {
      job.invalidated?.();
      return;
    }
    const config = this.config;
    const ledger = this.ledger;
    if (this.unavailable || !config || !ledger)
      return this.deliver(job, this.unavailable ?? "ledger");
    let status: ReturnType<DialogueLedger["reserve"]>;
    try {
      status = ledger.reserve(
        config,
        job.id,
        job.reservedInputTokens,
        Date.now(),
        job.purpose,
      );
    } catch {
      this.disable("ledger");
      this.deliver(job, "ledger");
      return;
    }
    if (status !== "ok") {
      this.model = {
        kind: "blocked",
        mode: config.mode,
        trigger: job.trigger,
        result: status,
        sharedUsage: this.model.sharedUsage,
      };
      this.deliver(job, status);
      return;
    }
    const abort = new AbortController();
    this.pending = { job, abort };
    this.model = {
      kind: "pending",
      mode: config.mode,
      trigger: job.trigger,
      sharedUsage: this.model.sharedUsage,
    };
    onStart?.();
    this.running = this.run(job, config, ledger, abort);
  }

  private async run(
    job: Job,
    config: DialogueConfig,
    ledger: DialogueLedger,
    abort: AbortController,
  ) {
    const start = performance.now();
    let status = "ok";
    let usage: Usage | undefined;
    let speech: string | undefined;
    let plan: ActionReply | undefined;
    const jsonMode = config.live?.jsonMode === true && job.format !== "text";
    try {
      const result = await generate(
        config,
        job.messages,
        job.mock,
        abort.signal,
        jsonMode,
      );
      usage = result.usage;
      if (job.format === "text") speech = result.text;
      else {
        let raw: unknown;
        try {
          raw = JSON.parse(result.text);
        } catch {
          // A structured reply must parse as a whole before it can carry a plan.
          if (
            jsonMode ||
            job.format === "plan" ||
            /^(?:\{|\[|```|~~~)/.test(result.text)
          )
            throw new DialogueFailure("invalid", usage);
          speech = result.text;
        }
        if (speech === undefined) {
          const plain =
            jsonMode && job.format === "optional-plan"
              ? speechReplySchema.safeParse(raw).data
              : undefined;
          if (plain) {
            speech = plain.speech;
          } else {
            const parsed = (
              job.format === "plan" ? decisionSchema : actionReplySchema
            ).safeParse(raw);
            if (!parsed.success) throw new DialogueFailure("invalid", usage);
            plan = parsed.data;
            speech = plan.speech;
          }
          // JSON escapes can hide content from the transport-level text checks.
          if (
            [plan?.goal ?? "", speech].some(
              (value) =>
                containsPrivateThought(value) ||
                (config.live && value.includes(config.live.key)),
            )
          )
            throw new DialogueFailure("invalid", usage);
        }
      }
    } catch (error) {
      status = error instanceof DialogueFailure ? error.code : "provider";
      if (error instanceof DialogueFailure) usage = error.usage;
    }
    if (abort.signal.aborted || !job.valid()) status = "cancelled";
    const elapsedMs = Math.round(performance.now() - start);
    let account: ReturnType<DialogueLedger["finish"]>;
    let sharedUsage = this.model.sharedUsage;
    try {
      account = ledger.finish(config, job.id, status, elapsedMs, usage);
      sharedUsage = ledger.summary(config.mode);
    } catch {
      this.disable("ledger");
      status = "ledger";
    }
    this.model = {
      kind:
        status === "ledger"
          ? "blocked"
          : status !== "ok" && status !== "cancelled"
            ? "backoff"
            : config.autonomy
              ? "idle"
              : "disabled",
      mode: config.mode,
      trigger: job.trigger,
      result: status,
      elapsedMs,
      sharedUsage,
      tokens:
        typeof account?.charged_tokens === "number"
          ? account.charged_tokens
          : undefined,
      estimatedUsd:
        typeof account?.estimated_nano === "number"
          ? account.estimated_nano / 1e9
          : undefined,
    };
    this.pending = undefined;
    if (status !== "cancelled") this.deliver(job, status, speech, plan);
    else if (job.purpose === "dialogue") job.invalidated?.();
    else if (job.purpose === "autonomy" && job.valid()) {
      this.seenEvent = -1;
      this.nextTry = performance.now() + eventDelayMs;
    }
    const queued = this.queued;
    this.queued = undefined;
    if (queued) this.start(queued);
  }

  private deliver(
    job: Job,
    status: string,
    speech?: string,
    plan?: ActionReply,
  ) {
    if (!job.valid()) return;
    try {
      job.done(status, speech, plan);
    } catch (error) {
      this.options?.storageError(error);
    }
  }

  checkDistance() {
    if (this.dlg && !this.state(this.dlg.owner)?.near)
      this.cancel("已离开交谈范围。");
  }

  cancel(text: string, notify = true) {
    const dialog = this.dlg;
    if (!dialog) return;
    this.dlg = undefined;
    this.queued?.invalidated?.();
    this.queued = undefined;
    if (this.pending?.job.purpose === "dialogue") {
      this.pending.abort.abort();
      this.pending.job.invalidated?.();
    }
    if (notify)
      this.send(dialog.owner, {
        type: "dialogue",
        event: "closed",
        dialogId: dialog.id,
        text,
      });
  }

  suspend(text: string, notify = true) {
    this.cancel(text, notify);
    this.epoch++;
    if (this.pending?.job.purpose === "autonomy") {
      this.pending.abort.abort();
      this.seenEvent = -1;
    }
    // Set the next periodic deadline on active ticks only. No offline debt.
    if (this.seenEvent !== -1) this.nextPeriod = Infinity;
  }

  resume(clock: number) {
    if (this.nextPeriod === Infinity) this.nextPeriod = clock + periodMs;
  }

  reset() {
    this.suspend("旅程已重开。");
    this.history = [];
    this.seenEvent = -1;
    this.nextTry = 0;
    this.nextPeriod = 0;
    this.streak = 0;
    this.stepFailures = 0;
    this.failureEvent = -1;
    this.focusedTopic = undefined;
    this.actionRetryAt = 0;
  }

  async close() {
    this.suspend("服务正在关闭。", false);
    await this.running;
    this.ledger?.close();
    this.ledger = undefined;
  }
}
