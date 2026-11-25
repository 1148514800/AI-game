import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { npcId, sessionMs, type DialogueConfig } from "./config.js";
import type { Usage } from "./provider.js";

export type Purpose = "dialogue" | "autonomy";

const nanoPerUsd = 1_000_000_000;

function cost(config: DialogueConfig, input: number, output: number) {
  if (!config.prices) return null;
  return Math.ceil(input * config.prices.input + output * config.prices.output);
}

export class DialogueLedger {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    const existing = path !== ":memory:" && existsSync(path);
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      // A locked or damaged ledger disables dialogue without delaying gameplay.
      this.db.exec("PRAGMA busy_timeout = 0");
      if (!existing)
        this.transaction(() =>
          this.db.exec(`
        CREATE TABLE calls (
          id TEXT PRIMARY KEY, at_ms INTEGER NOT NULL, npc TEXT NOT NULL,
          mode TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, elapsed_ms INTEGER,
          charged_tokens INTEGER NOT NULL, charged_nano INTEGER, estimated_nano INTEGER, usage TEXT,
          purpose TEXT NOT NULL CHECK(purpose IN ('dialogue', 'autonomy'))
        ) STRICT;
        CREATE INDEX calls_mode_at ON calls(mode, at_ms);
        PRAGMA user_version = 2;
      `),
        );
      const version = this.db
        .prepare("PRAGMA user_version")
        .get()?.user_version;
      if (
        (version !== 1 && version !== 2) ||
        this.db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok"
      )
        throw Error("Invalid dialogue ledger");
      if (version === 1)
        this.transaction(() =>
          this.db.exec(`
          ALTER TABLE calls ADD COLUMN purpose TEXT NOT NULL DEFAULT 'dialogue'
            CHECK(purpose IN ('dialogue', 'autonomy'));
          PRAGMA user_version = 2;
        `),
        );
      this.db
        .prepare(
          "UPDATE calls SET status = 'interrupted' WHERE status = 'pending'",
        )
        .run();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  reserve(
    config: DialogueConfig,
    id: string,
    inputTokens: number,
    now = Date.now(),
    purpose: Purpose = "dialogue",
  ) {
    const limits = config.limits;
    const output = limits.LLM_MAX_OUTPUT_TOKENS;
    const reservedTokens = inputTokens + output;
    const reservedNano = cost(config, inputTokens, output);
    return this.transaction(() => {
      if (this.db.prepare("SELECT id FROM calls WHERE id = ?").get(id))
        return "duplicate";
      const totals = this.db
        .prepare(
          `
        SELECT count(*) AS requests,
          coalesce(sum(at_ms > $minute), 0) AS minute, coalesce(sum(at_ms > $session), 0) AS session,
          coalesce(sum(charged_tokens), 0) AS tokens, coalesce(sum(charged_nano), 0) AS nano,
          count(*) - count(charged_nano) AS unpriced,
          coalesce(sum(purpose = 'autonomy'), 0) AS autoTotal,
          coalesce(sum(purpose = 'autonomy' AND at_ms > $minute), 0) AS autoMinute,
          coalesce(sum(purpose = 'autonomy' AND at_ms > $session), 0) AS autoSession
        FROM calls WHERE mode = $mode
      `,
        )
        .get({
          minute: now - 60_000,
          session: now - sessionMs,
          mode: config.mode,
        })! as Record<string, number>;
      const cap = limits.LLM_MAX_TOTAL_USD;
      if (
        totals.minute >= limits.LLM_MAX_REQUESTS_PER_MINUTE ||
        totals.session >= limits.LLM_MAX_REQUESTS_PER_SESSION ||
        totals.requests >= limits.LLM_MAX_TOTAL_REQUESTS ||
        totals.tokens + reservedTokens > limits.LLM_MAX_TOTAL_TOKENS ||
        (config.mode === "live" &&
          cap !== undefined &&
          (totals.unpriced ||
            reservedNano === null ||
            totals.nano + reservedNano > Math.floor(cap * nanoPerUsd)))
      ) {
        return "budget";
      }
      if (
        purpose === "autonomy" &&
        (totals.autoMinute >= limits.LLM_AUTONOMY_REQUESTS_PER_MINUTE ||
          totals.autoSession >= limits.LLM_AUTONOMY_REQUESTS_PER_SESSION ||
          totals.autoTotal >= limits.LLM_AUTONOMY_MAX_TOTAL_REQUESTS ||
          totals.minute >= limits.LLM_MAX_REQUESTS_PER_MINUTE - 1 ||
          totals.session >= limits.LLM_MAX_REQUESTS_PER_SESSION - 1 ||
          totals.requests >= limits.LLM_MAX_TOTAL_REQUESTS - 1 ||
          totals.tokens + reservedTokens >
            Math.floor(limits.LLM_MAX_TOTAL_TOKENS * 0.75) ||
          (cap !== undefined &&
            reservedNano !== null &&
            totals.nano + reservedNano > Math.floor(cap * nanoPerUsd * 0.75)))
      ) {
        return "budget";
      }
      this.db
        .prepare(
          `
        INSERT INTO calls (id, at_ms, npc, mode, model, status, charged_tokens, charged_nano, purpose)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `,
        )
        .run(
          id,
          now,
          npcId,
          config.mode,
          config.model,
          reservedTokens,
          reservedNano,
          purpose,
        );
      return "ok";
    });
  }

  finish(
    config: DialogueConfig,
    id: string,
    status: string,
    elapsedMs: number,
    usage?: Usage,
  ) {
    const subtotal =
      (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
    const reportedTotal = usage?.total_tokens ?? subtotal;
    const actual = Math.max(reportedTotal, subtotal);
    const unallocated = Math.max(0, reportedTotal - subtotal);
    // All-zero counters for a received response are unconfirmed, so the
    // reservation stays in force. Detail fields are subsets of known counts.
    const consistent = usage && actual > 0 && reportedTotal === subtotal;
    const recorded = usage
      ? {
          ...usage,
          ...(actual === 0 ? { measurement: "unconfirmed" } : {}),
          ...(unallocated > 0
            ? { unallocated_billed_tokens: unallocated }
            : {}),
        }
      : null;
    const estimate = consistent
      ? cost(config, usage.prompt_tokens, usage.completion_tokens)
      : null;
    const accountedNano =
      usage && actual > 0 && config.prices
        ? Math.ceil(
            usage.prompt_tokens * config.prices.input +
              usage.completion_tokens * config.prices.output +
              unallocated * Math.max(config.prices.input, config.prices.output),
          )
        : null;
    return this.db
      .prepare(
        `
      UPDATE calls
      SET status = ?, elapsed_ms = ?, usage = ?, estimated_nano = ?,
          charged_tokens = CASE WHEN ? THEN coalesce(?, charged_tokens)
                                ELSE max(charged_tokens, coalesce(?, 0)) END,
          charged_nano = CASE WHEN ? THEN ?
                              WHEN ? IS NOT NULL THEN max(coalesce(charged_nano, 0), ?)
                              ELSE charged_nano END
      WHERE id = ? AND status = 'pending'
      RETURNING charged_tokens, estimated_nano
    `,
      )
      .get(
        status,
        Math.round(elapsedMs),
        recorded ? JSON.stringify(recorded) : null,
        estimate,
        status === "ok" && consistent ? 1 : 0,
        actual,
        actual,
        status === "ok" && estimate !== null ? 1 : 0,
        estimate,
        accountedNano,
        accountedNano,
        id,
      );
  }

  close() {
    this.db.close();
  }
}
