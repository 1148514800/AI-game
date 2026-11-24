# 雾海行纪 · 雾灯谷

旅人从谷地聚落出发。向东查看断桥，到北坡采木、南坡取石，再回渡口交付六份木材和两份石材。修好桥后沿东岸小路查看航标遗迹。谷中三位居民可就近介绍自己，修桥可独立完成。

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
| 暂停 | Esc 或「暂停」。移动、暂停或断线会停止施工，已完成进度保留 |
| 查看全谷 | 点击「全谷地图」。同一按钮返回跟随视角 |
| 音乐与音效 | 音乐默认关，点击按钮启动。场景下方可切换音效 |

## 单人存档

默认路径是 `saves/foglamp-valley.sqlite`。材料、资源恢复时间、施工进度和遗迹发现随行动保存，移动位置定期保存，并在正常关闭时保存。刷新或重新启动服务会读回同一份存档。

- 重开时点击「重开旅程」，在确认框选择「确认重开」。
- 如需备份，结束本地服务后复制 SQLite 文件。可用 `MISTSEA_SAVE` 指向另一份本地存档。
- 如果遇到文件损坏或版本不匹配，界面会显示存档错误。原文件保留，关闭服务后可用备份恢复。
- 同一存档由一个标签页控制。新标签页打开后，旧标签页会提示旅程已切换。

## 验证与构建

```bash
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
node scripts/production-smoke.mjs
```

Playwright 另启 Vite 5174 和 Fastify 3003，生产冒烟使用 3002。它们各自使用临时 SQLite 文件。完整浏览器测试从空背包开始，以键盘和界面按钮采集、施工、过河并验证刷新及服务重启；证据默认写入 `evidence/phase1/`，可用 `MISTSEA_EVIDENCE` 指定该目录下的复测子目录。

编码沙箱与原生浏览器运行的各自结果见 [Phase 1 交付报告](docs/PHASE1_REPORT.md)。

## 数据与素材

| 路径 | 内容 |
|---|---|
| `data/foglamp-valley.json` | 雾灯谷地表、河流、建筑、碰撞、资源、居民、渡口和遗迹 |
| `data/animations.json` | 16 像素人物的四向动画映射 |
| `src/client/` | Phaser 场景、键盘和触屏输入、界面与连接反馈 |
| `src/server/` | Fastify、WebSocket、世界规则和 SQLite |
| `src/shared/` | 地图校验逻辑及游戏协议 |
| `assets/manifest.json` | 本地 CC0 素材的逐文件来源、哈希和加工记录 |
| `evidence/phase1/` | 本轮执行记录。Phase 0 历史证据保存在 `evidence/` 原位置 |

素材重建需要 Python 3 和 `scripts/assets/requirements.txt` 锁定的 Pillow。已有原包时只进行本地哈希校验。正式地图另有独立脚本。

```bash
npm run assets:fetch && npm run assets:prepare
npm run world:generate
```

原素材 ZIP 仅用于重新加工。完整设计基线见 [GAME_DESIGN.md](docs/GAME_DESIGN.md)，原始 29 页 PDF 与 [Phase 0 历史报告](docs/PHASE0_REPORT.md) 一并保留。本轮功能范围见 [Phase 1 执行规格](docs/PHASE1_TASK.md)。

## AG-2交付与验收

Phase 1已完成原生14项规则测试、7项Playwright测试及生产构建冒烟，真实正常输入从初始状态完成采集/修桥/过河/遗迹并验证刷新与重启恢复。最终证据：`evidence/phase1/verification-20261124-224732-873553/`。本轮未在Mac/Safari/Firefox重新验收，Phase0的Mac验收不替代Phase1。

源码附件 `mistsea-phase1-AG-2-core.zip`、本地历史 `mistsea-phase1-AG-2.bundle` 各小于25MB。原PDF、全部实际运行素材及许可证、地图/代码/锁文件/测试/日志/截图都保留。完整官方原素材ZIP与用户SQLite存档不随附件分发；运行游戏不需要原素材ZIP，重加工时 assets:fetch 会自动从官方恢复。详见 docs/PHASE1_PACKAGING.md。

Phase1交付后停止，Phase2尚未授权。
