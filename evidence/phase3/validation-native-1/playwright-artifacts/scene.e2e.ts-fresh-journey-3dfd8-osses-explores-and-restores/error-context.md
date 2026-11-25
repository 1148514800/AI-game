# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scene.e2e.ts >> fresh journey collects all materials, repairs, crosses, explores and restores
- Location: tests/scene.e2e.ts:147:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('#game')
Expected: "true"
Received: "false"
Timeout:  12000ms

Call log:
  - Expect "toHaveAttribute" locator('#game') with timeout 12000ms
  - waiting for locator('#game')
    28 × locator resolved to <div id="game" tabindex="0" data-ready="false" aria-label="游戏场景，方向键或 WASD 移动，E 交互">…</div>
       - unexpected value "false"

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - generic [ref=e6]:
      - heading "雾海行纪" [level=1] [ref=e7]
      - paragraph [ref=e8]: 雾灯谷
    - generic [ref=e9]:
      - status [ref=e10]: 服务不可用
      - button "音乐关" [ref=e11] [cursor=pointer]
      - button "暂停" [disabled] [ref=e12]
  - main [ref=e13]:
    - region "雾灯谷场景" [ref=e14]:
      - generic [ref=e15]:
        - heading "谷地聚落" [level=2] [ref=e18]
        - button "全谷地图" [disabled] [ref=e19]
      - generic [ref=e20]:
        - generic "游戏场景，方向键或 WASD 移动，E 交互" [ref=e21]
        - status [ref=e23]:
          - strong [ref=e24]: 暂时无法进入雾灯谷
          - generic [ref=e25]: 服务与当前地图版本不一致，请重新启动本地游戏。
          - button "重试连接" [ref=e26] [cursor=pointer]
      - generic [ref=e27]:
        - generic [ref=e29]:
          - strong [ref=e30]: 四处走走
          - paragraph [ref=e31]: 沿小路向东，在河边查看旧桥。
        - button "交互 E" [disabled] [ref=e33]:
          - text: 交互
          - generic [ref=e34]: E
      - generic [ref=e35]:
        - generic [ref=e36]:
          - generic [ref=e37]: W
          - generic [ref=e38]: A
          - generic [ref=e39]: S
          - generic [ref=e40]: D
          - text: 或方向键 移动
        - generic [ref=e41]:
          - generic [ref=e42]: E
          - text: 交互
        - generic [ref=e43]:
          - generic [ref=e44]: Esc
          - text: 暂停
        - button "音效开" [pressed] [ref=e45] [cursor=pointer]
    - complementary "旅人手记" [ref=e46]:
      - generic [ref=e47]:
        - generic [ref=e50]:
          - paragraph [ref=e51]: 当前目标
          - heading "修复雾灯旧桥" [level=2] [ref=e52]
        - paragraph [ref=e53]: 向东走到河边，查看雾灯旧桥。
        - generic [ref=e54]:
          - generic [ref=e55]: 已交木材
          - strong [ref=e56]: 0 / 6
        - generic [ref=e57]:
          - generic [ref=e58]: 已交石材
          - strong [ref=e59]: 0 / 2
        - generic [ref=e60]:
          - generic [ref=e61]: 施工进度
          - strong [ref=e62]: 0%
        - progressbar "施工进度" [ref=e63]: 0%
      - generic [ref=e64]:
        - heading "背包" [level=2] [ref=e65]
        - list "物品栏" [ref=e66]:
          - listitem [ref=e67]:
            - generic [ref=e68]: 木材
            - strong [ref=e69]: "0"
          - listitem [ref=e70]:
            - generic [ref=e71]: 石材
            - strong [ref=e72]: "0"
          - listitem [ref=e73]:
            - generic [ref=e74]: 食物
            - strong [ref=e75]: "0"
          - listitem [ref=e76]:
            - generic [ref=e77]: 工具箱
            - strong [ref=e78]: "0"
      - generic [ref=e79]:
        - heading "谷中居民" [level=2] [ref=e80]
        - list [ref=e81]:
          - listitem [ref=e82]:
            - strong [ref=e84]: 岑砚
            - generic [ref=e85]: 木匠
          - listitem [ref=e86]:
            - strong [ref=e88]: 阿禾
            - generic [ref=e89]: 采集者
          - listitem [ref=e90]:
            - strong [ref=e92]: 洛舟
            - generic [ref=e93]: 探路人
        - paragraph [ref=e94]: 岑砚 · 等待连接
        - group [ref=e95]:
          - generic "AI Debug" [ref=e96] [cursor=pointer]
      - generic [ref=e97]:
        - generic [ref=e98]: 等待本地存档
        - button "重开旅程" [disabled] [ref=e99]
```

# Test source

```ts
  1   | import { test as base, expect, type Page } from "@playwright/test";
  2   | import { spawn, type ChildProcess } from "node:child_process";
  3   | import { randomUUID } from "node:crypto";
  4   | import { once } from "node:events";
  5   | import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
  6   | import { tmpdir } from "node:os";
  7   | import { join } from "node:path";
  8   | import { WebSocket } from "ws";
  9   | import {
  10  |   distance,
  11  |   nearbyTarget,
  12  |   mapWidth,
  13  |   speed,
  14  |   valley,
  15  |   type Point,
  16  |   type Target,
  17  | } from "../src/shared/world.js";
  18  | import { route } from "./paths.js";
  19  | 
  20  | const evidence = process.env.MISTSEA_EVIDENCE ?? "evidence/phase3";
  21  | const backendUrl = "http://127.0.0.1:3003";
  22  | 
  23  | const test = base.extend<{
  24  |   backend: { start: () => Promise<void>; stop: () => Promise<void> };
  25  | }>({
  26  |   backend: [
  27  |     async ({}, use, info) => {
  28  |       mkdirSync(evidence, { recursive: true });
  29  |       const directory = mkdtempSync(join(tmpdir(), "mistsea-browser-"));
  30  |       const log = openSync(
  31  |         join(
  32  |           evidence,
  33  |           `e2e-service-${info.title.replace(/[^a-zA-Z0-9]+/g, "-")}.log`,
  34  |         ),
  35  |         "w",
  36  |       );
  37  |       let child: ChildProcess | undefined;
  38  |       async function start() {
  39  |         child = spawn(
  40  |           process.execPath,
  41  |           ["--import", "tsx", "src/server/index.ts"],
  42  |           {
  43  |             env: {
  44  |               PATH: process.env.PATH,
  45  |               LLM_ENABLED: "false",
  46  |               HOST: "127.0.0.1",
  47  |               PORT: "3003",
  48  |               MISTSEA_SAVE: join(directory, "valley.sqlite"),
  49  |             },
  50  |             stdio: ["ignore", log, log],
  51  |           },
  52  |         );
  53  |         await expect
  54  |           .poll(
  55  |             async () => {
  56  |               if (child?.exitCode !== null)
  57  |                 throw Error(`Backend exited: ${child?.exitCode}`);
  58  |               try {
  59  |                 return (await fetch(`${backendUrl}/health`)).status;
  60  |               } catch {
  61  |                 return 0;
  62  |               }
  63  |             },
  64  |             { timeout: 8000 },
  65  |           )
  66  |           .toBe(200);
  67  |       }
  68  |       async function stop() {
  69  |         if (child && child.exitCode === null && child.signalCode === null) {
  70  |           const exit = once(child, "exit");
  71  |           child.kill("SIGTERM");
  72  |           await exit;
  73  |         }
  74  |         child = undefined;
  75  |       }
  76  |       try {
  77  |         await start();
  78  |         await use({ start, stop });
  79  |       } finally {
  80  |         await stop();
  81  |         closeSync(log);
  82  |         rmSync(directory, { recursive: true, force: true });
  83  |       }
  84  |     },
  85  |     { auto: true },
  86  |   ],
  87  | });
  88  | 
  89  | const ready = (page: Page) =>
> 90  |   expect(page.locator("#game")).toHaveAttribute("data-ready", "true", {
      |                                 ^ Error: expect(locator).toHaveAttribute(expected) failed
  91  |     timeout: 12000,
  92  |   });
  93  | const bag = (page: Page, item: string) => page.locator(`[data-item="${item}"]`);
  94  | const progress = (page: Page) =>
  95  |   page.locator("#progress").evaluate((el: HTMLProgressElement) => el.value);
  96  | const position = (page: Page) =>
  97  |   page
  98  |     .locator("#game")
  99  |     .evaluate((el) => ({ x: Number(el.dataset.x), y: Number(el.dataset.y) }));
  100 | const screenshot = (page: Page, basename: string) =>
  101 |   page.screenshot({ path: join(evidence, `${basename}.png`), fullPage: true });
  102 | 
  103 | async function waitStill(page: Page) {
  104 |   await expect(page.locator("#game")).toHaveAttribute("data-moving", "false");
  105 | }
  106 | 
  107 | async function walk(page: Page, goal: (p: Point) => boolean, repaired = false) {
  108 |   const steps = route(await position(page), goal, repaired);
  109 |   for (const step of steps) {
  110 |     const axis = step.axis;
  111 |     const value = step[axis];
  112 |     const current = (await position(page))[axis];
  113 |     const sign = Math.sign(value - current);
  114 |     if (Math.abs(value - current) <= 2) continue;
  115 |     const key = axis === "x" ? (sign > 0 ? "d" : "a") : sign > 0 ? "s" : "w";
  116 |     await page.keyboard.down(key);
  117 |     try {
  118 |       await page.waitForFunction(
  119 |         ({ axis, value, sign }) => {
  120 |           const current = Number(
  121 |             document.getElementById("game")!.dataset[axis],
  122 |           );
  123 |           return (current - value) * sign >= -1.7;
  124 |         },
  125 |         { axis, value, sign },
  126 |         { timeout: 2200 + (Math.abs(value - current) * 1000) / speed },
  127 |       );
  128 |     } finally {
  129 |       await page.keyboard.up(key);
  130 |     }
  131 |   }
  132 |   await waitStill(page);
  133 | }
  134 | 
  135 | async function approach(page: Page, target: Target, repaired = false) {
  136 |   await walk(
  137 |     page,
  138 |     (p) =>
  139 |       distance(p, target) <= target.range - 8 &&
  140 |       nearbyTarget(p)?.id === target.id,
  141 |     repaired,
  142 |   );
  143 |   expect(distance(await position(page), target)).toBeLessThan(target.range);
  144 |   await expect(page.locator("#target")).toHaveText(target.name);
  145 | }
  146 | 
  147 | test("fresh journey collects all materials, repairs, crosses, explores and restores", async ({
  148 |   page,
  149 |   backend,
  150 | }) => {
  151 |   const external: string[] = [];
  152 |   const errors: string[] = [];
  153 |   const initialMissing: string[] = [];
  154 |   let restarting = false;
  155 |   page.on("request", (request) => {
  156 |     const url = new URL(request.url());
  157 |     if (url.origin !== "http://127.0.0.1:5174" && url.protocol !== "data:")
  158 |       external.push(request.url());
  159 |   });
  160 |   page.on("pageerror", (error) => errors.push(error.message));
  161 |   page.on("console", (message) => {
  162 |     if (message.type() === "error" && !restarting) errors.push(message.text());
  163 |   });
  164 |   page.on("response", (response) => {
  165 |     if (response.status() >= 400 && !restarting)
  166 |       initialMissing.push(response.url());
  167 |   });
  168 |   await page.goto("/");
  169 |   await ready(page);
  170 |   await expect(bag(page, "wood")).toHaveText("0");
  171 |   await expect(bag(page, "stone")).toHaveText("0");
  172 |   await expect(page.locator("#music")).toHaveAttribute("aria-pressed", "false");
  173 |   await expect(page.locator("canvas")).toBeVisible();
  174 |   const colors = await page
  175 |     .locator("canvas")
  176 |     .evaluate((canvas: HTMLCanvasElement) => {
  177 |       const pixels = canvas
  178 |         .getContext("2d")!
  179 |         .getImageData(0, 0, canvas.width, canvas.height).data;
  180 |       const colors = new Set<number>();
  181 |       for (let i = 0; i < pixels.length; i += 4)
  182 |         colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  183 |       return colors.size;
  184 |     });
  185 |   expect(colors).toBeGreaterThan(80);
  186 |   await screenshot(page, "scene-desktop");
  187 |   await page.getByRole("button", { name: "全谷地图" }).click();
  188 |   await screenshot(page, "valley-overview");
  189 |   await page.getByRole("button", { name: "返回场景" }).click();
  190 | 
```