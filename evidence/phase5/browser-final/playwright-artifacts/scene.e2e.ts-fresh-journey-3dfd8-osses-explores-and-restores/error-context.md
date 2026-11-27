# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scene.e2e.ts >> fresh journey collects all materials, repairs, crosses, explores and restores
- Location: tests/scene.e2e.ts:162:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('[data-item="wood"]')
Expected: "1"
Received: "0"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" locator('[data-item="wood"]') with timeout 5000ms
  - waiting for locator('[data-item="wood"]')
    14 × locator resolved to <strong data-item="wood">0</strong>
       - unexpected value "0"

```

```yaml
- strong: "0"
```

# Test source

```ts
  285 |   restarting = true;
  286 |   await backend.stop();
  287 |   await expect(page.locator("#game")).toHaveAttribute("data-ready", "false");
  288 |   await expect(page.locator("#screen-detail")).toContainText(/重试|恢复/);
  289 |   await backend.start();
  290 |   await ready(page);
  291 |   const persisted = await progress(page);
  292 |   expect(persisted).toBeGreaterThan(9);
  293 |   expect(persisted).toBeLessThan(50);
  294 |   await expect(page.locator("#bridge-wood")).toHaveText("6 / 6");
  295 |   await expect(page.locator("#game")).toHaveAttribute("data-working", "false");
  296 |   await page.getByRole("button", { name: "开始施工" }).click();
  297 |   await expect(page.locator("#objective")).toHaveText("查看航标遗迹", {
  298 |     timeout: 20000,
  299 |   });
  300 |   expect(await progress(page)).toBe(100);
  301 |   await checkpoint("旧桥修通");
  302 |   await screenshot(page, "bridge-after");
  303 | 
  304 |   await approach(page, valley.ruin, true);
  305 |   expect((await position(page)).x).toBeGreaterThan(600);
  306 |   await page.getByRole("button", { name: "查看航标" }).click();
  307 |   await expect(page.locator("#objective")).toHaveText("已找到航标");
  308 |   await expect(page.locator("#feedback")).toHaveText(valley.ruin.clue);
  309 |   await screenshot(page, "beacon-ruin");
  310 |   for (const clue of clues.slice(1)) {
  311 |     await approach(page, clue, true);
  312 |     await page.keyboard.press("e");
  313 |     await expect(page.locator("#expedition-clues")).toContainText(clue.name);
  314 |   }
  315 |   await expect(page.locator("#expedition-status")).toHaveText("东岸线索 3 / 3");
  316 |   await checkpoint("三条线索记入手记");
  317 |   await screenshot(page, "phase5-east-bank-clues");
  318 | 
  319 |   // Complete both local projects in the same journey without asking residents.
  320 |   await approach(page, resources.get("workshop-toolbox")!, true);
  321 |   await page.keyboard.press("e");
  322 |   await expect(bag(page, "toolbox")).toHaveText("1");
  323 |   for (const [index, resource] of valley.resources.slice(0, 2).entries()) {
  324 |     await approach(page, resource, true);
  325 |     await page.keyboard.press("e");
  326 |     await expect(bag(page, "wood")).toHaveText(String(index + 1));
  327 |   }
  328 |   const roof = projects.get("carpenter-roof")!;
  329 |   await approach(page, roof, true);
  330 |   await screenshot(page, "phase5-roof-before");
  331 |   await page.keyboard.press("e");
  332 |   await expect(page.locator("#carpenter-roof-status")).toContainText(
  333 |     "木材 2 / 2",
  334 |   );
  335 |   await page.keyboard.press("e");
  336 |   await expect(page.locator("#carpenter-roof-status")).toContainText("已完成", {
  337 |     timeout: 8500,
  338 |   });
  339 |   await expect(bag(page, "toolbox")).toHaveText("1");
  340 |   await screenshot(page, "phase5-roof-complete");
  341 |   await checkpoint("屋顶修缮完成");
  342 |   const camp = projects.get("valley-camp")!;
  343 |   for (const berry of ["berry-west", "berry-south"]) {
  344 |     await approach(page, resources.get(berry)!, true);
  345 |     await page.keyboard.press("e");
  346 |     await expect(bag(page, "food")).toHaveText("1");
  347 |     await approach(page, camp, true);
  348 |     await page.keyboard.press("e");
  349 |     await expect(bag(page, "food")).toHaveText("0");
  350 |   }
  351 |   await expect(page.locator("#valley-camp-status")).toContainText(
  352 |     "食物 2 / 2 · 已完成",
  353 |   );
  354 |   await screenshot(page, "phase5-camp-complete");
  355 |   await checkpoint("公共营地储备达标");
  356 |   await page.locator("#pause").click();
  357 |   await expect(page.locator("#pause")).toHaveText("继续");
  358 |   await page.waitForTimeout(200);
  359 |   const heldTime = await page.locator("#valley-time").innerText();
  360 |   await page.waitForTimeout(1200);
  361 |   await expect(page.locator("#valley-time")).toHaveText(heldTime);
  362 |   await backend.stop();
  363 |   await backend.start();
  364 |   await ready(page);
  365 |   await expect(page.locator("#carpenter-roof-status")).toContainText("已完成");
  366 |   await expect(page.locator("#valley-camp-status")).toContainText("食物 2 / 2");
  367 |   await expect(page.locator("#expedition-status")).toHaveText("东岸线索 3 / 3");
  368 |   await expect(page.locator("#valley-time")).toContainText("第 1 天");
  369 |   const end = await position(page);
  370 |   await page.reload();
  371 |   await ready(page);
  372 |   await expect(page.locator("#objective")).toHaveText("雾灯谷阶段成果");
  373 |   expect(distance(await position(page), end)).toBeLessThan(1);
  374 |   await backend.stop();
  375 |   await expect(page.locator("#game")).toHaveAttribute("data-ready", "false");
  376 |   await backend.start();
  377 |   await ready(page);
  378 |   await expect(page.locator("#objective")).toHaveText("雾灯谷阶段成果");
  379 |   await expect(page.locator("#progress")).toHaveJSProperty("value", 100);
  380 |   expect(distance(await position(page), end)).toBeLessThan(1);
  381 |   await checkpoint("重启后恢复进度");
  382 | 
  383 |   await approach(page, valley.resources[0], true);
  384 |   await page.keyboard.press("e");
> 385 |   await expect(bag(page, "wood")).toHaveText("1");
      |                                   ^ Error: expect(locator).toHaveText(expected) failed
  386 |   await expect(page.locator("#objective")).toHaveText("雾灯谷阶段成果");
  387 |   await checkpoint("阶段成果后继续采集");
  388 |   writeFileSync(
  389 |     join(evidence, "phase5-player-journey.json"),
  390 |     JSON.stringify(journey, undefined, 2) + "\n",
  391 |   );
  392 | 
  393 |   await page.getByRole("button", { name: "重开旅程" }).click();
  394 |   await page.getByRole("button", { name: "继续当前旅程" }).click();
  395 |   await expect(page.locator("#objective")).toHaveText("雾灯谷阶段成果");
  396 |   await page.getByRole("button", { name: "重开旅程" }).click();
  397 |   await page.getByRole("button", { name: "确认重开" }).click();
  398 |   await expect(page.locator("#objective")).toHaveText("修复雾灯旧桥");
  399 |   await expect(page.locator("#progress")).toHaveJSProperty("value", 0);
  400 |   expect(distance(await position(page), valley.spawn)).toBeLessThan(1);
  401 |   expect(errors).toEqual([]);
  402 |   expect(initialMissing).toEqual([]);
  403 |   expect(external).toEqual([]);
  404 | });
  405 | 
  406 | test("four-way walk frames, pause, a following camera and opt-in music", async ({
  407 |   page,
  408 | }) => {
  409 |   await page.goto("/");
  410 |   await ready(page);
  411 |   const stage = page.locator("#game");
  412 |   // Use a real reachable open plaza, not the tree beside the spawn. Frequent
  413 |   // observation prevents the test itself holding a key into a distant obstacle.
  414 |   await walk(page, (point) => distance(point, { x: 208, y: 376 }) <= 4);
  415 |   for (const [key, axis, sign, facing, column] of [
  416 |     ["d", "x", 1, "right", 3],
  417 |     ["s", "y", 1, "down", 0],
  418 |     ["a", "x", -1, "left", 2],
  419 |     ["w", "y", -1, "up", 1],
  420 |   ] as const) {
  421 |     const before = (await position(page))[axis];
  422 |     await page.keyboard.down(key);
  423 |     try {
  424 |       await expect
  425 |         .poll(async () => ((await position(page))[axis] - before) * sign, {
  426 |           intervals: [16, 25, 50],
  427 |         })
  428 |         .toBeGreaterThan(12);
  429 |       await expect(stage).toHaveAttribute("data-direction", facing);
  430 |       await expect(stage).toHaveAttribute("data-moving", "true");
  431 |       const frame = Number(await stage.getAttribute("data-frame"));
  432 |       expect(frame % 4).toBe(column);
  433 |       await expect
  434 |         .poll(async () => Number(await stage.getAttribute("data-frame")), {
  435 |           intervals: [16, 25, 50],
  436 |         })
  437 |         .not.toBe(frame);
  438 |     } finally {
  439 |       await page.keyboard.up(key);
  440 |     }
  441 |     await waitStill(page);
  442 |     await expect(stage).toHaveAttribute("data-frame", String(column));
  443 |   }
  444 |   await page.keyboard.press("Escape");
  445 |   await expect(page.locator("#screen-title")).toHaveText("旅程暂停");
  446 |   const paused = await position(page);
  447 |   await page.keyboard.down("d");
  448 |   await page.waitForTimeout(250);
  449 |   await page.keyboard.up("d");
  450 |   expect(await position(page)).toEqual(paused);
  451 |   await page.keyboard.press("Escape");
  452 |   await approach(page, valley.bridge);
  453 |   await expect
  454 |     .poll(async () => Number(await stage.getAttribute("data-camera-x")))
  455 |     .toBeGreaterThan(100);
  456 |   const cameraX = Number(await stage.getAttribute("data-camera-x"));
  457 |   const viewWidth = await page
  458 |     .locator("canvas")
  459 |     .evaluate((element: HTMLCanvasElement) => element.width);
  460 |   expect(cameraX + viewWidth).toBeLessThanOrEqual(mapWidth + 1);
  461 |   await page.getByRole("button", { name: "音乐关" }).click();
  462 |   await expect(page.getByRole("button", { name: "音乐开" })).toHaveAttribute(
  463 |     "aria-pressed",
  464 |     "true",
  465 |   );
  466 |   await page.getByRole("button", { name: "音乐开" }).click();
  467 |   await expect(page.getByRole("button", { name: "音乐关" })).toHaveAttribute(
  468 |     "aria-pressed",
  469 |     "false",
  470 |   );
  471 | });
  472 | 
  473 | test("390px narrow window renders the scene, residents and touch controls", async ({
  474 |   browser,
  475 |   baseURL,
  476 | }) => {
  477 |   const context = await browser.newContext({
  478 |     baseURL,
  479 |     viewport: { width: 390, height: 844 },
  480 |     isMobile: true,
  481 |     hasTouch: true,
  482 |   });
  483 |   try {
  484 |     const page = await context.newPage();
  485 |     await page.goto("/");
```