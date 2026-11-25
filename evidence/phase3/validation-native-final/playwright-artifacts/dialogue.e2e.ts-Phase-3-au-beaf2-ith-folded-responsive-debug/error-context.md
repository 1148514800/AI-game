# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dialogue.e2e.ts >> Phase 3 autonomous Mock journey >> fresh actor walks and visibly supplies and repairs the bridge, with folded responsive debug
- Location: tests/dialogue.e2e.ts:273:3

# Error details

```
Test timeout of 150000ms exceeded.
```

```
Error: keyboard.up: Target page, context or browser has been closed
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
          - strong [ref=e26]: 洛舟
          - paragraph [ref=e27]: 探路人 · 听听洛舟的介绍。
        - button "认识居民 E" [ref=e29] [cursor=pointer]:
          - text: 认识居民
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
          - heading "查看航标遗迹" [level=2] [ref=e48]
        - paragraph [ref=e49]: 穿过旧桥，顺着东岸小路前往航标遗迹。
        - generic [ref=e50]:
          - generic [ref=e51]: 已交木材
          - strong [ref=e52]: 6 / 6
        - generic [ref=e53]:
          - generic [ref=e54]: 已交石材
          - strong [ref=e55]: 2 / 2
        - generic [ref=e56]:
          - generic [ref=e57]: 施工进度
          - strong [ref=e58]: 100%
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
        - paragraph [ref=e90]: 岑砚 · 在休息 · Mock 模拟
        - group [ref=e91]:
          - generic "AI Debug" [active] [ref=e92] [cursor=pointer]
          - generic [ref=e93]:
            - term [ref=e94]: 目标
            - definition [ref=e95]: 休整
            - term [ref=e96]: 行动
            - definition [ref=e97]: 1. 前往 木匠工坊 → 2. 休息 24 秒（当前）
            - term [ref=e98]: 岑砚的背包
            - definition [ref=e99]: 木材 8 · 石材 0
            - term [ref=e100]: 规则回执
            - definition [ref=e101]: 抵达木匠工坊附近。
            - term [ref=e102]: 调用
            - definition [ref=e103]: Mock 模拟 · 等待 · 计划完成 · ok · 181 ms · 计入 3320 Token
          - heading "近期重要记忆" [level=3] [ref=e104]
          - list [ref=e105]:
            - listitem [ref=e106]: 规则事实 · 抵达木匠工坊附近。
            - listitem [ref=e107]: 规则事实 · 休息结束。
            - listitem [ref=e108]: 规则事实 · 抵达木匠工坊附近。
            - listitem [ref=e109]: 规则事实 · 休息结束。
            - listitem [ref=e110]: 规则事实 · 抵达木匠工坊附近。
            - listitem [ref=e111]: 规则事实 · 改为目标：休整
      - generic [ref=e112]:
        - generic [ref=e113]: 本地自动存档
        - button "重开旅程" [ref=e114] [cursor=pointer]
```

# Test source

```ts
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
  248 |     await expect(input(page)).not.toHaveValue("");
  249 |     await page.getByRole("button", { name: "发送", exact: true }).click();
  250 |     await expect(chat(page)).toContainText("计划已接受，等待规则执行。");
  251 |     await shoot(page, "phase3-action-accepted");
  252 |     const close = panel(page).getByRole("button", { name: "关闭对话" });
  253 |     if (await close.isVisible()) await close.click();
  254 |     await page.locator("#cenyan-debug summary").click();
  255 |     await expect(page.locator("#cenyan-bag")).toHaveText("木材 1 · 石材 0", {
  256 |       timeout: 15000,
  257 |     });
  258 |     await expect(page.locator("[data-item=wood]")).toHaveText("0");
  259 |     await expect(page.locator("#cenyan-memory")).toContainText("旅人声称");
  260 |     await expect(page.locator("#cenyan-memory")).toContainText("规则事实");
  261 |     await shoot(page, "phase3-action-harvest");
  262 |   });
  263 | });
  264 | 
  265 | test.describe("Phase 3 autonomous Mock journey", () => {
  266 |   test.use({
  267 |     mockEnv: {
  268 |       LLM_MOCK_AUTONOMY_ENABLED: "true",
  269 |       LLM_MOCK_DELAY_MS: "180",
  270 |       LLM_AUTONOMY_REQUESTS_PER_MINUTE: "20",
  271 |       LLM_MAX_REQUESTS_PER_MINUTE: "24",
  272 |     },
  273 |   });
  274 | 
  275 |   test("fresh actor walks and visibly supplies and repairs the bridge, with folded responsive debug", async ({
  276 |     page,
  277 |   }) => {
  278 |     const errors: string[] = [];
  279 |     page.on("pageerror", (error) => errors.push(error.message));
  280 |     await page.goto(url);
  281 |     const stage = page.locator("#game");
  282 |     await expect(stage).toHaveAttribute("data-ready", "true");
  283 |     await expect(page.locator("#cenyan-debug")).not.toHaveAttribute("open", "");
  284 |     await page.locator("#cenyan-debug summary").click();
  285 |     await expect(page.locator("#cenyan-status")).toContainText("Mock 模拟");
  286 |     await expect(stage).toHaveAttribute("data-cenyan-activity", "moving", {
  287 |       timeout: 10000,
  288 |     });
  289 |     const frame = await stage.getAttribute("data-cenyan-frame");
  290 |     await expect(stage).not.toHaveAttribute("data-cenyan-frame", frame!);
  291 |     await shoot(page, "phase3-npc-moving");
  292 |     await expect(page.locator("#cenyan-bag")).toHaveText("木材 1 · 石材 0");
  293 |     await expect(page.locator("#cenyan-memory")).toContainText("获得 木材");
  294 |     await shoot(page, "phase3-npc-collected");
  295 |     await page.keyboard.down("d");
  296 |     try {
  297 |       await page.waitForFunction(
  298 |         () => Number(document.getElementById("game")!.dataset.x) > 390,
> 299 |       );
      |                           ^ Error: keyboard.up: Target page, context or browser has been closed
  300 |     } finally {
  301 |       await page.keyboard.up("d");
  302 |     }
  303 |     await expect(page.locator("#bridge-wood")).toHaveText("6 / 6", {
  304 |       timeout: 85_000,
  305 |     });
  306 |     await expect(page.locator("#bridge-stone")).toHaveText("2 / 2");
  307 |     await shoot(page, "phase3-npc-delivered");
  308 |     await expect(stage).toHaveAttribute("data-cenyan-activity", "working");
  309 |     await expect
  310 |       .poll(() =>
  311 |         page
  312 |           .locator("#progress")
  313 |           .evaluate((element: HTMLProgressElement) => element.value),
  314 |       )
  315 |       .toBeGreaterThan(0);
  316 |     await shoot(page, "phase3-npc-building");
  317 |     await expect(page.locator("#percent")).toHaveText("100%", {
  318 |       timeout: 20_000,
  319 |     });
  320 |     await expect(page.locator("#objective")).toHaveText("查看航标遗迹");
  321 |     await expect(page.locator("[data-item=stone]")).toHaveText("0");
  322 |     await expect(page.locator("#cenyan-memory")).toContainText("旧桥已修通");
  323 |     await shoot(page, "phase3-npc-bridge-restored");
  324 |     await page.setViewportSize({ width: 390, height: 844 });
  325 |     await expect
  326 |       .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
  327 |       .toBeLessThanOrEqual(390);
  328 |     await page.locator("#cenyan-debug").scrollIntoViewIfNeeded();
  329 |     await shoot(page, "phase3-npc-debug-narrow");
  330 |     expect(errors).toEqual([]);
  331 |   });
  332 | });
  333 | 
```