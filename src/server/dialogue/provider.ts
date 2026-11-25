import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { ChatMessage } from "./cenyan.js";
import type { DialogueConfig } from "./config.js";

export type Failure =
  | "network"
  | "auth"
  | "model"
  | "rate-limit"
  | "provider"
  | "timeout"
  | "empty"
  | "invalid"
  | "cancelled";
export class DialogueFailure extends Error {
  constructor(
    readonly code: Failure,
    readonly usage?: Usage,
  ) {
    super(code);
  }
}

const count = z.number().int().nonnegative().max(100_000_000);
const usageSchema = z.object({
  prompt_tokens: count,
  completion_tokens: count,
  total_tokens: count.optional(),
  prompt_tokens_details: z
    .record(z.string().regex(/^[a-z][a-z_0-9]{0,49}$/), count.nullable())
    .nullish(),
  completion_tokens_details: z
    .record(z.string().regex(/^[a-z][a-z_0-9]{0,49}$/), count.nullable())
    .nullish(),
});
export type Usage = z.infer<typeof usageSchema>;
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z.unknown().optional(),
          function_call: z.unknown().optional(),
        }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
  usage: z.unknown().optional(),
});

export type Generation = { text: string; usage?: Usage };

function statusFailure(status: number): Failure {
  if (status === 401 || status === 403) return "auth";
  if (status === 400 || status === 404 || status === 422) return "model";
  if (status === 429) return "rate-limit";
  return "provider";
}

async function readJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new DialogueFailure("empty");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  function decode(value?: Uint8Array, stream = false) {
    try {
      return decoder.decode(value, { stream });
    } catch {
      throw new DialogueFailure("invalid");
    }
  }
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65_536) throw new DialogueFailure("invalid");
      text += decode(value, true);
    }
    text += decode();
    if (!text.trim()) throw new DialogueFailure("empty");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new DialogueFailure("invalid");
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export async function generate(
  config: DialogueConfig,
  messages: ChatMessage[],
  mock: () => string,
  cancellation: AbortSignal,
): Promise<Generation> {
  const timeout = AbortSignal.timeout(config.limits.LLM_TIMEOUT_MS);
  const signal = AbortSignal.any([cancellation, timeout]);
  try {
    if (!config.live) {
      const fault = config.limits.LLM_MOCK_FAILURE;
      await delay(
        fault === "timeout"
          ? config.limits.LLM_TIMEOUT_MS + 100
          : config.limits.LLM_MOCK_DELAY_MS,
        undefined,
        { signal },
      );
      if (fault) throw new DialogueFailure(fault);
      return { text: mock() };
    }
    const { endpoint, key, tokenField, enableThinking } = config.live;
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        [tokenField]: config.limits.LLM_MAX_OUTPUT_TOKENS,
        enable_thinking: enableThinking,
        stream: false,
      }),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new DialogueFailure(statusFailure(response.status));
    }
    const body = await readJson(response);
    const rawUsage =
      body && typeof body === "object" && "usage" in body
        ? body.usage
        : undefined;
    const usage = usageSchema.safeParse(rawUsage).data;
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new DialogueFailure("invalid", usage);
    const { message, finish_reason: finish } = parsed.data.choices[0];
    const tools = message.tool_calls;
    const calledTools =
      tools != null && (!Array.isArray(tools) || tools.length > 0);

    if (
      calledTools ||
      message.function_call != null ||
      (finish != null && finish !== "stop")
    )
      throw new DialogueFailure("invalid", usage);
    const text = message.content?.trim();
    if (!text) throw new DialogueFailure("empty", usage);
    if (text.length > 1800 || /[\u0000-\u0008\u000e-\u001f]/.test(text))
      throw new DialogueFailure("invalid", usage);
    return { text: text.replaceAll(key, "[已隐藏]"), usage };
  } catch (error) {
    if (cancellation.aborted) throw new DialogueFailure("cancelled");
    if (timeout.aborted) throw new DialogueFailure("timeout");
    if (error instanceof DialogueFailure) throw error;
    throw new DialogueFailure("network");
  }
}
