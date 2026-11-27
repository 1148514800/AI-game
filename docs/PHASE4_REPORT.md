# 雾海行纪 Phase 4 验收记录

工作区 `/workspace/mistsea-phase4`，分支 `ag-6-phase4`。审核基线 `8e4cb58e3f5d137d1b77934ad576ae8082d5c3c1`。本文件是本轮原生验收的诚实记录。完成即停 Phase 4，不进入 Phase 5。未 push、未开 PR、未公网部署、未调用 Live / 付费 API，也未读取私密 `.env`、密钥或个人存档。

Phase 3.1 工程与离线验收仍按原记录成立。用户此前确认过 Phase 3 真实模型自主采集。**Phase 3.1 真实模型完整协作与本阶段 Live 均未跑，不得标为通过。** 见 [Phase 3.1 历史记录](PHASE3_1_REPORT.md)。

时间均按用户时区 Asia/Shanghai（UTC+8）书写。

## 本轮修了什么

在 Codex 落地的三角色/社交实现之上，针对原生验收中的真实失败作了修复，没有放宽保护性断言，也没有改短 `#game` 的 `data-ready` 等待。

1. **客户端拒绝游戏状态。** 健康检查仍要求 `phase === 3`，与服务端 `phase: 4` 不一致；快照里过渡字段 `cenyan` 无法通过 v4 严格 `saveSchema`。客户端改为校验 phase 4，解析前去掉过渡 `cenyan`，再用 `actors.cenyan` 挂回。这是更早批次里「收到无法读取的游戏状态 / `#game` 的 `data-ready` 一直为 false」的根因。故意缺桥素材的 `asset-failure.png` 不是那批 12 个失败的根因。
2. **三 NPC 共享账本与采集回退。** 冷却采集改为 `step-retry` 而不是 `step-failed`，避免指数退避；Mock 采集跳过刚冷却的目标。集成/e2e 中的 Mock 限额按三人共用账本上调，施工时长断言改为 `workMs / workers` 下限，仍禁止瞬间完工。
3. **服务关闭与 3003 隔离。** `SIGTERM` 后若 `app.close()` 挂起，5 秒强制 `process.exit`；`preClose` 调用 `closeAllConnections()`；对话 `close()` 对未结束任务加超时；监听失败必须退出。测试在启动前释放被泄漏的 Mistsea 3003，停止时 SIGTERM 后限时 SIGKILL。这修复了后段用例连到脏存档（赠送被默认 Mock 收下、出生点跑到桥边、`backend.stop()` 后 `data-ready` 仍为 true）。
4. **建议按钮与记忆/抵达文案回归。** 对当前居民显示「请岑砚修桥」等可访问名，而不是笼统的「请居民修桥」。来自旅人的 claim 在调试记忆中仍标「旅人声称」。跟随抵达旧桥的结果句保留「同行抵达旧桥边」，不因地名「雾灯旧桥」把子串插到中间。
5. **对话面板被撑出视口。** 交接区展开后，关闭按钮被 `.viewport` 裁切，D–H 在贷款截图后无法点「关闭对话」。为对话面板加上 `max-height` 与粘性头栏。
6. **D–H「开始施工」定位。** 玩家对准旧桥时，侧栏 `#bridge-work` 会隐藏，主交互按钮的可访问名是「开始施工 E」。`getByRole({ name: "开始施工", exact: true })` 既点不到隐藏侧栏按钮，也无法匹配带 E 的主按钮，用例会空等直到 220 秒；期间洛舟可独自做完 14 秒施工，按钮随即消失。定位改为与 Phase 3.1 相同的 `name: "开始施工"`（非 exact），仍要求玩家与洛舟都有 `workMs`、旧桥实际修好。没有改短超时或取消这些断言。

## 工程与 Mock 验收

包装用验证目录：`evidence/phase4/verification-20261126-172149-373584`。该目录内 `python3 scripts/verify.py --with-soak` 于 17:21:49 在正常 box（非受限 sandbox）启动：`npm ci`、开发冒烟、严格类型检查、性能脚本类型检查、74 单元、6 集成、Phase 3.1 短同行回归、构建、客户端密钥扫描、生产冒烟、两份 soak 脚本语法检查均为退出 0。

同一次验证里的首次 `npm run test:e2e` 为 **14 通过 / 1 失败**（D–H 在「开始施工」上 220 秒超时）。失败日志保留为 `e2e-before-dh-locator-fix.log`。修正定位后，于 18:22:30–18:27:45 在同一证据目录重跑完整 15 项 e2e，结果为 **15 通过 / 0 失败（5.2 分钟）**，其中 D–H 用时 57.3 秒。`command-results.json` 中 e2e 一行已按这次真实重跑改为退出 0，并指向上述保留日志。soak 在定位修正之前就已经对同一产品代码跑完（测试定位不改变服务端/连接/长跑行为），见下一节。

| 项目 | 结果 |
|---|---|
| `npm ci`、开发冒烟 | 退出 0 |
| 严格类型检查、性能脚本类型检查 | 退出 0 |
| 单元 | 74 通过 / 0 失败 |
| 集成（回环 HTTP/WS + Mock） | 6 通过 / 0 失败 |
| Phase 3.1 短同行 `regress-phase3_1.ts` | `phase31-follow-ticks.json` 为 PASS |
| Playwright | 列出 15 项；定位修复后全通过 |
| 生产构建、dummy key 扫描、生产冒烟 | 退出 0 |
| Phase 3.1 A–F 合作 UI（回归） | 通过，轨迹含 A–F 各步，合作截图 10 张 |

A–H 场景中：自主三居民采集/协商/修桥、玩家前景对话、出借与重启后归还、交材并加入施工、调试面板查看阿禾约定，均在 Mock 与正常键盘/按钮下通过。集成与浏览器用例没有注入库存、传送或用 WebSocket 代替玩家操作。

## 视觉审查

截图来自上述官方目录在 18:22 e2e 重跑中的产物，路径均相对仓库根：

- `evidence/phase4/verification-20261126-172149-373584/society/A-three-residents.png`
- `evidence/phase4/verification-20261126-172149-373584/society/C-autonomous-bridge.png`
- `evidence/phase4/verification-20261126-172149-373584/society/F-loan.png`
- `evidence/phase4/verification-20261126-172149-373584/society/H-restart-and-debug.png`
- 合作轨迹截图：`evidence/phase4/verification-20261126-172149-373584/cooperation/`（10 张 PNG）

审查结论：A 能同时看到岑砚、阿禾、洛舟名牌与「赶路 · Mock 模拟」，布局清楚。C 中旧桥材料 6/6、2/2、进度 100%，三人回家休息，近况记载合力修通与分工时；目标已切到「查看航标遗迹」。开局贡献区只先列出旅人与岑砚，有贡献后 C/H 会列出其余居民，不视为破版。F 对话头栏可见「关闭对话」，建议钮为「请阿禾修桥」，出借回执成立；交接区因限高略裁切底行，可滚动，关闭按钮可点。H 在旧桥渡口看到已修好的桥面，旅人施工 6.55 秒、洛舟 7.03 秒、同时施工 6.05 秒，调试面板选中阿禾并显示归还约定与相关记忆。未发现挡住交互的重叠名牌或错误目标文案。

## 性能与两轮 1800 秒 Mock 长测

`npm run soak:phase4` 要求真实墙钟至少 1800 秒、三名 Mock 居民、`mockOnly === true`。下面两轮都满足，均不是短跑冒充。配置只用于长测额度，不影响游戏默认值或 Live。

### 第一轮（保留）

目录：`evidence/phase4/verification-20261126-154335-643457/soak-ZqB0WI`。约 15:55 起，16:40 左右结束。`status` PASS，`elapsedMs` 1800008.108949，`mockOnly` true，`errors` []。快照 7225，持久化修订 1022，样本 110。采集 14 木 / 2 石。旧桥已修通（进度 14000 ms）：旅人贡献 0；岑砚木 4 / 施工约 4.50 秒；阿禾木 2 / 约 4.75 秒；洛舟石 2 / 约 4.75 秒。`finishedTalks` ok 2 / failed 0。发言 岑砚 1、阿禾 1、洛舟 2。`peakPending` 2，`peakQueued` 0。`clientFps` 53.82。tick 耗时均值 0.35 ms、P95 0.81 ms。tick 间隔均值 55.85 ms、P95 50.60 ms。

**必须如实记录的异常：** 该轮 `tickIntervalMs.max` 约 165833 ms，`clientFrameIntervalMs.max` 约 165777 ms。样本 56→57 在 elapsed 约 856 s 到 1031 s 出现约 174.5 秒间隙，与上述 max 同一量级，服务 tick 与客户端帧同时停住。均值和 P95 仍然接近 50 ms / 16.7 ms，不像持续卡死。更可能是宿主调度或事件循环被长时间暂停，而不是游戏逻辑稳定跑出 165 秒一帧。暂停结束后长测继续跑满 1800 秒并 PASS。同批次首次 e2e 为 10 通过 / 5 失败，不得把该批次 e2e 写成全通过；生产冒烟已通过。

进程内 RSS 样本约 238.5 → 177.8 MB，峰值约 245.8 MB，未见单向膨胀到失败。

### 第二轮（包装用验证目录内）

目录：`evidence/phase4/verification-20261126-172149-373584/soak-flmxXy`。17:32:26 起，随 `verify.py --with-soak` 自然结束。`status` PASS，`elapsedMs` 1800009.405397，`mockOnly` true，`errors` []。快照 7558，持久化修订 1083，样本 119。采集与修桥结果同类：旅人贡献 0，岑砚木 4 / 约 4.50 秒，阿禾木 2 / 约 4.75 秒，洛舟石 2 / 约 4.75 秒。`finishedTalks` ok 2 / failed 0。发言同样为 1/1/2。`peakPending` 2，`peakQueued` 0。`clientFps` 57.60。tick 耗时均值 0.44 ms、P95 0.75 ms、最大 1089.53 ms。tick 间隔均值 52.19 ms、P95 50.61 ms、**最大 13012 ms**。客户端帧间隔均值 17.36 ms、P95 16.70 ms、最大 12983 ms。样本仅在 elapsed 约 989–1012 s 见到约 23 秒间隙，没有再现第一轮那种 165 秒停顿。

两轮都是 Mock 三居民从空世界自主凑材并修好旧桥。它们证明这段墙钟内无错误、工程守恒、账本能结算，**不能外推 Mac/GPU 帧率、长期数小时运行，也不能代替 Live 费用或延迟。** Mock token 只是保守账本占用。

## 存档迁移

规则层用单元测试覆盖 v1–v3 备份迁移、账本延续与 schema v4。本轮没有打开或改写用户个人存档。不得把「真实玩家旧档在其机器上的迁移」标为已验。

## Live 与其它未验项（不得标为通过）

- **Phase 4 Live / 真实模型 / 付费 API：未跑。** 没有供应商输出、计费、延迟或真实意愿质量数据。对话与自主长测全部是 Mock。
- **Phase 3.1 真实模型完整协作：未跑。** 本轮只再次回归了 A–F 的 Mock UI。
- 未 push、未 PR、未公网部署。
- 未在用户 Mac 或其它真机浏览器上手动通玩。本轮浏览器证据仅限箱内 Playwright Chromium。
- 第一轮 soak 中约 165 秒的调度/循环停顿没有单独做成稳定复现实验；第二轮未再现同尺度停顿，仍不能声称任意宿主负载下都没有长间隔。
- 默认游戏额度、Live 开关与长测专用 Mock 限额不是同一套配置，不能混用长测数字当作默认 Live 预算。

## 阶段结论

Phase 4 工程与 Mock 原生验收（类型检查、74 单元、6 集成、15 e2e、生产冒烟、两次真实 1800 秒三 NPC Mock 长测、A–H 截图与视觉审查）已完成。Live 未跑。完成即停 Phase 4，禁止进入 Phase 5。
