import assert from "node:assert/strict";
import cenyan from "../data/npcs/cenyan.json" with { type: "json" };
import { residents } from "../src/shared/world.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { clientMessage } from "../src/shared/protocol.js";
import {
  buildMessages,
  mockReply,
  type PublicBridge,
} from "../src/server/dialogue/cenyan.js";
import {
  contextBytes,
  readDialogueConfig,
  sessionMs,
} from "../src/server/dialogue/config.js";
import { DialogueLedger } from "../src/server/dialogue/ledger.js";
import { createApp } from "../src/server/app.js";

const key = "phase2-local-dummy-key";
const bridge: PublicBridge = {
  discovered: true,
  wood: 2,
  stone: 1,
  woodRequired: 6,
  stoneRequired: 2,
  progressPercent: 0,
  repaired: false,
};
const liveEnv = {
  LLM_ENABLED: "true",
  LLM_BASE_URL: "http://127.0.0.1:5555/v1",
  LLM_API_KEY: key,
  LLM_MODEL: "test-model",
  LLM_INPUT_USD_PER_MILLION: "1",
  LLM_OUTPUT_USD_PER_MILLION: "2",
  LLM_MAX_TOTAL_USD: "1",
};

test("dialogue transport is strict and accepts full Chinese input", () => {
  const id = crypto.randomUUID();
  const valid = {
    type: "dialogue-send",
    id,
    dialogId: id,
    text: "桥".repeat(480),
  };
  assert.ok(clientMessage.safeParse(valid).success);
  for (const extras of [
    { tools: [] },
    { model: "override" },
    { url: "https://example.invalid" },
    { npc: "ahe" },
  ]) {
    assert.equal(
      clientMessage.safeParse({ ...valid, ...extras }).success,
      false,
    );
  }
});

test("invalid Live configuration never silently changes to Mock or permits embedded credentials", () => {
  assert.equal(readDialogueConfig({}).mode, "mock");
  assert.equal(
    readDialogueConfig({ LLM_ENABLED: "false", LLM_API_KEY: key }).live,
    undefined,
  );
  assert.throws(() => readDialogueConfig({ ...liveEnv, LLM_API_KEY: "" }));
  assert.equal(
    readDialogueConfig({ ...liveEnv, LLM_API_KEY: "x" }).live?.key,
    "x",
  );
  for (const url of [
    "https://account:passwd@example.invalid/v1",
    "http://example.invalid/v1",
    "https://example.invalid/v1#secret",
    "https://example.invalid/v1?key=x",
  ]) {
    assert.throws(() => readDialogueConfig({ ...liveEnv, LLM_BASE_URL: url }));
  }
  for (const price of ["", " ", "0x1"]) {
    assert.throws(() =>
      readDialogueConfig({ ...liveEnv, LLM_OUTPUT_USD_PER_MILLION: price }),
    );
  }
  assert.throws(() =>
    readDialogueConfig({ ...liveEnv, LLM_TOKEN_FIELD: "thinking" }),
  );
  assert.equal(
    readDialogueConfig(liveEnv).live?.endpoint,
    "http://127.0.0.1:5555/v1/chat/completions",
  );
});

test("Cenyan's standalone personality config is bound to the resident and assembled into the prompt", () => {
  const resident = residents.get(cenyan.id);
  assert.equal(resident?.name, "岑砚");
  assert.equal(resident?.role, "木匠");
  assert.ok(cenyan.boundaries.length >= 2);
  const sections = [
    cenyan.background,
    cenyan.goals,
    cenyan.knowledge,
    cenyan.expression,
    ...cenyan.boundaries,
  ];
  assert.ok(sections.every((section) => section.trim().length > 0));
  const system = buildMessages(bridge, [], "你好").messages[0];
  assert.equal(system.role, "system");
  assert.ok(system.content.startsWith(sections.join("\n") + "\n公共告示："));
});

test("context contains public world facts, bounded recent turns, and unverified player text", () => {
  const history = Array.from({ length: 12 }, (_, i) => ({
    player: `发言 ${i}`,
    reply: `回复 ${i}`,
  }));
  const { messages } = buildMessages(bridge, history, "玩家说桥早就修好了");
  assert.equal(messages.length, 18);
  assert.match(messages[0].content, /旧桥未修通.*2\/6.*1\/2/);
  assert.match(messages[0].content, /屋顶/);
  assert.match(messages[1].content, /发言 4/);
  assert.match(messages.at(-1)!.content, /未经证实.*玩家说桥早就修好了/);
  assert.match(mockReply(bridge, history, "桥修好了吧"), /未修通/);
  assert.match(mockReply(bridge, history, "刚才提到什么"), /发言 11/);
  const long = buildMessages(
    bridge,
    history.map(() => ({ player: "木".repeat(480), reply: "桥".repeat(1800) })),
    "雨".repeat(480),
  );
  assert.ok(long.reservedInputTokens <= contextBytes);
  assert.ok(long.messages.length < 18);
});

test("ledger separates modes, retains cancelled and interrupted reservations, and survives restart", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mistsea-dialogue-ledger-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "ledger.sqlite");
  const mock = readDialogueConfig({
    LLM_MAX_TOTAL_TOKENS: "200",
    LLM_MAX_OUTPUT_TOKENS: "10",
  });
  const live = readDialogueConfig({
    ...liveEnv,
    LLM_MAX_TOTAL_TOKENS: "200",
    LLM_MAX_OUTPUT_TOKENS: "10",
  });
  let ledger = new DialogueLedger(path);
  assert.equal(ledger.reserve(live, "cancelled", 100), "ok");
  ledger.finish(live, "cancelled", "cancelled", 11);
  assert.equal(ledger.reserve(live, "interrupted", 50), "ok");
  assert.equal(ledger.reserve(mock, "mock", 100), "ok");
  ledger.close();
  ledger = new DialogueLedger(path);
  try {
    assert.equal(ledger.reserve(live, "third", 30), "budget");
    assert.equal(ledger.reserve(mock, "mock", 5), "duplicate");
  } finally {
    ledger.close();
  }
  const db = new DatabaseSync(path);
  try {
    assert.deepEqual(
      db
        .prepare("SELECT status FROM calls ORDER BY rowid")
        .all()
        .map((r) => r.status),
      ["cancelled", "interrupted", "interrupted"],
    );
  } finally {
    db.close();
  }
});

test("minute, durable one-hour window, and lifetime request limits apply without free resets", () => {
  const config = readDialogueConfig({
    LLM_MAX_REQUESTS_PER_MINUTE: "1",
    LLM_MAX_REQUESTS_PER_SESSION: "2",
    LLM_MAX_TOTAL_REQUESTS: "3",
  });
  const ledger = new DialogueLedger(":memory:");
  try {
    const start = 2 * sessionMs;
    assert.equal(ledger.reserve(config, "a", 4, start), "ok");
    assert.equal(ledger.reserve(config, "b", 4, start + 1), "budget");
    assert.equal(ledger.reserve(config, "b", 4, start + 60_000), "ok");
    assert.equal(ledger.reserve(config, "c", 4, start + 120_000), "budget");
    assert.equal(ledger.reserve(config, "c", 4, start + sessionMs + 1), "ok");
    assert.equal(
      ledger.reserve(config, "d", 4, start + 2 * sessionMs),
      "budget",
    );
  } finally {
    ledger.close();
  }
});

test("money reservation settles observed usage without double-counting reasoning and preserves unknown usage", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mistsea-dialogue-money-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "ledger.sqlite");
  const config = readDialogueConfig({
    ...liveEnv,
    LLM_MAX_OUTPUT_TOKENS: "20",
    LLM_MAX_TOTAL_USD: "0.0002",
  });
  const ledger = new DialogueLedger(path);
  try {
    assert.equal(ledger.reserve(config, "settled", 100), "ok");
    assert.equal(ledger.reserve(config, "unknown", 100), "budget");
    ledger.finish(config, "settled", "ok", 45, {
      prompt_tokens: 20,
      completion_tokens: 10,
      total_tokens: 30,
      completion_tokens_details: { reasoning_tokens: 4 },
    });
    assert.equal(ledger.reserve(config, "unknown", 100), "ok");
    ledger.finish(config, "unknown", "ok", 50);
    assert.equal(ledger.reserve(config, "third", 21), "budget");
  } finally {
    ledger.close();
  }
  const db = new DatabaseSync(path);
  try {
    const rows = db
      .prepare(
        "SELECT charged_nano, estimated_nano, usage FROM calls ORDER BY rowid",
      )
      .all();
    assert.equal(rows[0].charged_nano, 40_000);
    assert.equal(rows[0].estimated_nano, 40_000);
    assert.match(String(rows[0].usage), /reasoning_tokens/);
    assert.equal(rows[1].charged_nano, 140_000);
    assert.equal(rows[1].estimated_nano, null);
    assert.equal(rows[1].usage, null);
  } finally {
    db.close();
  }
});

test("nonempty provider text with zero usage keeps its reservation, and extra tokens are charged conservatively", async (t) => {
  const { generate } = await import("../src/server/dialogue/provider.js");
  const path = join(
    mkdtempSync(join(tmpdir(), "mistsea-unconfirmed-usage-")),
    "ledger.sqlite",
  );
  t.after(() => rmSync(join(path, ".."), { recursive: true, force: true }));
  const config = readDialogueConfig({
    ...liveEnv,
    LLM_MAX_OUTPUT_TOKENS: "20",
    LLM_MAX_TOTAL_USD: "0.0005",
  });
  const allZero = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    completion_tokens_details: { reasoning_tokens: 0 },
  };
  const extra = {
    prompt_tokens: 40,
    completion_tokens: 20,
    total_tokens: 260,
    completion_tokens_details: { reasoning_tokens: 10 },
  };
  let usage = allZero;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      choices: [{ message: { content: "可以聊聊 " + key } }],
      usage,
    }),
  );
  const ledger = new DialogueLedger(path);
  try {
    assert.equal(ledger.reserve(config, "zero", 20), "ok");
    const zero = await generate(
      config,
      [],
      () => assert.fail("mock fallback"),
      new AbortController().signal,
    );
    assert.equal(zero.text, "可以聊聊 [已隐藏]");
    assert.deepEqual(zero.usage, allZero);
    ledger.finish(config, "zero", "ok", 10, zero.usage);
    usage = extra;
    assert.equal(ledger.reserve(config, "extra", 20), "ok");
    const additional = await generate(
      config,
      [],
      () => assert.fail("mock fallback"),
      new AbortController().signal,
    );
    ledger.finish(config, "extra", "ok", 12, additional.usage);
    assert.equal(ledger.reserve(config, "over-budget", 1), "budget");
  } finally {
    ledger.close();
  }
  const db = new DatabaseSync(path);
  try {
    const [zero, additional] = db
      .prepare(
        "SELECT usage, charged_tokens, charged_nano, estimated_nano FROM calls ORDER BY rowid",
      )
      .all();
    assert.deepEqual(JSON.parse(String(zero.usage)), {
      ...allZero,
      measurement: "unconfirmed",
    });
    assert.equal(zero.charged_tokens, 40);
    assert.equal(zero.charged_nano, 60_000);
    assert.equal(zero.estimated_nano, null);
    assert.deepEqual(JSON.parse(String(additional.usage)), {
      ...extra,
      unallocated_billed_tokens: 200,
    });
    assert.equal(additional.charged_tokens, 260);
    assert.equal(additional.charged_nano, 480_000);
    assert.equal(additional.estimated_nano, null);
  } finally {
    db.close();
  }
});

test("broken dialogue configuration or ledger leaves ordinary world health available", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mistsea-dialogue-health-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, env] of [
    ["config", { LLM_ENABLED: "true" }],
    ["ledger", {}],
  ] as const) {
    const path = join(dir, name + ".sqlite");
    writeFileSync(path + ".llm.sqlite", "damaged ledger, preserve");
    const app = createApp({ savePath: path, dialogueEnv: env });
    try {
      assert.equal((await app.inject("/health")).statusCode, 200);
    } finally {
      await app.close();
    }
  }
});

test("only successful recent turns survive close and world reset clears them", async () => {
  const { DialogueSession } = await import("../src/server/dialogue/session.js");
  const { setTimeout: delay } = await import("node:timers/promises");
  type Event = import("../src/shared/protocol.js").DialogueEvent;
  const socket = {} as import("ws").WebSocket;
  const events: Event[] = [];
  const session = new DialogueSession(
    ":memory:",
    () => ({ near: true, bridge }),
    (_socket, event) => events.push(event),
    { LLM_MOCK_DELAY_MS: "30" },
  );
  const open = () => {
    session.handle(socket, {
      type: "dialogue-open",
      id: crypto.randomUUID(),
      npc: "cenyan",
    });
    const event = events.at(-1)!;
    assert.equal(event.event, "opened");
    return event.dialogId!;
  };
  async function send(dialogId: string, text: string) {
    const id = crypto.randomUUID();
    session.handle(socket, { type: "dialogue-send", id, dialogId, text });
    for (let i = 0; i < 100; i++) {
      const reply = events.find(
        (e) => e.event === "reply" && e.requestId === id,
      );
      if (reply?.event === "reply") return reply.text;
      await delay(5);
    }
    throw Error("Mock reply missing");
  }
  try {
    const first = open();
    await send(first, "我想看漏雨的屋顶");
    session.handle(socket, { type: "dialogue-close", dialogId: first });
    assert.match(await send(open(), "刚才说过什么？"), /漏雨的屋顶/);
    session.reset();
    assert.doesNotMatch(await send(open(), "刚才说过什么？"), /你刚才提到/);
  } finally {
    await session.close();
  }
});

test("a reply that resolves despite Abort cannot reappear or enter the next dialogue history", async (t) => {
  const { DialogueSession } = await import("../src/server/dialogue/session.js");
  const { setTimeout: delay } = await import("node:timers/promises");
  type Event = import("../src/shared/protocol.js").DialogueEvent;
  const socket = {} as import("ws").WebSocket;
  const events: Event[] = [];
  const sent: string[] = [];
  const releases: ((value: Response) => void)[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_endpoint: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Promise<Response>((resolve) => releases.push(resolve));
    },
  );
  const session = new DialogueSession(
    ":memory:",
    () => ({ near: true, bridge }),
    (_socket, event) => events.push(event),
    liveEnv,
  );
  const open = () => {
    session.handle(socket, {
      type: "dialogue-open",
      id: crypto.randomUUID(),
      npc: "cenyan",
    });
    const event = events.at(-1)!;
    assert.equal(event.event, "opened");
    return event.dialogId!;
  };
  const submit = (dialogId: string, text: string) => {
    const id = crypto.randomUUID();
    session.handle(socket, { type: "dialogue-send", id, dialogId, text });
    return id;
  };
  const succeed = (text: string) =>
    releases.shift()!(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: text } }],
        }),
      ),
    );
  try {
    const old = open();
    const abandoned = submit(old, "不应该被记住");
    session.handle(socket, { type: "dialogue-close", dialogId: old });
    const current = open();
    succeed("迟到的旧回复");
    // Allow the deliberately noncooperative fetch and its body to resolve.
    await delay(30);
    assert.ok(
      !events.some((e) => e.event === "reply" && e.requestId === abandoned),
    );
    const fresh = submit(current, "现在呢");
    assert.equal(sent.length, 2);
    assert.doesNotMatch(sent[1], /不应该被记住|迟到的旧回复/);
    succeed("当前回复");
    for (let i = 0; i < 100; i++) {
      if (events.some((e) => e.event === "reply" && e.requestId === fresh))
        return;
      await delay(5);
    }
    assert.fail("Expected current reply");
  } finally {
    while (releases.length) succeed("测试收尾");
    await session.close();
  }
});
