# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dialogue.e2e.ts >> Phase 3 autonomous Mock journey >> fresh actor walks and visibly supplies and repairs the bridge, with folded responsive debug
- Location: tests/dialogue.e2e.ts:273:3

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
    14 × locator resolved to <div id="game" tabindex="0" data-ready="false" aria-label="游戏场景，方向键或 WASD 移动，E 交互">…</div>
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
  180 |   test("390px dialogue fits and exposes budget failure with a manual retry", async ({
  181 |     browser,
  182 |   }) => {
  183 |     const context = await browser.newContext({
  184 |       viewport: { width: 390, height: 844 },
  185 |       isMobile: true,
  186 |       hasTouch: true,
  187 |     });
  188 |     try {
  189 |       const page = await context.newPage();
  190 |       await page.goto(url);
  191 |       await approach(page);
  192 |       await page.getByRole("button", { name: /与岑砚交谈/ }).click();
  193 |       await expect(panel(page)).toBeVisible();
  194 |       const box = await panel(page).boundingBox();
  195 |       expect(box!.x).toBeGreaterThanOrEqual(0);
  196 |       expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  197 |       expect(
  198 |         await page.evaluate(() => document.documentElement.scrollWidth),
  199 |       ).toBeLessThanOrEqual(390);
  200 |       await shoot(page, "dialogue-narrow");
  201 |       await input(page).fill("旧桥已经好了吧？");
  202 |       await page.getByRole("button", { name: "发送" }).click();
  203 |       await expect(chat(page)).toContainText("旧桥未修通");
  204 |       await input(page).fill("现在可以再问吗");
  205 |       await page.getByRole("button", { name: "发送" }).click();
  206 |       await expect(page.locator("#dialogue-error")).toContainText("额度已用完");
  207 |       await expect(
  208 |         page.getByRole("button", { name: "重试这条消息" }),
  209 |       ).toBeVisible();
  210 |       await shoot(page, "dialogue-budget");
  211 |       await page.getByRole("button", { name: "重试这条消息" }).click();
  212 |       await expect(page.locator("#dialogue-error")).toContainText("额度已用完");
  213 |       await expect(chat(page).locator("p")).toHaveCount(3);
  214 |     } finally {
  215 |       await context.close();
  216 |     }
  217 |   });
  218 | });
  219 | 
  220 | test.describe("faulted Mock", () => {
  221 |   test.use({ mockEnv: { LLM_TIMEOUT_MS: "200", LLM_MOCK_FAILURE: "timeout" } });
  222 |   test("timeout is visible and manual retry remains Mock", async ({ page }) => {
  223 |     await page.goto(url);
  224 |     await approach(page);
  225 |     await page.keyboard.press("e");
  226 |     await input(page).fill("你好，岑砚");
  227 |     await page.getByRole("button", { name: "发送" }).click();
  228 |     await expect(page.locator("#dialogue-error")).toContainText("等候回复超时");
  229 |     await expect(page.locator("#dialogue-mode")).toContainText("Mock");
  230 |     await shoot(page, "dialogue-failure");
  231 |     await page.getByRole("button", { name: "重试这条消息" }).click();
  232 |     await expect(page.locator("#dialogue-error")).toContainText("等候回复超时");
  233 |     await expect(chat(page).locator("p")).toHaveCount(1);
  234 |   });
  235 | });
  236 | 
  237 | test.describe("Phase 3 offline action request", () => {
  238 |   test.use({ mockEnv: { LLM_MOCK_DELAY_MS: "300" } });
  239 | 
  240 |   test("natural request accepts a plan and the actor actually harvests after the dialogue closes", async ({
  241 |     page,
  242 |   }) => {
  243 |     await page.goto(url);
  244 |     await approach(page);
  245 |     await page.keyboard.press("e");
  246 |     await expect(panel(page)).toBeVisible();
  247 |     await panel(page).getByRole("button", { name: "请岑砚修桥" }).click();
  248 |     await expect(chat(page)).toContainText("计划已接受，等待规则执行。");
  249 |     await shoot(page, "phase3-action-accepted");
  250 |     const close = panel(page).getByRole("button", { name: "关闭对话" });
  251 |     if (await close.isVisible()) await close.click();
  252 |     await page.locator("#cenyan-debug summary").click();
  253 |     await expect(page.locator("#cenyan-bag")).toHaveText("木材 1 · 石材 0", {
  254 |       timeout: 15000,
  255 |     });
  256 |     await expect(page.locator("[data-item=wood]")).toHaveText("0");
  257 |     await expect(page.locator("#cenyan-memory")).toContainText("旅人声称");
  258 |     await expect(page.locator("#cenyan-memory")).toContainText("规则事实");
  259 |     await shoot(page, "phase3-action-harvest");
  260 |   });
  261 | });
  262 | 
  263 | test.describe("Phase 3 autonomous Mock journey", () => {
  264 |   test.use({
  265 |     mockEnv: {
  266 |       LLM_MOCK_AUTONOMY_ENABLED: "true",
  267 |       LLM_MOCK_DELAY_MS: "180",
  268 |       LLM_AUTONOMY_REQUESTS_PER_MINUTE: "20",
  269 |       LLM_MAX_REQUESTS_PER_MINUTE: "24",
  270 |     },
  271 |   });
  272 | 
  273 |   test("fresh actor walks and visibly supplies and repairs the bridge, with folded responsive debug", async ({
  274 |     page,
  275 |   }) => {
  276 |     const errors: string[] = [];
  277 |     page.on("pageerror", (error) => errors.push(error.message));
  278 |     await page.goto(url);
  279 |     const stage = page.locator("#game");
> 280 |     await expect(stage).toHaveAttribute("data-ready", "true");
      |                         ^ Error: expect(locator).toHaveAttribute(expected) failed
  281 |     await expect(page.locator("#cenyan-debug")).not.toHaveAttribute("open", "");
  282 |     await page.locator("#cenyan-debug summary").click();
  283 |     await expect(page.locator("#cenyan-status")).toContainText("Mock 模拟");
  284 |     await expect(stage).toHaveAttribute("data-cenyan-activity", "moving", {
  285 |       timeout: 10000,
  286 |     });
  287 |     const frame = await stage.getAttribute("data-cenyan-frame");
  288 |     await expect(stage).not.toHaveAttribute("data-cenyan-frame", frame!);
  289 |     await shoot(page, "phase3-npc-moving");
  290 |     await expect(page.locator("#cenyan-bag")).toHaveText("木材 1 · 石材 0");
  291 |     await expect(page.locator("#cenyan-memory")).toContainText("获得 木材");
  292 |     await shoot(page, "phase3-npc-collected");
  293 |     await page.keyboard.down("d");
  294 |     try {
  295 |       await page.waitForFunction(
  296 |         () => Number(document.getElementById("game")!.dataset.x) > 390,
  297 |       );
  298 |     } finally {
  299 |       await page.keyboard.up("d");
  300 |     }
  301 |     await expect(page.locator("#bridge-wood")).toHaveText("6 / 6", {
  302 |       timeout: 85_000,
  303 |     });
  304 |     await expect(page.locator("#bridge-stone")).toHaveText("2 / 2");
  305 |     await shoot(page, "phase3-npc-delivered");
  306 |     await expect(stage).toHaveAttribute("data-cenyan-activity", "working");
  307 |     await expect
  308 |       .poll(() =>
  309 |         page
  310 |           .locator("#progress")
  311 |           .evaluate((element: HTMLProgressElement) => element.value),
  312 |       )
  313 |       .toBeGreaterThan(0);
  314 |     await shoot(page, "phase3-npc-building");
  315 |     await expect(page.locator("#percent")).toHaveText("100%", {
  316 |       timeout: 20_000,
  317 |     });
  318 |     await expect(page.locator("#objective")).toHaveText("查看航标遗迹");
  319 |     await expect(page.locator("[data-item=stone]")).toHaveText("0");
  320 |     await expect(page.locator("#cenyan-memory")).toContainText("旧桥已修通");
  321 |     await shoot(page, "phase3-npc-bridge-restored");
  322 |     await page.setViewportSize({ width: 390, height: 844 });
  323 |     await expect
  324 |       .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
  325 |       .toBeLessThanOrEqual(390);
  326 |     await page.locator("#cenyan-debug").scrollIntoViewIfNeeded();
  327 |     await shoot(page, "phase3-npc-debug-narrow");
  328 |     expect(errors).toEqual([]);
  329 |   });
  330 | });
  331 | 
```