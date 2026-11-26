import { z } from "zod";

export const npcId = "cenyan";

export const contextBytes = 12_000;
export const historyTurns = 8;
export const sessionMs = 60 * 60_000;
export const tokenFields = ["max_tokens", "max_completion_tokens"] as const;

const integer = (fallback: number, max: number) =>
  z.preprocess(
    (value) =>
      value === undefined ? fallback : value === "" ? NaN : Number(value),
    z.number().int().min(1).max(max),
  );

const budget = z.object({
  LLM_TIMEOUT_MS: integer(12_000, 60_000),
  LLM_MAX_OUTPUT_TOKENS: integer(320, 2048),
  LLM_MAX_REQUESTS_PER_MINUTE: integer(8, 120),
  LLM_MAX_REQUESTS_PER_SESSION: integer(40, 1_000),
  LLM_MAX_TOTAL_REQUESTS: integer(500, 100_000),
  LLM_MAX_TOTAL_TOKENS: integer(500_000, 100_000_000),
  LLM_MAX_TOTAL_USD: z.coerce.number().positive().max(1000).optional(),
  LLM_AUTONOMY_REQUESTS_PER_MINUTE: integer(4, 60),
  LLM_AUTONOMY_REQUESTS_PER_SESSION: integer(24, 500),
  LLM_AUTONOMY_MAX_TOTAL_REQUESTS: integer(300, 50_000),
  LLM_MOCK_DELAY_MS: integer(650, 30_000),
  LLM_MOCK_FAILURE: z.enum(["timeout", "rate-limit", "network"]).optional(),
});

export type Limits = z.infer<typeof budget>;
export type Prices = { input: number; output: number };
export type DialogueConfig = {
  mode: "mock" | "live";
  model: string;
  autonomy: boolean;
  limits: Limits;
  prices?: Prices;
  live?: {
    endpoint: string;
    key: string;
    tokenField: (typeof tokenFields)[number];
    enableThinking?: boolean;
    jsonMode?: boolean;
  };
};

export function readDialogueConfig(
  env: NodeJS.ProcessEnv = process.env,
): DialogueConfig {
  const enabled =
    z.enum(["true", "false"]).default("false").parse(env.LLM_ENABLED) ===
    "true";
  const limits = budget.parse({
    LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
    LLM_MAX_OUTPUT_TOKENS: env.LLM_MAX_OUTPUT_TOKENS,
    LLM_MAX_REQUESTS_PER_MINUTE: env.LLM_MAX_REQUESTS_PER_MINUTE,
    LLM_MAX_REQUESTS_PER_SESSION: env.LLM_MAX_REQUESTS_PER_SESSION,
    LLM_MAX_TOTAL_REQUESTS: env.LLM_MAX_TOTAL_REQUESTS,
    LLM_MAX_TOTAL_TOKENS: env.LLM_MAX_TOTAL_TOKENS,
    LLM_MAX_TOTAL_USD: env.LLM_MAX_TOTAL_USD || undefined,
    LLM_AUTONOMY_REQUESTS_PER_MINUTE: env.LLM_AUTONOMY_REQUESTS_PER_MINUTE,
    LLM_AUTONOMY_REQUESTS_PER_SESSION: env.LLM_AUTONOMY_REQUESTS_PER_SESSION,
    LLM_AUTONOMY_MAX_TOTAL_REQUESTS: env.LLM_AUTONOMY_MAX_TOTAL_REQUESTS,
    LLM_MOCK_DELAY_MS: env.LLM_MOCK_DELAY_MS,
    LLM_MOCK_FAILURE: env.LLM_MOCK_FAILURE || undefined,
  });
  const autonomy =
    z
      .enum(["true", "false"])
      .default("false")
      .parse(
        enabled ? env.LLM_AUTONOMY_ENABLED : env.LLM_MOCK_AUTONOMY_ENABLED,
      ) === "true";
  if (!enabled)
    return { mode: "mock", model: "cenyan-scripted-mock", limits, autonomy };

  const key = z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .regex(/^[\x21-\x7e]+$/)
    .parse(env.LLM_API_KEY);
  const model = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[\w./:-]+$/)
    .parse(env.LLM_MODEL);
  const url = new URL(z.string().parse(env.LLM_BASE_URL));
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
  ) {
    throw Error("Invalid LLM base URL");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") + "/chat/completions";
  const tokenField = z
    .enum(tokenFields)
    .default("max_tokens")
    .parse(env.LLM_TOKEN_FIELD);
  const thinking = z
    .enum(["true", "false"])
    .optional()
    .parse(env.LLM_ENABLE_THINKING || undefined);
  const jsonMode =
    z.enum(["true", "false"]).default("false").parse(env.LLM_JSON_MODE) ===
    "true";
  const input = env.LLM_INPUT_USD_PER_MILLION;
  const output = env.LLM_OUTPUT_USD_PER_MILLION;
  const rate = z
    .string()
    .trim()
    .regex(/^(?:\d+(?:\.\d+)?|\.\d+)$/)
    .transform(Number)
    .pipe(z.number().nonnegative().max(1000));
  const prices =
    input && output
      ? { input: rate.parse(input) * 1000, output: rate.parse(output) * 1000 }
      : undefined;
  if (!prices || limits.LLM_MAX_TOTAL_USD === undefined)
    throw Error("LLM prices missing");
  return {
    mode: "live",
    model,
    autonomy,
    limits,
    prices,
    live: {
      endpoint: url.href,
      key,
      tokenField,
      enableThinking: thinking === undefined ? undefined : thinking === "true",
      jsonMode,
    },
  };
}
