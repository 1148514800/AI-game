# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scene.e2e.ts >> fresh journey collects all materials, repairs, crosses, explores and restores
- Location: tests/scene.e2e.ts:147:1

# Error details

```
TimeoutError: page.waitForFunction: Timeout 4109.798863636363ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - banner [ref=f1e3]:
    - generic [ref=f1e6]:
      - heading "雾海行纪" [level=1] [ref=f1e7]
      - paragraph [ref=f1e8]: 雾灯谷
    - generic [ref=f1e9]:
      - status [ref=f1e10]: 本地存档已连接
      - button "音乐关" [ref=f1e11] [cursor=pointer]
      - button "暂停" [ref=f1e12] [cursor=pointer]
  - main [ref=f1e13]:
    - region "雾灯谷场景" [ref=f1e14]:
      - generic [ref=f1e15]:
        - heading "谷地聚落" [level=2] [ref=f1e18]
        - button "全谷地图" [ref=f1e19] [cursor=pointer]
      - generic "游戏场景，方向键或 WASD 移动，E 交互" [ref=f1e21]
      - generic [ref=f1e23]:
        - generic [ref=f1e25]:
          - strong [ref=f1e26]: 岑砚
          - paragraph [ref=f1e27]: 木匠 · 和岑砚聊聊。
        - button "与岑砚交谈 E" [ref=f1e29] [cursor=pointer]:
          - text: 与岑砚交谈
          - generic [ref=f1e30]: E
      - generic [ref=f1e31]:
        - generic [ref=f1e32]:
          - generic [ref=f1e33]: W
          - generic [ref=f1e34]: A
          - generic [ref=f1e35]: S
          - generic [ref=f1e36]: D
          - text: 或方向键 移动
        - generic [ref=f1e37]:
          - generic [ref=f1e38]: E
          - text: 交互
        - generic [ref=f1e39]:
          - generic [ref=f1e40]: Esc
          - text: 暂停
        - button "音效开" [pressed] [ref=f1e41] [cursor=pointer]
    - complementary "旅人手记" [ref=f1e42]:
      - generic [ref=f1e43]:
        - generic [ref=f1e46]:
          - paragraph [ref=f1e47]: 当前目标
          - heading "修复雾灯旧桥" [level=2] [ref=f1e48]
        - paragraph [ref=f1e49]: 北坡林地采木，南坡岩场取石，再回渡口交付。
        - generic [ref=f1e50]:
          - generic [ref=f1e51]: 已交木材
          - strong [ref=f1e52]: 0 / 6
        - generic [ref=f1e53]:
          - generic [ref=f1e54]: 已交石材
          - strong [ref=f1e55]: 0 / 2
        - generic [ref=f1e56]:
          - generic [ref=f1e57]: 施工进度
          - strong [ref=f1e58]: 0%
        - progressbar "施工进度" [ref=f1e59]: 0%
      - generic [ref=f1e60]:
        - heading "背包" [level=2] [ref=f1e61]
        - list "物品栏" [ref=f1e62]:
          - listitem [ref=f1e63]:
            - generic [ref=f1e64]: 木材
            - strong [ref=f1e65]: "6"
          - listitem [ref=f1e66]:
            - generic [ref=f1e67]: 石材
            - strong [ref=f1e68]: "0"
          - listitem [ref=f1e69]:
            - generic [ref=f1e70]: 食物
            - strong [ref=f1e71]: "0"
          - listitem [ref=f1e72]:
            - generic [ref=f1e73]: 工具箱
            - strong [ref=f1e74]: "0"
      - generic [ref=f1e75]:
        - heading "谷中居民" [level=2] [ref=f1e76]
        - list [ref=f1e77]:
          - listitem [ref=f1e78]:
            - strong [ref=f1e80]: 岑砚
            - generic [ref=f1e81]: 木匠
          - listitem [ref=f1e82]:
            - strong [ref=f1e84]: 阿禾
            - generic [ref=f1e85]: 采集者
          - listitem [ref=f1e86]:
            - strong [ref=f1e88]: 洛舟
            - generic [ref=f1e89]: 探路人
        - paragraph [ref=f1e90]: 岑砚 · 空闲
        - group [ref=f1e91]:
          - generic "AI Debug" [ref=f1e92] [cursor=pointer]
      - generic [ref=f1e93]:
        - generic [ref=f1e94]: 本地自动存档
        - button "重开旅程" [ref=f1e95] [cursor=pointer]
```

# Test source

```ts
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
  90  |   expect(page.locator("#game")).toHaveAttribute("data-ready", "true", {
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
> 118 |       await page.waitForFunction(
      |                  ^ TimeoutError: page.waitForFunction: Timeout 4109.798863636363ms exceeded.
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
  191 |   for (const resident of valley.residents) {
  192 |     await approach(page, resident);
  193 |     await page.keyboard.press("e");
  194 |     await expect(page.locator("#feedback")).toHaveText(resident.intro);
  195 |     await expect(page.locator("#feedback-icon")).toHaveAttribute(
  196 |       "src",
  197 |       `/assets/${resident.asset}-face.png`,
  198 |     );
  199 |     await screenshot(page, `resident-${resident.id}`);
  200 |     if (resident.id === "cenyan") {
  201 |       await expect(page.getByRole("dialog", { name: "岑砚" })).toBeVisible();
  202 |       await expect(page.locator("#dialogue-mode")).toContainText("模拟");
  203 |       await page.getByRole("button", { name: "关闭对话" }).click();
  204 |     }
  205 |   }
  206 |   await approach(page, valley.bridge);
  207 |   await page.keyboard.press("e");
  208 |   await expect(page.locator("#feedback")).toContainText(
  209 |     "旧桥需要木材 6、石材 2",
  210 |   );
  211 |   await page.getByRole("button", { name: "交付材料" }).click();
  212 |   await expect(page.locator("#feedback")).toContainText("材料不足");
  213 |   await expect(page.locator("#bridge-wood")).toHaveText("0 / 6");
  214 |   await walk(page, (p) => p.x > 432 && p.x < 453 && Math.abs(p.y - 368) <= 4.1);
  215 |   await page.keyboard.down("d");
  216 |   await expect.poll(async () => (await position(page)).x).toBeGreaterThan(450);
  217 |   await page.waitForTimeout(1050);
  218 |   await page.keyboard.up("d");
```