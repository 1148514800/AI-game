# Phase 5 当前授权

在审核基线 `9a1290e9dfcff86ecf6600183cf446948e653c59` 上继续开发《雾海行纪》。本轮范围与验收见 [Phase 5 执行规格](docs/PHASE5_TASK.md)。以下历史阶段的范围限制由本节覆盖，兼容性、事务和合规素材要求继续有效。

- 保留雾灯谷地图、三名居民及既有回归。新工程、时间与遗迹通过正常动作和版本化 SQLite 存档运行。
- 规则校验贡献数量、权限、位置与施工。自动衔接依赖明确授权，玩家对话优先，模型调度与游戏时间独立。
- 本轮以 Mock 与本地 HTTP 桩执行验收。付费 Live、远程推送及公网部署需另行授权。
- 原生验收证据写入 `evidence/phase5/`，保留历史记录。完成本地提交后停止在 Phase 5。

## 历史阶段

# AG-6 / Phase4 当前唯一授权（覆盖以下旧阶段限制）
用户2026-11-26明确授权仅Phase4《建立小型 AI 社会》，审核基线 8e4cb58e3f5d137d1b77934ad576ae8082d5c3c1（GitHub `Add Phase 3.1 collaboration and fix model action requests`，已包含 LLM_JSON_MODE / speechReplySchema / D026 与 LLM_ENABLE_THINKING 三态）。完整范围和验收见 docs/PHASE4_TASK.md，必须先完整阅读。本机 Codex CLI 与本地 commit 已授权；禁 push/PR/部署/Live/私密配置/触碰 Mac，禁进入 Phase5。所有新增证据只写 evidence/phase4，不覆盖历史证据。必须保留 Phase0–3.1 有效回归（基线 64 单元 / 5 集成 / 13 浏览器），不得无理由删除断言。无明确 Live 额度授权则不调用，不得把未验证的真实模型完整协作标为通过，不虚构 Live 分数。

工程目录 /workspace/mistsea-phase4。不得覆盖或重置 /workspace/mistsea-phase3_1（HEAD 11b7b8d）与 /workspace/mistsea-phase3_1-mac-sync-20261126。不以旧 Phase3.1 本地提交替代新基线。

本轮编码交付保留工作区改动，由协调者在原生完整验收后执行本地提交。协调者在正常 box 环境执行完整安装、类型检查、测试、构建、生产冒烟、不少于 30 分钟三 NPC Mock 长测、真实截图视觉检查、本地提交与打包。验收以本轮命令实际退出码为准。Mock 与用户既有 Phase3 采集验证分别记录。

## 以下保留 Phase3.1 历史指令（被本轮覆盖的限制不再适用）
# AG-5 / Phase3.1 当前唯一授权（覆盖以下旧阶段限制）
用户2026-11-25明确授权仅Phase3.1，在审核基线842342a1021751d0e33ac7b2a3db27f0e0bca9f1续作。完整范围和验收见 docs/PHASE3_1_TASK.md，必须先完整阅读。允许本机Codex CLI和本地commit；禁push/PR/部署/Live/私密配置/触碰Mac。所有新增证据只写evidence/phase3_1，不覆盖历史证据。新30min soak不强制但调用风暴/性能需本轮回归。只岑砚，完成停Phase3.1。

本轮开发以本机 Codex CLI 续作。协调者使用 `python3 scripts/verify.py` 原生复核 A–F、视觉检查并提交打包。编码阶段保留授权添加的文件与历史证据，验收以本轮命令实际退出码为准。用户确认的 Phase3 Live 与本次 Phase3.1 Mock 验证分别记录。

本轮最终原生验证：64单元、5集成、13浏览器及全部13项验证命令退出0，另2次完整A–F正常UI复测通过。证据 evidence/phase3_1/verification-20261125-223512-151573/。Live未调用/未验证。完成即停，仅等待验收，不据此开始Phase4。

## 以下保留Phase3历史指令（被本轮覆盖的限制不再适用）
# AG-4 / Phase3 当前授权（覆盖下文旧阶段限制）
用户2026-11-25明确授权仅Phase3。Phase0/1验收、Phase2源码审核及用户本人真实AI接入验证已通过；这是用户验证，不是本代理的Live数据。仅岑砚自主思考/1–3步严格计划/受控真实行动/A*/持久记忆/轻量Debug/共享预算，保留Phase2对话、thinking兼容、全部原玩法和有效测试。禁止Phase4、其他NPC智能、社交经济战斗新地图、屋顶建造系统、大型框架。
无本轮Phase3真实调用额度授权：默认LLM_AUTONOMY_ENABLED=false，不读取.env/开发工具密钥，不付费Live；Mock与HTTP桩不是真实AI规划。仅本地Codex CLI、最终本地commit，无push/PR/部署，不碰Mac/旧Phase2/同步快照。完整范围见docs/PHASE3_TASK.md。历史证据不删改；新证据仅evidence/phase3。必须真实30分钟elapsed、有实际动作资源循环的Mock自主soak（不能虚拟时钟代替），报告实际退出状态，不伪造通过。附件每件<25,000,000字节。

本次编码交接由协调者在原生环境运行 `python3 scripts/verify.py` 与 `node --import tsx scripts/soak-phase3.mjs --duration 1800`。记录实际状态，完成验收后由协调者执行本地提交与打包。

## 以下为Phase2历史规则（仅兼容性与未被本轮覆盖条目继续适用）
# 开发 AI 必须遵守
- 唯一完整设计基线：docs/GAME_DESIGN.md（原始 PDF 同目录）。优先服从本轮用户的范围限制。技术变更只登记 docs/DECISIONS.md，不复制相互冲突的设计。
- 当前唯一授权为 AG-3 / Phase 2《接入第一名 AI 角色》，见 docs/PHASE2_TASK.md，覆盖旧 Phase0/1限制。仅岑砚文字对话、轻量服务端LLM适配/有限短期上下文/持久预算、低风险实测性能优化。交付即停，不进入Phase3；禁止自主行动、长期记忆、社交、战斗、经济或多人系统。
- 未授权实际游戏Live调用、未提供专用Key/额度：只实现配置和Mock/本地HTTP假供应商验证；真实模型待用户配置验证，不得宣称完整Phase2 PASS。不得借用开发工具/其他环境凭据。无付费、购买、部署、远程push/PR，不修改工作区外无关文件。
- TypeScript、Phaser 4.2.1、Vite、单 Node/Fastify、WebSocket、SQLite、Zod、Playwright；保留稳定 ID 和清晰目录，不引入微服务/Redis/向量库/Agent 框架。
- 仅官方来源且准入完成的 CC0 素材；所有运行素材本地化并逐文件列 manifest、哈希与修改。下载更新必须重新核查授权。
- 资产脚本 `npm run assets:fetch && npm run assets:prepare`；Python Pillow 是离线重建资源的开发工具，游戏运行无需 Python。
- 使用 `python3 scripts/verify.py` 实际运行安装、开发启动、类型检查、单元、本地 HTTP/WS 集成、浏览器、构建、客户端 dummy Key 扫描及生产冒烟；截图必须是真实浏览器输出，必须看图并修复。不得把未执行项写为 PASS。
- NPC仍固定位置，只有岑砚可配置真实生成对话；Mock必须显著标识模拟，不冒充真实AI。所有玩法副作用由服务端校验与事务持久化；不得使用客户端注入或改库背包代替真实完整试玩。
- Phase0/1 都已获用户验收，保留原设计 PDF 和两个阶段的历史证据；本轮已完成原生离线复核及本地提交，最终ID见DELIVERY_COMMIT.txt，真实模型仍待配置验收。严禁push/远程PR/部署。附件每件严格小于25,000,000字节。
- 原始素材处理与正式地图/动画数据独立；重复素材处理不得覆盖正式地图、扩展manifest。测试验证清单与文件一致，不固定素材数。
- 用户优先 Codex CLI gpt-6.2 sol high；调用前验证参数和可用性，不虚构模型名、额度或重置时间。额度确实用尽时保存工作并报告，勿用 sleep 阻塞五小时。
- 默认单人存档为 `saves/foglamp-valley.sqlite`，可用 `MISTSEA_SAVE` 指定隔离路径。浏览器测试与生产冒烟均用临时存档，Phase2 日志和真实浏览器截图写入 `evidence/phase2/`。回环和 Chromium 若受沙箱限制，记实际错误、继续可执行验收并交协调代理复核。

- Phase2证据独立写入 evidence/phase2/，不得覆盖Phase0/1历史。性能先在指定基线真实采样再改，并复测同环境。已采原样 Canvas 基线见 `evidence/phase2/performance/before-tHNDhF/report.json`。模型仅文本、无工具/行动权限，异步且不得阻塞tick或持SQLite事务；取消/预算/历史必须安全。
