# 《雾海行纪》Phase 1 交付报告

执行日期 2026-11-24，Asia/Shanghai。范围为 AG-2「可玩的小世界」。Phase 0 的 Mac 验收属于历史记录。

## 最终结论（协调代理原生验收补记）

**AG-2 / Phase 1 PASS，等待用户验收；Phase 2 未开始。** GitHub最新基线 `aa3e1a0102efb51cb52bd29de4bcde77b066f0f2`，独立目录 `/workspace/mistsea-phase1`。本轮实际优先使用 Codex CLI 0.166.0 / `gpt-6.2-sol` / high / workspace-write 完成主要编码，成功日志与总结在 evidence/phase1/codex-implementation.*；协调代理执行原生完整验收、修正证据目录触发Vite重载的配置问题并做最终视觉复核。没有将编码沙箱的失败冒充通过，也没有提升其沙箱权限。

GitHub基线中的原PDF和Village.ogg被截短。已由Phase0本地留存按原manifest/PDF SHA-256恢复，原29页PDF可完整读取，Markdown全量非空白字符核对一致，详见 baseline-binary-check.json / design-preservation.json。Phase0原工程、归档和历史证据均保留。

## 实现

- 48×48 格的雾灯谷采用 16 像素地块，包含谷地聚落、三处住宅、公共区、北坡林地、南坡岩场、贯通南北的河道和东岸遗迹。新旧桥的渲染和通行都由同一工程状态驱动。
- 旅人有四向站立和走路帧，按脚底 Y 排序遮挡。镜头在地图边界内跟随，也可以查看全谷。岑砚、阿禾和洛舟在固定位置介绍自己，使用不同角色、姓名、职业和头像。
- WebSocket 接收离散方向和行动请求。服务端验证位置、速度、有效距离、资源冷却、库存和工程条件，再将结果同步给界面。旅人可以独立采集六份木材和两份石材，到桥边交齐材料，累计施工 14 秒，过桥并发现航标线索。
- 一份 SQLite 存档保存位置、背包、资源恢复时间、交付材料、施工进度和遗迹发现。关键变化和成功行动回执一并提交。重开有确认界面，坏档、版本错误、缺少素材及连接中断有明确反馈。
- 运行素材使用同一已核准的 Ninja Adventure CC0 原包，清单随附 45 个本地文件。独立重建已验证每个输出哈希、动画和地图不受素材重建影响，扩展 manifest 条目与字段保留。[复现日志](../evidence/phase1/final-checks/reproducibility.log)

## 本地编码沙箱实测

| 命令 | 退出码 | 实际结果 |
|---|---:|---|
| `npm ci` | 1 | esbuild 安装脚本的同步子进程报 `EPERM` |
| `npm ci --ignore-scripts` | 0 | 安装锁文件对应的 103 个依赖 |
| `npm run assets:fetch` | 0 | 现存官方 ZIP 哈希校验 |
| `npm run assets:prepare` | 0 | 本地导出、许可与逐文件清单 |
| `npm run world:generate` | 0 | 48×48 地图、320 个道具、9 个采集点 |
| `npm run dev` | 1 | Vite 的 5173 回环监听被拒绝 |
| `npm run typecheck` | 0 | TypeScript 类型检查 |
| `npm test` | 0 | 14/14 规则及 SQLite 测试 |
| `npm run test:e2e -- --list` | 0 | 发现 7 个测试 |
| `npm run test:e2e` | 1 | Vite 的 5174 回环监听被拒绝，测试未进入浏览器 |
| `npm run build` | 0 | 构建前后端到 `release/` |
| `node scripts/production-smoke.mjs` | 1 | 编译后服务的 3002 回环监听被拒绝 |
| 编译后的 Fastify 进程内检查 | 0 | 仅有 PATH 的环境中，入口页、编译 JS/CSS 和 45 个登记素材均按预期读取 |

逐项命令和时间见 [退出码记录](../evidence/phase1/final-checks/command-results.json)。进程内检查见 [编译产物日志](../evidence/phase1/final-checks/compiled-fastify-inject.log)。独立 Chromium 探针在启动时收到 `shutdown: Operation not permitted`，见 [浏览器探针](../evidence/phase1/chromium-launch.log)。

规则测试覆盖严格消息格式、地图和素材完整、速度归一化及输入过期、碰撞和河道连通、交互距离、冷却、重复、防负库存、按时间施工、恢复、重开、并发写入拒绝和坏档。另从全新规则状态走完采集、交付、施工、过桥、查看遗迹及 SQLite 重读。

## 原生浏览器验证

协调代理在独立的原生运行中执行了标准 npm 安装、类型检查、单元测试和构建，均退出 0。首次 Chromium 套件 6/7 项通过，完整旅程以正常键盘与按钮取得六木两石、实际交付材料并开始施工，在重启后的施工完成断言处失败。第二轮单项复测确认 Vite 监听了 Playwright 产生的证据 HTML 和同步生成的构建产物，引发全页重载。协调代理已让 Vite 忽略证据、构建、存档和素材源目录。稳定源码下最终完整复测已通过（下面最终原生验收表）；完整旅程54.1秒通过，整套7/7通过。[原生退出码](../evidence/phase1/native-command-results.json) · [首轮 E2E](../evidence/phase1/native-e2e.log) · [协调记录](../evidence/phase1/coordinator-findings.md)

已目视检查真实桌面、全谷地图、三位居民、采集、背包、破桥、初始施工、缺图和 390px 窄屏截图。观察到邻接素材裁剪和河道阶梯式转折，已重裁树冠、岩簇和石拱门，并从原岸边泡沫像素生成弯道图块。新的 [破桥截图](../evidence/phase1/isolated/bridge-before.png) 显示弧形岸线。

| 真实截图 | 已观察内容 |
|---|---|
| [scene-desktop.png](../evidence/phase1/scene-desktop.png) / [valley-overview.png](../evidence/phase1/valley-overview.png) | 桌面场景及全谷布局 |
| [resident-cenyan.png](../evidence/phase1/resident-cenyan.png) / [resident-ahe.png](../evidence/phase1/resident-ahe.png) / [resident-luozhou.png](../evidence/phase1/resident-luozhou.png) | 三位居民的名字、头像和固定介绍 |
| [collection.png](../evidence/phase1/collection.png) / [inventory.png](../evidence/phase1/inventory.png) | 首次入包反馈和六木两石 |
| [bridge-before.png](../evidence/phase1/bridge-before.png) / [construction.png](../evidence/phase1/construction.png) | 断桥、材料不足、真实交付和施工进度 |
| [scene-narrow.png](../evidence/phase1/scene-narrow.png) / [asset-failure.png](../evidence/phase1/asset-failure.png) | 窄屏与缺少桥图时的阻断提示 |

## 十二类验收对照

| 项目 | 当前实际证据 |
|---|---|
| 1. 地图与素材 | 清单哈希、可复现地图、编译静态文件和真实开场通过 |
| 2. 移动、动画、相机与碰撞 | 四向帧、相机跟随和暂停在原生浏览器通过，速度、边界和道具碰撞通过规则测试 |
| 3. 交互距离 | 真实 WebSocket 拒绝在出生点查看东岸遗迹 |
| 4. 采集与背包 | 原生旅程从空背包采集到六木两石并截图 |
| 5. 重复或非法 | 规则测试覆盖回执去重和采集冷却。原生 WebSocket 验证拒绝带伪造坐标的移动 |
| 6. 材料不足 | 真实旧桥界面回报材料不足，交付数量保持为零 |
| 7. 修桥前不能过河 | 真实向东移动输入在西岸被拦截，规则路径搜索确认无绕路 |
| 8. 修桥后可过河 | 规则路径通过，最终原生正常键盘旅程实际过河通过，并截图 bridge-after.png |
| 9. 抵达并查看遗迹 | 规则路径和重读存档通过，最终原生正常键盘旅程抵达并查看航标通过，并截图 beacon-ruin.png |
| 10. 刷新及重启恢复 | 原生首轮已通过木材刷新、施工中断后的材料与进度恢复，最终完工/遗迹后的刷新、真实服务停止重启及状态恢复全部通过 |
| 11. 断线重连及关键素材缺失 | 原生 HTTP 恢复、WebSocket 初次失败和缺图用例通过，首轮旅程完成中途重连 |
| 12. 无 API Key 运行 | 只有 PATH 的编译后 Fastify 检查通过，最终无Key正常完整旅程及真实编译后生产浏览器冒烟均通过 |

## 余项与交付

- 完整正常游玩、桥后通行、遗迹、刷新、两次真实服务重启、断线重连和重开确认，以及最终生产浏览器冒烟均已实际通过。最终截图位于下列verification目录，早期截图保留用于失败修复追溯，不作为最终画面的唯一依据。
- Vite 保留约 1.54 MB 的主 JS 包体积警告，gzip 约 403 KB。Safari、Firefox、Mac Phase 1 和人工听感均未验收。
- 原设计 PDF、恢复的 Village.ogg、Phase 0 截图和日志按原件保留。可选原素材 ZIP 留在 Git 忽略目录，超过附件上限的 Playwright 调试 trace 保留于本地并排除在交付附件之外。[完整性核对](../evidence/phase1/final-checks/workspace-integrity.json)
- 最终视觉复核已实际读取全谷、三位居民、采集、背包、桥前/后、遗迹及窄屏截图：人物/建筑/河道/桥梁为真实像素素材，比例与像素清晰度统一；遮挡按脚底Y排序，人物在大型石像背后可能被自然遮挡。未观察到缺图或页面横向溢出。后续阶段待独立授权。

## 最终原生验收命令（不是沙箱失败记录）

时区 UTC+8 / Asia/Shanghai；稳定工作树在Codex完成后统一运行 `python3 scripts/verify.py`，退出0。

|命令|退出码|开始时间（UTC+8）|日志|
|---|---:|---|---|
|`npm ci`|0|2026-11-24T22:47:32.873762+08:00|`evidence/phase1/verification-20261124-224732-873553/npm-ci.log`|
|`npm run typecheck`|0|2026-11-24T22:47:35.302753+08:00|`evidence/phase1/verification-20261124-224732-873553/typecheck.log`|
|`npm test`|0|2026-11-24T22:47:35.720982+08:00|`evidence/phase1/verification-20261124-224732-873553/unit-test.log`|
|`npm run test:e2e`|0|2026-11-24T22:47:36.493450+08:00|`evidence/phase1/verification-20261124-224732-873553/e2e.log`|
|`npm run build`|0|2026-11-24T22:48:52.312129+08:00|`evidence/phase1/verification-20261124-224732-873553/build.log`|
|`node scripts/production-smoke.mjs`|0|2026-11-24T22:48:53.618491+08:00|`evidence/phase1/verification-20261124-224732-873553/production-smoke.log`|

- 规则/SQLite测试：14通过、0失败。包含无API Key、严格字段、服务端速度/碰撞/河道唯一通路、重复回执跨重启、材料事务、按时间施工、坏档保留、并发写入冲突和完整规则旅程。测试故意注入坏档时日志打印SQLite错误是已断言的预期失败场景，不是套件失败。
- Playwright：7通过、0失败。完整正常旅程没有DB改包或客户端注入，辅助寻路只读静态地图及DOM坐标，所有移动均由真实键盘输入完成，采集/交材/施工/查看遗迹均通过E键或按钮。测试用独立临时存档，未污染用户存档。
- 生产冒烟：真实编译Fastify/SQLite/WS/本地素材、键盘移动通过。运行不读取或要求游戏模型API Key。
- 故意停止服务及阻断资源/握手的用例可能使Vite代理记录EPIPE/ECONNRESET；最终套件断言恢复与失败界面通过。这些服务端代理日志未伪装成没有发生；正常浏览器阶段无未预期页面/控制台错误。

### 最终截图（全部已实际Read检查）

- 全谷地图：`evidence/phase1/verification-20261124-224732-873553/valley-overview.png`
- 开场跟随画面：`evidence/phase1/verification-20261124-224732-873553/scene-desktop.png`
- 岑砚介绍：`evidence/phase1/verification-20261124-224732-873553/resident-cenyan.png`
- 阿禾介绍：`evidence/phase1/verification-20261124-224732-873553/resident-ahe.png`
- 洛舟介绍：`evidence/phase1/verification-20261124-224732-873553/resident-luozhou.png`
- 真实采集入包：`evidence/phase1/verification-20261124-224732-873553/collection.png`
- 6木2石背包：`evidence/phase1/verification-20261124-224732-873553/inventory.png`
- 修前被河阻挡：`evidence/phase1/verification-20261124-224732-873553/bridge-before.png`
- 实际施工进度：`evidence/phase1/verification-20261124-224732-873553/construction.png`
- 桥已修复100%：`evidence/phase1/verification-20261124-224732-873553/bridge-after.png`
- 实际过河并完成遗迹探索：`evidence/phase1/verification-20261124-224732-873553/beacon-ruin.png`
- 390px窄屏：`evidence/phase1/verification-20261124-224732-873553/scene-narrow.png`
- 关键桥素材缺失阻断：`evidence/phase1/verification-20261124-224732-873553/asset-failure.png`
- 编译产物真实浏览器：`evidence/phase1/verification-20261124-224732-873553/scene-production.png`

## 交付、限制与停止点

源码包将为 `/workspace/mistsea-phase1-AG-2-core.zip`，本地提交历史另附 `/workspace/mistsea-phase1-AG-2.bundle`，每个文件严格小于25,000,000字节；最终commit与SHA-256见交付元数据。包含原PDF、全部本地运行资源、文档/授权/锁文件、地图/服务端存档代码、测试日志/JSON/截图；不包含node_modules、用户SQLite存档、未用完整原素材ZIP和可选大调试trace，后者留在本地。源码可 `npm ci && npm run dev`；生产启动前 `npm run build && npm start`。

尚未验证：Mac上的Phase1、Safari/Firefox、真实手机触控操作与音频人工听感、长时间性能。已验证窄屏渲染和触控按钮存在，但不冒充真实手机验收。Vite约1.54MB主包警告保留，没有为消除警告引入复杂拆包。无真实游戏LLM、无NPC自主系统、无战斗/经济/多人、无付费、无公网部署、无远程push/PR。

**仅完成Phase1；等待用户验收，不进入Phase2。**

## 本地 Git 记录

- GitHub基线：`aa3e1a0102efb51cb52bd29de4bcde77b066f0f2`。
- 完整实现与实际验收提交：`ea9df2a92326635ed9c75b286b6d827d6cb36791`，本地分支 `ag-2-phase1`。
- 本段及交付说明另作仅文档提交；最终HEAD写入附件 `DELIVERY_COMMIT.txt` 和交付元数据，避免试图将提交自己的哈希写入同一提交。未push、未创建远程PR。
