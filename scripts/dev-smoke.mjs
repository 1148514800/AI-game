import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const dir = mkdtempSync(join(tmpdir(), "mistsea-phase2-dev-"));
const node = spawn(process.execPath, ["scripts/dev.mjs"], {
  env: {
    PATH: process.env.PATH,
    MISTSEA_SAVE: join(dir, "world.sqlite"),
    HOST: "127.0.0.1",
    PORT: "3005",
    MISTSEA_VITE_PORT: "5175",
    LLM_ENABLED: "false",
  },
  stdio: "inherit",
});
const done = once(node, "close");
try {
  const until = Date.now() + 8000;
  let ready = false;
  while (
    Date.now() < until &&
    node.exitCode === null &&
    node.signalCode === null
  ) {
    const page = await fetch("http://127.0.0.1:5175/", {
      signal: AbortSignal.timeout(500),
    }).catch(() => null);
    const health = await fetch("http://127.0.0.1:5175/health", {
      signal: AbortSignal.timeout(500),
    }).catch(() => null);
    if (
      page?.ok &&
      health?.ok &&
      (await health.json()).status === "ok" &&
      (await page.text()).includes("雾灯谷")
    ) {
      ready = true;
      console.log(
        "Development entrypoint served the game and proxied SQLite health.",
      );
      break;
    }

    await delay(100);
  }
  if (node.exitCode !== null || node.signalCode !== null)
    throw Error(
      `Development process exited before readiness: ${node.signalCode ?? node.exitCode}`,
    );
  if (!ready) throw Error("Development game did not become ready.");
} finally {
  if (node.exitCode === null && node.signalCode === null) node.kill("SIGTERM");
  await done;
  rmSync(dir, { recursive: true, force: true });
}
