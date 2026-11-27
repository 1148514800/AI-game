# 雾海行纪 · 雾灯谷

旅人从雾灯谷聚落出发。可以帮岑砚修缮漏雨的屋顶、为阿禾的公共营地补给野莓，也可以到渡口修桥，过河寻找三条航标遗迹线索。每项活动都可以单独完成。靠近对象后按 E，工程进度和已发现的线索会显示在手记中。

## 本地启动

需要 Node.js **24+** 和 npm。游戏运行只使用本地服务、SQLite 和随附素材，无需 API Key、数据库服务或 Python。

```bash
npm ci
npm run dev
```

打开 **http://127.0.0.1:5173/**。前端由 Vite 启动，Fastify 在 `127.0.0.1:3001` 提供存档健康检查和 WebSocket。用 Ctrl+C 结束。执行 `npm run build && npm start`，打开 **http://127.0.0.1:3001/**。启动生产版前先结束开发服务，或使用 `PORT=3002 npm start`。

| 操作 | 控制 |
|---|---|
| 移动 | WASD 或方向键。触屏设备可使用场景下方方向按钮 |
| 查看、采集、交材料或施工 | 靠近对象后按 E，或点击场景下方的当前操作 |
| 分批交付 | 桥边选木材或石材及数量，点击「交指定材料」。按 E 的「交付材料」会交当前背包中工程仍缺的材料 |
| 与居民交谈 | 靠近居民后按 E 或使用居民名单上的「交谈」。输入中文，按 Enter 或点击「发送」 |
| 交接物品 | 对话中使用「提议赠送」或展开「交接与约定」，选择请求、交换、出借或指定工程承诺。对方提议时可明确接受或拒绝。借用方到出借方附近主动归还 |
| 同行和合力施工 | 对岑砚说「我们一起去桥边吧。」。他同意后关对话，正常走向旧桥。材料齐备时双方分别开始施工，可用「结束同行」或「暂停施工」操作 |
| 暂停 | Esc 或「暂停」。移动、暂停或断线会停止施工，已完成进度保留。对话内 Esc 关闭对话 |
| 查看全谷 | 点击「全谷地图」。同一按钮返回跟随视角 |
| 音乐与音效 | 音乐默认关，点击按钮启动。场景下方可切换音效 |

## 建设、采集与探索

- **屋顶**在木匠工坊门口，分批交足 2 份木材后开始修缮。每位手持工具箱的施工者增加 25% 工效，工坊旁有一件备用工具，也可向持有者借用。
- **营地**在聚落南侧，附近两处野莓点可以采食物。营地备齐 2 份即达成目标，还可继续补到 4 份。
- **旧桥**需要 6 份木材、2 份石材。修通后可在东岸探索航标、星纹石碑和测绘残页。居民也可自主探索，并与附近角色分享自己发现的线索。
- 游戏一天约为 12 分钟有效活动时间。日期和昼夜显示在地图上方，暂停、离线与重启不会补跑游戏时间。

## 居民的对话、行动与预算

首次启动使用「模拟对话 · Mock」。岑砚为漏雨屋顶备木料，阿禾为聚落备物资并在意分工，洛舟想修通旧桥去看航标。用中文商量时，居民可以继续、接受新计划、暂缓或拒绝。世界继续运行，交谈对象驻足。关闭对话后，已经过规则接受的计划继续执行。桥边可按自己持有的木石分批交材，再各自开始施工。「谷中近况」显示近期公共成果与旅人相关的待回应事项。

在新存档中启用离线自主活动：

```bash
LLM_ENABLED=false LLM_MOCK_AUTONOMY_ENABLED=true npm run dev
```

三名居民可以主动找对方商量、采集、送材料、等料并共同施工。附近对白可见。正式交接须有明确确认和规则回执。赠送和交接的提议有效 90 秒，接受后的承诺有效五分钟。到期取消，共同施工完工、赠送和履约等实际结果会影响有方向的信任。对话中的口头意向可作为下一步商量的内容。

展开「AI Debug」并选择角色可查看该角色的目标、计划、待执行项、背包、近期规则回执、记忆、信任与承诺。对话、记忆与推理任务按角色管理。共享预算按角色、用途、模型和模式记账，每名居民同时最多一个请求，整个世界最多两个请求。旅人对话优先，后台需要显式开启且只在旅程活动时发起请求。

真实供应商配置见 [环境变量模板](.env.example)。只有在获得真实调用授权和专用 Key 后才配置 Live。给 `LLM_ENABLED` 填 `true`，设置 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`。基础地址使用 HTTPS。本地测试桩支持回环 HTTP。服务端追加 `/chat/completions`。可加载自己配置的文件，例如 `node --env-file=.env release/server/src/server/index.js`。默认开发与生产入口读取已导出的变量。Vite 不加载环境文件。

`LLM_AUTONOMY_ENABLED` 默认 `false`。开启 Live 对话后，仍需显式设置该开关才能在后台发起 Live 自主请求。`LLM_JSON_MODE` 默认 `false`，支持的供应商可配置为 `true`，带计划能力的请求随之发送 `response_format: {"type":"json_object"}`。`LLM_ENABLE_THINKING` 留空会省略该字段，`true` / `false` 作为布尔值发送。按供应商配置 `LLM_TOKEN_FIELD`、累计金额上限及输入输出单价。

每份存档旁的 `.llm.sqlite` 账本按 Mock / Live 分账。同一模式的对话和自主共享每分钟、滚动 60 分钟、累计请求量、Token 和 Live 金额限制。自主另有三档请求数上限和角色份额，并给旅人对话保留总预算空间。取消、失败、中断或缺失可信用量保留预留。重开和服务重启均不会重置预算。

Phase 2 的 Live 对话与 Phase 3 的真实 AI 自主思考采集已由用户本人验证。Phase 3.1 完成工程及离线验证。Phase 4 后续的真实模型修桥记录见 [Phase 4 报告](docs/PHASE4_REPORT.md)。Phase 5 真实模型试玩步骤见 [Phase 5 报告](docs/PHASE5_REPORT.md)。

## 单人存档

默认路径是 `saves/foglamp-valley.sqlite`。材料、资源恢复、施工、遗迹、三名居民的计划和重要记忆、信任及约定随行动保存。位置约每五秒检查保存，正常关闭时刷新。v4 首次加载时，先用 SQLite 生成相邻的 `*.pre-phase5.sqlite`，再事务迁移至 v5。v1–v3 仍生成原有命名的备份，直接迁移至 v5。v3 的具名贡献照原样恢复。v1/v2 未记录贡献人的材料和工时显示为「旧档记录」。账本继续沿用。

- 重开时点击「重开旅程」，在确认框选择「确认重开」。
- 如需备份，结束本地服务后复制 SQLite 文件。一同备份关联的 `.llm.sqlite`。可用 `MISTSEA_SAVE` 指向另一份本地存档。
- 如果遇到文件损坏或版本不匹配，界面会显示存档错误。原文件保留，关闭服务后可用备份恢复。
- 同一存档由一个标签页控制。新标签页打开后，旧标签页会提示旅程已切换。

## 验证与构建

```bash
npx playwright install chromium
python3 scripts/verify.py
```

验证脚本执行锁定安装、开发冒烟、类型检查、单元、回环集成、同行性能回归、Playwright、构建、dummy Key 扫描和生产冒烟。日志、退出码和浏览器截图写入 `evidence/phase5/verification-*/`。测试使用隔离的新存档。浏览器场景由正常键盘、对话面板与操作按钮驱动。

```bash
npm run test:e2e -- tests/phase4.e2e.ts
MISTSEA_EVIDENCE=evidence/phase5 npm run soak:phase4
```

长测需要先构建。它使用真实 Chromium 与三个运行中的 Mock 居民，测量不少于 1800 秒活动时间。用 `python3 scripts/verify.py --with-soak` 可将长测纳入同批记录。运行状态和当前环境限制见 [Phase 5 报告](docs/PHASE5_REPORT.md)。

## 数据与素材

| 路径 | 内容 |
|---|---|
| `data/foglamp-valley.json` | 雾灯谷地表、河流、建筑、碰撞、资源、居民、渡口和遗迹 |
| `data/valley-development.json` | 屋顶、营地、野莓、工具箱和新增遗迹对象 |
| `data/animations.json` | 16 像素人物的四向动画映射 |
| `data/npcs/` | 岑砚、阿禾、洛舟的人格、目标、知识和行为边界 |
| `src/client/` | Phaser 场景、键盘和触屏输入、界面与连接反馈 |
| `src/server/` | Fastify、WebSocket、世界规则和 SQLite |
| `src/server/dialogue/` | 人格、会话调度、Chat Completions 与共享预算账本 |
| `src/shared/` | 地图校验逻辑及游戏协议 |
| `assets/manifest.json` | 本地 CC0 素材的逐文件来源、哈希和加工记录 |
| `evidence/phase5/` | 本轮验证与 Phase 4 真实模型补测归档 |
| `evidence/phase4/` | 找回的 Phase 4 Mock 摘要、日志与截图 |

素材重建需要 Python 3 和 `scripts/assets/requirements.txt` 锁定的 Pillow。已有原包时只进行本地哈希校验。正式地图另有独立脚本。

```bash
npm run assets:fetch && npm run assets:prepare
npm run world:generate
```

原素材 ZIP 仅用于重新加工。完整设计基线见 [GAME_DESIGN.md](docs/GAME_DESIGN.md)，原始 29 页 PDF 与 [Phase 0 历史报告](docs/PHASE0_REPORT.md) 一并保留。本轮功能范围见 [Phase 5 执行规格](docs/PHASE5_TASK.md)。

## 已验收阶段

Phase 0、Phase 1 已获用户验收。Phase 2 的离线 25 单元、2 本地 HTTP/WS 集成、10 浏览器及生产冒烟已由原生复核通过。用户随后亲自验证了 Phase 2 的真实模型接入。历史报告和阶段归档分别保留原来的工程证据与作者验收时间点。详见 [路线图](docs/ROADMAP.md) 和 [Phase 2 报告](docs/PHASE2_REPORT.md)。

Phase 3 的真实 AI 自主思考采集由用户验证。Phase 3.1 工程与离线原生验证了 64 单元、5 回环集成及 13 浏览器用例，并复测了完整 A–F。真实模型完整协作待验证。[Phase 3.1 报告](docs/PHASE3_1_REPORT.md)

当前交付为 Phase 5。真实模型试玩流程与离线验收证据见 [Phase 5 报告](docs/PHASE5_REPORT.md)。
