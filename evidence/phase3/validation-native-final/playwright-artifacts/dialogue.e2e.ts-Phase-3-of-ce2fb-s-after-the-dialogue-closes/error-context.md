# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dialogue.e2e.ts >> Phase 3 offline action request >> natural request accepts a plan and the actor actually harvests after the dialogue closes
- Location: tests/dialogue.e2e.ts:240:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('log')
Expected substring: "计划已接受，等待规则执行。"
Received string:    ""
Timeout: 5000ms

Call log:
  - Expect "toContainText" getByRole('log') with timeout 5000ms
  - waiting for getByRole('log')
    14 × locator resolved to <div role="log" aria-label="对话记录" aria-live="polite" id="dialogue-transcript"></div>
       - unexpected value ""

```

```yaml
- log "对话记录"
```

# Test source

```ts
  148 |   await expect(chat(page)).toContainText("<img src=x onerror=alert(1)>");
  149 |   await expect(chat(page).locator("img")).toHaveCount(0);
  150 |   await expect(page.locator("[data-item=wood]")).toHaveText("0");
  151 |   await expect(page.locator("#progress")).toHaveJSProperty("value", 0);
  152 |   await shoot(page, "dialogue-multiturn");
  153 | 
  154 |   await input(page).fill("修桥之前怎么准备？");
  155 |   await page.getByRole("button", { name: "发送" }).click();
  156 |   await expect(page.locator("#dialogue-pending")).toBeVisible();
  157 |   await page.getByRole("button", { name: "暂停", exact: true }).click();
  158 |   await expect(panel(page)).toBeHidden();
  159 |   await expect(page.locator("#screen-title")).toHaveText("旅程暂停");
  160 |   await page.getByRole("button", { name: "继续", exact: true }).click();
  161 |   await page.getByRole("button", { name: /与岑砚交谈/ }).click();
  162 |   await expect(chat(page).locator("p")).toHaveCount(0);
  163 |   await page.getByRole("button", { name: "关闭对话" }).click();
  164 |   const start = Number(await stage.getAttribute("data-y"));
  165 |   await page.keyboard.down("s");
  166 |   try {
  167 |     await expect
  168 |       .poll(async () => Number(await stage.getAttribute("data-y")))
  169 |       .toBeGreaterThan(start + 12);
  170 |   } finally {
  171 |     await page.keyboard.up("s");
  172 |   }
  173 |   await shoot(page, "scene-optimized");
  174 | });
  175 | 
  176 | test.describe("limited Mock", () => {
  177 |   test.use({
  178 |     mockEnv: { LLM_MOCK_DELAY_MS: "150", LLM_MAX_TOTAL_REQUESTS: "1" },
  179 |   });
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
> 248 |     await expect(chat(page)).toContainText("计划已接受，等待规则执行。");
      |                              ^ Error: expect(locator).toContainText(expected) failed
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
  280 |     await expect(stage).toHaveAttribute("data-ready", "true");
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