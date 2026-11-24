# 《雾海行纪》Phase 0 阶段验收报告

验收记录：2026-11-24 18:58:13 UTC+8 / Asia/Shanghai

## 结论

**Phase 0 工程与素材门禁 PASS，待用户试玩验收；到此停止，不进入 Phase 1。** 这不是 v0.1 完整游戏验收。优先 Codex 路径有网络阻塞，未冒充其完成编码；具体见下文。

## 实际完成

1. 从用户指定 Mac `Desktop/AI game/AI_Game_Research_and_Design_v2.pdf` 只读复制到本工程 docs，未改动 Mac 源文件或其他个人文件。完整读取 29 页（含美术、技术、路线、验收与全部来源），生成逐页 Markdown；原 PDF SHA-256 `8623390d64c8f0684e89749247cbf2d3206f3c859bd0c7e34f8567a5d252efc7`。转换去除空白后的全部字符逐字比对一致，29/29 页完整，见 evidence/design-conversion-check.json。保留表格原排版，没有将未来方案误标为当前功能。
2. 清晰目录 src/client、src/server、src/shared、data、assets、public/assets、tests、scripts、docs；一个 package-lock.json。README/AGENTS/ROADMAP/DECISIONS/ASSETS 完备；GAME_DESIGN 为唯一完整设计基线。design-extracted.txt 仅自动提取中间产物，不独立维护设计。
3. 实际使用 TypeScript 7.0.2、Phaser 4.2.1、Vite 8.3.8、Fastify 5.12.8、ws 8.23.0、Zod 4.6.7、Playwright 1.65.1；Node 24.22.1 内置 SQLite。无明确兼容阻塞，未降级 Phaser。完整版本及环境见 package-lock.json / evidence/environment.txt。
4. 从官方 itch.io 免费下载 Ninja Adventure 2026-03-29（upload 16981275 / Update 8）完整原包。包内 README 与 LICENSE 及作者页面均确认 CC0-1.0。作者 Pixel-Boy 与 AAA。原 ZIP 未改写，保留许可与全包分类索引；筛选地形、树木、建筑、玩家/NPC 行走与站立、物品、UI、音乐与音效共 13 个本地文件。每个文件有来源、作者、版本、原始与输出路径、哈希和修改记录。Kenney 官方备选已调研但未混用。
5. 实际像素场景：20×14 格（320×224 原生像素）、草地/十字道路、树木与灌木、小屋、一名玩家与一名 NPC。WASD/方向键四向移动，正确四方向行走/站立，NPC 原素材动画循环；脚底 Y 排序，整数倍最近邻缩放，边界限制与小屋最小阻挡；HTML/CSS 简单中文界面、坐标/加载/服务状态、暂停和默认关闭的可选本地音乐。不是雾灯谷正式地图。
6. Fastify /health、SQLite 内存 SELECT 1、严格 Zod WebSocket ping/pong；构建后可由单 Fastify 提供静态游戏。没有世界模拟、数据库业务表、存档或多人同步。
7. Playwright Chromium 真实加载、像素色彩非空、13 资源、四方向/动画帧/坐标变化、NPC 帧变化、Escape 暂停、边界、小屋阻挡、音乐按钮、无控制台错误/HTTP 缺失/外部源请求、桌面与390px窄屏无横向溢出；已保存并实际查看截图。生产编译产物另有真实浏览器冒烟通过。测试服务退出后 3001/3002/5173 均已关闭，无遗留服务。

## 技术取舍

- Phaser 4.2.1 已从 npm 实测可用并真正运行；Canvas 渲染减少 WebGL 环境差异，pixelArt/roundPixels/antialias=false 与 CSS 整数倍共同确保清晰。
- 人物 Walk 为 64×64、16×16 帧，四方向在列、时间在行；右方向是 3/7/11/15，不把一行当成同方向动画。Idle 64×16。动画映射见 data/animations.json。
- Node 内置 SQLite 只验证连接，不预建未来业务；单进程与稳定 ID 足够。HTML/CSS 界面不另加 UI 框架。
- 固定小验证地图由脚本生成 Tiled 兼容 JSON，原生数值对象 ID 配稳定业务 ID 属性；不提前构建正式地图或玩法。
- 全量主库原包只作为 source 归档，生产产物只含 13 个筛选素材。不引入额外画风、不依赖 CDN。

## Codex CLI 实测（非游戏内模型调用）

**BLOCKED：优先编码 CLI 的远端访问。** 已安装 codex-cli 0.166.0，`codex login status` 显示已登录。按用户首选尝试 `-m gpt-6.2-sol -c model_reasoning_effort="high"` 的只读最小探针。CLI 接受参数，但模型目录请求超时、metadata not found、workspace routing discovery failed，173.893 秒后退出 1；未产生模型响应，不能证实该订阅的模型支持情况。证据 evidence/codex-model-check.log。

没有读取凭据、改全局配置或通过私有接口绕过失败。**这不是已确认额度耗尽，不虚构五小时重置时刻，也未用 sleep 等待。** 在用户自主技术决策授权下由本执行代理直接实现，未宣称 Codex 编码成功。没有接入游戏内真实模型 API。

## 实际命令与退出状态

最终完整流水线：evidence/final-verification.log / command-results.json。所有时间为 UTC+8 / Asia/Shanghai。

|命令|退出状态|说明/日志|
|---|---:|---|
|`npm run dev`|0（健康运行后主动终止）|evidence/dev.log，Vite 5173/Fastify 3001 实际启动；最终 E2E 还再次自动启动同一命令，完成后自动清理|
|`npm ci`|0 / PASS|evidence/npm-ci.log，开始 2026-11-24T18:56:40.877335+08:00|
|`npm run typecheck`|0 / PASS|evidence/typecheck.log，开始 2026-11-24T18:56:43.386948+08:00|
|`npm test`|0 / PASS|evidence/unit-test.log，开始 2026-11-24T18:56:43.746072+08:00|
|`npm run test:e2e`|0 / PASS|evidence/e2e.log，开始 2026-11-24T18:56:44.327428+08:00|
|`npm run build`|0 / PASS|evidence/build.log，开始 2026-11-24T18:56:59.255009+08:00|
|`node scripts/production-smoke.mjs`|0 / PASS|evidence/production-smoke.log，开始 2026-11-24T18:57:00.393380+08:00|
|`npm run assets:fetch`|0 / PASS|evidence/assets-fetch.log，开始 2026-11-24T18:57:01.988518+08:00|
|`npm run assets:prepare`|0 / PASS|evidence/assets-prepare.log，开始 2026-11-24T18:57:02.325432+08:00|

- `npm test`：5/5 通过，协议、边界、运行素材授权/哈希、动画映射、Fastify+SQLite+真实 WebSocket。
- `npm run test:e2e`：3/3 通过，真实场景综合验收、窄屏布局、小屋阻挡。
- 生产冒烟：编译后的 Fastify 静态页面实际启动，13 素材且浏览器无错误。
- npm ci 最终安装审计无已知漏洞；npm 对 esbuild 安装脚本有提示，实际类型检查/单元/E2E/构建均能执行。

### 首轮失败与修复，均保留证据

- 首轮 typecheck 退出 1：CSS side-effect import 无类型声明；添加 Vite client 声明。evidence/typecheck-attempt1.log。
- 首轮 build 退出 2：TypeScript 7 要求 rootDir 显式设置；修复后前后端编译均退出 0。evidence/build-attempt1.log。
- 首轮 E2E 退出 1：原 Phaser ESC 快捷键未冻结移动；改标准 DOM Escape 监听，按键及位置冻结实测通过。evidence/e2e-attempt1.log。
- 次轮 E2E 退出 1：本地 blob 资源被测试误当外网；按 URL.origin 判断，真正外网禁止断言保留。evidence/e2e-attempt2.log。
- 清洁生命周期测试发现 detached 子进程会在 Playwright 终止外层时残留；清理本项目进程后改直接 Node 子服务，最终完整复测并检查三个端口关闭（evidence/post-test-ports.json）。

## 真实截图与视觉核查

|路径（工程根目录相对路径）|实际内容|
|---|---|
|evidence/scene-desktop.png|1280×960 桌面启动、真实素材与界面|
|evidence/scene-mobile.png|390px 窄屏完整页面|
|evidence/animation-down.png|玩家向下行走|
|evidence/animation-up.png|玩家向上行走|
|evidence/animation-left.png|玩家向左行走|
|evidence/animation-right.png|玩家向右行走|
|evidence/house-collision.png|玩家被小屋基座阻挡，无穿墙|
|evidence/scene-production.png|构建产物经 Fastify 静态服务真实运行|

**视觉检查 PASS（范围仅本阶段）。** 本执行代理实际读取桌面、窄屏、四方向、生产、小屋阻挡截图及原图帧预览：主要人物/建筑均为真实像素素材，朝向正确、大小比例一致，无可见像素模糊、缺图黑块或 UI 遮挡/横向溢出。树木/灌木为装饰遮挡样例，地图边缘部分树冠自然裁切；草地/道路为刻意简单的测试铺砖，不作为正式地图美术成果。静态截图不能单独证明动画，另有真实帧变化断言；按钮测试不等同于人工听感验收。

## 已知问题、未验证及明确不做

- **WARN**：Phaser 主 bundle 约 1.44 MB，gzip 约 380 KB，Vite 发出 >500KB chunk 警告；构建退出 0。为 Phase 0 简单性暂不做复杂拆包，没有隐藏警告。
- **NOT RUN**：Mac 本地 npm 安装/浏览器实际运行、Safari/Firefox、触屏移动、不同 GPU/高 DPI、长时性能测试。已在 Linux/Node24/Playwright Chromium 验证；Mac 只做了授权源 PDF 只读定位与复制。
- **NOT RUN**：人工音乐/音效听感；已测试音频加载和用户点击音乐开关，无浏览器错误。alert.wav 和 arrow.png 已分类准入/预加载，本阶段没有业务动作触发。
- **不在本阶段**：树木完整碰撞/寻路、正式雾灯谷地图、采集/背包、修桥/过河、对话/记忆/自主目标/社交、存档、战斗/经济/多人，以及真实模型评测/费用和五人产品试玩。没有创建虚假的对话、施工、过桥截图，也不将这些验收标为 PASS。
- 模型 API Key、付费服务和素材均未使用；无购买/捐款、无部署、无远程仓库创建或推送。
- 原报告的模型价格、产品事实与研究结论是保留的历史设计快照，不声称本次逐项实时验证。

## 交付与复现

工程目录 `/workspace/mistsea-phase0`；**推荐聊天交付包 `/workspace/mistsea-phase0-core.zip`，小于25MB**。包含源码、锁文件、原PDF、全部文档、13个本地运行素材、许可证/清单、脚本/测试/日志/真实截图与 release 构建产物。排除 node_modules、完整官方原素材 ZIP、展开的原包副本与临时目录/签名下载响应。

原完整归档 `/workspace/mistsea-phase0-delivery.zip` 原样保留，约98.69MiB，已确认超过聊天附件25MB硬限制，不声称已通过聊天送达。原完整官方素材 ZIP 仍保存在研发电脑 `assets/source/ninja-adventure-2026-03-29.zip`，约90MiB；轻量包不包含该原包。`npm run assets:fetch` 在原包缺省时会从官方自动获取同一 upload 并校验 SHA-256，仅重新处理素材才需此步骤，运行游戏无需原素材 ZIP。

解压轻量包后按 README：`npm ci && npm run dev`，浏览器打开 http://127.0.0.1:5173/；也可 `npm start` 使用随附构建产物（默认3001端口），或 `npm run build` 自行重建。无需 Python 或 API Key，不要求用户自行下载、裁剪或绘制素材。包装结构与独立自检见 docs/PACKAGING.md。

本次仅补做附件包装及相关说明，游戏代码和依赖锁文件未更改；先前测试结果仍是原实际运行证据，没有把未重跑测试声称为本次新增通过。

**停止点：Phase 0 待用户验收；Phase 1–6 均未开始。**
