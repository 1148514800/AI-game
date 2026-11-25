import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import {
  clientMessage,
  schemaVersion,
  type ServerMessage,
} from "../shared/protocol.js";
import { tickMs, valley } from "../shared/world.js";
import { SaveFile } from "./save.js";
import { World } from "./world.js";
import type { MockDecision } from "./dialogue/planning.js";
import { DialogueSession } from "./dialogue/session.js";

export function createApp(
  options: {
    savePath?: string;
    staticRoot?: string;
    dialogueEnv?: NodeJS.ProcessEnv;
    mockDecision?: MockDecision;
    observeTick?: (sample: {
      elapsedMs: number;
      durationMs: number;
      pending: number;
      queued: number;
    }) => void;
  } = {},
) {
  const app = Fastify({ logger: false });
  const staticRoot = options.staticRoot ?? resolve("release/client");
  if (existsSync(staticRoot)) app.register(fastifyStatic, { root: staticRoot });

  let save: SaveFile | undefined;
  let world: World | undefined;
  let unavailable: string | undefined;
  const savePath = options.savePath ?? resolve("saves/foglamp-valley.sqlite");
  try {
    save = new SaveFile(savePath);
    world = new World(save);
  } catch (error) {
    console.error("存档无法打开，已保留原件。", error);
    unavailable = "存档无法打开。请保留原件并检查 SQLite 文件与存档版本。";
  }

  app.get("/health", (_request, reply) => {
    const info = {
      phase: 3,
      schemaVersion,
      contentVersion: valley.contentVersion,
    };
    reply.header("Cache-Control", "no-store");
    if (unavailable)
      return reply
        .code(503)
        .send({ ...info, status: "save_error", message: unavailable });
    return { ...info, status: "ok" };
  });

  const ws = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  let active: WebSocket | undefined;
  let paused = false;
  let lastPing = 0;
  let answered = true;
  let lastTick = performance.now();
  let lastSent = 0;
  let wasMoving = false;
  let wasWorking = false;
  let lastCenyanActivity: ReturnType<World["snapshot"]>["cenyan"]["activity"] =
    "idle";
  let lastModel: DialogueSession["status"] | undefined;

  function send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 65536) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(message));
  }

  const isActive = () =>
    !paused && active?.readyState === WebSocket.OPEN && !unavailable;
  const dialogue = new DialogueSession(
    savePath === ":memory:" ? savePath : `${savePath}.llm.sqlite`,
    (socket) => {
      if (
        active !== socket ||
        socket.readyState !== WebSocket.OPEN ||
        paused ||
        !world ||
        unavailable
      )
        return;
      const near = world.canTalkToCenyan();
      return { near, bridge: near ? world.publicBridge() : undefined };
    },
    send,
    options.dialogueEnv,
    () => world?.haltPlayer(),
    world
      ? {
          world,
          active: isActive,
          storageError,
          mockDecision: options.mockDecision,
        }
      : undefined,
  );

  function storageError(error: unknown) {
    console.error("存档写入失败。", error);
    unavailable = "存档写入失败。请检查磁盘与存档，再重新启动服务。";
    world?.halt();
    dialogue.suspend("存档不可用，对话已结束。");
    if (active) {
      send(active, { type: "error", code: "SAVE_ERROR", text: unavailable });
      active.close(1011);
    }
  }

  function update(clock = performance.now()) {
    if (!active || !world) return;
    const snapshot = world.snapshot(Date.now(), paused);
    lastCenyanActivity = snapshot.cenyan.activity;
    lastModel = dialogue.status;
    snapshot.cenyan.model = dialogue.status;
    send(active, snapshot);
    lastSent = clock;
    ({ moving: wasMoving, working: wasWorking } = world.activity);
  }

  const timer = setInterval(() => {
    const clock = performance.now();
    const elapsed = clock - lastTick;
    lastTick = clock;
    if (!active || !world || unavailable) return;
    try {
      if (clock - lastPing >= 2000) {
        if (!answered) {
          world.halt();
          dialogue.suspend("连接已断开。", false);
          active.terminate();
          return;
        }
        if (active.readyState === WebSocket.OPEN) {
          answered = false;
          lastPing = clock;
          active.ping();
        }
      }
      if (isActive()) {
        world.tick(clock, elapsed, Date.now(), dialogue.holdsCenyan);
        dialogue.checkDistance();
        dialogue.tick(clock);
      }
      const { moving, working } = world.activity;
      if (
        moving ||
        working ||
        wasMoving ||
        wasWorking ||
        (!paused && world.cenyanActivity !== lastCenyanActivity) ||
        dialogue.status !== lastModel ||
        clock - lastSent >= 1000
      )
        update(clock);
    } catch (error) {
      storageError(error);
    } finally {
      options.observeTick?.({
        elapsedMs: elapsed,
        durationMs: performance.now() - clock,
        ...dialogue.load,
      });
    }
  }, tickMs);
  timer.unref();

  app.server.on("upgrade", (request, socket, head) => {
    const origin = request.headers.origin;
    const host = request.headers.host ?? "";
    const isLoopback = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host);
    const sameOrigin =
      !origin || origin === `http://${host}` || origin === `https://${host}`;
    if (request.url !== "/ws" || !isLoopback || !sameOrigin) {
      socket.destroy();
      return;
    }
    ws.handleUpgrade(request, socket, head, (client) =>
      ws.emit("connection", client, request),
    );
  });

  ws.on("connection", (socket) => {
    socket.on("error", () => socket.terminate());
    if (!world || unavailable) {
      send(socket, {
        type: "error",
        code: "SAVE_ERROR",
        text: unavailable ?? "存档不可用。",
      });
      socket.close(1011);
      return;
    }
    const current = world;
    if (active) {
      dialogue.suspend("另一标签页已接管旅程。", false);
      active.close(4001, "single player");
    }
    current.halt();
    active = socket;
    paused = false;
    lastPing = performance.now();
    dialogue.resume(lastPing);
    answered = true;
    socket.on("pong", () => {
      if (active === socket) answered = true;
    });
    let inputWindow = lastPing;
    let messages = 0;
    let actions = 0;

    socket.on("message", (raw, binary) => {
      if (active !== socket || unavailable) return;
      const clock = performance.now();
      if (clock - inputWindow >= 1000) {
        inputWindow = clock;
        messages = 0;
        actions = 0;
      }
      if (++messages > 90) {
        socket.close(1008, "input limit");
        return;
      }

      let input: unknown;
      try {
        input = binary ? null : JSON.parse(raw.toString());
      } catch {
        input = null;
      }
      const parsed = clientMessage.safeParse(input);
      if (!parsed.success) {
        send(socket, {
          type: "error",
          code: "INVALID_MESSAGE",
          text: "行动格式无效。",
        });
        return;
      }

      const message = parsed.data;
      if (
        message.type === "dialogue-open" ||
        message.type === "dialogue-send" ||
        message.type === "dialogue-close"
      ) {
        try {
          dialogue.handle(socket, message);
        } catch {
          console.warn("[dialogue] internal");
          if (message.type !== "dialogue-close")
            send(socket, {
              type: "dialogue",
              event: "error",
              requestId: message.id,
              dialogId:
                message.type === "dialogue-send" ? message.dialogId : undefined,
              code: "internal",
              text: "暂时无法处理对话，可手动重试。",
            });
        }
        return;
      }

      try {
        switch (message.type) {
          case "move":
            if (!paused) current.setMovement(message, clock);
            break;
          case "pause":
            if (paused !== message.paused) {
              paused = message.paused;
              if (paused) {
                dialogue.suspend("旅程已暂停。");
                current.halt();
                current.flush();
              } else dialogue.resume(clock);
            }
            update(clock);
            break;
          case "action":
          case "reset": {
            if (++actions > 8 || (paused && message.type === "action")) {
              send(socket, {
                type: "result",
                id: message.id,
                ok: false,
                code: paused ? "PAUSED" : "RATE_LIMIT",
                text: paused ? "请先继续游玩。" : "操作太快，请稍等。",
              });
              break;
            }
            const result =
              message.type === "reset"
                ? current.reset(message)
                : current.perform(message);
            if (message.type === "reset" && result.ok) dialogue.reset();
            update(clock);
            send(socket, result);
            break;
          }
        }
      } catch (error) {
        storageError(error);
      }
    });

    socket.on("close", () => {
      if (active !== socket) return;
      active = undefined;
      dialogue.suspend("连接已断开。", false);
      current.halt();
      if (!unavailable) {
        try {
          current.flush();
        } catch (error) {
          storageError(error);
        }
      }
    });
    update();
  });

  app.addHook("preClose", async () => {
    clearInterval(timer);
    dialogue.suspend("服务正在关闭。", false);
    for (const socket of ws.clients) socket.terminate();
    active = undefined;
    if (!unavailable) {
      try {
        world?.flush();
      } catch (error) {
        storageError(error);
      }
    }
    ws.close();
  });
  app.addHook("onClose", async () => {
    await dialogue.close();
    save?.close();
  });
  return app;
}
