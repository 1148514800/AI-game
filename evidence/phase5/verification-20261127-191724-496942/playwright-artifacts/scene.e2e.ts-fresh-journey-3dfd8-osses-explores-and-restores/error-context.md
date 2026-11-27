# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scene.e2e.ts >> fresh journey collects all materials, repairs, crosses, explores and restores
- Location: tests/scene.e2e.ts:155:1

# Error details

```
Error: No walkable route from current position
```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - banner [ref=f1e3]:
    - generic [ref=f1e6]:
      - heading "雾海行纪" [level=1] [ref=f1e7]
      - paragraph [ref=f1e8]: 雾灯谷
    - generic [ref=f1e9]:
      - status [ref=f1e10]: 本地存档已连接
      - button "音乐关" [ref=f1e11] [cursor=pointer]
      - button "暂停" [ref=f1e12] [cursor=pointer]
  - main [ref=f1e13]:
    - region "雾灯谷场景" [ref=f1e14]:
      - generic [ref=f1e15]:
        - generic [ref=f1e16]:
          - heading "航标遗迹" [level=2] [ref=f1e18]
          - time [ref=f1e19]: 第 1 天 · 早晨 07:32
        - button "全谷地图" [ref=f1e20] [cursor=pointer]
      - generic "游戏场景，方向键或 WASD 移动，E 交互" [ref=f1e22]
      - generic [ref=f1e24]:
        - generic [ref=f1e26]:
          - strong [ref=f1e27]: 测绘残页
          - paragraph [ref=f1e28]: 残页写着：旧航道曾连接雾灯谷与北方聚落。雾潮升起时，巡灯人会在这里等待信号。
        - button "探索测绘残页 E" [ref=f1e30] [cursor=pointer]:
          - text: 探索测绘残页
          - generic [ref=f1e31]: E
      - generic [ref=f1e32]:
        - generic [ref=f1e33]:
          - generic [ref=f1e34]: W
          - generic [ref=f1e35]: A
          - generic [ref=f1e36]: S
          - generic [ref=f1e37]: D
          - text: 或方向键 移动
        - generic [ref=f1e38]:
          - generic [ref=f1e39]: E
          - text: 交互
        - generic [ref=f1e40]:
          - generic [ref=f1e41]: Esc
          - text: 暂停
        - button "音效开" [pressed] [ref=f1e42] [cursor=pointer]
    - complementary "旅人手记" [ref=f1e43]:
      - generic [ref=f1e44]:
        - generic [ref=f1e47]:
          - paragraph [ref=f1e48]: 当前目标
          - heading "已找到航标" [level=2] [ref=f1e49]
        - paragraph [ref=f1e50]: 航标线索已收入手记。你可以继续探索、建设或观察居民的生活。
        - generic [ref=f1e51]:
          - generic [ref=f1e52]: 已交木材
          - strong [ref=f1e53]: 6 / 6
        - generic [ref=f1e54]:
          - generic [ref=f1e55]: 已交石材
          - strong [ref=f1e56]: 2 / 2
        - generic [ref=f1e57]:
          - generic [ref=f1e58]: 施工进度
          - strong [ref=f1e59]: 100%
        - progressbar "施工进度" [ref=f1e60]: 0%
        - paragraph [ref=f1e61]: 旅人 · 木材 6 · 石材 2 · 施工 14.00 秒
        - paragraph [ref=f1e62]: 岑砚 · 木材 0 · 石材 0 · 施工 0.00 秒
      - region "建设与探索" [ref=f1e63]:
        - heading "建设与探索" [level=2] [ref=f1e64]
        - paragraph [ref=f1e65]: 岑砚的屋顶 · 木材 0 / 2 · 施工 0%
        - paragraph [ref=f1e66]: 公共营地 · 食物 0 / 2
        - paragraph [ref=f1e67]: 东岸线索 3 / 3
        - list [ref=f1e68]:
          - listitem [ref=f1e69]: 航标遗迹 · 风化的石面留下一行浅刻：雾潮平息时，沿三盏航灯向北。你把星纹拓进了行囊。
          - listitem [ref=f1e70]: 星纹石碑 · 石碑上刻着三盏航灯。中间的灯指向北方，另外两盏标出退潮后可走的浅滩。
          - listitem [ref=f1e71]: 测绘残页 · 残页写着：旧航道曾连接雾灯谷与北方聚落。雾潮升起时，巡灯人会在这里等待信号。
        - paragraph [ref=f1e72]: 木匠工坊可修屋顶。聚落南边的营地收食物。桥东有航标和两处线索。
      - generic [ref=f1e73]:
        - heading "背包" [level=2] [ref=f1e74]
        - list "物品栏" [ref=f1e75]:
          - listitem [ref=f1e76]:
            - generic [ref=f1e77]: 木材
            - strong [ref=f1e78]: "0"
          - listitem [ref=f1e79]:
            - generic [ref=f1e80]: 石材
            - strong [ref=f1e81]: "0"
          - listitem [ref=f1e82]:
            - generic [ref=f1e83]: 食物
            - strong [ref=f1e84]: "0"
          - listitem [ref=f1e85]:
            - generic [ref=f1e86]: 工具箱
            - strong [ref=f1e87]: "0"
      - generic [ref=f1e88]:
        - heading "谷中居民" [level=2] [ref=f1e89]
        - list [ref=f1e90]:
          - listitem [ref=f1e91]:
            - strong [ref=f1e93]: 岑砚
            - generic [ref=f1e94]: 木匠
          - listitem [ref=f1e95]:
            - strong [ref=f1e97]: 阿禾
            - generic [ref=f1e98]: 采集者
          - listitem [ref=f1e99]:
            - strong [ref=f1e101]: 洛舟
            - generic [ref=f1e102]: 探路人
        - paragraph [ref=f1e103]: 岑砚 · 空闲
        - paragraph [ref=f1e104]: 阿禾 · 空闲
        - paragraph [ref=f1e105]: 洛舟 · 空闲
        - group [ref=f1e106]:
          - generic "AI Debug" [ref=f1e107] [cursor=pointer]
          - option "岑砚" [selected]
          - option "阿禾"
          - option "洛舟"
      - generic [ref=f1e108]:
        - heading "谷中近况" [level=2] [ref=f1e109]
        - list [ref=f1e110]:
          - listitem [ref=f1e111]: 旅人发现了测绘残页的线索。
          - listitem [ref=f1e112]: 旅人发现了星纹石碑的线索。
          - listitem [ref=f1e113]: 旅人发现了航标遗迹的线索。
          - listitem [ref=f1e114]: 公共告示：旧桥已修通。
        - list
      - generic [ref=f1e115]:
        - generic [ref=f1e116]: 本地自动存档
        - button "重开旅程" [ref=f1e117] [cursor=pointer]
```

# Test source

```ts
  1   | import {
  2   |   distance,
  3   |   isPassable,
  4   |   speed,
  5   |   tickMs,
  6   |   type Point,
  7   | } from "../src/shared/world.js";
  8   | import { canApproach } from "../src/server/path.js";
  9   | 
  10  | type Stop = Point & { axis: "x" | "y" };
  11  | const grid = 8;
  12  | const keyboardStep = (speed * tickMs) / 1000;
  13  | const cardinal = [
  14  |   [1, 0],
  15  |   [-1, 0],
  16  |   [0, 1],
  17  |   [0, -1],
  18  | ];
  19  | 
  20  | export function route(
  21  |   start: Point,
  22  |   reached: (point: Point) => boolean,
  23  |   repaired: boolean,
  24  |   occupants: Point[] = [],
  25  | ): Stop[] {
  26  |   const stops = search(start, reached, repaired, occupants, grid);
> 27  |   if (!stops) throw Error("No walkable route from current position");
      |                     ^ Error: No walkable route from current position
  28  |   return stops;
  29  | }
  30  | 
  31  | export function findKeyboardRoute(
  32  |   start: Point,
  33  |   reached: (point: Point) => boolean,
  34  |   repaired: boolean,
  35  |   occupants: Point[],
  36  | ): Stop[] | undefined {
  37  |   // Prefer room for keyboard release and turns. Near a wall even the finer
  38  |   // grid can need to start with a step that uses the actual collision limits.
  39  |   return (
  40  |     search(start, reached, repaired, occupants, grid) ??
  41  |     search(start, reached, repaired, occupants, keyboardStep) ??
  42  |     search(start, reached, repaired, occupants, keyboardStep, false)
  43  |   );
  44  | }
  45  | 
  46  | function search(
  47  |   start: Point,
  48  |   reached: (point: Point) => boolean,
  49  |   repaired: boolean,
  50  |   occupants: Point[],
  51  |   stride: number,
  52  |   padded = true,
  53  | ): Stop[] | undefined {
  54  |   if (reached(start)) return [];
  55  |   const queue = [{ point: start, parent: -1, axis: "x" as Stop["axis"] }];
  56  |   const visited = new Set(["0,0"]);
  57  |   let found = -1;
  58  |   function clear(point: Point, from: Point) {
  59  |     const { x, y } = point;
  60  |     if (!padded)
  61  |       return (
  62  |         isPassable(x, y, repaired) &&
  63  |         occupants.every((other) => canApproach(from, point, other))
  64  |       );
  65  |     return (
  66  |       occupants.every((other) => distance(point, other) >= 14) &&
  67  |       isPassable(x - 3, y - 3, repaired) &&
  68  |       isPassable(x + 3, y + 3, repaired) &&
  69  |       isPassable(x + 3, y - 3, repaired) &&
  70  |       isPassable(x - 3, y + 3, repaired)
  71  |     );
  72  |   }
  73  |   for (let i = 0; i < queue.length; i++) {
  74  |     const { point } = queue[i];
  75  |     if (reached(point)) {
  76  |       found = i;
  77  |       break;
  78  |     }
  79  |     for (const [dx, dy] of cardinal) {
  80  |       const next = { x: point.x + dx * stride, y: point.y + dy * stride };
  81  |       const middle = {
  82  |         x: point.x + (dx * stride) / 2,
  83  |         y: point.y + (dy * stride) / 2,
  84  |       };
  85  |       // Lattice indices stay stable when the start is a fractional server position.
  86  |       const key = `${Math.round((next.x - start.x) / stride)},${Math.round((next.y - start.y) / stride)}`;
  87  |       if (visited.has(key) || !clear(middle, point) || !clear(next, middle))
  88  |         continue;
  89  |       visited.add(key);
  90  |       queue.push({ point: next, parent: i, axis: dx ? "x" : "y" });
  91  |     }
  92  |   }
  93  |   if (found < 0) return;
  94  |   const steps: Stop[] = [];
  95  |   for (let i = found; queue[i].parent >= 0; i = queue[i].parent) {
  96  |     const { point, axis } = queue[i];
  97  |     if (steps.at(-1)?.axis !== axis) steps.push({ ...point, axis });
  98  |   }
  99  |   return steps.reverse();
  100 | }
  101 | 
```