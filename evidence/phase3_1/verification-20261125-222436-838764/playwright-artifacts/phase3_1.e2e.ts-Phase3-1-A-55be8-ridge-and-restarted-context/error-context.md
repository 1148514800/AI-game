# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase3_1.e2e.ts >> Phase3.1 A–F normal UI: consent, persisted plan, following, shared bridge and restarted context
- Location: tests/phase3_1.e2e.ts:142:1

# Error details

```
Error: No walkable route from current position
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - generic [ref=e6]:
      - heading "雾海行纪" [level=1] [ref=e7]
      - paragraph [ref=e8]: 雾灯谷
    - generic [ref=e9]:
      - status [ref=e10]: 重连中
      - button "音乐关" [ref=e11] [cursor=pointer]
      - button "暂停" [disabled] [ref=e12]
  - main [ref=e13]:
    - region "雾灯谷场景" [ref=e14]:
      - generic [ref=e15]:
        - heading "南坡岩场" [level=2] [ref=e18]
        - button "全谷地图" [disabled] [ref=e19]
      - generic [ref=e20]:
        - generic "游戏场景，方向键或 WASD 移动，E 交互" [active] [ref=e21]
        - status [ref=e23]:
          - strong [ref=e24]: 正在重连雾灯谷
          - generic [ref=e25]: 与雾灯谷失去连接，正在恢复存档。
          - button "重试连接" [ref=e26] [cursor=pointer]
      - generic [ref=e27]:
        - generic [ref=e29]:
          - strong [ref=e30]: 岑砚
          - paragraph [ref=e31]: 修得慢一点也好。答应修好的桥，得经得住下一次雾潮。
        - button "与岑砚交谈 E" [disabled] [ref=e33]:
          - text: 与岑砚交谈
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
        - button "结束同行" [ref=e45] [cursor=pointer]
        - button "音效开" [pressed] [ref=e46] [cursor=pointer]
    - complementary "旅人手记" [ref=e47]:
      - generic [ref=e48]:
        - generic [ref=e51]:
          - paragraph [ref=e52]: 当前目标
          - heading "修复雾灯旧桥" [level=2] [ref=e53]
        - paragraph [ref=e54]: 向东走到河边，查看雾灯旧桥。
        - generic [ref=e55]:
          - generic [ref=e56]: 已交木材
          - strong [ref=e57]: 0 / 6
        - generic [ref=e58]:
          - generic [ref=e59]: 已交石材
          - strong [ref=e60]: 0 / 2
        - generic [ref=e61]:
          - generic [ref=e62]: 施工进度
          - strong [ref=e63]: 0%
        - progressbar "施工进度" [ref=e64]: 0%
        - paragraph [ref=e65]: 旅人 · 木材 0 · 石材 0 · 施工 0.00 秒
        - paragraph [ref=e66]: 岑砚 · 木材 0 · 石材 0 · 施工 0.00 秒
      - generic [ref=e67]:
        - heading "背包" [level=2] [ref=e68]
        - list "物品栏" [ref=e69]:
          - listitem [ref=e70]:
            - generic [ref=e71]: 木材
            - strong [ref=e72]: "4"
          - listitem [ref=e73]:
            - generic [ref=e74]: 石材
            - strong [ref=e75]: "0"
          - listitem [ref=e76]:
            - generic [ref=e77]: 食物
            - strong [ref=e78]: "0"
          - listitem [ref=e79]:
            - generic [ref=e80]: 工具箱
            - strong [ref=e81]: "0"
      - generic [ref=e82]:
        - heading "谷中居民" [level=2] [ref=e83]
        - list [ref=e84]:
          - listitem [ref=e85]:
            - strong [ref=e87]: 岑砚
            - generic [ref=e88]: 木匠
          - listitem [ref=e89]:
            - strong [ref=e91]: 阿禾
            - generic [ref=e92]: 采集者
          - listitem [ref=e93]:
            - strong [ref=e95]: 洛舟
            - generic [ref=e96]: 探路人
        - paragraph [ref=e97]: 岑砚 · 等待连接
        - group [ref=e98]:
          - generic "AI Debug" [ref=e99] [cursor=pointer]
          - generic [ref=e100]:
            - term [ref=e101]: 目标
            - definition [ref=e102]: 跟旅人走到桥边
            - term [ref=e103]: 行动
            - definition [ref=e104]: 1. 跟随 旅人（当前）
            - term [ref=e105]: 待执行
            - definition [ref=e106]: 暂无
            - term [ref=e107]: 最近决策
            - definition [ref=e108]:
              - generic [ref=e109]: "{ \"id\": \"61fa1cfe-0ede-4886-88d4-f5ff372b548b\", \"goal\": \"跟旅人走到桥边\", \"speech\": \"好，我跟你到桥边。\", \"policy\": \"replace\", \"steps\": [ { \"type\": \"follow\", \"target_id\": \"player\" } ], \"status\": \"accepted\" }"
            - term [ref=e110]: 岑砚的背包
            - definition [ref=e111]: 木材 2 · 石材 2
            - term [ref=e112]: 规则回执
            - definition [ref=e113]: 从河谷岩簇获得 石材 ×1，已放入背包。
            - term [ref=e114]: 调用
            - definition [ref=e115]: Mock 模拟 · 自主关闭 · 旅人请求 · ok · 96 ms · 计入 8185 Token · 累计 11 次 / 89250 Token
          - paragraph [ref=e116]: ARRIVED · 抵达河谷岩簇附近。 COLLECTED · 从河谷岩簇获得 石材 ×1，已放入背包。
          - heading "近期重要记忆" [level=3] [ref=e117]
          - list [ref=e118]:
            - listitem [ref=e119]: 规则事实 · 改为目标：跟旅人走到桥边
            - listitem [ref=e120]: 岑砚观点 · 好，我跟你到桥边。
            - listitem [ref=e121]: 旅人声称 · 我们一起去桥边吧。
            - listitem [ref=e122]: 规则事实 · 从河谷岩簇获得 石材 ×1，已放入背包。
            - listitem [ref=e123]: 规则事实 · 抵达河谷岩簇附近。
            - listitem [ref=e124]: 规则事实 · 改为目标：采第二份石料
      - generic [ref=e125]:
        - generic [ref=e126]: 等待本地存档
        - button "重开旅程" [disabled] [ref=e127]
```

# Test source

```ts
  1  | import { distance, isPassable, type Point } from "../src/shared/world.js";
  2  | 
  3  | type Stop = Point & { axis: "x" | "y" };
  4  | const grid = 8;
  5  | const cardinal = [
  6  |   [1, 0],
  7  |   [-1, 0],
  8  |   [0, 1],
  9  |   [0, -1],
  10 | ];
  11 | 
  12 | export function route(
  13 |   start: Point,
  14 |   reached: (point: Point) => boolean,
  15 |   repaired: boolean,
  16 |   occupants: Point[] = [],
  17 | ): Stop[] {
  18 |   if (reached(start)) return [];
  19 |   const queue = [{ point: start, parent: -1, axis: "x" as Stop["axis"] }];
  20 |   const visited = new Set(["0,0"]);
  21 |   let found = -1;
  22 |   function clear(x: number, y: number) {
  23 |     return (
  24 |       occupants.every((other) => distance({ x, y }, other) >= 14) &&
  25 |       isPassable(x - 3, y - 3, repaired) &&
  26 |       isPassable(x + 3, y + 3, repaired) &&
  27 |       isPassable(x + 3, y - 3, repaired) &&
  28 |       isPassable(x - 3, y + 3, repaired)
  29 |     );
  30 |   }
  31 |   for (let i = 0; i < queue.length; i++) {
  32 |     const { point } = queue[i];
  33 |     if (reached(point)) {
  34 |       found = i;
  35 |       break;
  36 |     }
  37 |     for (const [dx, dy] of cardinal) {
  38 |       const next = { x: point.x + dx * grid, y: point.y + dy * grid };
  39 |       // Lattice indices stay stable when the start is a fractional server position.
  40 |       const key = `${Math.round((next.x - start.x) / grid)},${Math.round((next.y - start.y) / grid)}`;
  41 |       if (
  42 |         visited.has(key) ||
  43 |         !clear(next.x, next.y) ||
  44 |         !clear(point.x + dx * 4, point.y + dy * 4)
  45 |       )
  46 |         continue;
  47 |       visited.add(key);
  48 |       queue.push({ point: next, parent: i, axis: dx ? "x" : "y" });
  49 |     }
  50 |   }
> 51 |   if (found < 0) throw Error("No walkable route from current position");
     |                        ^ Error: No walkable route from current position
  52 |   const steps: Stop[] = [];
  53 |   for (let i = found; queue[i].parent >= 0; i = queue[i].parent) {
  54 |     const { point, axis } = queue[i];
  55 |     if (steps.at(-1)?.axis !== axis) steps.push({ ...point, axis });
  56 |   }
  57 |   return steps.reverse();
  58 | }
  59 | 
```