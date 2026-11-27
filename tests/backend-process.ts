import { execFile, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);
export const e2eBackendPort = 3003;

async function pidsListeningOn(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync(
      "ss",
      ["-lptn", `sport = :${port}`],
      { encoding: "utf8" },
    );
    return [
      ...new Set(
        [...stdout.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])),
      ),
    ];
  } catch {
    return [];
  }
}

function isMistseaBackend(pid: number): boolean {
  try {
    const command = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return (
      command.includes("src/server/index.ts") ||
      command.includes("tests/fixtures/phase3_1-server.ts")
    );
  } catch {
    return false;
  }
}

/** Free the Playwright backend port of leaked Mistsea servers before starting a new one. */
export async function freeBackendPort(
  port = e2eBackendPort,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listeners = await pidsListeningOn(port);
    if (listeners.length === 0) return;
    const ours = listeners.filter(isMistseaBackend);
    if (ours.length === 0)
      throw new Error(
        `Port ${port} is occupied by unexpected pid ${listeners.join(",")}`,
      );
    for (const pid of ours) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
    await delay(250);
    const remaining = (await pidsListeningOn(port)).filter(isMistseaBackend);
    for (const pid of remaining) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    await delay(100);
  }
  throw new Error(`Port ${port} is still in use after waiting ${timeoutMs}ms`);
}

export async function stopBackend(
  child: ChildProcess | undefined,
  timeoutMs = 5_000,
): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const finished = await Promise.race([
    exited.then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
  if (!finished) {
    child.kill("SIGKILL");
    await exited;
  }
}
