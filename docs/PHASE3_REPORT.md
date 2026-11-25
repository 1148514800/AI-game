# 《雾海行纪》Phase 3 / AG-4 验收报告

## 结论与授权边界

- 工程实现与离线验收完成：45 单元、4 本地 HTTP/WS 集成、12 Playwright 全通过；真实 elapsed 30 分钟 Mock 自主长测通过。
- **Phase3 Live 未验证**：没有本轮真实调用额度或专用 Key 授权，未调用真实供应商，不能宣称完整 Live 阶段验收通过。HTTP 供应商桩不是 Live 能力验证，Mock 是确定性测试响应。
- Phase0/1 已获用户验收；Phase2 源码及真实模型接入由用户本人验证，未虚构模型名、评测成绩或代理 Live 用量。
- 基线 `4d8572ff0aa64692d4e09b4b7e5b488bf8f7e70e`，工作目录 `/workspace/mistsea-phase3`。只完成 Phase3；未推送、PR、部署、付费或进入 Phase4。

## 基线、资料与兼容

已读 AGENTS、README、GAME_DESIGN、29页原PDF、ROADMAP、DECISIONS、PHASE2_REPORT。原PDF SHA256 `8623390d64c8f0684e89749247cbf2d3206f3c859bd0c7e34f8567a5d252efc7`，文字对照见 `design-integrity.json`。506 个历史证据逐文件字节不变，45 个运行素材哈希通过。未新增付费或替代素材。

旧 `/workspace/mistsea-phase2` 保持干净，HEAD `628c80632c7108cb639d52e03f7bccef2e7f906c`；Mac 同步快照仍为168文件/12,968,878字节。五项 thinking 改动已与本轮 GitHub 基线核对，`LLM_ENABLE_THINKING` 空值省略，true/false 布尔透传，原回归保留。

实际使用 Codex CLI gpt-6.2-sol/high、workspace-write 完成实现及专项复核，两轮均退出0。日志为 `codex-implementation.log` / `codex-review.log`。沙箱 EPERM 与后续原生执行分开记录，没有更改沙箱、借用游戏密钥或调用开发订阅的游戏接口。

## 工程实现

- 仅岑砚升级为独立角色：稳定ID、真实位置朝向、木石背包、三个轻量目标、1–3步计划与执行索引。阿禾、洛舟不变。屋顶愿望仅作储木，不新增修屋系统。
- 八像素四向 A* 找可交互邻点，20Hz tick 按既有88px/s连续推进。复用河桥、建筑树石和角色碰撞；客户端用运行态坐标、四向动画、插值与脚底Y遮挡。未修桥不可绕行或穿河。
- 共用受控采集/冷却/库存/交付/施工规则。NPC必须用自己的六木两石交材；同一时刻一名施工者，累计原有14秒。资源、材料、回执、下一执行步与重要记忆同事务，模型没有真实状态写权限。
- SQLite v2 快照及记忆表；v1 在验证后先 `VACUUM INTO` 相邻 `*.pre-phase3.sqlite` 备份，再事务迁移，保留回执。新启动重验未完成步骤，不重复扣材。坏档明确报错、不静默清空。
- 记忆区分规则fact、旅人claim、角色opinion，稳定ID/角色/时间/来源/事件/主题；按最近与简单主题相关性有界取用。感知仅自身、附近人物资源、已知地点和公共桥况，不传玩家私包或全库。
- 对话、自主共用原 provider、人格、生命周期和持久账本。普通聊天可纯文本，模型自行理解自由行动请求并可返回 strict JSON 可选计划，不以固定关键词限制 Live 理解。非法动作、目标、额外字段、代码/任意坐标与格式错误拒绝。
- 活跃首次、关键事件及约120秒周期调度；有效计划不重复请求。失败退避、不补跑离线调用。每NPC一个在途、最多一个优先对话等待槽；暂停/断线/重开/代次与交互距离阻止旧结果。有效交谈仅让岑砚驻足，不阻塞世界和渲染；关闭后已接受计划继续。
- Live自主默认 `LLM_AUTONOMY_ENABLED=false`；Mock另用 `LLM_MOCK_AUTONOMY_ENABLED` 显式开启。共享分钟/滚动60分钟/累计次数、Token及金额账本，自主另受4/24/300默认请求子限，保留对话请求及25%总预算空间。失败、取消、缺usage保守占用，重开/重启不免费重置。
- 简洁真实执行状态及折叠Debug展示目标/步骤/库存/回执/记忆/触发/耗时/计入用量。安全文本渲染与中文IME保留，不显示Key、原始供应商错误或私有思考。

位置和等待/休息时间约每5秒及暂停、断线、正常退出保存；异常终止最多回退约5秒这类进度。采集、材料、计划步、记忆及施工tick仍立即事务，不以丢正确性换性能。

## 实际命令与回归

最终完整原生批次：中国标准时间 2026-11-25T19:51:34.733909+08:00 至 2026-11-25T19:55:26.722245+08:00。日志目录 `evidence/phase3/acceptance-final/`，汇总 `summary.json`。

| 命令 | 退出码 | 耗时 | 日志 |
|---|---:|---:|---|
| `npm ci` | 0 | 2.821 s | `npm-ci.log` |
| `npm run typecheck` | 0 | 0.519 s | `typecheck.log` |
| `npm test` | 0 | 1.719 s | `unit.log` |
| `npm run test:integration` | 0 | 58.032 s | `integration.log` |
| `npm run test:e2e` | 0 | 165.205 s | `e2e.log` |
| `npm run build` | 0 | 1.52 s | `build.log` |
| `node scripts/production-smoke.mjs` | 0 | 2.169 s | `production-smoke.log` |

实测45单元、4集成、12浏览器，0失败、0跳过；25/2/10基线有效用例全部保留，新增20/2/2。另有 dummy-only 原生构建与客户端48文件扫描、开发入口冒烟、最终生产冒烟均退出0，见 `native-dummy-key-*`、`native-dev-smoke.log`、`native-production-post-sentinel.log`。没有真实API Key注入测试。

覆盖15项：无对话自主启动；strict计划；非法动作/目标；A*与动态碰撞；独立库存；玩家争抢资源；NPC交材/14秒施工；规则/模型失败退避；SQLite记忆与服务重启；自然请求实际采集；关闭/暂停/断线/重开/代次保护；共享持久预算；故障不阻游戏；旧档备份迁移及完整玩家路线；至少30分钟真实Mock运行。主要见 `tests/phase3.test.ts`、`tests/dialogue.integration.ts`、`tests/dialogue.e2e.ts` 和原 `scene.e2e.ts`。

玩家正常初始空包，经键盘/UI采齐六木两石、交材、施工、过河、查看遗迹、刷新并真实停止/重启子服务，全程通过，没有改DB或注入背包替代试玩。NPC浏览器旅程另从空包自主采集交材施工，玩家仅正常步行观察。

首次沙箱安装/监听/浏览器遇EPERM，保留原日志；原生最初还发现客户端残留Phase2握手、新用例漏点发送/直走撞建筑、旧静态测试路线未避让运行NPC等问题，均修复后完整重跑。保留 `validation-native-1/`、`validation-native-final/`、`browser-final/` 失败记录，不以新文件存在冒充通过。旧断言未删除，键盘助手改读真实NPC碰撞，动画改在可达公共区高频观察。

## 真实30分钟Mock长测

- 开始/结束：中国标准时间 2026-11-25T19:41:31.678000+08:00 → 2026-11-25T20:11:31.772000+08:00。
- 活跃 elapsed **1800.007s**，总 elapsed 1800.093s，退出 0，结果 PASS。PID 316881。
- 计数：{"collections": 202, "recoveredHarvests": 13, "cooldownFailures": 25, "deliveries": 13, "bridges": 13, "rests": 12, "completedCycles": 12, "modelRecovery": 13, "motionSamples": 5548}；在途峰值 1、排队峰值 0。
- 真实20Hz定时器、回环WS和独立临时SQLite；循环含格式失败、冷却失败、同一资源真实恢复重采、六木两石交付、14秒施工、储木、休息及普通重开。没有虚拟时钟或空闲挂满30分钟。
- 为持续验证显式提高Mock限额：分钟30/自主25，60分钟600/自主500，累计1500/自主1200，Token12,000,000；同一账本贯穿重开。并不修改Live默认配置。
- 1160个稀疏状态、35888个tick耗时样本、30个分钟窗口；逐状态复核非负有界库存、单次采集增量、准确六木两石扣除、非重开期间施工不倒退、观测运动无超速跳跃。19个服务端/共享数据/长测脚本哈希与最终代码一致。
- tick回调加权均值 0.383ms，分钟窗口P95范围 0.355–3.036ms，峰值 31.585ms；前三/后三窗口均值 0.327/0.511ms。RSS首/末/峰值 150417408/122826752/150417408字节。分钟窗口处于不同采集/施工阶段，首尾均值不是等负载优化比；这是本次窗口观察，不外推长期无退化。

完整证据：`soak-vLUMsY/summary.json`、`soak-vLUMsY/trajectory.jsonl`、`soak-native-1800.log`、`soak-audit.json`，均位于 `evidence/phase3/`。Mock计入Token是保守账本占用，不是供应商实测usage或费用；金额未知保持null。

## 性能实测与局限

最终 Linux headless Chromium、1280×960，每场景约5秒/301帧间隔、100个真实tick回调；与长测并行。实际Canvas2D可用，WebGL/WebGL2均不可用、GPU软件路径。不改变既有渲染器或引擎，Phase2历史before/after证据保留。

| 场景 | 观测RAF FPS | 帧间隔P95 ms | tick均值/P95 ms |
|---|---:|---:|---:|
| idle | 60.00 | 16.80 | 0.064 / 0.100 |
| autonomy-active | 60.00 | 16.70 | 0.318 / 0.794 |
| npc-construction | 60.00 | 16.70 | 2.174 / 3.909 |
| dialogue-pending | 60.00 | 16.80 | 0.095 / 0.279 |

`performance-final/results.json` 保留原始RAF时间戳、边界状态、实际context探测和截图，浏览器错误为空。自主活动窗口包含移动/采集/停留，非整窗持续移动。RAF是本机浏览器节奏，不能视为用户Mac实机FPS或GPU吞吐；不是新的严格A/B优化成绩。施工耗时未构成50ms预算瓶颈，因此保留立即持久化。

## 真实截图与视觉检查

以下均在 `evidence/phase3/acceptance-final/`：

- `phase3-action-accepted.png` / `phase3-action-harvest.png`：接受不等于完成、真实后续采集。
- `phase3-npc-moving.png` / `phase3-npc-collected.png`：运行态四向动画、全谷采集位置、独立库存与规则回执。
- `phase3-npc-delivered.png` / `phase3-npc-building.png` / `phase3-npc-bridge-restored.png`：材料来自NPC、施工中及真实修通前后。
- `phase3-npc-debug-narrow.png`：390px Debug；`dialogue-thinking.png` / `dialogue-budget.png` / `dialogue-narrow.png`：等待、失败预算及窄屏对话。
- `beacon-ruin.png`：玩家独立正常旅程终点；其余地图、居民、背包、桥前后截图同目录。

已实际Read检查，见 `visual-review.json`。修复回执标签换行与窄屏Debug半栏拥挤；用正常键盘绕建筑到观察点，全谷视角让采集NPC可见。`browser-npc-trajectory.json` 为真实Playwright DOM稀疏观察（32条、12个位置），不是伪造WS轨迹；来源trace哈希随附。长测另有完整规则事件JSONL。

## 交付与未验证

本地Git提交ID见交付的 `DELIVERY_COMMIT.txt` 及相邻delivery-info.json；源码、锁文件、45运行素材、授权、原PDF、全部既有提交证据与新增文本日志/PNG/JSON轨迹组成互补core/evidence ZIP，同根 `mistsea-phase3/` 解压到空目录即可还原，每件严格小于25,000,000字节。排除.env私密配置、个人存档、依赖、构建、未用大源包。约587MB可重建Playwright二进制trace仅保留本机且Git忽略，不塞入附件；提交并交付真实PNG、执行日志及提取观察轨迹，不删原始trace。

尚未验证：Phase3真实供应商JSON兼容、真正自主决策质量/人格与世界事实理解、真实Token/费用、用户Mac帧率、30分钟以外长期运行。等待用户专用配置及明确调用预算后再验Live。当前只交付Phase3离线工程，不宣称完整Live验收通过，不继续Phase4。


本地工程与全部离线证据提交：`8763f2df0867107c36753552f2fbcbb6c464a646`。其后仅补充本提交记录和交付恢复说明；最终交付HEAD由 `DELIVERY_COMMIT.txt` / delivery-info.json 登记，未推送。
