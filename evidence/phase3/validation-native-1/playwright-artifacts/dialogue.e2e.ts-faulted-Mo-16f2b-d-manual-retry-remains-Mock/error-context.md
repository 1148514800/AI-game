# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dialogue.e2e.ts >> faulted Mock >> timeout is visible and manual retry remains Mock
- Location: tests/dialogue.e2e.ts:222:3

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
  1   | import { test as base, expect, type Page } from "@playwright/test";
  2   | import { spawn } from "node:child_process";
  3   | import { once } from "node:events";
  4   | import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
  5   | import { tmpdir } from "node:os";
  6   | import { join } from "node:path";
  7   | 
  8   | const evidence = process.env.MISTSEA_EVIDENCE ?? "evidence/phase3";
  9   | const url = "http://127.0.0.1:5174";
  10  | const test = base.extend<{
  11  |   mockEnv: Record<string, string>;
  12  |   gameBackend: void;
  13  | }>({
  14  |   mockEnv: [{ LLM_MOCK_DELAY_MS: "1700" }, { option: true }],
  15  |   gameBackend: [
  16  |     async ({ mockEnv }, use, info) => {
  17  |       mkdirSync(evidence, { recursive: true });
  18  |       const dir = mkdtempSync(join(tmpdir(), "mistsea-dialogue-browser-"));
  19  |       const log = openSync(
  20  |         join(evidence, `dialogue-server-${info.line}.log`),
  21  |         "w",
  22  |       );
  23  |       const child = spawn(
  24  |         process.execPath,
  25  |         ["--import", "tsx", "src/server/index.ts"],
  26  |         {
  27  |           env: {
  28  |             PATH: process.env.PATH,
  29  |             ...mockEnv,
  30  |             LLM_ENABLED: "false",
  31  |             HOST: "127.0.0.1",
  32  |             PORT: "3003",
  33  |             MISTSEA_SAVE: join(dir, "world.sqlite"),
  34  |           },
  35  |           stdio: ["ignore", log, log],
  36  |         },
  37  |       );
  38  |       try {
  39  |         await expect
  40  |           .poll(
  41  |             async () => {
  42  |               if (child.exitCode !== null)
  43  |                 throw Error(`Backend exited ${child.exitCode}`);
  44  |               const response = await fetch("http://127.0.0.1:3003/health", {
  45  |                 signal: AbortSignal.timeout(400),
  46  |               }).catch(() => null);
  47  |               return response?.status;
  48  |             },
  49  |             { timeout: 8000 },
  50  |           )
  51  |           .toBe(200);
  52  |         await use();
  53  |       } finally {
  54  |         if (child.exitCode === null && child.signalCode === null) {
  55  |           const done = once(child, "close");
  56  |           child.kill("SIGTERM");
  57  |           await done;
  58  |         }
  59  |         closeSync(log);
  60  |         rmSync(dir, { recursive: true, force: true });
  61  |       }
  62  |     },
  63  |     { auto: true },
  64  |   ],
  65  | });
  66  | 
  67  | // Persist the browser trace for the Phase 3 visual journey, including successful runs.
  68  | test.use({ trace: "on" });
  69  | 
  70  | const panel = (page: Page) => page.getByRole("dialog", { name: "岑砚" });
  71  | const input = (page: Page) => page.getByRole("textbox", { name: "对岑砚说" });
  72  | const chat = (page: Page) => page.getByRole("log");
  73  | const shoot = (page: Page, name: string) =>
  74  |   page.screenshot({ path: join(evidence, `${name}.png`) });
  75  | 
  76  | async function approach(page: Page) {
  77  |   const stage = page.locator("#game");
> 78  |   await expect(stage).toHaveAttribute("data-ready", "true");
      |                       ^ Error: expect(locator).toHaveAttribute(expected) failed
  79  |   await expect(panel(page)).toBeHidden();
  80  |   for (const [key, axis, sign, target] of [
  81  |     ["d", "x", 1, 247],
  82  |     ["w", "y", -1, 321],
  83  |   ] as const) {
  84  |     await page.keyboard.down(key);
  85  |     try {
  86  |       await page.waitForFunction(
  87  |         ({ axis, sign, target }) =>
  88  |           (Number(document.querySelector<HTMLElement>("#game")!.dataset[axis]) -
  89  |             target) *
  90  |             sign >=
  91  |           0,
  92  |         { axis, sign, target },
  93  |         { timeout: 3500 },
  94  |       );
  95  |     } finally {
  96  |       await page.keyboard.up(key);
  97  |     }
  98  |     await expect(stage).toHaveAttribute("data-moving", "false");
  99  |   }
  100 |   await expect(page.locator("#target")).toHaveText("岑砚");
  101 | }
  102 | 
  103 | test("ordinary E opens offline dialogue, handles candidate Enter, exchanges safe Chinese text and keeps rendering", async ({
  104 |   page,
  105 | }) => {
  106 |   await page.goto(url);
  107 |   await approach(page);
  108 |   await page.keyboard.press("e");
  109 |   await expect(panel(page)).toBeVisible();
  110 |   await expect(page.locator("#dialogue-mode")).toHaveText("模拟对话 · Mock");
  111 |   await shoot(page, "dialogue");
  112 |   const stage = page.locator("#game");
  113 |   await input(page).pressSequentially("wasde");
  114 |   await expect(input(page)).toHaveValue("wasde");
  115 |   await expect(stage).toHaveAttribute("data-moving", "false");
  116 | 
  117 |   await input(page).fill("我想看看漏雨的屋顶 <img src=x onerror=alert(1)>");
  118 |   await input(page).dispatchEvent("compositionstart");
  119 |   await input(page).press("Enter");
  120 |   await expect(chat(page).locator("p")).toHaveCount(0);
  121 |   await input(page).evaluate((el) => {
  122 |     el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  123 |     el.dispatchEvent(
  124 |       new KeyboardEvent("keydown", {
  125 |         key: "Enter",
  126 |         bubbles: true,
  127 |         cancelable: true,
  128 |       }),
  129 |     );
  130 |   });
  131 |   await expect(chat(page).locator("p")).toHaveCount(0);
  132 |   await page.waitForTimeout(90);
  133 |   await input(page).press("Enter");
  134 |   await expect(page.locator("#dialogue-pending")).toBeVisible();
  135 |   await shoot(page, "dialogue-thinking");
  136 |   const cameraBefore = await stage.getAttribute("data-camera-x");
  137 |   await page.getByRole("button", { name: "全谷地图" }).click();
  138 |   await expect(stage).not.toHaveAttribute("data-camera-x", cameraBefore!);
  139 |   await expect(stage.locator("canvas")).toBeVisible();
  140 |   await expect(panel(page)).toBeVisible();
  141 |   await expect(chat(page)).toContainText("我家的屋顶漏雨");
  142 |   await page.getByRole("button", { name: "返回场景" }).click();
  143 | 
  144 |   await input(page).fill("刚才我说了什么？");
  145 |   await page.getByRole("button", { name: "发送" }).click();
  146 |   await expect(chat(page).locator("p")).toHaveCount(4);
  147 |   await expect(chat(page)).toContainText("你刚才提到");
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
```