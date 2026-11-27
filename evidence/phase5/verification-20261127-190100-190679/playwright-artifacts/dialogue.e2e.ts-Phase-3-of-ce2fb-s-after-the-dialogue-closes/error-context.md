# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dialogue.e2e.ts >> Phase 3 offline action request >> natural request accepts a plan and the actor actually harvests after the dialogue closes
- Location: tests/dialogue.e2e.ts:236:3

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('#cenyan-bag')
Expected: "木材 1 · 石材 0"
Received: "木材 1 · 石材 0 · 食物 0 · 工具箱 0"
Timeout:  15000ms

Call log:
  - Expect "toHaveText" locator('#cenyan-bag') with timeout 15000ms
  - waiting for locator('#cenyan-bag')
    7 × locator resolved to <dd id="cenyan-bag">木材 0 · 石材 0 · 食物 0 · 工具箱 0</dd>
      - unexpected value "木材 0 · 石材 0 · 食物 0 · 工具箱 0"
    27 × locator resolved to <dd id="cenyan-bag">木材 1 · 石材 0 · 食物 0 · 工具箱 0</dd>
       - unexpected value "木材 1 · 石材 0 · 食物 0 · 工具箱 0"

```

```yaml
- definition: 木材 1 · 石材 0 · 食物 0 · 工具箱 0
```

# Test source

```ts
  151 |   await page.getByRole("button", { name: "发送" }).click();
  152 |   await expect(page.locator("#dialogue-pending")).toBeVisible();
  153 |   await page.getByRole("button", { name: "暂停", exact: true }).click();
  154 |   await expect(panel(page)).toBeHidden();
  155 |   await expect(page.locator("#screen-title")).toHaveText("旅程暂停");
  156 |   await page.getByRole("button", { name: "继续", exact: true }).click();
  157 |   await page.getByRole("button", { name: /与岑砚交谈/ }).click();
  158 |   await expect(chat(page).locator("p")).toHaveCount(0);
  159 |   await page.getByRole("button", { name: "关闭对话" }).click();
  160 |   const start = Number(await stage.getAttribute("data-y"));
  161 |   await page.keyboard.down("s");
  162 |   try {
  163 |     await expect
  164 |       .poll(async () => Number(await stage.getAttribute("data-y")))
  165 |       .toBeGreaterThan(start + 12);
  166 |   } finally {
  167 |     await page.keyboard.up("s");
  168 |   }
  169 |   await shoot(page, "scene-optimized");
  170 | });
  171 | 
  172 | test.describe("limited Mock", () => {
  173 |   test.use({
  174 |     mockEnv: { LLM_MOCK_DELAY_MS: "150", LLM_MAX_TOTAL_REQUESTS: "1" },
  175 |   });
  176 |   test("390px dialogue fits and exposes budget failure with a manual retry", async ({
  177 |     browser,
  178 |   }) => {
  179 |     const context = await browser.newContext({
  180 |       viewport: { width: 390, height: 844 },
  181 |       isMobile: true,
  182 |       hasTouch: true,
  183 |     });
  184 |     try {
  185 |       const page = await context.newPage();
  186 |       await page.goto(url);
  187 |       await approach(page);
  188 |       await page.getByRole("button", { name: /与岑砚交谈/ }).click();
  189 |       await expect(panel(page)).toBeVisible();
  190 |       const box = await panel(page).boundingBox();
  191 |       expect(box!.x).toBeGreaterThanOrEqual(0);
  192 |       expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  193 |       expect(
  194 |         await page.evaluate(() => document.documentElement.scrollWidth),
  195 |       ).toBeLessThanOrEqual(390);
  196 |       await shoot(page, "dialogue-narrow");
  197 |       await input(page).fill("旧桥已经好了吧？");
  198 |       await page.getByRole("button", { name: "发送" }).click();
  199 |       await expect(chat(page)).toContainText("旧桥未修通");
  200 |       await input(page).fill("现在可以再问吗");
  201 |       await page.getByRole("button", { name: "发送" }).click();
  202 |       await expect(page.locator("#dialogue-error")).toContainText("额度已用完");
  203 |       await expect(
  204 |         page.getByRole("button", { name: "重试这条消息" }),
  205 |       ).toBeVisible();
  206 |       await shoot(page, "dialogue-budget");
  207 |       await page.getByRole("button", { name: "重试这条消息" }).click();
  208 |       await expect(page.locator("#dialogue-error")).toContainText("额度已用完");
  209 |       await expect(chat(page).locator("p")).toHaveCount(3);
  210 |     } finally {
  211 |       await context.close();
  212 |     }
  213 |   });
  214 | });
  215 | 
  216 | test.describe("faulted Mock", () => {
  217 |   test.use({ mockEnv: { LLM_TIMEOUT_MS: "200", LLM_MOCK_FAILURE: "timeout" } });
  218 |   test("timeout is visible and manual retry remains Mock", async ({ page }) => {
  219 |     await page.goto(url);
  220 |     await approach(page);
  221 |     await page.keyboard.press("e");
  222 |     await input(page).fill("你好，岑砚");
  223 |     await page.getByRole("button", { name: "发送" }).click();
  224 |     await expect(page.locator("#dialogue-error")).toContainText("等候回复超时");
  225 |     await expect(page.locator("#dialogue-mode")).toContainText("Mock");
  226 |     await shoot(page, "dialogue-failure");
  227 |     await page.getByRole("button", { name: "重试这条消息" }).click();
  228 |     await expect(page.locator("#dialogue-error")).toContainText("等候回复超时");
  229 |     await expect(chat(page).locator("p")).toHaveCount(1);
  230 |   });
  231 | });
  232 | 
  233 | test.describe("Phase 3 offline action request", () => {
  234 |   test.use({ mockEnv: { LLM_MOCK_DELAY_MS: "300" } });
  235 | 
  236 |   test("natural request accepts a plan and the actor actually harvests after the dialogue closes", async ({
  237 |     page,
  238 |   }) => {
  239 |     await page.goto(url);
  240 |     await approach(page);
  241 |     await page.keyboard.press("e");
  242 |     await expect(panel(page)).toBeVisible();
  243 |     await panel(page).getByRole("button", { name: "请岑砚修桥" }).click();
  244 |     await expect(input(page)).not.toHaveValue("");
  245 |     await page.getByRole("button", { name: "发送", exact: true }).click();
  246 |     await expect(chat(page)).toContainText("计划已接受，等待规则执行。");
  247 |     await shoot(page, "phase3-action-accepted");
  248 |     const close = panel(page).getByRole("button", { name: "关闭对话" });
  249 |     if (await close.isVisible()) await close.click();
  250 |     await page.locator("#cenyan-debug summary").click();
> 251 |     await expect(page.locator("#cenyan-bag")).toHaveText("木材 1 · 石材 0", {
      |                                               ^ Error: expect(locator).toHaveText(expected) failed
  252 |       timeout: 15000,
  253 |     });
  254 |     await expect(page.locator("[data-item=wood]")).toHaveText("0");
  255 |     await expect(page.locator("#cenyan-memory")).toContainText("旅人声称");
  256 |     await expect(page.locator("#cenyan-memory")).toContainText("规则事实");
  257 |     await shoot(page, "phase3-action-harvest");
  258 |   });
  259 | });
  260 | 
  261 | test.describe("Phase 3 autonomous Mock journey", () => {
  262 |   test.use({
  263 |     mockEnv: {
  264 |       LLM_MOCK_AUTONOMY_ENABLED: "true",
  265 |       LLM_MOCK_DELAY_MS: "180",
  266 |       LLM_AUTONOMY_REQUESTS_PER_MINUTE: "60",
  267 |       LLM_MAX_REQUESTS_PER_MINUTE: "90",
  268 |       LLM_AUTONOMY_REQUESTS_PER_SESSION: "90",
  269 |       LLM_MAX_REQUESTS_PER_SESSION: "120",
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
  290 |     await page.getByRole("button", { name: "全谷地图", exact: true }).click();
  291 |     await expect(page.locator("#cenyan-bag")).toHaveText("木材 1 · 石材 0");
  292 |     await expect(page.locator("#cenyan-memory")).toContainText("获得 木材");
  293 |     await shoot(page, "phase3-npc-collected");
  294 |     await page.getByRole("button", { name: "返回场景", exact: true }).click();
  295 |     const position = () =>
  296 |       stage.evaluate((el) => ({
  297 |         x: Number(el.dataset.x),
  298 |         y: Number(el.dataset.y),
  299 |       }));
  300 |     // Reach a west-bank viewing point with ordinary keys, routing around the
  301 |     // existing buildings rather than holding D into Luozhou's house.
  302 |     const steps = route(
  303 |       await position(),
  304 |       (point) =>
  305 |         point.x >= 390 &&
  306 |         distance(point, valley.bridge) <= 80 &&
  307 |         distance(point, valley.bridge) >= 45,
  308 |       false,
  309 |     );
  310 |     for (const step of steps) {
  311 |       const axis = step.axis;
  312 |       const target = step[axis];
  313 |       const delta = target - (await position())[axis];
  314 |       if (Math.abs(delta) <= 2) continue;
  315 |       const sign = Math.sign(delta);
  316 |       const key = axis === "x" ? (sign > 0 ? "d" : "a") : sign > 0 ? "s" : "w";
  317 |       await page.keyboard.down(key);
  318 |       try {
  319 |         await page.waitForFunction(
  320 |           ({ axis, target, sign }) =>
  321 |             (Number(document.getElementById("game")!.dataset[axis]) - target) *
  322 |               sign >=
  323 |             -1.7,
  324 |           { axis, target, sign },
  325 |           { timeout: 2200 + (Math.abs(delta) * 1000) / speed },
  326 |         );
  327 |       } finally {
  328 |         await page.keyboard.up(key);
  329 |       }
  330 |     }
  331 |     await expect(page.locator("#bridge-wood")).toHaveText("6 / 6", {
  332 |       timeout: 85_000,
  333 |     });
  334 |     await expect(page.locator("#bridge-stone")).toHaveText("2 / 2");
  335 |     await shoot(page, "phase3-npc-delivered");
  336 |     await expect(stage).toHaveAttribute("data-cenyan-activity", "working");
  337 |     await expect
  338 |       .poll(() =>
  339 |         page
  340 |           .locator("#progress")
  341 |           .evaluate((element: HTMLProgressElement) => element.value),
  342 |       )
  343 |       .toBeGreaterThan(0);
  344 |     await shoot(page, "phase3-npc-building");
  345 |     await expect(page.locator("#percent")).toHaveText("100%", {
  346 |       timeout: 20_000,
  347 |     });
  348 |     await expect(page.locator("#objective")).toHaveText("查看航标遗迹");
  349 |     await expect(page.locator("[data-item=stone]")).toHaveText("0");
  350 |     await expect(page.locator("#cenyan-memory")).toContainText("旧桥已修通");
  351 |     await shoot(page, "phase3-npc-bridge-restored");
```