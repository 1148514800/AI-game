# 雾海行纪 · 雾灯谷

旅人从谷地聚落出发。向东查看断桥，到北坡采木、南坡取石，再回渡口交付六份木材和两份石材。修好桥后沿东岸小路查看航标遗迹。岑砚可就近自由交谈，也能用自己的材料按同一工程规则修桥。阿禾和洛舟保留原有介绍。旅人可独立完成全程。

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
| 与岑砚交谈 | 跟上岑砚并靠近后按 E 或点击「与岑砚交谈」。输入中文，按 Enter 或点击「发送」 |
| 暂停 | Esc 或「暂停」。移动、暂停或断线会停止施工，已完成进度保留。对话内 Esc 关闭对话 |
| 查看全谷 | 点击「全谷地图」。同一按钮返回跟随视角 |
| 音乐与音效 | 音乐默认关，点击按钮启动。场景下方可切换音效 |

## 岑砚的对话、行动与预算

首次启动使用「模拟对话 · Mock」。在对话里可以说「请你帮忙修桥」，也可以点击建议填入文本后，再点击「发送」。岑砚能接受一个短计划、暂缓或婉拒。对话中的「计划已接受」由服务器发出。观察岑砚的行动状态、独立背包和规则回执可以确认实际进展。关闭尚未完成验证的对话会取消回复。有效交谈期间岑砚驻足，不冻结世界或渲染；关闭后已接受的计划继续执行。暂停、断线期间行动冻结，重连后重验当前步骤。

Mock 对话可直接离线运行。要观察岑砚主动采集、交材、施工、储木和休息，在新存档中启动：

```bash
LLM_ENABLED=false LLM_MOCK_AUTONOMY_ENABLED=true npm run dev
```

Mock 是可复现的模拟决策。自主决策由重要事件及约 120 秒的活动周期触发。展开「谷中居民」下的 AI Debug 可查看短计划、独立背包、回执、记忆来源、调用触发和用量。常规聊天不强制生成计划，Live 模型自行理解自由表达的行动请求，不受关键词表限制。重要交流分别保存为旅人声称和岑砚观点。采集、交材和完工由规则记录为事实。

真实供应商配置见 [环境变量模板](.env.example)。只有在获得真实调用授权和专用 Key 后才配置 Live。给 `LLM_ENABLED` 填 `true`，设置 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`。基础地址使用 HTTPS。本地测试桩支持回环 HTTP。服务端追加 `/chat/completions`。可加载自己配置的文件，例如 `node --env-file=.env release/server/src/server/index.js`。默认开发与生产入口读取已导出的变量。Vite 不加载环境文件。

`LLM_AUTONOMY_ENABLED` 默认 `false`。开启 Live 对话后，仍需显式设置该开关才能在后台发起 Live 自主请求。与 Phase 2 一样，`LLM_ENABLE_THINKING` 留空会省略该字段，`true` / `false` 作为布尔值发送。按供应商配置 `LLM_TOKEN_FIELD`、累计金额上限及输入输出单价。

每份存档旁的 `.llm.sqlite` 账本按 Mock / Live 分账。同一模式的对话和自主共享每分钟、滚动 60 分钟、累计请求量、Token 和 Live 金额限制。自主另有三档请求数上限，并给对话保留总预算空间。取消、失败、中断或缺失可信用量保留预留。重开和服务重启均不会重置预算。

Phase 2 的 Live 对话已由用户本人验证。Phase 3 的 Live 计划与实际用量待用户另行授权验证。

## 单人存档

默认路径是 `saves/foglamp-valley.sqlite`。材料、资源恢复、施工、遗迹与岑砚的计划步骤和重要记忆随行动保存。位置约每五秒检查保存，正常关闭时刷新。v1 存档首次加载时先用 SQLite 生成相邻的 `*.pre-phase3.sqlite` 备份，再事务迁移到 v2。已有备份会保留。

- 重开时点击「重开旅程」，在确认框选择「确认重开」。
- 如需备份，结束本地服务后复制 SQLite 文件。一同备份关联的 `.llm.sqlite`。可用 `MISTSEA_SAVE` 指向另一份本地存档。
- 如果遇到文件损坏或版本不匹配，界面会显示存档错误。原文件保留，关闭服务后可用备份恢复。
- 同一存档由一个标签页控制。新标签页打开后，旧标签页会提示旅程已切换。

## 验证与构建

```bash
npx playwright install chromium
python3 scripts/verify.py
```

验证脚本执行锁定安装、开发入口、类型、规则、本地 HTTP 桩和 WebSocket 集成、Playwright、构建、dummy Key 扫描和生产冒烟。各项退出码和截图写入 `evidence/phase3/verification-*/`。测试使用临时存档。原空包键盘/UI 路线覆盖六木两石、交材、施工、过河、遗迹、刷新与真实服务重启。新增 Playwright 流程采集岑砚移动、采集、交材、施工、完工与窄屏 AI Debug 的截图及轨迹。

原生环境安装依赖后，从项目根目录启动真实 30 分钟 Mock soak：

```bash
node --import tsx scripts/soak-phase3.mjs --duration 1800
```

脚本输出 PID、每分钟指标、轨迹与最终状态到独立的 `evidence/phase3/soak-*/`。可加 `--smoke --duration 12` 单独检查短启动。验收状态与本次沙箱限制见 [Phase 3 报告](docs/PHASE3_REPORT.md)。

## 数据与素材

| 路径 | 内容 |
|---|---|
| `data/foglamp-valley.json` | 雾灯谷地表、河流、建筑、碰撞、资源、居民、渡口和遗迹 |
| `data/animations.json` | 16 像素人物的四向动画映射 |
| `data/npcs/cenyan.json` | 岑砚的背景、目标、表达、知识与行为边界 |
| `src/client/` | Phaser 场景、键盘和触屏输入、界面与连接反馈 |
| `src/server/` | Fastify、WebSocket、世界规则和 SQLite |
| `src/server/dialogue/` | 岑砚人格、会话、Chat Completions 与预算账本 |
| `src/shared/` | 地图校验逻辑及游戏协议 |
| `assets/manifest.json` | 本地 CC0 素材的逐文件来源、哈希和加工记录 |
| `evidence/phase3/` | 本轮验证和 soak。Phase 0–2 证据保留在原路径 |

素材重建需要 Python 3 和 `scripts/assets/requirements.txt` 锁定的 Pillow。已有原包时只进行本地哈希校验。正式地图另有独立脚本。

```bash
npm run assets:fetch && npm run assets:prepare
npm run world:generate
```

原素材 ZIP 仅用于重新加工。完整设计基线见 [GAME_DESIGN.md](docs/GAME_DESIGN.md)，原始 29 页 PDF 与 [Phase 0 历史报告](docs/PHASE0_REPORT.md) 一并保留。本轮功能范围见 [Phase 3 执行规格](docs/PHASE3_TASK.md)。

## 已验收阶段

Phase 0、Phase 1 已获用户验收。Phase 2 的离线 25 单元、2 本地 HTTP/WS 集成、10 浏览器及生产冒烟已由原生复核通过。用户随后亲自验证了 Phase 2 的真实模型接入。历史报告和阶段归档分别保留原来的工程证据与作者验收时间点。详见 [路线图](docs/ROADMAP.md) 和 [Phase 2 报告](docs/PHASE2_REPORT.md)。

当前授权范围为 AG-4 / Phase 3。
