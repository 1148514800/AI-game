# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scene.e2e.ts >> four-way walk frames, pause, a following camera and opt-in music
- Location: tests/scene.e2e.ts:305:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('#game')
Expected: "true"
Received: "false"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" locator('#game') with timeout 5000ms
  - waiting for locator('#game')
    14 × locator resolved to <div id="game" tabindex="0" data-frame="1" data-ready="true" data-x="175.1701" data-y="414.6627" data-direction="up" data-moving="false" data-working="false" data-camera-x="0.00" data-cenyan-frame="0" data-camera-y="273.66" data-cenyan-x="255.0000" data-cenyan-y="299.0000" data-cenyan-activity="idle" data-cenyan-direction="down" aria-label="游戏场景，方向键或 WASD 移动，E 交互">…</div>
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
      - status [ref=e10]: 本地存档已连接
      - button "音乐关" [ref=e11] [cursor=pointer]
      - button "暂停" [ref=e12] [cursor=pointer]
  - main [ref=e13]:
    - region "雾灯谷场景" [ref=e14]:
      - generic [ref=e15]:
        - heading "谷地聚落" [level=2] [ref=e18]
        - button "全谷地图" [ref=e19] [cursor=pointer]
      - generic "游戏场景，方向键或 WASD 移动，E 交互" [ref=e21]
      - generic [ref=e23]:
        - generic [ref=e25]:
          - strong [ref=e26]: 探索雾灯谷
          - paragraph [ref=e27]: 沿小路探索，靠近居民或采集点后按 E。
        - button "附近无交互 E" [disabled] [ref=e29]:
          - text: 附近无交互
          - generic [ref=e30]: E
      - generic [ref=e31]:
        - generic [ref=e32]:
          - generic [ref=e33]: W
          - generic [ref=e34]: A
          - generic [ref=e35]: S
          - generic [ref=e36]: D
          - text: 或方向键 移动
        - generic [ref=e37]:
          - generic [ref=e38]: E
          - text: 交互
        - generic [ref=e39]:
          - generic [ref=e40]: Esc
          - text: 暂停
        - button "音效开" [pressed] [ref=e41] [cursor=pointer]
    - complementary "旅人手记" [ref=e42]:
      - generic [ref=e43]:
        - generic [ref=e46]:
          - paragraph [ref=e47]: 当前目标
          - heading "修复雾灯旧桥" [level=2] [ref=e48]
        - paragraph [ref=e49]: 向东走到河边，查看雾灯旧桥。
        - generic [ref=e50]:
          - generic [ref=e51]: 已交木材
          - strong [ref=e52]: 0 / 6
        - generic [ref=e53]:
          - generic [ref=e54]: 已交石材
          - strong [ref=e55]: 0 / 2
        - generic [ref=e56]:
          - generic [ref=e57]: 施工进度
          - strong [ref=e58]: 0%
        - progressbar "施工进度" [ref=e59]: 0%
      - generic [ref=e60]:
        - heading "背包" [level=2] [ref=e61]
        - list "物品栏" [ref=e62]:
          - listitem [ref=e63]:
            - generic [ref=e64]: 木材
            - strong [ref=e65]: "0"
          - listitem [ref=e66]:
            - generic [ref=e67]: 石材
            - strong [ref=e68]: "0"
          - listitem [ref=e69]:
            - generic [ref=e70]: 食物
            - strong [ref=e71]: "0"
          - listitem [ref=e72]:
            - generic [ref=e73]: 工具箱
            - strong [ref=e74]: "0"
      - generic [ref=e75]:
        - heading "谷中居民" [level=2] [ref=e76]
        - list [ref=e77]:
          - listitem [ref=e78]:
            - strong [ref=e80]: 岑砚
            - generic [ref=e81]: 木匠
          - listitem [ref=e82]:
            - strong [ref=e84]: 阿禾
            - generic [ref=e85]: 采集者
          - listitem [ref=e86]:
            - strong [ref=e88]: 洛舟
            - generic [ref=e89]: 探路人
        - paragraph [ref=e90]: 岑砚 · 空闲
        - group [ref=e91]:
          - generic "AI Debug" [ref=e92] [cursor=pointer]
      - generic [ref=e93]:
        - generic [ref=e94]: 本地自动存档
        - button "重开旅程" [ref=e95] [cursor=pointer]
```

# Test source

```ts
  224 |   let stone = 0;
  225 |   for (const resource of valley.resources.slice(0, 8)) {
  226 |     await approach(page, resource);
  227 |     await page.keyboard.press("e");
  228 |     const amount = resource.item === "wood" ? ++wood : ++stone;
  229 |     await expect(bag(page, resource.item)).toHaveText(String(amount));
  230 |     await expect(page.locator("#feedback")).toContainText("已放入背包");
  231 |     if (wood === 1 && stone === 0) {
  232 |       await screenshot(page, "collection");
  233 |       const checkpoint = await position(page);
  234 |       await page.reload();
  235 |       await ready(page);
  236 |       await expect(bag(page, "wood")).toHaveText("1");
  237 |       expect(distance(await position(page), checkpoint)).toBeLessThan(1);
  238 |       await page.keyboard.press("e");
  239 |       await expect(page.locator("#feedback")).toContainText("恢复");
  240 |       await expect(bag(page, "wood")).toHaveText("1");
  241 |     }
  242 |   }
  243 |   expect({ wood, stone }).toEqual({ wood: 6, stone: 2 });
  244 |   await screenshot(page, "inventory");
  245 | 
  246 |   await approach(page, valley.bridge);
  247 |   await page.getByRole("button", { name: "交付材料" }).click();
  248 |   await expect(page.locator("#bridge-wood")).toHaveText("6 / 6");
  249 |   await expect(page.locator("#bridge-stone")).toHaveText("2 / 2");
  250 |   await expect(bag(page, "wood")).toHaveText("0");
  251 |   await expect(bag(page, "stone")).toHaveText("0");
  252 |   await page.getByRole("button", { name: "开始施工" }).click();
  253 |   await expect.poll(() => progress(page)).toBeGreaterThan(9);
  254 |   await screenshot(page, "construction");
  255 |   restarting = true;
  256 |   await backend.stop();
  257 |   await expect(page.locator("#game")).toHaveAttribute("data-ready", "false");
  258 |   await expect(page.locator("#screen-detail")).toContainText(/重试|恢复/);
  259 |   await backend.start();
  260 |   await ready(page);
  261 |   const persisted = await progress(page);
  262 |   expect(persisted).toBeGreaterThan(9);
  263 |   expect(persisted).toBeLessThan(50);
  264 |   await expect(page.locator("#bridge-wood")).toHaveText("6 / 6");
  265 |   await expect(page.locator("#game")).toHaveAttribute("data-working", "false");
  266 |   await page.getByRole("button", { name: "开始施工" }).click();
  267 |   await expect(page.locator("#objective")).toHaveText("查看航标遗迹", {
  268 |     timeout: 20000,
  269 |   });
  270 |   expect(await progress(page)).toBe(100);
  271 |   await screenshot(page, "bridge-after");
  272 | 
  273 |   await approach(page, valley.ruin, true);
  274 |   expect((await position(page)).x).toBeGreaterThan(600);
  275 |   await page.getByRole("button", { name: "查看航标" }).click();
  276 |   await expect(page.locator("#objective")).toHaveText("旅程完成");
  277 |   await expect(page.locator("#feedback")).toHaveText(valley.ruin.clue);
  278 |   await screenshot(page, "beacon-ruin");
  279 |   const end = await position(page);
  280 |   await page.reload();
  281 |   await ready(page);
  282 |   await expect(page.locator("#objective")).toHaveText("旅程完成");
  283 |   expect(distance(await position(page), end)).toBeLessThan(1);
  284 |   await backend.stop();
  285 |   await expect(page.locator("#game")).toHaveAttribute("data-ready", "false");
  286 |   await backend.start();
  287 |   await ready(page);
  288 |   await expect(page.locator("#objective")).toHaveText("旅程完成");
  289 |   await expect(page.locator("#progress")).toHaveJSProperty("value", 100);
  290 |   expect(distance(await position(page), end)).toBeLessThan(1);
  291 | 
  292 |   await page.getByRole("button", { name: "重开旅程" }).click();
  293 |   await page.getByRole("button", { name: "继续当前旅程" }).click();
  294 |   await expect(page.locator("#objective")).toHaveText("旅程完成");
  295 |   await page.getByRole("button", { name: "重开旅程" }).click();
  296 |   await page.getByRole("button", { name: "确认重开" }).click();
  297 |   await expect(page.locator("#objective")).toHaveText("修复雾灯旧桥");
  298 |   await expect(page.locator("#progress")).toHaveJSProperty("value", 0);
  299 |   expect(distance(await position(page), valley.spawn)).toBeLessThan(1);
  300 |   expect(errors).toEqual([]);
  301 |   expect(initialMissing).toEqual([]);
  302 |   expect(external).toEqual([]);
  303 | });
  304 | 
  305 | test("four-way walk frames, pause, a following camera and opt-in music", async ({
  306 |   page,
  307 | }) => {
  308 |   await page.goto("/");
  309 |   await ready(page);
  310 |   const stage = page.locator("#game");
  311 |   for (const [key, axis, sign, facing, column] of [
  312 |     ["d", "x", 1, "right", 3],
  313 |     ["s", "y", 1, "down", 0],
  314 |     ["a", "x", -1, "left", 2],
  315 |     ["w", "y", -1, "up", 1],
  316 |   ] as const) {
  317 |     const before = (await position(page))[axis];
  318 |     await page.keyboard.down(key);
  319 |     try {
  320 |       await expect
  321 |         .poll(async () => ((await position(page))[axis] - before) * sign)
  322 |         .toBeGreaterThan(12);
  323 |       await expect(stage).toHaveAttribute("data-direction", facing);
> 324 |       await expect(stage).toHaveAttribute("data-moving", "true");
      |                           ^ Error: expect(locator).toHaveAttribute(expected) failed
  325 |       const frame = Number(await stage.getAttribute("data-frame"));
  326 |       expect(frame % 4).toBe(column);
  327 |       await expect
  328 |         .poll(async () => Number(await stage.getAttribute("data-frame")))
  329 |         .not.toBe(frame);
  330 |     } finally {
  331 |       await page.keyboard.up(key);
  332 |     }
  333 |     await waitStill(page);
  334 |     await expect(stage).toHaveAttribute("data-frame", String(column));
  335 |   }
  336 |   await page.keyboard.press("Escape");
  337 |   await expect(page.locator("#screen-title")).toHaveText("旅程暂停");
  338 |   const paused = await position(page);
  339 |   await page.keyboard.down("d");
  340 |   await page.waitForTimeout(250);
  341 |   await page.keyboard.up("d");
  342 |   expect(await position(page)).toEqual(paused);
  343 |   await page.keyboard.press("Escape");
  344 |   await approach(page, valley.bridge);
  345 |   await expect
  346 |     .poll(async () => Number(await stage.getAttribute("data-camera-x")))
  347 |     .toBeGreaterThan(100);
  348 |   const cameraX = Number(await stage.getAttribute("data-camera-x"));
  349 |   const viewWidth = await page
  350 |     .locator("canvas")
  351 |     .evaluate((element: HTMLCanvasElement) => element.width);
  352 |   expect(cameraX + viewWidth).toBeLessThanOrEqual(mapWidth + 1);
  353 |   await page.getByRole("button", { name: "音乐关" }).click();
  354 |   await expect(page.getByRole("button", { name: "音乐开" })).toHaveAttribute(
  355 |     "aria-pressed",
  356 |     "true",
  357 |   );
  358 |   await page.getByRole("button", { name: "音乐开" }).click();
  359 |   await expect(page.getByRole("button", { name: "音乐关" })).toHaveAttribute(
  360 |     "aria-pressed",
  361 |     "false",
  362 |   );
  363 | });
  364 | 
  365 | test("390px narrow window renders the scene, residents and touch controls", async ({
  366 |   browser,
  367 |   baseURL,
  368 | }) => {
  369 |   const context = await browser.newContext({
  370 |     baseURL,
  371 |     viewport: { width: 390, height: 844 },
  372 |     isMobile: true,
  373 |     hasTouch: true,
  374 |   });
  375 |   try {
  376 |     const page = await context.newPage();
  377 |     await page.goto("/");
  378 |     await ready(page);
  379 |     await expect(page.locator("canvas")).toBeVisible();
  380 |     await expect(page.locator("#residents img")).toHaveCount(3);
  381 |     await expect(page.getByRole("button", { name: "向右" })).toBeVisible();
  382 |     expect(
  383 |       await page.evaluate(
  384 |         () => document.documentElement.scrollWidth <= innerWidth,
  385 |       ),
  386 |     ).toBe(true);
  387 |     await screenshot(page, "scene-narrow");
  388 |   } finally {
  389 |     await context.close();
  390 |   }
  391 | });
  392 | 
  393 | test("missing bridge art blocks readiness with a clear error", async ({
  394 |   page,
  395 | }) => {
  396 |   await page.route("**/assets/bridge-open.png", (request) =>
  397 |     request.fulfill({ status: 404, body: "asset removed by test" }),
  398 |   );
  399 |   await page.goto("/");
  400 |   await expect(page.locator("#screen-title")).toHaveText("游戏素材加载失败");
  401 |   await expect(page.locator("#screen-detail")).toContainText("bridge-open");
  402 |   await expect(page.locator("#game")).toHaveAttribute("data-ready", "false");
  403 |   await expect(page.locator("#interact")).toBeDisabled();
  404 |   await screenshot(page, "asset-failure");
  405 | });
  406 | 
  407 | test("HTTP failure stays unavailable and automatically recovers", async ({
  408 |   page,
  409 | }) => {
  410 |   await page.route("**/health", (request) =>
  411 |     request.fulfill({ status: 502, body: "backend unavailable" }),
  412 |   );
  413 |   await page.goto("/");
  414 |   await expect(page.locator("#screen-detail")).toContainText(
  415 |     "HTTP 服务无法连接",
  416 |   );
  417 |   await expect(page.locator("#game")).toHaveAttribute("data-ready", "false");
  418 |   await page.unroute("**/health");
  419 |   await ready(page);
  420 | });
  421 | 
  422 | test("WebSocket handshake failure remains visible and prevents input", async ({
  423 |   page,
  424 | }) => {
```