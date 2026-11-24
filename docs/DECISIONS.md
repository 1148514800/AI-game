# 技术决策记录

## D001 — 仅 Phase 0
完整设计为未来基线，本轮用户限定覆盖附录的 Phase 0–6 总授权：仅工程、资源准入、验证场景。无正式地图、AI、采集/背包/桥梁/存档业务。NPC 是动画样例，不伪装为智能角色。

## D002 — 实测技术栈，无需降级
Node 24.22.1 / npm 11.21.1；npm 注册表确认 Phaser 4.2.1 可用，实际锁定使用，未以旧 Phaser 3 替代。Vite 8.3.8 的 Node 要求 ^20.19.0 或 >=22.12.0，本机满足。TypeScript 7.0.2 / Fastify 5.12.8 / ws 8.23.0 / Zod 4.6.7 / Playwright 1.65.1 均实际安装；最终以 package-lock.json 为准。HTML/CSS 无 UI 框架。Canvas 渲染配合整数倍像素缩放，避免设备 WebGL 差异；Phaser 仍管理贴图、动画、输入与场景。

## D003 — 必要基础设施，不预建业务
Fastify 单进程；一个 /health HTTP 端点通过 SQLite SELECT 1 检查连通；一个 /ws 校验 ping/pong 通道（Zod 严格校验）。SQLite 使用 Node 内置 node:sqlite 内存连接，不建立业务表、世界持久化或多人同步。当前玩家移动是本地素材验证，不是未来服务端权威世界的最终实现。生产静态文件由 @fastify/static 提供；默认绑定 127.0.0.1，不部署公网。

## D004 — 素材统一
官方 itch.io 主包（2026-03-29，upload 16981275，Update 8）；原包 README 与 LICENSE 均确认 CC0 1.0。所有角色、草地、道路、树木、小屋、物品、UI、音频取自主库，Kenney Tiny Town 仅调研未引入，避免画风混搭。原 ZIP 不改写，运行时仅筛选 13 个文件。16×16 地块；人物 Walk 为 64×64，四方向按列、时间按行；Idle 为 64×16。派生裁剪和哈希见 manifest 与脚本。

## D005 — Codex 首选尝试与真实限制
Codex CLI 0.166.0 已安装，`codex login status` 返回 Logged in using ChatGPT。执行 `codex exec --skip-git-repo-check -s read-only -m gpt-6.2-sol -c 'model_reasoning_effort="high"'` 的最小模型探针。CLI 接受该参数字符串，但模型目录请求超时、metadata not found、workspace routing discovery failed，173.9 秒后退出 1；未得到模型响应。不能据此确认订阅支持该模型，也不是已证实额度耗尽，故不虚构五小时重置时间。没有更改全局配置、提取凭据、改调用私有接口或绕过失败认证。依照用户自主实现授权，由本执行代理直接生成项目代码；本次没有声称 Codex 完成了编码。原始日志见 evidence/codex-model-check.log。

## D006 — 阶段专用验收
仅测试真实资源加载、渲染、移动/动画/暂停/边界、窄屏布局、基础服务与构建。完整报告中的对话、施工、过桥、真实模型和五人试玩是后续验收，本次 NOT RUN，不创建假截图或模拟通过。

## D007 — 当前修复记录
- TypeScript 7 的 CSS side-effect import 需要 Vite client 类型；添加 src/client/env.d.ts，类型检查复测通过。
- TypeScript 7 构建要求显式 rootDir；设为项目根，保留 server 输出的 src/server 路径。
- 浏览器测试发现 Phaser 的原 ESC 快捷键未触发暂停；改用有 repeat 防护的标准 DOM Escape 监听，实际按键冻结位置与动画验证。
- 本地 blob URL 被初版网络断言误当外网；使用 URL.origin 判断来源，保留真正外网请求禁止断言。
- 最终生命周期测试发现 detached 子进程组在 Playwright 强制终止外层进程时可能残留并阻止日志管道关闭；已清理本项目残留服务，改为直接启动两个 Node 子服务（无 npm/shell 嵌套、无 detached），显式传递 SIGTERM。最终重新完整验收，避免端口残留。
- Vite 的 Phaser 单包约 1.44MB（gzip 约 380KB）触发 chunk 大小警告；Phase 0 保持简单，未隐藏警告，也不以拆包增加复杂度。

## D008 — Phase 1 地图与素材各自重建

`data/foglamp-valley.json` 是客户端与服务端共同读取的 48×48 地图。地表、河道、桥口、道具基座、居民、资源和交互距离分别由地图记录指定。正式地图使用独立的 `npm run world:generate` 生成。素材加工只更新配方内的运行文件、许可和对应 manifest 字段，保留扩展记录、动画配置与历史预览地图。

## D009 — 固定步长下的单人输入

WebSocket 绑定当前旅人。移动输入只有两根离散轴，20 Hz 服务端推进，速度每秒 88 像素，斜向归一化。移动意图租期 420ms，服务器限定收包量，动作只使用当前服务端位置。按脚底排序与平滑追随在客户端完成，库存和工程变化来自提交成功的服务端快照。新标签页接管单人输入，旧标签页提示并等待手动恢复。

## D010 — SQLite 快照与回执

维护一份带 schemaVersion 及 contentVersion 的快照。每次关键变化把新快照和成功行动的 ID 一起提交，然后替换内存状态。重试返回明确的重复回执。位置约每五秒检查保存，正常断线和停服时刷新。施工每个有效推进步持久化。并行打开同一份存档时，事务里的旧版本比较会拒绝过期写入。版本错误、坏档及写入失败都反馈给界面，重开需要明确确认。

## D011 — Phase 1 自力路径

木材六份、石材两份一次交齐。默认独立施工累计 14 秒，移动、暂停和断开控制会终止本次施工，已保存进度支持续作。资源恢复采用服务端真实时间，施工计时采用活动连接上的单调时间推进。配方、资源点和交互范围由内容数据定义。

## D012 — 受限执行环境的验收记录

Phase 1 的授权工作区由 Codex 直接编辑，前序本地 CLI 探针记录在 `evidence/phase1/codex-check.log`。普通 npm 安装的 esbuild 生命周期脚本收到 `EPERM`。使用 npm 原生 `--ignore-scripts` 取得锁文件对应依赖后，规则测试和构建可运行。测试用 `node --import tsx` 加载 TypeScript。当前环境拒绝本机监听及 Chromium 所需的系统调用，相关验收的实际退出码见 Phase 1 报告。

## AG-2最终原生复核
初轮浏览器失败与Vite监听证据HTML/重建产物导致整页重载相关；协调代理最小配置修正后，在Codex完全停止修改的稳定源码上重新全量执行 npm ci/typecheck/test/test:e2e/build/生产冒烟，全0；14单元、7浏览器通过。保留早期失败、沙箱拒绝、最终成功的各自日志，不通过延长超时掩盖问题。
