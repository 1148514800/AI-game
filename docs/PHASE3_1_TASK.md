# AG-5 / Phase 3.1 用户授权与完整实施范围

当前唯一范围 Phase3.1，在 GitHub https://github.com/1148514800/AI-game 指定审核基线 842342a1021751d0e33ac7b2a3db27f0e0bca9f1 上续作，禁止 Phase4。Phase0–2已获验收，用户亲自确认Phase3真实AI自主思考采集，这是用户的验证而非本代理Live数据。用户明确本机checkout/Codex CLI例外；只本地Git提交，不push/PR/部署。不碰Mac、不读.env/密钥/个人存档、不调用Live。LLM_ENABLE_THINKING空省略/true false布尔三态保留。旧目录、历史证据不删改。只有岑砚，无新地图/战斗/经济关系/其他NPC智能/复杂框架。

开始完整阅读 AGENTS、README、docs/GAME_DESIGN、ROADMAP、DECISIONS、PHASE3_REPORT 和相关源码。以下新授权覆盖它们的旧Phase3限制。

1. 分批交材：玩家/NPC可指定木/石item+qty或贡献当前全部有效材料。只扣真实拥有且工程尚缺数量，允许部分和反复交付，明确超量截断/失败行为，禁止负数和超扣。事务、稳定唯一行动回执、幂等并发、真实贡献者/物品/数量。UI和模型上下文实时显示缺口。删除提示词一次性交齐六木两石限制，保留玩家原单人流程。
2. 木/石双向give_item与受控接受拒绝：玩家提议赠送时NPC由模型决定接受或拒绝；NPC模型可提议赠送但玩家必须显式接受/拒绝，不能强制扣玩家包也不能强制塞包。原子校验距离、库存、容量、过期和重复；不预先丢失材料；真实回执与事实记忆。简单协议/UI即可，不做交易系统。
3. follow target_id player：自然语言交谈时模型愿意则发合法计划；动态跟随运行时玩家坐标，由服务器A*、碰撞与合理距离控制，停走恢复、重寻路节流，不瞬移穿墙/未修桥或重叠。明确在桥边、时限、玩家取消或持续不可达时结束。关闭对话后已正式接受计划继续，未被接受的旧回复不启行动。不每帧调用模型。
4. 合力施工：材料齐备/双方主动/距离合法时玩家和NPC可同时做工；单人原速，双人可加速；统一服务器tick推进共享进度，各自真实施工时间贡献，一方退出另一方继续，完成恰好一次并保存合作事实记忆/UI。移动wait/work安全可中断。
5. 简短自然语言goal+必要轻量标签，兼容旧repair-bridge/stock-wood/rest，不做目标树。明确模型plan_policy continue/replace/defer/reject。替换不回滚已完成资源动作；defer不是一句对白，最多一个pending计划真实持久化，在当前行动完成后提升并重新校验；旧模型generation不得覆盖新计划。拒绝/继续要真实保留原计划。可以自主选择简单可靠协议并明确记录。
6. 统一轻量能力定义（name/description/params/targets/preconditions/execution/results）覆盖move_to/follow/collect/give_item/deliver/work/wait/rest，与Zod严格JSON合法目标/提示词/执行器/测试一致；1–3步。模型上下文提供人格、自由目标和当前/pending执行态、自身包与感知、公共工程缺口、最近真实结果/失败、相关长期记忆、玩家话语、能力和policy规则。普通聊天保留；愿意真行动就必须结构化计划，不以Live关键词或固定测试对白驱动，NPC可以真实拒绝推迟，不虚报完成，不把玩家口述库存当事实。
7. 真实结果：type/status/实际结果/失败原因/相关世界变化进入后续决策，失败退避防风暴。赠送/贡献/同行/合力等客观经历基于真实规则事件保存，重启恢复并进入上下文。Debug显示目标变化、最近经校验决策、当前/pending计划、policy、回执、包、双方贡献、记忆和共享usage成本；绝不显示Key、私有思考、原始供应商错误。
8. 兼容Phase3 v2存档，迁移先备份再事务，不清档；预算账本保留，单NPC在途、开关、暂停/断线/重开代次安全保留。确定性跟随/移动/交材/施工无需反复模型请求。Mock与Live严格分开。

必须真实验收（可确定性Mock决策，但绝非Live理解）：
A 玩家合法采到4木，NPC合法采到2木2石，各交自己的材料，最终6木2石（非改DB/预置库存）。
B 正常UI自然语言“我们一起去桥边吧。”模型模拟同意合法follow，关对话，真实跟随到桥。
C 材料齐全后双方同时施工，双方有施工时间贡献，桥通可正常行走。
D 正在去林地采集时，新协作请求分别触发replace/defer/reject，defer随后真实执行且持久化。
E 正常UI双向赠送、显式接受和拒绝（拒绝不转移）。
F 合作后真实停止和重新启动子服务，事实记忆保留，后续模型上下文包含合作经历。

保留Phase0–3全部仍有效回归；旧一次交齐/互斥施工的断言只按新规则更新并记录依据，不能删保护。新增partial/overdelivery/并发交材/gift拒绝和过期容量/动态follow不可达/施工退出/replace与defer/旧结果generation/失败反馈/共同记忆重启/旧档迁移/共享预算/异常测试。Playwright必须通过正常浏览器键盘/UI完整合作，不许通过测试API/调DB/改库存或传送替代。可以读测试DOM坐标规划键盘路线。
实际npm ci、typecheck、npm test、test:integration、test:e2e、build、生产冒烟，保存真实命令退出状态、数量、日志、行为轨迹和截图；看图修复。新30min soak不是强制，但相关自主调用风暴/性能退化需本轮合理回归，不冒用旧长测。无Live额度授权，只Mock/本地HTTP桩，提供明确Phase3.1 Live人工步骤。
更新README/AGENTS/ROADMAP/DECISIONS和docs/PHASE3_1_REPORT.md，明确旧程序限制、解决、新能力、model policy、Mock/Live和未验证项。本地提交干净并记录ID；完整源码素材历史证据交付，ZIP每件<25,000,000字节，独立源码可运行、证据互补同根，CRC/SHA/真实联合还原比较，无机密env/存档/依赖/构建，不重包庞大trace。完成后停Phase3.1等用户验收。
