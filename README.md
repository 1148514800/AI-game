# 雾海行纪 · 雾灯谷

旅人从谷地聚落出发。向东查看断桥，到北坡采木、南坡取石，再回渡口交付六份木材和两份石材。修好桥后沿东岸小路查看航标遗迹。岑砚可就近自由交谈，阿禾和洛舟保留原有介绍。修桥可独立完成。

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
| 与岑砚交谈 | 走近后按 E 或点击「与岑砚交谈」。输入中文，按 Enter 或点击「发送」 |
| 暂停 | Esc 或「暂停」。移动、暂停或断线会停止施工，已完成进度保留。对话内 Esc 关闭对话 |
| 查看全谷 | 点击「全谷地图」。同一按钮返回跟随视角 |
| 音乐与音效 | 音乐默认关，点击按钮启动。场景下方可切换音效 |

## 岑砚对话与预算

首次启动显示「模拟对话 · Mock」，可离线试玩。Mock 有少量可复现的应答，用于演示界面、近期上下文和实际桥况。只有岑砚支持文字对话，行动仍由玩家操作。关闭对话、暂停、离开交谈距离、断线、标签接管和重开会中断等待。成功的近期对话只保存在服务端内存，重开或重启会清除。

真实供应商模式的配置见 [环境变量模板](.env.example)。获授权并取得独立 Key 后，由你把配置写入本地 `.env`，执行 `npm run build`，再以 `node --env-file=.env release/server/src/server/index.js` 启动。默认的 `npm run dev` 或 `npm start` 使用已导出的环境变量。给 `LLM_ENABLED` 填 `true`，提供 `LLM_BASE_URL`、`LLM_MODEL` 和专用 `LLM_API_KEY`。基础地址例如 `https://provider.example/v1`，服务端追加 `/chat/completions`。正式地址使用 HTTPS，本地测试桩允许回环 HTTP。地址不得嵌入凭据、查询参数或片段。

按供应商模型的能力设置 `LLM_TOKEN_FIELD` 为 `max_tokens` 或 `max_completion_tokens`。选择能限制全部计费输出的字段，含推理 Token 的模型通常使用后者。还须配置总金额上限和确切的输入、输出每百万 Token 单价。服务端按输入保守估算和输出上限预留，按有效 usage 结算美元估计。缺用量、非空回复的全零用量、取消、失败和异常重启保留预算占用。供应商的隐藏计费、额外 Token 和最终账单仍待真实验证。

每份游戏存档旁有独立的 `.llm.sqlite` 用量账本。Mock 与 Live 分账，分钟和会话按滚动 1 分钟与 60 分钟限额，总请求、Token 与 Live 金额累积到对应账本。游戏重开或服务重启不会清空额度。备份时先停止服务，一同复制游戏存档和对应账本。连接或配置故障时仍可游玩基本路线。

本轮已实现 Live 配置入口，真实供应商、计费及生成质量待专用 Key 和授权后验证。

## 单人存档

默认路径是 `saves/foglamp-valley.sqlite`。材料、资源恢复时间、施工进度和遗迹发现随行动保存，移动位置定期保存，并在正常关闭时保存。刷新或重新启动服务会读回同一份存档。

- 重开时点击「重开旅程」，在确认框选择「确认重开」。
- 如需备份，结束本地服务后复制 SQLite 文件。可用 `MISTSEA_SAVE` 指向另一份本地存档。
- 如果遇到文件损坏或版本不匹配，界面会显示存档错误。原文件保留，关闭服务后可用备份恢复。
- 同一存档由一个标签页控制。新标签页打开后，旧标签页会提示旅程已切换。

## 验证与构建

```bash
npx playwright install chromium
python3 scripts/verify.py
```

验证脚本在原生环境运行锁定安装、开发启动、类型检查、单元、真实本地 HTTP 假供应商和 WebSocket 集成、Playwright、生产构建、客户端 dummy Key 扫描、生产冒烟及性能 after。每项退出码和截图写入独立的 `evidence/phase2/verification-*/`，性能原始样本另写 `evidence/phase2/performance/`。可单独运行 `npm run test:integration` 或 `npm run test:e2e`。Playwright Vite/Fastify 使用 5174/3003，生产冒烟使用 3002，开发冒烟使用 5175/3005。各次均用临时存档。

完整浏览器回归保留空包、六木两石、交材、施工、桥前阻挡、桥后过河、遗迹、刷新和真实服务重启。最终原生25单元、2本地HTTP/WS集成、10浏览器全部通过。原生基线、沙箱失败及真实模型待验项见 [Phase 2 交付报告](docs/PHASE2_REPORT.md)。

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
| `evidence/phase2/` | 本轮基线、验证与复测。Phase 0/1 证据保留在原路径 |

素材重建需要 Python 3 和 `scripts/assets/requirements.txt` 锁定的 Pillow。已有原包时只进行本地哈希校验。正式地图另有独立脚本。

```bash
npm run assets:fetch && npm run assets:prepare
npm run world:generate
```

原素材 ZIP 仅用于重新加工。完整设计基线见 [GAME_DESIGN.md](docs/GAME_DESIGN.md)，原始 29 页 PDF 与 [Phase 0 历史报告](docs/PHASE0_REPORT.md) 一并保留。本轮功能范围见 [Phase 2 执行规格](docs/PHASE2_TASK.md)。

## 已验收阶段

Phase 0、Phase 1 已获用户验收。Phase 1 已完成原生14项规则测试、7项Playwright测试及生产构建冒烟，真实正常输入从初始状态完成采集/修桥/过河/遗迹并验证刷新与重启恢复。最终证据：`evidence/phase1/verification-20261124-224732-873553/`。Phase 2 的 Mac、Safari 和 Firefox 验证仍待完成。

## AG-3交付包

`mistsea-phase2-AG-3-core.zip` 为完整可运行源码（原PDF、全部45项实际运行素材及许可证、地图/代码/锁文件/测试/所有文档）；`mistsea-phase2-AG-3-evidence.zip` 为全部Phase0/1/2日志和真实截图。**两件分别小于25,000,000字节**，解压到同一父目录合并为 `mistsea-phase2/`。核心包可独立 `npm ci && npm run dev`；合并证据包后报告的历史日志与截图链接齐全。核心包不带.git，当前提交见 `DELIVERY_COMMIT.txt`；after性能工具支持无Git源码包，before重现需有指定基线的Git checkout。

完整官方未用原素材ZIP、用户SQLite、机密.env、node_modules和可再生release不随包分发；运行不需要原素材ZIP，重加工时assets:fetch缺省会从官方恢复。旧Phase1工程与归档未改动。详见 [PHASE2_PACKAGING.md](docs/PHASE2_PACKAGING.md)。实际大小/校验和见随附delivery-info.json和.sha256。Live未调用、未通过真实模型验收，不能据离线通过宣称完整Phase2 PASS。

当前工作截至 Phase 2。后续阶段待单独授权。
