# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scene.e2e.ts >> fresh journey collects all materials, repairs, crosses, explores and restores
- Location: tests/scene.e2e.ts:146:1

# Error details

```
TimeoutError: page.waitForFunction: Timeout 2654.5454545454545ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=f2e2]:
  - banner [ref=f2e3]:
    - generic [ref=f2e6]:
      - heading "雾海行纪" [level=1] [ref=f2e7]
      - paragraph [ref=f2e8]: 雾灯谷
    - generic [ref=f2e9]:
      - status [ref=f2e10]: 本地存档已连接
      - button "音乐关" [ref=f2e11] [cursor=pointer]
      - button "暂停" [ref=f2e12] [cursor=pointer]
  - main [ref=f2e13]:
    - region "雾灯谷场景" [ref=f2e14]:
      - generic [ref=f2e15]:
        - heading "北坡林地" [level=2] [ref=f2e18]
        - button "全谷地图" [ref=f2e19] [cursor=pointer]
      - generic "游戏场景，方向键或 WASD 移动，E 交互" [ref=f2e21]
      - generic [ref=f2e23]:
        - generic [ref=f2e25]:
          - strong [ref=f2e26]: 探索雾灯谷
          - paragraph [ref=f2e27]: 沿小路探索，靠近居民或采集点后按 E。
        - button "附近无交互 E" [disabled] [ref=f2e29]:
          - text: 附近无交互
          - generic [ref=f2e30]: E
      - generic [ref=f2e31]:
        - generic [ref=f2e32]:
          - generic [ref=f2e33]: W
          - generic [ref=f2e34]: A
          - generic [ref=f2e35]: S
          - generic [ref=f2e36]: D
          - text: 或方向键 移动
        - generic [ref=f2e37]:
          - generic [ref=f2e38]: E
          - text: 交互
        - generic [ref=f2e39]:
          - generic [ref=f2e40]: Esc
          - text: 暂停
        - button "音效开" [pressed] [ref=f2e41] [cursor=pointer]
    - complementary "旅人手记" [ref=f2e42]:
      - generic [ref=f2e43]:
        - generic [ref=f2e46]:
          - paragraph [ref=f2e47]: 当前目标
          - heading "修复雾灯旧桥" [level=2] [ref=f2e48]
        - paragraph [ref=f2e49]: 北坡林地采木，南坡岩场取石，再回渡口交付。
        - generic [ref=f2e50]:
          - generic [ref=f2e51]: 已交木材
          - strong [ref=f2e52]: 0 / 6
        - generic [ref=f2e53]:
          - generic [ref=f2e54]: 已交石材
          - strong [ref=f2e55]: 0 / 2
        - generic [ref=f2e56]:
          - generic [ref=f2e57]: 施工进度
          - strong [ref=f2e58]: 0%
        - progressbar "施工进度" [ref=f2e59]: 0%
      - generic [ref=f2e60]:
        - heading "背包" [level=2] [ref=f2e61]
        - list "物品栏" [ref=f2e62]:
          - listitem [ref=f2e63]:
            - generic [ref=f2e64]: 木材
            - strong [ref=f2e65]: "3"
          - listitem [ref=f2e66]:
            - generic [ref=f2e67]: 石材
            - strong [ref=f2e68]: "0"
          - listitem [ref=f2e69]:
            - generic [ref=f2e70]: 食物
            - strong [ref=f2e71]: "0"
          - listitem [ref=f2e72]:
            - generic [ref=f2e73]: 工具箱
            - strong [ref=f2e74]: "0"
      - generic [ref=f2e75]:
        - heading "谷中居民" [level=2] [ref=f2e76]
        - list [ref=f2e77]:
          - listitem [ref=f2e78]:
            - strong [ref=f2e80]: 岑砚
            - generic [ref=f2e81]: 木匠
          - listitem [ref=f2e82]:
            - strong [ref=f2e84]: 阿禾
            - generic [ref=f2e85]: 采集者
          - listitem [ref=f2e86]:
            - strong [ref=f2e88]: 洛舟
            - generic [ref=f2e89]: 探路人
      - generic [ref=f2e90]:
        - generic [ref=f2e91]: 本地自动存档
        - button "重开旅程" [ref=f2e92] [cursor=pointer]
```

# Test source

```ts
  17  | } from "../src/shared/world.js";
  18  | import { route } from "./paths.js";
  19  | 
  20  | const evidence = process.env.MISTSEA_EVIDENCE ?? "evidence/phase1";
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
  44  |               ...process.env,
  45  |               HOST: "127.0.0.1",
  46  |               PORT: "3003",
  47  |               MISTSEA_SAVE: join(directory, "valley.sqlite"),
  48  |             },
  49  |             stdio: ["ignore", log, log],
  50  |           },
  51  |         );
  52  |         await expect
  53  |           .poll(
  54  |             async () => {
  55  |               if (child?.exitCode !== null)
  56  |                 throw Error(`Backend exited: ${child?.exitCode}`);
  57  |               try {
  58  |                 return (await fetch(`${backendUrl}/health`)).status;
  59  |               } catch {
  60  |                 return 0;
  61  |               }
  62  |             },
  63  |             { timeout: 8000 },
  64  |           )
  65  |           .toBe(200);
  66  |       }
  67  |       async function stop() {
  68  |         if (child && child.exitCode === null && child.signalCode === null) {
  69  |           const exit = once(child, "exit");
  70  |           child.kill("SIGTERM");
  71  |           await exit;
  72  |         }
  73  |         child = undefined;
  74  |       }
  75  |       try {
  76  |         await start();
  77  |         await use({ start, stop });
  78  |       } finally {
  79  |         await stop();
  80  |         closeSync(log);
  81  |         rmSync(directory, { recursive: true, force: true });
  82  |       }
  83  |     },
  84  |     { auto: true },
  85  |   ],
  86  | });
  87  | 
  88  | const ready = (page: Page) =>
  89  |   expect(page.locator("#game")).toHaveAttribute("data-ready", "true", {
  90  |     timeout: 12000,
  91  |   });
  92  | const bag = (page: Page, item: string) => page.locator(`[data-item="${item}"]`);
  93  | const progress = (page: Page) =>
  94  |   page.locator("#progress").evaluate((el: HTMLProgressElement) => el.value);
  95  | const position = (page: Page) =>
  96  |   page
  97  |     .locator("#game")
  98  |     .evaluate((el) => ({ x: Number(el.dataset.x), y: Number(el.dataset.y) }));
  99  | const screenshot = (page: Page, basename: string) =>
  100 |   page.screenshot({ path: join(evidence, `${basename}.png`), fullPage: true });
  101 | 
  102 | async function waitStill(page: Page) {
  103 |   await expect(page.locator("#game")).toHaveAttribute("data-moving", "false");
  104 | }
  105 | 
  106 | async function walk(page: Page, goal: (p: Point) => boolean, repaired = false) {
  107 |   const steps = route(await position(page), goal, repaired);
  108 |   for (const step of steps) {
  109 |     const axis = step.axis;
  110 |     const value = step[axis];
  111 |     const current = (await position(page))[axis];
  112 |     const sign = Math.sign(value - current);
  113 |     if (Math.abs(value - current) <= 2) continue;
  114 |     const key = axis === "x" ? (sign > 0 ? "d" : "a") : sign > 0 ? "s" : "w";
  115 |     await page.keyboard.down(key);
  116 |     try {
> 117 |       await page.waitForFunction(
      |                  ^ TimeoutError: page.waitForFunction: Timeout 2654.5454545454545ms exceeded.
  118 |         ({ axis, value, sign }) => {
  119 |           const current = Number(
  120 |             document.getElementById("game")!.dataset[axis],
  121 |           );
  122 |           return (current - value) * sign >= -1.7;
  123 |         },
  124 |         { axis, value, sign },
  125 |         { timeout: 2200 + (Math.abs(value - current) * 1000) / speed },
  126 |       );
  127 |     } finally {
  128 |       await page.keyboard.up(key);
  129 |     }
  130 |   }
  131 |   await waitStill(page);
  132 | }
  133 | 
  134 | async function approach(page: Page, target: Target, repaired = false) {
  135 |   await walk(
  136 |     page,
  137 |     (p) =>
  138 |       distance(p, target) <= target.range - 8 &&
  139 |       nearbyTarget(p)?.id === target.id,
  140 |     repaired,
  141 |   );
  142 |   expect(distance(await position(page), target)).toBeLessThan(target.range);
  143 |   await expect(page.locator("#target")).toHaveText(target.name);
  144 | }
  145 | 
  146 | test("fresh journey collects all materials, repairs, crosses, explores and restores", async ({
  147 |   page,
  148 |   backend,
  149 | }) => {
  150 |   const external: string[] = [];
  151 |   const errors: string[] = [];
  152 |   const initialMissing: string[] = [];
  153 |   let restarting = false;
  154 |   page.on("request", (request) => {
  155 |     const url = new URL(request.url());
  156 |     if (url.origin !== "http://127.0.0.1:5174" && url.protocol !== "data:")
  157 |       external.push(request.url());
  158 |   });
  159 |   page.on("pageerror", (error) => errors.push(error.message));
  160 |   page.on("console", (message) => {
  161 |     if (message.type() === "error" && !restarting) errors.push(message.text());
  162 |   });
  163 |   page.on("response", (response) => {
  164 |     if (response.status() >= 400 && !restarting)
  165 |       initialMissing.push(response.url());
  166 |   });
  167 |   await page.goto("/");
  168 |   await ready(page);
  169 |   await expect(bag(page, "wood")).toHaveText("0");
  170 |   await expect(bag(page, "stone")).toHaveText("0");
  171 |   await expect(page.locator("#music")).toHaveAttribute("aria-pressed", "false");
  172 |   await expect(page.locator("canvas")).toBeVisible();
  173 |   const colors = await page
  174 |     .locator("canvas")
  175 |     .evaluate((canvas: HTMLCanvasElement) => {
  176 |       const pixels = canvas
  177 |         .getContext("2d")!
  178 |         .getImageData(0, 0, canvas.width, canvas.height).data;
  179 |       const colors = new Set<number>();
  180 |       for (let i = 0; i < pixels.length; i += 4)
  181 |         colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  182 |       return colors.size;
  183 |     });
  184 |   expect(colors).toBeGreaterThan(80);
  185 |   await screenshot(page, "scene-desktop");
  186 |   await page.getByRole("button", { name: "全谷地图" }).click();
  187 |   await screenshot(page, "valley-overview");
  188 |   await page.getByRole("button", { name: "返回场景" }).click();
  189 | 
  190 |   for (const resident of valley.residents) {
  191 |     await approach(page, resident);
  192 |     await page.keyboard.press("e");
  193 |     await expect(page.locator("#feedback")).toHaveText(resident.intro);
  194 |     await expect(page.locator("#feedback-icon")).toHaveAttribute(
  195 |       "src",
  196 |       `/assets/${resident.asset}-face.png`,
  197 |     );
  198 |     await screenshot(page, `resident-${resident.id}`);
  199 |   }
  200 |   await approach(page, valley.bridge);
  201 |   await page.keyboard.press("e");
  202 |   await expect(page.locator("#feedback")).toContainText(
  203 |     "旧桥需要木材 6、石材 2",
  204 |   );
  205 |   await page.getByRole("button", { name: "交付材料" }).click();
  206 |   await expect(page.locator("#feedback")).toContainText("材料不足");
  207 |   await expect(page.locator("#bridge-wood")).toHaveText("0 / 6");
  208 |   await walk(page, (p) => p.x > 432 && p.x < 453 && Math.abs(p.y - 368) <= 4.1);
  209 |   await page.keyboard.down("d");
  210 |   await expect.poll(async () => (await position(page)).x).toBeGreaterThan(450);
  211 |   await page.waitForTimeout(1050);
  212 |   await page.keyboard.up("d");
  213 |   await waitStill(page);
  214 |   expect((await position(page)).x).toBeLessThan(461);
  215 |   await screenshot(page, "bridge-before");
  216 | 
  217 |   let wood = 0;
```