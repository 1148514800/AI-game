import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, platform, release, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs, promisify } from "node:util";
import type { Browser } from "@playwright/test";
import {
  durationMs,
  launchBrowser,
  launchOptions,
  mockDelayMs,
  observeGameCanvas,
  probeRenderer,
  samplePage,
  viewport,
  warmupMs,
  type MockUi,
  type Scenario,
} from "./page.js";

const baseline = "62c5c2a10dff3afc18dbe875341f3a274ca3b436";
const exec = promisify(execFile);
const repo = resolve(import.meta.dirname, "../..");
const buildInputs = [
  "src",
  "data",
  "assets/manifest.json",
  "public",
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.server.json",
  "vite.config.ts",
];
const scenarios: Scenario[] = [
  "idle",
  "movement",
  "construction",
  "dialogue-pending",
];
const {
  positionals: [mode, ...extra],
  values,
} = parseArgs({
  allowPositionals: true,
  options: { "mock-ui": { type: "string" } },
});
if (
  (mode !== "before" && mode !== "after") ||
  extra.length ||
  (values["mock-ui"] && mode !== "after")
) {
  throw Error(
    "Usage: node --import tsx scripts/performance/run.ts before|after [--mock-ui path.json]",
  );
}

function readMockUi(path: string): MockUi {
  const config: MockUi = JSON.parse(readFileSync(path, "utf8"));
  for (const name of [
    "input",
    "send",
    "pending",
    "mockBadge",
    "delayEnv",
  ] as const) {
    if (typeof config?.[name] !== "string" || !config[name].trim()) {
      throw Error(`Missing Mock UI configuration field: ${name}`);
    }
  }
  if (!/^(?:[A-Z0-9]+_)*MOCK_(?:[A-Z0-9]+_)*DELAY_MS$/.test(config.delayEnv)) {
    throw Error("Mock UI delayEnv must name a Mock delay-in-ms setting.");
  }
  return config;
}

const mockUi = values["mock-ui"] ? readMockUi(values["mock-ui"]) : undefined;
const evidence = join(repo, "evidence/phase2/performance");
mkdirSync(evidence, { recursive: true });
const output = mkdtempSync(join(evidence, `${mode}-`));
// Keep SQLite on the workspace filesystem. The mount is part of the benchmark.
const temp = mkdtempSync(join(tmpdir(), "mistsea-performance-"));
const saves = mkdtempSync(join(output, ".temporary-saves-"));
const home = join(temp, "home");
mkdirSync(home);
const toolEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home };
const gitEnv = {
  ...toolEnv,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};
const reportPath = join(output, "report.json");
const logError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const variants =
  mode === "before"
    ? [
        { name: "baseline-canvas", renderer: "original-canvas" },
        {
          name: "baseline-webgl-variant",
          renderer: "webgl-only-source-change",
        },
      ]
    : [{ name: "after-current", renderer: "current-source" }];

type CaseResult = {
  status: "sampled" | "failed" | "not-run" | "N/A";
  reason?: string;
};
type VariantResult = (typeof variants)[number] & {
  status?: "completed" | "failed" | "blocked" | "unavailable";
  reason?: string;
  sourceSha256?: string;
  lockfileSha256?: string;
  cases: Partial<Record<Scenario, CaseResult>>;
};

const report = {
  mode,
  expectedBaseline: baseline,
  checkoutHead: "",
  startedAt: new Date().toISOString(),
  finishedAt: "",
  environment: {
    node: process.version,
    platform: platform(),
    kernel: release(),
    architecture: arch(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    viewport,
    deviceScaleFactor: 1,
    chromiumLaunch: launchOptions,
    build: "production",
    durationMs,
    warmupMs,
    tickPeriodMs: 50,
    mockDelayMs: mockUi ? mockDelayMs : null,
    sqliteLocation: "isolated evidence-directory filesystem",
  },
  browser: {} as {
    version?: string;
    capability?: Awaited<ReturnType<typeof probeRenderer>>;
    error?: string;
  },
  variants: variants.map((variant): VariantResult => ({
    ...variant,
    cases: {},
  })),
  error: undefined as string | undefined,
};

function lockedDependencies(path: string) {
  const { packages, lockfileVersion } = JSON.parse(readFileSync(path, "utf8"));
  const { name: _name, version: _version, ...root } = packages[""];
  return JSON.stringify({
    lockfileVersion,
    packages: { ...packages, "": root },
  });
}

function fileHash(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceHash(root: string) {
  const hash = createHash("sha256");
  for (const input of buildInputs) {
    const absolute = join(root, input);
    const paths = readdirFiles(absolute);
    for (const path of paths)
      hash.update(`${relative(root, path)}\0${fileHash(path)}\n`);
  }
  return hash.digest("hex");
}

function readdirFiles(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name === b.name ? 0 : 1))
      .flatMap((entry) =>
        entry.isDirectory()
          ? readdirFiles(join(path, entry.name))
          : [join(path, entry.name)],
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") return [path];
    throw error;
  }
}

async function build(variant: VariantResult, directory: string) {
  const root = join(temp, variant.name);
  mkdirSync(root);
  const log = openSync(join(directory, "build.log"), "wx");
  try {
    if (mode === "before") {
      const archive = join(temp, `${variant.name}.tar`);
      await loggedCommand(
        "git",
        ["archive", `--output=${archive}`, baseline, "--", ...buildInputs],
        repo,
        log,
        15000,
        gitEnv,
      );
      await loggedCommand("tar", ["-xf", archive], root, log, 15000);
      rmSync(archive);
    } else {
      for (const path of buildInputs)
        cpSync(join(repo, path), join(root, path), { recursive: true });
    }
    if (variant.renderer === "webgl-only-source-change") {
      const entry = join(root, "src/client/main.ts");
      const source = readFileSync(entry, "utf8");
      const canvas = "type: Phaser.CANVAS,";
      if (source.split(canvas).length !== 2)
        throw Error("Expected exactly one baseline renderer setting.");
      writeFileSync(entry, source.replace(canvas, "type: Phaser.WEBGL,"));
    }
    variant.sourceSha256 = sourceHash(root);
    variant.lockfileSha256 = fileHash(join(root, "package-lock.json"));
    if (
      lockedDependencies(join(root, "package-lock.json")) !==
      lockedDependencies(join(repo, "package-lock.json"))
    ) {
      throw Error(
        "Install dependencies matching the sampled source lockfile before running the harness.",
      );
    }
    symlinkSync(join(repo, "node_modules"), join(root, "node_modules"), "dir");
    for (const [entry, ...args] of [
      ["node_modules/vite/bin/vite.js", "build", "--outDir", "release/client"],
      ["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.json"],
    ]) {
      await loggedCommand(process.execPath, [entry, ...args], root, log, 30000);
    }
    return root;
  } finally {
    closeSync(log);
  }
}

function deadline<T>(promise: Promise<T>, ms: number, description: string) {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error(description)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let browser: Browser | undefined;
let activeChild: ChildProcess | undefined;
let interrupted: NodeJS.Signals | undefined;

function interrupt(signal: NodeJS.Signals) {
  interrupted = signal;
  activeChild?.kill("SIGTERM");
  void browser?.close().catch(() => {});
}
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid)
    return;
  const closed = once(child, "close");
  child.kill("SIGTERM");
  try {
    await deadline(closed, 2500, "Server did not stop on SIGTERM.");
  } catch {
    child.kill("SIGKILL");
    await closed;
  }
}

async function loggedCommand(
  command: string,
  args: string[],
  cwd: string,
  log: number,
  ms: number,
  env = toolEnv,
) {
  if (interrupted) throw Error(`Interrupted by ${interrupted}.`);
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", log, log] });
  activeChild = child;
  try {
    const [code, signal] = await deadline(
      once(child, "close"),
      ms,
      `${command} ${args[0]} timed out.`,
    );
    if (code !== 0)
      throw Error(`${command} ${args[0]} exited with ${signal ?? code}.`);
  } finally {
    await stop(child);
    activeChild = undefined;
  }
}

async function withServer<T>(
  root: string,
  directory: string,
  scenario: Scenario,
  run: (url: string, child: ChildProcess) => Promise<T>,
) {
  const compiled = join(root, "release/server/src");
  const savePath = join(
    saves,
    `${relative(output, directory).replaceAll("/", "-")}-${scenario}.sqlite`,
  );
  const serverLog = join(directory, `${scenario}.server.log`);
  const preload = join(import.meta.dirname, "tick-preload.mjs");
  if (scenario === "construction") {
    const log = openSync(serverLog, "wx");
    try {
      await loggedCommand(
        process.execPath,
        [
          join(import.meta.dirname, "fixtures/construction.mjs"),
          compiled,
          savePath,
        ],
        root,
        log,
        5000,
      );
    } finally {
      closeSync(log);
    }
  }
  const env = {
    ...toolEnv,
    HOST: "127.0.0.1",
    PORT: "0",
    MISTSEA_SAVE: savePath,
    LLM_ENABLED: "false",
  };
  if (scenario === "dialogue-pending" && mockUi)
    Object.assign(env, { [mockUi.delayEnv]: String(mockDelayMs) });
  if (interrupted) throw Error(`Interrupted by ${interrupted}.`);
  const log = openSync(serverLog, "a");
  let child: ChildProcess;
  try {
    child = spawn(
      process.execPath,
      ["--import", preload, "release/server/src/server/index.js"],
      {
        cwd: root,
        env,
        stdio: ["ignore", log, log, "ipc"],
      },
    );
  } finally {
    closeSync(log);
  }
  activeChild = child;
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  try {
    const starting = performance.now();
    while (performance.now() - starting < 6000) {
      if (spawnError) throw spawnError;
      const exit = child.signalCode ?? child.exitCode;
      if (exit !== null) {
        throw Error(
          `Server stopped before readiness (${exit}). See ${relative(repo, serverLog)}.`,
        );
      }
      const url = readFileSync(serverLog, "utf8").match(
        /雾灯谷 · (http:\/\/127\.0\.0\.1:\d+)\r?\n/,
      )?.[1];
      if (url) {
        const health = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (!health.ok || (await health.json()).status !== "ok") {
          throw Error(`Server is unhealthy: HTTP ${health.status}.`);
        }
        return await run(url, child);
      }
      await delay(50);
    }
    throw Error(
      `No loopback address reported. See ${relative(repo, serverLog)}.`,
    );
  } finally {
    await stop(child);
    activeChild = undefined;
  }
}

type Tick = { registration: number; startEpochMs: number; durationMs: number };

async function readTicks(child: ChildProcess) {
  const [result] = await deadline(
    new Promise<[unknown]>((resolve, reject) => {
      child.once("message", (message) => resolve([message]));
      child.send("mistsea-performance-ticks", (error) => {
        if (error) reject(error);
      });
    }),
    2500,
    "No tick timing received from the server preload.",
  );
  const { periodMs, registrations, samples } = result as {
    periodMs: number;
    registrations: string[];
    samples: Tick[];
  };
  if (periodMs !== 50 || registrations.length !== 1) {
    throw Error(
      `Expected exactly one 50ms app interval. Observed registrations: ${JSON.stringify(registrations)}`,
    );
  }
  return { periodMs, registration: registrations[0], samples };
}

function summarize(samples: number[]) {
  if (
    !samples.length ||
    samples.some((sample) => !Number.isFinite(sample) || sample < 0)
  ) {
    throw Error("Missing or invalid timing samples.");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: samples.length,
    meanMs: samples.reduce((sum, ms) => sum + ms, 0) / samples.length,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted[sorted.length - 1],
  };
}

async function runScenario(
  browser: Browser,
  root: string,
  directory: string,
  variant: VariantResult,
  scenario: Scenario,
) {
  return withServer(root, directory, scenario, async (url, child) => {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const browserLog = join(directory, `${scenario}.browser.log`);
    const errors: string[] = [];
    const messages: string[] = [];
    page.on("pageerror", (error) => errors.push(logError(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
      if (["error", "warning"].includes(message.type())) {
        messages.push(`${message.type()} ${message.text()}`);
      }
    });
    try {
      await observeGameCanvas(page);
      await page.goto(url, { timeout: 6000 });
      const screenshot = `${scenario}.png`;
      const { renderer, frames, movementLegs } = await samplePage(
        page,
        scenario,
        join(directory, screenshot),
        mockUi,
      );
      if (variant.renderer === "original-canvas" && renderer.type !== "2d")
        throw Error(`Baseline renderer was ${renderer.type}, expected 2d.`);
      if (
        variant.renderer === "webgl-only-source-change" &&
        !renderer.type.endsWith("webgl")
      ) {
        throw Error(
          `The forced WebGL source variant rendered as ${renderer.type}.`,
        );
      }
      const tick = await readTicks(child);
      const ticks = tick.samples.filter(
        ({ startEpochMs }) =>
          startEpochMs >= frames.startEpochMs &&
          startEpochMs < frames.endEpochMs,
      );
      const duration = frames.endEpochMs - frames.startEpochMs;
      const metrics = {
        browserRaf: {
          ...summarize(frames.frameTimesMs),
          averageFps: (frames.frameTimesMs.length * 1000) / duration,
        },
        serverCallback: {
          ...summarize(ticks.map(({ durationMs }) => durationMs)),
          observedHz: (ticks.length * 1000) / duration,
        },
      };
      if (errors.length) throw Error(errors.join("\n"));
      return {
        status: "sampled" as const,
        renderer,
        durationMs: duration,
        metrics,
        frames,
        movementLegs,
        tick: {
          periodMs: tick.periodMs,
          registration: tick.registration,
          samples: ticks,
        },
        workload:
          scenario === "construction"
            ? "isolated fixture: bridge materials already delivered, real UI starts work; performance only"
            : scenario,
        screenshot: `${variant.name}/${screenshot}`,
      };
    } catch (error) {
      messages.push(...errors, logError(error));
      throw error;
    } finally {
      writeFileSync(browserLog, messages.join("\n"), { flag: "wx" });
      await page.close();
    }
  });
}

console.log(`Performance evidence: ${relative(repo, output)}`);
try {
  // A delivered source ZIP intentionally has no .git directory. After samples
  // are still reproducible from its hashed source; before must use real history.
  if (existsSync(join(repo, ".git"))) {
    report.checkoutHead = (
      await exec("git", ["rev-parse", "HEAD"], {
        cwd: repo,
        env: gitEnv,
        timeout: 5000,
      })
    ).stdout.trim();
  } else {
    if (mode === "before")
      throw Error("Before sampling requires the audited Git baseline checkout; source ZIP users already have the recorded before evidence.");
    report.checkoutHead = "source-archive-no-git; see DELIVERY_COMMIT.txt";
  }
  try {
    browser = await launchBrowser(toolEnv);
    report.browser.version = browser.version();
    report.browser.capability = await probeRenderer(browser);
  } catch (error) {
    report.browser.error = logError(error);
    writeFileSync(join(output, "chromium.log"), `${report.browser.error}\n`);
    console.error(report.browser.error);
  }

  for (const variant of report.variants) {
    if (mode === "before")
      variant.cases["dialogue-pending"] = {
        status: "N/A",
        reason: "Phase 1 baseline has no generated dialogue.",
      };
    if (interrupted) break;
    if (variant.renderer === "webgl-only-source-change") {
      const probe = report.browser.capability?.contexts;
      if (!browser || (probe && !probe.webgl && !probe.experimentalWebgl)) {
        variant.status = browser ? "unavailable" : "blocked";
        variant.reason = !browser
          ? "Chromium did not start."
          : "This Chromium could not create either WebGL context used by Phaser 4.2.1.";
        continue;
      }
    }
    const directory = join(output, variant.name);
    mkdirSync(directory);
    try {
      const root = await build(variant, directory);
      if (!browser) {
        // Exercise the real loopback listener independently of a Chromium launch failure.
        await withServer(root, directory, "idle", async () => {});
        throw Error("Chromium did not start. See chromium.log.");
      }
      for (const scenario of scenarios) {
        if (interrupted) break;
        if (variant.cases[scenario]) continue;
        if (scenario === "dialogue-pending" && !mockUi) {
          variant.cases[scenario] = {
            status: "not-run",
            reason: "After pending Mock UI configuration was not supplied.",
          };
          continue;
        }
        try {
          variant.cases[scenario] = await runScenario(
            browser,
            root,
            directory,
            variant,
            scenario,
          );
          console.log(`${variant.name}/${scenario}: sampled`);
        } catch (error) {
          variant.cases[scenario] = {
            status: "failed",
            reason: logError(error),
          };
          throw error;
        }
        writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      }
      variant.status = "completed";
      await delay(250);
    } catch (error) {
      variant.status = "failed";
      variant.reason = logError(error);
      console.error(`${variant.name}: ${variant.reason}`);
    }
  }
} catch (error) {
  report.error = logError(error);
  console.error(report.error);
} finally {
  try {
    await browser?.close();
  } finally {
    rmSync(saves, { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    if (interrupted) report.error = `Interrupted by ${interrupted}.`;
    for (const variant of report.variants) {
      for (const scenario of scenarios) {
        variant.cases[scenario] ??=
          mode === "before" && scenario === "dialogue-pending"
            ? {
                status: "N/A",
                reason: "Phase 1 baseline has no generated dialogue.",
              }
            : {
                status: "not-run",
                reason:
                  variant.reason ??
                  report.error ??
                  "Sampling did not reach this scenario.",
              };
      }
    }
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    if (
      report.error ||
      report.browser.error ||
      report.variants.some(({ status }) => status === "failed")
    )
      process.exitCode = 1;
  }
}
