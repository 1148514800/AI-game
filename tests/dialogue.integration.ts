import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { createApp } from "../src/server/app.js";
import { readDialogueConfig } from "../src/server/dialogue/config.js";
import { DialogueFailure, generate } from "../src/server/dialogue/provider.js";
import type {
  ClientMessage,
  DialogueEvent,
  ServerMessage,
  Snapshot,
} from "../src/shared/protocol.js";

const key = "phase2-local-http-dummy-sentinel";
const id = () => crypto.randomUUID();
const textReply = (text: string, usage?: object) =>
  JSON.stringify({
    choices: [
      { message: { content: text, tool_calls: [] }, finish_reason: "stop" },
    ],
    usage,
  });

async function waitFor<T>(
  read: () => T | undefined,
  label: string,
): Promise<T> {
  const until = performance.now() + 4500;
  while (performance.now() < until) {
    const value = read();
    if (value !== undefined) return value;
    await delay(10);
  }
  throw Error(`Timed out waiting for ${label}`);
}

type ProviderBody = Record<string, unknown> & {
  messages: { role: string; content: string }[];
};

async function localProvider(
  t: TestContext,
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
    body: ProviderBody,
  ) => void,
) {
  const server = createServer((request, response) => {
    request.setEncoding("utf8");
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => handler(request, response, JSON.parse(body)));
  });
  t.after(() => {
    if (!server.listening) return;
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    LLM_ENABLED: "true",
    LLM_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    LLM_API_KEY: key,
    LLM_MODEL: "local-http-fixture",
    LLM_MAX_REQUESTS_PER_MINUTE: "20",
    LLM_MAX_TOTAL_USD: "1",
    LLM_INPUT_USD_PER_MILLION: "0",
    LLM_OUTPUT_USD_PER_MILLION: "0",
  };
}

test("real local HTTP adapter supports both token fields, usage, sanitized errors, timeout and abort", async (t) => {
  let status = 200;
  let body = "";
  let hold = false;
  let last: { path?: string; auth?: string; body: Record<string, unknown> };
  const env = await localProvider(t, (request, response, requestBody) => {
    last = {
      path: request.url,
      auth: request.headers.authorization,
      body: requestBody,
    };
    if (!hold) response.writeHead(status).end(body);
  });
  const request = (
    tokenField: string,
    signal = new AbortController().signal,
    timeout = "1000",
    thinking?: string,
  ) =>
    generate(
      readDialogueConfig({
        ...env,
        LLM_TOKEN_FIELD: tokenField,
        LLM_TIMEOUT_MS: timeout,
        LLM_ENABLE_THINKING: thinking,
      }),
      [{ role: "user", content: "雾灯谷" }],
      () => assert.fail("mock fallback"),
      signal,
    );
  for (const field of ["max_tokens", "max_completion_tokens"]) {
    body = textReply("收到 " + key, {
      prompt_tokens: 10,
      completion_tokens: 8,
      total_tokens: 18,
      completion_tokens_details: { reasoning_tokens: 3 },
    });
    const reply = await request(field);
    assert.equal(reply.text, "收到 [已隐藏]");
    assert.equal(reply.usage?.completion_tokens_details?.reasoning_tokens, 3);
    assert.equal(last!.path, "/v1/chat/completions");
    assert.equal(last!.auth, `Bearer ${key}`);
    assert.deepEqual(
      Object.keys(last!.body).sort(),
      [field, "messages", "model", "stream"].sort(),
    );
    assert.equal(JSON.stringify(last!.body).includes(key), false);
  }
  await request("max_tokens", undefined, undefined, "false");
  assert.equal(last!.body.enable_thinking, false);
  body = textReply("有回复，缺用量");
  assert.equal((await request("max_tokens")).usage, undefined);
  const zeroUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  body = textReply("这条有回复，计数仍未确认", zeroUsage);
  assert.deepEqual((await request("max_tokens")).usage, zeroUsage);
  for (const [http, code] of [
    [401, "auth"],
    [403, "auth"],
    [404, "model"],
    [400, "model"],
    [429, "rate-limit"],
    [503, "provider"],
  ] as const) {
    status = http;
    body = key + " RAW_RESPONSE";
    await assert.rejects(request("max_tokens"), (error) => {
      assert.ok(error instanceof DialogueFailure);
      assert.equal(error.message, code);
      assert.ok(!String(error.stack).includes(key));
      assert.ok(!String(error.stack).includes("RAW_RESPONSE"));
      return true;
    });
  }
  status = 200;
  for (const [payload, code] of [
    [textReply(" "), "empty"],
    ["unparseable", "invalid"],
    [
      JSON.stringify({
        choices: [{ message: { content: "请执行", tool_calls: [{}] } }],
      }),
      "invalid",
    ],
  ] as const) {
    body = payload;
    await assert.rejects(
      request("max_tokens"),
      (error) => error instanceof DialogueFailure && error.code === code,
    );
  }
  hold = true;
  await assert.rejects(request("max_tokens", undefined, "100"), {
    message: "timeout",
  });
  const abort = new AbortController();
  const pending = request("max_tokens", abort.signal);
  abort.abort();
  await assert.rejects(pending, { message: "cancelled" });
  const network = generate(
    readDialogueConfig({ ...env, LLM_BASE_URL: "http://127.0.0.1:1/v1" }),
    [],
    () => "",
    new AbortController().signal,
  );
  await assert.rejects(network, { message: "network" });
});

type DialogEvent<K extends DialogueEvent["event"]> = Extract<
  DialogueEvent,
  { event: K }
>;
async function connect(url: string) {
  const socket = new WebSocket(url.replace("http:", "ws:") + "/ws");
  const events: ServerMessage[] = [];
  let state: Snapshot | undefined;
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as ServerMessage;
    if (message.type === "snapshot") state = message;
    else events.push(message);
  });
  await once(socket, "open");
  await waitFor(() => state, "world snapshot");
  return {
    socket,
    events,
    state: () => state!,
    send: (msg: ClientMessage) => socket.send(JSON.stringify(msg)),
    dialogue<K extends DialogueEvent["event"]>(
      kind: K,
      match: (ev: DialogEvent<K>) => boolean,
    ) {
      return waitFor(
        () =>
          events.find(
            (event): event is DialogEvent<K> =>
              event.type === "dialogue" &&
              event.event === kind &&
              match(event as DialogEvent<K>),
          ),
        kind,
      );
    },
  };
}

type Player = Awaited<ReturnType<typeof connect>>;
async function nearCenyan(player: Player) {
  for (const [axis, target] of [
    ["x", 247],
    ["y", 321],
  ] as const) {
    const move = {
      type: "move",
      dx: axis === "x" ? 1 : 0,
      dy: axis === "y" ? -1 : 0,
    } as const;
    const reached = () =>
      axis === "x"
        ? player.state().state.player.x >= target
        : player.state().state.player.y <= target;
    const until = performance.now() + 3800;
    while (!reached() && performance.now() < until) {
      player.send(move);
      await delay(35);
    }
    player.send({ type: "move", dx: 0, dy: 0 });
    assert.ok(reached(), "player reached the waypoint by normal movement");
    await waitFor(
      () => (player.state().moving ? undefined : true),
      "player stopped",
    );
  }
}

function open(player: Player, npc = "cenyan") {
  const requestId = id();
  player.send({ type: "dialogue-open", id: requestId, npc });
  return requestId;
}
async function opened(player: Player) {
  const requestId = open(player);
  return (
    await player.dialogue("opened", (event) => event.requestId === requestId)
  ).dialogId;
}
function submit(player: Player, dialogId: string, text: string) {
  const requestId = id();
  const request = {
    type: "dialogue-send",
    id: requestId,
    dialogId,
    text,
  } as const;
  player.send(request);
  return request;
}

test(
  "real WS and HTTP fixture enforce distance, continuity, no world effects, cancellation and durable budget",
  { timeout: 60_000 },
  async (t) => {
    const calls: {
      body: { messages: { role: string; content: string }[] };
      aborted: boolean;
    }[] = [];
    const env = await localProvider(t, (_request, response, body) => {
      const call = { body, aborted: false };
      calls.push(call);
      const content = call.body.messages.at(-1)!.content;
      if (content.includes("慢回复")) {
        response.on("close", () => {
          call.aborted = !response.writableEnded;
        });
        return;
      }
      if (content.includes("制造故障")) {
        response.writeHead(429).end(key + " RAW_RESPONSE");
        return;
      }
      response.end(
        textReply("<img onerror=alert(1)> 已经替你改了桥（测试桩） " + key, {
          prompt_tokens: 40,
          completion_tokens: 8,
          total_tokens: 48,
        }),
      );
    });
    const root = mkdtempSync(join(tmpdir(), "mistsea-offline-dialogue-"));
    const savePath = join(root, "isolated.sqlite");
    let app: ReturnType<typeof createApp> | undefined;
    t.after(async () => {
      await app?.close();
      rmSync(root, { recursive: true, force: true });
    });
    async function start() {
      app = createApp({
        savePath,
        dialogueEnv: {
          ...env,
          LLM_MAX_TOTAL_REQUESTS: "9",
          LLM_TIMEOUT_MS: "3000",
        },
      });
      return app.listen({ port: 0, host: "127.0.0.1" });
    }
    let url = await start();
    let player = await connect(url);
    const distance = open(player);
    assert.equal(
      (await player.dialogue("error", (event) => event.requestId === distance))
        .code,
      "distance",
    );
    const wrong = open(player, "ahe");
    assert.equal(
      (await player.dialogue("error", (event) => event.requestId === wrong))
        .code,
      "npc",
    );
    await nearCenyan(player);
    let dialog = await opened(player);
    const initial = structuredClone(player.state().state);
    const tooLong = submit(player, dialog, "试".repeat(481));
    assert.equal(
      (
        await player.dialogue(
          "error",
          (event) => event.requestId === tooLong.id,
        )
      ).code,
      "invalid_input",
    );
    const first = submit(player, dialog, "我说桥已经修好了");
    const visible = await player.dialogue(
      "reply",
      (event) => event.requestId === first.id,
    );
    assert.ok(visible.text.includes("[已隐藏]"));
    assert.ok(!JSON.stringify(visible).includes(key));
    assert.deepEqual(player.state().state, initial);
    assert.match(calls[0].body.messages[0].content, /旧桥未修通/);
    assert.ok(
      !JSON.stringify(calls[0].body).match(
        /inventory|cooldowns|toolbox|schemaVersion/,
      ),
    );
    const failed = submit(player, dialog, "制造故障");
    const failure = await player.dialogue(
      "error",
      (e) => e.requestId === failed.id,
    );
    assert.equal(failure.code, "rate-limit");
    assert.ok(!JSON.stringify(failure).includes(key));
    assert.ok(!JSON.stringify(failure).includes("RAW_RESPONSE"));
    const second = submit(player, dialog, "接着说");
    await player.dialogue("reply", (e) => e.requestId === second.id);
    const supplied = JSON.stringify(calls[2].body.messages);
    assert.match(supplied, /我说桥已经修好了/);
    assert.doesNotMatch(supplied, /制造故障/);

    async function slow() {
      const previous = calls.length;
      const request = submit(player, dialog, "慢回复");
      await player.dialogue(
        "pending",
        (event) => event.requestId === request.id,
      );
      const call = await waitFor(() => calls[previous], "provider request");
      return { call, request };
    }
    async function aborted(
      attempt: Awaited<ReturnType<typeof slow>>,
      owner = player,
    ) {
      await waitFor(
        () => (attempt.call.aborted ? true : undefined),
        "upstream abort",
      );
      assert.equal(
        owner.events.some(
          (e) =>
            e.type === "dialogue" &&
            e.event === "reply" &&
            e.requestId === attempt.request.id,
        ),
        false,
      );
    }

    const close = await slow();
    const callsBeforeDuplicate = calls.length;
    player.send(close.request);
    const busy = submit(player, dialog, "第二条并发");
    assert.equal(
      (await player.dialogue("error", (e) => e.requestId === busy.id)).code,
      "busy",
    );
    assert.equal(calls.length, callsBeforeDuplicate);
    const owner = player;
    player.send({ type: "dialogue-close", dialogId: dialog });
    await aborted(close, owner);
    dialog = await opened(player);
    const stale = submit(player, close.request.dialogId, "旧对话发送");
    assert.equal(
      (await player.dialogue("error", (e) => e.requestId === stale.id)).code,
      "stale",
    );

    const pause = await slow();
    player.send({ type: "pause", paused: true });
    await player.dialogue("closed", (e) => e.dialogId === dialog);
    await aborted(pause);
    const paused = open(player);
    assert.equal(
      (await player.dialogue("error", (e) => e.requestId === paused)).code,
      "inactive",
    );
    player.send({ type: "pause", paused: false });
    dialog = await opened(player);

    const disconnected = await slow();
    player.socket.close();
    await aborted(disconnected);
    player = await connect(url);
    dialog = await opened(player);

    const takeover = await slow();
    const replaced = player;
    player = await connect(url);
    await aborted(takeover, replaced);
    dialog = await opened(player);

    const left = await slow();
    const moveUntil = performance.now() + 2000;
    while (
      !player.events.some(
        (e) =>
          e.type === "dialogue" &&
          e.event === "closed" &&
          e.dialogId === dialog,
      ) &&
      performance.now() < moveUntil
    ) {
      player.send({ type: "move", dx: 0, dy: 1 });
      await delay(100);
    }
    await player.dialogue("closed", (e) => e.dialogId === dialog);
    player.send({ type: "move", dx: 0, dy: 0 });
    await aborted(left);
    await nearCenyan(player);
    dialog = await opened(player);

    const reset = await slow();
    const resetId = id();
    player.send({ type: "reset", id: resetId, confirm: true });
    await waitFor(
      () =>
        player.events.some(
          (e) => e.type === "result" && e.id === resetId && e.ok,
        )
          ? true
          : undefined,
      "reset",
    );
    await aborted(reset);
    await nearCenyan(player);
    dialog = await opened(player);
    const spent = submit(player, dialog, "额度已经用完了吗");
    assert.equal(
      (await player.dialogue("error", (e) => e.requestId === spent.id)).code,
      "budget",
    );
    assert.equal(calls.length, 9);

    await app!.close();
    url = await start();
    player = await connect(url);
    dialog = await opened(player);
    const restart = submit(player, dialog, "重启之后还是要限额");
    assert.equal(
      (await player.dialogue("error", (e) => e.requestId === restart.id)).code,
      "budget",
    );
    assert.equal(calls.length, 9);
    const ledger = new DatabaseSync(savePath + ".llm.sqlite");
    try {
      assert.deepEqual(
        ledger
          .prepare(
            "SELECT status, count(*) AS n FROM calls GROUP BY status ORDER BY status",
          )
          .all()
          .map((row) => [row.status, row.n]),
        [
          ["cancelled", 6],
          ["ok", 2],
          ["rate-limit", 1],
        ],
      );
    } finally {
      ledger.close();
    }
  },
);
