import { test, expect } from "@playwright/test";
test("real scene assets, animation, four-way movement, pause, bounds and local networking", async ({
  page,
}) => {
  const errors: string[] = [];
  const missing: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400) missing.push(r.url());
  });
  page.on("request", (r) => {
    if (
      new URL(r.url()).origin !== "http://127.0.0.1:5173" &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__PHASE0__?.ready);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("#asset-status")).toHaveText("13 / 13 已就绪");
  await expect(page.locator("#service-status")).toContainText("就绪");
  expect(
    await page
      .locator("canvas")
      .evaluate((e) => getComputedStyle(e).imageRendering),
  ).toMatch(/pixelated|crisp-edges/);
  const colorCount = await page.locator("canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    for (let i = 0; i < pixels.length; i += 4)
      colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return colors.size;
  });
  expect(colorCount).toBeGreaterThan(32);
  await page.screenshot({ path: "evidence/scene-desktop.png", fullPage: true });
  for (const [key, axis, sign, direction] of [
    ["d", "x", 1, "right"],
    ["s", "y", 1, "down"],
    ["a", "x", -1, "left"],
    ["w", "y", -1, "up"],
  ] as const) {
    const before = await page.evaluate(() => ({ ...window.__PHASE0__ }));
    await page.keyboard.down(key);
    await page.waitForTimeout(350);
    const during = await page.evaluate(() => ({ ...window.__PHASE0__ }));
    expect((during[axis] - before[axis]) * sign).toBeGreaterThan(5);
    expect(during.direction).toBe(direction);
    expect(during.moving).toBe(true);
    const column = { down: 0, up: 1, left: 2, right: 3 }[direction];
    expect([column, column + 4, column + 8, column + 12]).toContain(
      during.animationFrame,
    );
    await page.screenshot({ path: `evidence/animation-${direction}.png` });
    await page.keyboard.up(key);
  }
  const frame = await page.evaluate(() => window.__PHASE0__.npcFrame);
  await expect
    .poll(() => page.evaluate(() => window.__PHASE0__.npcFrame))
    .not.toBe(frame);
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => window.__PHASE0__.paused))
    .toBe(true);
  const before = await page.evaluate(() => window.__PHASE0__.x);
  await page.keyboard.down("d");
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__PHASE0__.x)).toBe(before);
  await page.keyboard.up("d");
  await expect(page.locator("#pause")).toContainText("继续");
  await page.keyboard.press("Escape");
  await page.keyboard.down("d");
  await page.waitForTimeout(3500);
  await page.keyboard.up("d");
  expect(await page.evaluate(() => window.__PHASE0__.x)).toBeLessThanOrEqual(
    312,
  );
  await page.locator("#music").click();
  await expect(page.locator("#music")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#music").click();
  await expect(page.locator("#music")).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(missing).toEqual([]);
  expect(external).toEqual([]);
});
test("narrow window fits without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => window.__PHASE0__?.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("canvas")).toBeVisible();
  await page.screenshot({ path: "evidence/scene-mobile.png", fullPage: true });
});

test("preview house blocks movement at its base", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__PHASE0__?.ready);
  await page.keyboard.down("a");
  await page.waitForTimeout(1450);
  await page.keyboard.up("a");
  const x = await page.evaluate(() => window.__PHASE0__.x);
  expect(x).toBeGreaterThan(50);
  expect(x).toBeLessThan(100);
  await page.keyboard.down("w");
  await page.waitForTimeout(2000);
  await page.keyboard.up("w");
  const y = await page.evaluate(() => window.__PHASE0__.y);
  expect(y).toBeGreaterThanOrEqual(97);
  expect(y).toBeLessThanOrEqual(100);
  await page.screenshot({ path: "evidence/house-collision.png" });
});
