# 开发 AI 必须遵守
- 唯一完整设计基线：docs/GAME_DESIGN.md（原始 PDF 同目录）。优先服从本轮用户的范围限制。技术变更只登记 docs/DECISIONS.md，不复制相互冲突的设计。
- 当前已授权仅 Phase 0。交付即停，后续 Phase 1–6 必须新获授权。不得补写采集、修桥、AI 记忆/社交、战斗、经济或多人系统。
- 无真实大模型 API、无付费、无购买、无公网部署、无远程推送。不得读取/泄露凭据或修改工作区外无关文件。
- TypeScript、Phaser 4.2.1、Vite、单 Node/Fastify、WebSocket、SQLite、Zod、Playwright；保留稳定 ID 和清晰目录，不引入微服务/Redis/向量库/Agent 框架。
- 仅官方来源且准入完成的 CC0 素材；所有运行素材本地化并逐文件列 manifest、哈希与修改。下载更新必须重新核查授权。
- 资产脚本 `npm run assets:fetch && npm run assets:prepare`；Python Pillow 是离线重建资源的开发工具，游戏运行无需 Python。
- 修改后实际 npm ci/dev/typecheck/test/test:e2e/build；截图必须是真实浏览器输出，必须看图并修复。不得把未执行项写为 PASS。
- 不把 NPC 动画样例描述为 AI，不把基础 SQLite 连通描述成存档系统。
- 用户优先 Codex CLI gpt-6.2 sol high；调用前验证参数和可用性，不虚构模型名、额度或重置时间。额度确实用尽时保存工作并报告，勿用 sleep 阻塞五小时。
