import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  actorName,
  npcIds,
  npcSchema,
  type NpcId,
} from "../../shared/social.js";
import {
  actionReplySchema,
  decisionSchema,
  legacyGoalTag,
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
  readDialogueConfig,
  type DialogueConfig,
} from "./config.js";
import { DialogueLedger, type Purpose } from "./ledger.js";
import {
  autonomyMessages,
  playerPlanInstructions,
  socialMessages,
  mockSocialReply,
  mockSocietyPlan,
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
  distance: "请走近这位居民后再交谈。",
  npc: "这位居民暂未接入自由对话。",
  inactive: "当前无法交谈，请继续旅程后再试。",
  stale: "这次对话已结束。",
  invalid_input: "请输入 1 至 480 个字符。",
  duplicate: "这条请求已处理。",
  busy: "正在等上一条回复。",
  budget: "对话额度已用完。请稍后再试，或检查服务端预算。",
  network: "无法连接对话服务，请重试。",
  auth: "对话服务拒绝了凭据，请检查服务端配置。",
  model: "对话地址、模型或请求参数不可用，请检查服务端配置。",
  "rate-limit": "对话服务请求过多，请稍后重试。",
  provider: "对话服务暂时不可用，请稍后重试。",
  timeout: "等候回复超时，可手动重试。",
  empty: "对话服务返回了空回复，可手动重试。",
  invalid: "模型回复不符合游戏格式，未执行行动。可以重试。",
  truncated: "模型回复被截断，未执行行动。可以用更短的指令重试。",
  context: "本轮对话信息过长，请缩短消息后再试。",
  agreement: "对方没有给出有效的约定答复，请重新发起。",
  cancelled: "这次请求已取消。",
  gift: "对方没有给出有效的赠送答复。请重新提议。",
  cooldown: "上一次行动计划有误，请稍后再请求。",
};

type OpenDialog = { id: string; owner: WebSocket; npc: NpcId };
type State = { near: boolean; bridge?: PublicBridge } | undefined;
type Job = {
  id: string;
  npc: NpcId;
  purpose: Purpose;
  trigger: string;
  messages: ChatMessage[];
  reservedInputTokens: number;
  mock: () => string;
  format: "text" | "speech" | "optional-plan" | "plan";
  retryInput?: () => ReturnType<typeof buildMessages>;
  hasPlan?: boolean;
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
  actors?: readonly NpcId[];
};

const periodMs = 120_000;
const eventDelayMs = 3500;
const formatCorrection =
  '上一份回复没有通过格式校验。重新生成完整 JSON：新行动必须有 goal、speech、plan_policy="replace" 和非空 plan。每个动作只带该动作允许的参数；普通问答只带 speech。省略 goal_tag。';

class ReplyFormatFailure extends DialogueFailure {
  constructor(usage?: Usage) {
    super("invalid", usage);
  }
}

export class DialogueSession {
  private config?: DialogueConfig;
  private ledger?: DialogueLedger;
  private unavailable?: "config" | "ledger";
  private dlg?: OpenDialog;
  private readonly pending = new Map<
    NpcId,
    { job: Job; abort: AbortController }
  >();
  private queued?: Job;
  private readonly running = new Set<Promise<void>>();
  private readonly calls = new Map<
    NpcId,
    {
      history: Turn[];
      seenEvent: number;
      nextPeriod: number;
      nextTry: number;
      streak: number;
      stepFailures: number;
      failureEvent: number;
      actionRetryAt: number;
      focusedTopic?: string;
      model: ModelStatus;
    }
  >(
    npcIds.map((id) => [
      id,
      {
        history: [],
        seenEvent: -1,
        nextPeriod: 0,
        nextTry: 0,
        streak: 0,
        stepFailures: 0,
        failureEvent: -1,
        actionRetryAt: 0,
        model: { kind: "disabled" },
      },
    ]),
  );
  private epoch = 0;
  private cursor = 0;
  private sharedUsage?: ModelStatus["sharedUsage"];

  private actor(npc: NpcId) {
    return this.calls.get(npc)!;
  }
  private get roster() {
    return this.options?.actors ?? (["cenyan"] as const);
  }

  constructor(
    path: string,
    private readonly state: (socket: WebSocket, npc: NpcId) => State,
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
      this.sharedUsage = this.ledger.summary(this.config.mode);
      for (const state of this.calls.values())
        state.model = {
          kind: this.config.autonomy ? "idle" : "disabled",
          mode: this.config.mode,
        };
    } catch {
      this.disable("ledger");
    }
  }

  statusFor(npc: NpcId): ModelStatus {
    return { ...this.actor(npc).model, sharedUsage: this.sharedUsage };
  }
  get status() {
    return this.statusFor("cenyan");
  }
  get load() {
    return { pending: this.pending.size, queued: Number(!!this.queued) };
  }
  get holdsCenyan() {
    return this.dlg?.npc === "cenyan";
  }
  get heldActor() {
    return this.dlg?.npc;
  }
  get pendingActors() {
    return [...this.pending.keys()];
  }

  private disable(code: "config" | "ledger") {
    this.unavailable = code;
    for (const state of this.calls.values())
      state.model = { kind: "blocked", mode: this.config?.mode, result: code };
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
    const dialogId = msg.type === "dialogue-open" ? undefined : msg.dialogId;
    const fail = (code: string) => this.error(owner, msg.id, code, dialogId);
    const npc =
      msg.type === "dialogue-open"
        ? npcSchema.safeParse(msg.npc).data
        : this.dlg?.npc;
    if (!npc) return fail(msg.type === "dialogue-open" ? "npc" : "stale");
    const state = this.state(owner, npc);
    if (!state) return fail("inactive");
    if (!state.near || !state.bridge) return fail("distance");
    const lane = this.actor(npc);
    const { bridge } = state;
    const config = this.config;
    if (this.unavailable || !config || !this.ledger)
      return fail(this.unavailable ?? "ledger");
    if (msg.type === "dialogue-open") {
      if (this.dlg) this.cancel("旧对话已关闭。", false);
      this.stopMovement?.();
      const id = randomUUID();
      this.options?.world.interruptConversation(npc);
      this.dlg = { id, owner, npc };
      this.send(owner, {
        type: "dialogue",
        event: "opened",
        requestId: msg.id,
        dialogId: id,
        mode: config.mode,
        npc,
      });
      return;
    }
    const dialog = this.dlg;
    if (!dialog || dialog.owner !== owner || dialog.id !== msg.dialogId)
      return fail("stale");
    const occupied =
      this.queued ??
      [...this.pending.values()].find(
        ({ job }) => job.purpose === "dialogue" && job.valid(),
      )?.job;
    if (occupied?.id === msg.id && occupied.valid()) return;
    if (occupied) return fail("busy");
    const world = this.options?.world;
    const gift = msg.type === "dialogue-gift" ? msg.gift : undefined;
    const inbox = world?.socialInbox(npc, Date.now(), "player");
    const agreement =
      msg.type === "dialogue-agreement" &&
      [...(inbox?.deals ?? []), ...(inbox?.pledges ?? [])].find(
        (entry) =>
          entry.id === msg.offerId &&
          entry.from === "player" &&
          entry.to === npc &&
          entry.status === "proposed",
      );
    if (msg.type === "dialogue-agreement" && !agreement) return fail("stale");
    const text =
      msg.type === "dialogue-gift"
        ? "旅人的正式赠送提议，编号 " + msg.id
        : msg.type === "dialogue-agreement"
          ? "旅人的正式约定提议，编号 " + msg.offerId
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
      const proposed = world.proposePlayerGift(msg.id, gift, Date.now(), npc);
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
    const history = lane.history.slice();
    const mockActionRequested =
      !!world && config.mode === "mock" && mockActionRequest(player);
    const canPlan =
      !!world &&
      (config.mode === "live" ||
        mockActionRequested ||
        !!gift ||
        !!agreement ||
        !!this.options?.mockDialogue);
    if (mockActionRequested && performance.now() < lane.actionRetryAt) {
      abandon();
      return fail("cooldown");
    }
    const view = world?.perceive(
      world.topic(player, npc),
      Date.now(),
      npc,
      "player",
    );
    const project = view?.bridge ?? bridge;
    const context = view ? perceptionText(view) : "";
    const epoch = this.epoch;
    const generation = world?.actorDecision(npc).generation;
    const planHelp = agreement
      ? "本轮只回应当前旅人正式提议。用严格 JSON 包含 goal、speech、social_response（offer_id 必须为该提议 ID，decision 为 accept 或 reject）。"
      : view
        ? playerPlanInstructions(view, !!gift)
        : "";
    const jsonDialogue =
      canPlan && config.live?.jsonMode && !gift && !agreement;
    const buildInput = (correction = "") =>
      buildMessages(
        project,
        history,
        player,
        [
          canPlan ? planHelp : "",
          context,
          jsonDialogue ? jsonDialogueInstructions : "",
          correction,
        ]
          .filter(Boolean)
          .join("\n"),
        npc,
      );
    let input: ReturnType<typeof buildMessages>;
    try {
      input = buildInput();
    } catch {
      abandon();
      fail("context");
      return;
    }
    const job: Job = {
      id: msg.id,
      npc,
      purpose: "dialogue",
      trigger: mockActionRequested ? "player-action" : "dialogue",
      ...input,
      format: canPlan ? "optional-plan" : "text",
      retryInput: jsonDialogue ? () => buildInput(formatCorrection) : undefined,
      hasPlan: !!(view?.self.active || view?.self.pending),
      mock: () => {
        const fixture =
          view && this.options?.mockDialogue?.(view, player, input.messages);
        if (fixture !== undefined) return fixture;
        if (agreement && view) {
          const take =
            "terms" in agreement && "take" in agreement.terms
              ? agreement.terms.take
              : undefined;
          const accept =
            !take ||
            view.self.bag[take.item] >= take.qty + (npc === "ahe" ? 1 : 0);
          return JSON.stringify({
            goal: view.self.goal,
            speech: accept
              ? "好，按你提的约定办。"
              : "手头余量不多，这回就先不换了。",
            social_response: {
              offer_id: agreement.id,
              decision: accept ? "accept" : "reject",
            },
          });
        }
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
          : mockReply(project, history, player, npc);
      },
      valid: () =>
        this.dlg === dialog &&
        this.epoch === epoch &&
        !!this.state(owner, npc)?.near &&
        (!canPlan || world?.actorDecision(npc).generation === generation),
      invalidated: () => {
        abandon();
        if (this.dlg === dialog && this.epoch === epoch) fail("stale");
      },
      done: (status, speech, proposal) => {
        if (status !== "ok" || !speech) {
          abandon();
          if (mockActionRequested && ["empty", "invalid"].includes(status))
            lane.actionRetryAt = performance.now() + 5000;
          fail(status);
          return;
        }
        const response = proposal?.gift_response;
        const socialResponse = proposal?.social_response;
        if (
          (agreement && socialResponse?.offer_id !== agreement.id) ||
          (!agreement && socialResponse)
        ) {
          fail("agreement");
          return;
        }
        const agreementResult =
          socialResponse && world
            ? world.applySocial(msg.id, npc, {
                kind: "respond",
                offerId: socialResponse.offer_id,
                choice: socialResponse.decision,
              })
            : undefined;
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
                npc,
                response.decision,
                Date.now(),
                proposal,
              )
            : undefined;
        const resolution =
          proposal && !gift && !agreement
            ? world?.recordActionReply(
                msg.id,
                player,
                proposal,
                Date.now(),
                npc,
              )
            : undefined;
        if (!proposal && !gift && !agreement)
          world?.rememberExchange(msg.id, player, speech, Date.now(), npc);
        if (proposal && world) lane.focusedTopic = world.topic(player, npc);
        lane.history.push({ player, reply: speech });
        if (lane.history.length > historyTurns) lane.history.shift();
        this.send(owner, {
          type: "dialogue",
          event: "reply",
          requestId: msg.id,
          dialogId: dialog.id,
          text: speech,
          action: resolution,
          gift: giftResult,
          agreement: agreementResult,
        });
      },
    };
    if (!this.hasSlot(npc)) {
      this.queued = job;
      const occupying =
        this.pending.get(npc) ??
        [...this.pending.values()].find(
          ({ job }) => job.purpose === "autonomy",
        );
      occupying?.abort.abort();
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

  private hasSlot(npc: NpcId) {
    return this.pending.size < 2 && !this.pending.has(npc);
  }

  private startQueued() {
    const queued = this.queued;
    if (queued && this.hasSlot(queued.npc)) {
      this.queued = undefined;
      this.start(queued);
    }
  }

  tick(clock: number) {
    const options = this.options;
    if (!options?.active() || !this.config?.autonomy || this.unavailable)
      return;
    for (const pending of this.pending.values())
      if (!pending.job.valid()) pending.abort.abort();
    this.startQueued();
    if (this.queued || this.pending.size >= 2) return;
    for (const npc of this.roster) {
      const turn = options.world.conversationFor(npc);
      if (turn && this.startSocial(turn.id)) return;
    }
    for (let index = 0; index < this.roster.length; index++) {
      const position = (this.cursor + index) % this.roster.length;
      if (this.startAutonomy(this.roster[position], clock, options)) {
        this.cursor = (position + 1) % this.roster.length;
        return;
      }
    }
  }

  private startSocial(conversation: string) {
    const options = this.options!;
    const world = options.world;
    const config = this.config!;
    const turn = world.socialTurn(conversation);
    if (!turn || this.dlg?.npc === turn.actor || !this.hasSlot(turn.actor))
      return false;
    const npc = turn.actor;
    const peer = npc === turn.from ? turn.to : turn.from;
    const generation = world.actorDecision(npc).generation;
    const otherGeneration = world.actorDecision(peer).generation;
    const epoch = this.epoch;
    const id = randomUUID();
    const view = world.perceive(
      world.topic(turn.topic, npc),
      Date.now(),
      npc,
      peer,
    );
    const input = socialMessages(
      view,
      peer,
      turn.topic,
      turn.last,
      config.live?.jsonMode === true,
    );
    if (input.reservedInputTokens > contextBytes) {
      world.endConversation(conversation, false);
      return false;
    }
    this.start({
      id,
      npc,
      purpose: "autonomy",
      trigger: turn.lines ? "social-reply" : "social-invite",
      ...input,
      format: turn.lines ? "optional-plan" : "speech",
      mock: () => mockSocialReply(view, peer, turn.last),
      valid: () =>
        options.active() &&
        this.epoch === epoch &&
        world.socialTurn(conversation)?.lines === turn.lines &&
        world.actorDecision(npc).generation === generation &&
        world.actorDecision(peer).generation === otherGeneration,
      invalidated: () => {
        if (options.active() && this.epoch === epoch)
          world.endConversation(conversation, false);
      },
      done: (status, speech, proposal) => {
        if (
          status !== "ok" ||
          !speech ||
          proposal?.gift_response ||
          proposal?.social_response
        ) {
          world.endConversation(conversation, false);
          return;
        }
        if (!world.speak(conversation, npc, speech)) return;
        if (turn.last) {
          if (proposal)
            world.recordActionReply(
              id,
              turn.last,
              proposal,
              Date.now(),
              npc,
              peer,
            );
          else
            world.rememberExchange(
              id,
              turn.last,
              speech,
              Date.now(),
              npc,
              peer,
            );
          world.rememberExchange(id, speech, turn.last, Date.now(), peer, npc);
        }
      },
    });
    return true;
  }

  private startAutonomy(npc: NpcId, clock: number, options: Options) {
    const lane = this.actor(npc);
    const state = options.world.actorDecision(npc);
    if (
      state.executing ||
      !this.hasSlot(npc) ||
      this.dlg?.npc === npc ||
      options.world.conversationFor(npc)
    )
      return false;
    if (state.trigger === "step-failed" && lane.failureEvent !== state.serial) {
      lane.failureEvent = state.serial;
      lane.stepFailures = Math.min(5, lane.stepFailures + 1);
      lane.nextTry = Math.max(
        lane.nextTry,
        clock + Math.min(periodMs, 5000 * 2 ** (lane.stepFailures - 1)),
      );
    }
    if (state.trigger !== "step-failed") lane.stepFailures = 0;
    if (
      clock < lane.nextTry ||
      (state.serial === lane.seenEvent && clock < lane.nextPeriod)
    )
      return false;
    const trigger =
      state.serial === lane.seenEvent ? "periodic" : state.trigger;
    const view = options.world.perceive(
      lane.focusedTopic ?? state.topic,
      Date.now(),
      npc,
    );
    lane.focusedTopic = undefined;
    const input = autonomyMessages(view, trigger);
    lane.seenEvent = state.serial;
    lane.nextPeriod = clock + periodMs;
    const epoch = this.epoch;
    const id = randomUUID();
    if (input.reservedInputTokens > contextBytes) {
      this.autonomyOutcome(npc, "invalid");
      return false;
    }
    this.start({
      id,
      npc,
      purpose: "autonomy",
      trigger,
      ...input,
      format: "plan",
      mock: () =>
        options.mockDecision?.(view, trigger) ??
        JSON.stringify(
          this.roster.length > 1 ? mockSocietyPlan(view) : mockPlan(view),
        ),
      valid: () =>
        options.active() &&
        this.epoch === epoch &&
        options.world.actorDecision(npc).generation === state.generation &&
        !options.world.actorDecision(npc).executing &&
        !options.world.conversationFor(npc),
      done: (status, _speech, plan) => {
        if (status === "ok" && plan?.plan)
          options.world.accept(
            id,
            plan as Decision,
            Date.now(),
            undefined,
            npc,
          );
        this.autonomyOutcome(npc, status);
      },
    });
    return true;
  }

  private autonomyOutcome(npc: NpcId, status: string) {
    const lane = this.actor(npc);
    const now = performance.now();
    if (status === "ok") {
      lane.streak = 0;
      lane.nextTry = now + eventDelayMs;
      return;
    }
    lane.streak = Math.min(6, lane.streak + 1);
    lane.nextTry =
      now +
      (status === "budget"
        ? 60_000
        : Math.min(periodMs, 5000 * 2 ** (lane.streak - 1)));
    lane.nextPeriod = Math.min(lane.nextPeriod, lane.nextTry);
  }

  private reserve(
    ledger: DialogueLedger,
    config: DialogueConfig,
    job: Job,
    id: string,
    reservedInputTokens: number,
  ) {
    return ledger.reserve(
      config,
      id,
      reservedInputTokens,
      Date.now(),
      job.purpose,
      job.npc,
      this.roster.length > 1,
      job.trigger,
    );
  }

  private start(job: Job, onStart?: () => void) {
    if (!job.valid()) {
      job.invalidated?.();
      return;
    }
    const config = this.config;
    const ledger = this.ledger;
    const lane = this.actor(job.npc);
    if (this.unavailable || !config || !ledger)
      return this.deliver(job, this.unavailable ?? "ledger");
    let status: ReturnType<DialogueLedger["reserve"]>;
    try {
      status = this.reserve(
        ledger,
        config,
        job,
        job.id,
        job.reservedInputTokens,
      );
    } catch {
      this.disable("ledger");
      this.deliver(job, "ledger");
      return;
    }
    if (status !== "ok") {
      lane.model = {
        kind: "blocked",
        mode: config.mode,
        trigger: job.trigger,
        result: status,
      };
      this.deliver(job, status);
      return;
    }
    const abort = new AbortController();
    this.pending.set(job.npc, { job, abort });
    lane.model = {
      kind: "pending",
      mode: config.mode,
      trigger: job.trigger,
    };
    onStart?.();
    const running = this.run(job, config, ledger, abort);
    this.running.add(running);
    void running
      .finally(() => this.running.delete(running))
      .catch((error) => this.options?.storageError(error));
  }

  private async requestReply(
    job: Job,
    config: DialogueConfig,
    messages: ChatMessage[],
    signal: AbortSignal,
    timeoutMs: number,
  ) {
    const jsonMode = config.live?.jsonMode === true && job.format !== "text";
    const { text, usage } = await generate(
      config,
      messages,
      job.mock,
      signal,
      jsonMode,
      timeoutMs,
    );
    let speech: string | undefined;
    let plan: ActionReply | undefined;
    if (job.format === "text" || (job.format === "speech" && !jsonMode))
      speech = text;
    else {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        // A structured reply must parse as a whole before it can carry a plan.
        if (
          jsonMode ||
          job.format === "plan" ||
          /^(?:\{|\[|```|~~~)/.test(text)
        )
          throw new ReplyFormatFailure(usage);
        speech = text;
      }
      if (speech === undefined && job.format === "speech") {
        const parsed = speechReplySchema.safeParse(raw);
        if (!parsed.success) throw new ReplyFormatFailure(usage);
        speech = parsed.data.speech;
      }
      if (speech === undefined) {
        if (
          job.retryInput &&
          raw &&
          typeof raw === "object" &&
          "goal_tag" in raw &&
          (typeof raw.goal_tag !== "string" || !legacyGoalTag(raw.goal_tag))
        ) {
          // A model-invented label is optional metadata and has no action parameters.
          const { goal_tag: _unknownTag, ...untagged } = raw;
          raw = untagged;
        }
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
          if (!parsed.success) throw new ReplyFormatFailure(usage);
          plan = parsed.data;
          if (
            job.retryInput &&
            (plan.gift_response ||
              plan.social_response ||
              (!plan.plan && !plan.plan_policy) ||
              (plan.plan_policy === "continue" && !job.hasPlan))
          )
            throw new ReplyFormatFailure(usage);
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
    const exposed = proposalText(plan, speech);
    if (
      containsPrivateThought(exposed) ||
      (config.live && exposed.includes(config.live.key))
    )
      throw new DialogueFailure("invalid", usage);
    if (
      job.trigger.startsWith("social-") &&
      (!speech ||
        speech.length > 300 ||
        /[\u0000-\u0008\u000e-\u001f]/.test(speech))
    )
      throw new DialogueFailure("invalid", usage);
    return { usage, speech, plan };
  }

  private async run(
    job: Job,
    config: DialogueConfig,
    ledger: DialogueLedger,
    abort: AbortController,
  ) {
    const start = performance.now();
    let status = "ok";
    let speech: string | undefined;
    let plan: ActionReply | undefined;
    let tokens: number | undefined;
    let estimatedNano: number | undefined;
    let attemptId = job.id;
    let messages = job.messages;
    let timeoutMs = config.limits.LLM_TIMEOUT_MS;
    for (;;) {
      const attemptStart = performance.now();
      let usage: Usage | undefined;
      let formatFailed = false;
      try {
        ({ usage, speech, plan } = await this.requestReply(
          job,
          config,
          messages,
          abort.signal,
          timeoutMs,
        ));
        status = "ok";
      } catch (error) {
        status = error instanceof DialogueFailure ? error.code : "provider";
        if (error instanceof DialogueFailure) usage = error.usage;
        formatFailed = error instanceof ReplyFormatFailure;
      }
      if (abort.signal.aborted || !job.valid()) status = "cancelled";
      try {
        const account = ledger.finish(
          config,
          attemptId,
          status,
          Math.round(performance.now() - attemptStart),
          usage,
        );
        if (typeof account?.charged_tokens === "number")
          tokens = (tokens ?? 0) + account.charged_tokens;
        if (typeof account?.estimated_nano === "number")
          estimatedNano = (estimatedNano ?? 0) + account.estimated_nano;
        this.sharedUsage = ledger.summary(config.mode);
      } catch {
        this.disable("ledger");
        status = "ledger";
      }
      if (
        status !== "invalid" ||
        !formatFailed ||
        attemptId !== job.id ||
        !job.retryInput
      )
        break;
      let retry: ReturnType<typeof buildMessages>;
      try {
        retry = job.retryInput();
      } catch {
        // The format reminder may not fit even after older turns are dropped.
        break;
      }
      timeoutMs =
        config.limits.LLM_TIMEOUT_MS - Math.ceil(performance.now() - start);
      if (timeoutMs <= 0) break;
      const retryId = randomUUID();
      try {
        if (
          this.reserve(
            ledger,
            config,
            job,
            retryId,
            retry.reservedInputTokens,
          ) !== "ok"
        )
          break;
      } catch {
        this.disable("ledger");
        status = "ledger";
        break;
      }
      attemptId = retryId;
      messages = retry.messages;
    }
    const elapsedMs = Math.round(performance.now() - start);
    const lane = this.actor(job.npc);
    lane.model = {
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
      tokens,
      estimatedUsd:
        estimatedNano === undefined ? undefined : estimatedNano / 1e9,
    };
    this.pending.delete(job.npc);
    if (status !== "cancelled") this.deliver(job, status, speech, plan);
    else if (job.invalidated) job.invalidated();
    else if (job.valid()) {
      lane.seenEvent = -1;
      lane.nextTry = performance.now() + eventDelayMs;
    }
    this.startQueued();
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
    if (this.dlg && !this.state(this.dlg.owner, this.dlg.npc)?.near)
      this.cancel("已离开交谈范围。");
  }

  cancel(text: string, notify = true) {
    const dialog = this.dlg;
    if (!dialog) return;
    this.dlg = undefined;
    this.queued?.invalidated?.();
    this.queued = undefined;
    const pending = this.pending.get(dialog.npc);
    if (pending?.job.purpose === "dialogue") {
      pending.abort.abort();
      pending.job.invalidated?.();
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
    for (const { job, abort } of this.pending.values()) {
      if (job.purpose === "autonomy") {
        abort.abort();
        this.actor(job.npc).seenEvent = -1;
      }
    }
    for (const lane of this.calls.values())
      if (lane.seenEvent !== -1) lane.nextPeriod = Infinity;
  }

  resume(clock: number) {
    for (const lane of this.calls.values())
      if (lane.nextPeriod === Infinity) lane.nextPeriod = clock + periodMs;
  }

  reset() {
    this.suspend("旅程已重开。");
    for (const lane of this.calls.values())
      Object.assign(lane, {
        history: [],
        seenEvent: -1,
        nextTry: 0,
        nextPeriod: 0,
        streak: 0,
        stepFailures: 0,
        failureEvent: -1,
        focusedTopic: undefined,
        actionRetryAt: 0,
      });
  }

  async close() {
    this.suspend("服务正在关闭。", false);
    await Promise.race([
      Promise.allSettled(this.running),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    this.ledger?.close();
    this.ledger = undefined;
  }
}

function proposalText(plan?: ActionReply, speech?: string) {
  return [
    speech,
    plan?.goal,
    ...(plan?.plan ?? []).flatMap((step) =>
      step.type === "talk" ? [step.topic] : [],
    ),
  ]
    .filter(Boolean)
    .join("\n");
}
