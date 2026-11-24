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
