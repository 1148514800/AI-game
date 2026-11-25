import {
  saveSchema,
  schemaVersion,
  type ClientMessage,
  type DialogueEvent,
  type Result,
  type Snapshot,
} from "../shared/protocol.js";
import { valley } from "../shared/world.js";

export type ConnectionStatus = {
  kind: "connecting" | "online" | "retrying" | "failed" | "occupied";
  detail: string;
};

export class Connection {
  private socket?: WebSocket;
  private attempt = 0;
  private retryTimer?: number;
  private watchdog?: number;
  private retryDelay = 500;

  constructor(
    private readonly callbacks: {
      status: (status: ConnectionStatus) => void;
      snapshot: (snapshot: Snapshot) => void;
      result: (result: Result) => void;
      dialogue: (event: DialogueEvent) => void;
      error: (message: string) => void;
    },
  ) {}

  async connect() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.watchdog);
    const attempt = ++this.attempt;
    this.socket?.close();
    this.callbacks.status({
      kind: "connecting",
      detail: "正在连接服务并读取存档。",
    });
    try {
      const response = await fetch("/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (attempt !== this.attempt) return;
      if (response.status === 503) {
        const body = await response.json();
        if (attempt !== this.attempt) return;
        if (body.status === "save_error") {
          this.callbacks.status({ kind: "failed", detail: body.message });
          return;
        }
      }
      if (!response.ok) throw Error();
      const health = await response.json();
      if (attempt !== this.attempt) return;
      if (
        health.status !== "ok" ||
        health.phase !== 2 ||
        health.schemaVersion !== schemaVersion ||
        health.contentVersion !== valley.contentVersion
      ) {
        this.callbacks.status({
          kind: "failed",
          detail: "服务与当前地图版本不一致，请重新启动本地游戏。",
        });
        return;
      }
      this.open(attempt);
    } catch {
      if (attempt === this.attempt) this.retry("HTTP 服务无法连接，正在重试。");
    }
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private open(attempt: number) {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${location.host}/ws`);
    this.socket = socket;
    let ready = false;
    let terminal = false;
    const timeout = () => {
      clearTimeout(this.watchdog);
      this.watchdog = window.setTimeout(() => {
        terminal = true;
        this.retry(
          ready ? "连接超时，正在恢复存档。" : "WebSocket 连接超时，正在重试。",
        );
        socket.close();
      }, 5500);
    };
    timeout();
    socket.addEventListener("message", (event) => {
      if (attempt !== this.attempt || terminal) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "snapshot") {
          const state = saveSchema.parse(message.state);
          if (
            !Number.isFinite(message.now) ||
            typeof message.moving !== "boolean" ||
            typeof message.working !== "boolean"
          )
            throw Error("Invalid snapshot");
          if (!ready) {
            ready = true;
            this.retryDelay = 500;
            this.callbacks.status({ kind: "online", detail: "存档已连接" });
          }
          timeout();
          this.callbacks.snapshot({ ...message, state });
        } else if (message.type === "dialogue") {
          this.callbacks.dialogue(message);
        } else if (message.type === "result") {
          this.callbacks.result(message);
        } else if (message.type === "error" && message.code === "SAVE_ERROR") {
          terminal = true;
          this.callbacks.status({ kind: "failed", detail: message.text });
        } else if (message.type === "error") {
          this.callbacks.error(message.text);
        }
      } catch {
        terminal = true;
        this.callbacks.status({
          kind: "failed",
          detail: "收到无法读取的游戏状态。请重新连接。",
        });
        socket.close();
      }
    });
    socket.addEventListener("close", (event) => {
      if (attempt !== this.attempt) return;
      clearTimeout(this.watchdog);
      if (terminal) return;
      if (event.code === 4001) {
        this.callbacks.status({
          kind: "occupied",
          detail: "另一浏览器标签页正在游玩。",
        });
        return;
      }
      this.retry(
        ready
          ? "与雾灯谷失去连接，正在恢复存档。"
          : "WebSocket 连接失败，正在重试。",
      );
    });
  }

  private retry(detail: string) {
    this.callbacks.status({ kind: "retrying", detail });
    this.retryTimer = window.setTimeout(
      () => void this.connect(),
      this.retryDelay,
    );
    this.retryDelay = Math.min(2200, this.retryDelay * 2);
  }
}
