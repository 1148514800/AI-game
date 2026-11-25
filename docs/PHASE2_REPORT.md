# 《雾海行纪》Phase 2 / AG-3 交付报告

更新：2026-11-25（Asia/Shanghai，UTC+8）。指定并实际核对的 GitHub 基线：`62c5c2a10dff3afc18dbe875341f3a274ca3b436`；工作分支 `ag-3-phase2`，工程 `/workspace/mistsea-phase2`。原 `/workspace/mistsea-phase1` 与历史归档未改动。

## 结论与验收边界

|项目|结果|
|---|---|
|本阶段工程实现|完成：仅岑砚文字对话、可配置Live、明确Mock、生命周期、持久预算及低风险画面更新优化|
|离线验证|通过：最终25单元+2本地HTTP/WS集成+10浏览器；安装、开发入口、类型、构建和生产冒烟全部退出0|
|真实模型验收|**未运行、未通过验收**。无项目专用Key或实际付费调用授权；未寻找/借用开发工具凭据|
|性能|已保留同环境before/after原始采样；**没有测得FPS改善**，未复现用户Mac低帧率，不能外推硬件GPU表现|
|完整Phase2最终验收|**待用户配置Live及验收，不标完整PASS**；停在Phase2，未进入Phase3|

## 实际工程实现与决策

- 原48×48雾灯谷、45个本地CC0运行文件、四角色、采集/背包/修桥/过河/遗迹、SQLite存档与全部有效旧测试保留。不重建架构，不新增地图或素材；授权和逐文件哈希仍见 `docs/ASSETS.md`、`assets/manifest.json`。原29页PDF和完整GAME_DESIGN逐页正文保留，转换正文与PDF提取文本正规化核对一致，见 `evidence/phase2/baseline-integrity.json`。
- 实际优先使用Codex CLI 0.166.0、`gpt-6.2-sol`、high；性能工具、主体实现、定向审计三次编码均退出0。记录见 `evidence/phase2/codex-check.log`、`codex-performance.*`、`codex-implementation.*`、`codex-audit.*`。没有证据表明额度耗尽，未伪造重置时间。
- `src/server/dialogue/` 独立适配Chat Completions：异步fetch、Abort取消/超时、严格非空有界文本，不传工具/行动、不盲发thinking或response_format。输出限制字段按能力配置为max_tokens或max_completion_tokens。URL仅服务端配置，HTTPS（本地回环桩可HTTP），拒绝URL内凭据/查询/片段。没有玩家任意URL或工具入口。
- 人格独立配置 `data/npcs/cenyan.json`：谨慎务实、重承诺、漏雨屋顶个人目标、有限公共事务意愿、知识和表达边界。岑砚位置仍确定，阿禾洛舟保留原介绍。**Mock是固定模拟，不是真实生成能力**。
- 上下文独立组装：稳定人格/目标/世界知识、服务端公共桥况告示、明确标为玩家陈述的输入、最多8个成功近期往返，总上下文保守估算上限；不dump数据库、私人背包或其他人物记忆。失败/超时/取消/过期回复不记为经历，重开和服务重启清除短期历史。不实现长期记忆或自主行动。
- 校验有效连接、岑砚唯一目标、距离、合法长度、单NPC在途、对话ID和世界代次。关闭、离距、暂停、重开、断线、其他标签接管和超时会取消/失效；旧回复无法回填新会话。等待模型不持SQLite事务、不阻塞20Hz tick，模型输出不进入行动执行器。
- `src/client/dialogue.ts` 支持头像/名字/职业、自由中文、多轮、thinking、错误/手动重试、关闭和清楚的Mock/Live标识。安全textContent，不执行HTML。对话开启清移动，输入WASDE和中文IME候选确认不误触游戏，关闭后恢复；非模态界面允许暂停/全谷视图，渲染持续。390px窄屏实测无横向溢出。
- 未提供真实Key。默认LLM_ENABLED=false。完整中文配置见 `.env.example` 和 README；`.env.*`（除example）忽略。Live要求明确模型、专用Key、输入/输出价格和总美元上限，未配置时不给伪装真实回复；错误不会阻断原玩法。无自动无限重试。

### 持久成本与预算

- 独立 `<存档>.llm.sqlite` 账本，Mock/Live分账。记录时间、NPC、模型、状态、耗时、供应商usage及额外计费明细；不记录密钥，不把未知Token/费用写成0或虚构已结算账单。
- 默认每分钟8次、持久滚动60分钟40次、累计500次/500000 Token，输入和输出有界（默认输出320 Token、超时12秒）。单NPC仅一个在途。无玩家发送不自动调用。
- Live金额上限和两个每百万Token单价必须显式配置。请求前原子保守预留；有效usage后结算。缺usage、非空全零usage、失败/取消/进程中断保留占用；重开和简单重启不能清限额。供应商额外未分类Token按较高价格保守占用，推理子集不重复加总。
- 真实供应商可能仍对取消收费；本项目保守记账不等于供应商最终账单。账本损坏/配置失败明确提示，对话不可用但原玩法保留。HTTP假供应商证明适配及限额逻辑，**不是实际付费调用证据**。

## 最终真实执行结果

最终原生全套运行于2026-11-25 00:40–00:43（UTC+8），Node24.22.1/npm11.21.1。逐项退出码见 [evidence/phase2/verification-20261125-004035-665303/command-results.json](../evidence/phase2/verification-20261125-004035-665303/command-results.json)。

|命令|退出码|结果|日志|
|---|---:|---|---|
|`npm ci`|0|锁文件安装成功|[npm-ci.log](../evidence/phase2/verification-20261125-004035-665303/npm-ci.log)|
|`node scripts/dev-smoke.mjs`|0|实际开发入口，隔离存档/端口|[dev.log](../evidence/phase2/verification-20261125-004035-665303/dev.log)|
|`npm run typecheck`|0|通过|[typecheck.log](../evidence/phase2/verification-20261125-004035-665303/typecheck.log)|
|`node node_modules/typescript/bin/tsc -p scripts/performance/tsconfig.json`|0|通过|[performance-typecheck.log](../evidence/phase2/verification-20261125-004035-665303/performance-typecheck.log)|
|`npm test`|0|25/25，0 跳过；原14项保留|[unit-test.log](../evidence/phase2/verification-20261125-004035-665303/unit-test.log)|
|`npm run test:integration`|0|2/2，本地HTTP假供应商+WS，不是真实模型|[integration.log](../evidence/phase2/verification-20261125-004035-665303/integration.log)|
|`npm run test:e2e -- --list`|0|发现10项|[e2e-list.log](../evidence/phase2/verification-20261125-004035-665303/e2e-list.log)|
|`npm run test:e2e`|0|10/10，0跳过；原7项保留|[e2e.log](../evidence/phase2/verification-20261125-004035-665303/e2e.log)|
|`npm run build`|0|生产客户端和服务端构建成功|[build.log](../evidence/phase2/verification-20261125-004035-665303/build.log)|
|`node scripts/assert-client-no-secret.mjs`|0|dummy sentinel未进入客户端构建|[client-key-sentinel.log](../evidence/phase2/verification-20261125-004035-665303/client-key-sentinel.log)|
|`node scripts/production-smoke.mjs`|0|实际编译产物、HTTP/WS/SQLite/浏览器通过|[production-smoke.log](../evidence/phase2/verification-20261125-004035-665303/production-smoke.log)|
|`node --import tsx scripts/performance/run.ts after --mock-ui scripts/performance/mock-ui.json`|0|真实4场景after采样成功|[performance-after.log](../evidence/phase2/verification-20261125-004035-665303/performance-after.log)|

完整旧玩法用例耗时53.6秒：**正常初始空包、普通键盘/UI**采六木两石→交材料→14秒施工→修前真实河阻挡/修后实际过河→遗迹反馈→刷新→**真实停止/重启服务后恢复**。没有改包、改库或注入调试世界替代该验收。测试均隔离临时存档，不污染用户存档。性能施工fixture仅作独立负载，绝不充当试玩。

最终验证前锁定的73个运行输入SHA见 `evidence/phase2/final-runtime-source-hashes.json`，验证后及交付收口再次核对未变化。后续只完善文档、独立截屏脚本及测量工具对无.git源码包的元数据兼容分支，未改游戏代码，未重复全套玩法测试。

补充实际执行：`node --import tsx scripts/capture-phase2.mjs`退出0，正常输入完成两轮干净Mock截图，0 pageerrors，日志 `evidence/phase2/clean-visual-capture-final.log`；源码包无.git独立复现的after工具退出0、四场景成功，见 `evidence/phase2/delivery-reproduction.log` 与 `delivery-reproduction/after-1249Rh/report.json`，测量工具类型检查退出0见 `delivery-tool-typecheck.log`。该额外复现仅验证交付兼容，不替换下文最终before/after，不挑选更好FPS。

### 早期失败如实保留

Codex沙箱中普通npm安装/回环监听/Chromium因EPERM等失败，记录在 `verification-20261125-003146-203537/command-results.json` 等早期目录。最初采样辅助代码的序列化__name问题也保留日志并已修复。首次原生全套 `verification-20261125-003305-096897/` 全0（当时23单元），审计补强后最终全套为上表25单元/2集成/10浏览器全部通过。没有修改沙箱权限绕过限制，也没有把失败日志删除或当成通过；原生测试与编码沙箱日志明确分开。

### 覆盖对照

|类别|对应测试与证据|
|---|---|
|1. 入口与近距打开|对话浏览器 E 和普通按钮，本地 WS 近距打开|
|2. 远距和其他 NPC 拒绝|WS 用例在出生点尝试，验证距离和阿禾拒绝|
|3. 自由中文、IME 与按键|浏览器输入中文、合成候选 Enter 与 WASDE，关闭后移动恢复|
|4. 多轮与有界历史|单元上下文上限和重开清理，浏览器多轮，WS 检查真实请求|
|5. 权威桥况|单元和 WS 验证玩家声称修好仍只使用真实告示，浏览器看见未修通|
|6. 无玩法副作用与转义|WS 对照同一世界快照，浏览器核对库存进度及字面 HTML|
|7. Pending 渲染及普通 UI|浏览器挂起时切全谷地图并查看相机变化，暂停仍可操作|
|8. 重复与并发|同 ID 重发不转发新 HTTP，第二个 ID 返回 busy，账本去重|
|9. 错误与手工重试|本地 HTTP 桩 400/401/403/404/429/503、空、非法、网络、超时、取消。浏览器 Mock 超时重试|
|10. 预算与用量|单元分钟、一小时、总请求、Token、金额、推理子集、缺失或全零 usage、额外 Token 和遗留预留。本地 HTTP 与浏览器覆盖预算停止|
|11. 生命周期与旧回复|WS 关闭、暂停、断线、接管、离距、重开，上游连接取消，旧 ID 失败且无法回填|
|12. 重启重复与账本故障|单元检查损坏账本/配置与中断占用。本地集成检查保存、重开和真实 Fastify 重启后的额度|
|13. Key 与无 Key 模式|生产包 dummy 扫描，本地 HTTP/WS 检查认证头、有效输出与上游错误体脱敏，默认 Mock 单元和浏览器|
|14. 完整旧玩法|原空包六木两石、交材、施工、桥前阻挡桥后过河、遗迹、刷新和真实服务停启断言保留|
|15. 窄屏与实际画面|390px 对话布局测试及真实浏览器截图入口|


## 实际截图与视觉检查

最终全套目录 `evidence/phase2/verification-20261125-004035-665303/` 含21张真实PNG，覆盖原完整地图/三NPC/采集/背包/桥前后/施工/遗迹/加载失败/窄屏及本轮对话。实际使用Read视觉查看多轮、thinking、超时、预算、窄屏和正式场景，检查清晰像素、Mock标识、文本安全显示和布局；未发现需继续修复的视觉问题。额外干净对话图也实际Read，不是合成图。

|内容|相对项目路径|
|---|---|
|推荐主图：干净两轮中文对话|`evidence/phase2/visual-review-final/dialogue-clean-multiturn.png`|
|干净等待|`evidence/phase2/visual-review-final/dialogue-clean-thinking.png`|
|最终多轮/安全文本样例|`evidence/phase2/verification-20261125-004035-665303/dialogue-multiturn.png`|
|thinking|`evidence/phase2/verification-20261125-004035-665303/dialogue-thinking.png`|
|超时失败|`evidence/phase2/verification-20261125-004035-665303/dialogue-failure.png`|
|预算停止|`evidence/phase2/verification-20261125-004035-665303/dialogue-budget.png`|
|390px对话|`evidence/phase2/verification-20261125-004035-665303/dialogue-narrow.png`|
|正式场景|`evidence/phase2/verification-20261125-004035-665303/scene-optimized.png`|
|地图/桥前后/遗迹|同目录`valley-overview.png`、`bridge-before.png`、`bridge-after.png`、`beacon-ruin.png`|

## 前后性能：真实结果而非改善宣称

同一Linux x64 box，Chromium159.0.8154.6，1280×960，生产构建，约5秒/场景，原始RAF间隔和完整服务端50ms回调耗时。before从指定Git基线导出，after工作树用输入哈希绑定（采样时尚未提交，checkoutHead仍显示基线，并不表示未实现Phase2）。P95用最近秩计算。

|场景|平均FPS before→最终after|帧均值/P95 ms before→after|tick均值/P95/最大 ms before→after|
|---|---:|---|---|
|静止|60.003→59.404|16.666/16.700→16.834/16.700|0.02535/0.01412/0.55641→0.07251/0.42814/2.56648|
|移动|60.003→60.002|16.666/16.700→16.666/16.700|0.50113/0.23782/33.95176→0.23141/0.30216/2.27839|
|施工|60.003→59.207|16.666/16.700→16.890/16.800|2.78056/4.40947/7.48141→3.71847/5.38188/34.58682|
|Mock对话等待|N/A→60.003|N/A→16.666/16.700|N/A→0.07568/0.24700/2.92287|

- 原始before：`evidence/phase2/performance/before-tHNDhF/report.json`；最终after：`after-VtaIPH/report.json`。首次after `after-LDjvHe/report.json`同样保留（约60FPS，施工tick均值3.4456/P9510.6879ms），不藏不利样本。无对话的Phase1基线对话为**N/A**，不造before值。
- 实际探测Canvas可用、WebGL/WebGL2上下文不可用，因此没有可比较的WebGL游戏样本。保留Chromium沙箱，移除默认unsafe SwiftShader参数；不强制软件WebGL并冒充硬件实测。生产继续Canvas兼容路径，不以偏好换引擎。
- 已减少重复DOM和depth/动画/贴图/调试属性写入，保留渲染插值与20Hz解耦。**短样本没有测得FPS改善**，施工tick波动且均值/P95稍增，不能宣称优化消除卡顿。现有tick样本未达50ms周期，不足以牺牲持久性换施工检查点，因此材料/施工仍即时事务，未引入新增崩溃进度损失窗口。
- headless/软件绘制和共享CPU短窗口局限明确；未复现Mac低帧率，未验证用户Mac/WebGL/Safari/Firefox、长时重负载或真实模型等待时性能。当前Mock等待结果不代表远程供应商吞吐或生成速度。

## 未验证、交付及停止点

真实API地址/鉴权/模型兼容、人格和自由多轮质量、真实usage/计费、供应商取消收费等均待专用Key及明确额度后验证。操作系统真实中文输入法候选窗口、真实触摸/音频设备及用户Mac复测未做；浏览器合成composition与窄屏已测。没有调用未经授权服务，没有付费、push、远程PR或部署。

完整工程、原PDF、全部实际运行素材、锁文件、许可证、源脚本、Phase0/1历史和本轮证据保留。单ZIP会超过聊天25MB硬限制，因此交付**互补的核心源码ZIP+全部证据ZIP**，每件严格小于25,000,000字节；不是不兼容的字节分卷，解压到同一父目录即合并。核心包可独立安装运行。完整官方未用原素材ZIP不随轻量包分发，`assets:fetch`缺省可从官方恢复重加工所需原包；用户SQLite、.env、node_modules不入包。详情见 [PHASE2_PACKAGING.md](PHASE2_PACKAGING.md)，真实提交ID见根目录 `DELIVERY_COMMIT.txt`，ZIP字节数和SHA见随附delivery-info.json/sha256文件。**仅本地提交，停Phase2等待用户验收。**

## 本地提交记录

实现、测试及证据提交：`56f3b20818a14633ca874b5764a818f7f1fc1edf`。随后仅文档登记此真实ID；最终文档收口HEAD记录在 `DELIVERY_COMMIT.txt` 与交付delivery-info.json，避免报告自引用。未push、未创建远程PR、未部署。
