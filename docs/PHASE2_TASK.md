# AG-3 / Phase 2 — 当前用户授权执行规格

用户已验收Phase0和Phase1。唯一审核基线62c5c2a10dff3afc18dbe875341f3a274ca3b436，github.com/1148514800/AI-game。保留现有栈、完整地图、全部素材/原PDF和Phase0/1测试证据，仅Phase2，结束等验收，不进Phase3。允许本地Codex CLI gpt-6.2-sol/high和本地git commit，不push/PR/部署，不使用CloudAgent。旧 /workspace/mistsea-phase1 不改。

完整读AGENTS、README、GAME_DESIGN、原29页PDF、ROADMAP、DECISIONS、PHASE1_REPORT和代码。已验证PDF完整且与Markdown全部正文非空白字符相同，45运行文件哈希均有效。

## 必须先采样再优化
指定基线在相同浏览器/viewport/环境真实before/after：平均FPS、frame mean/P95、server tick实际耗时，静止/移动/施工/对话。基线无AI则对话明确N/A，不伪造。对比实际Canvas/WebGL能力，选择有根据并保留兼容路径，不强制不支持的GPU。检查20Hz网络与插值，重复DOM、逐帧depth/animation/texture/debug属性、静态场景、施工每50ms SQLite事务。只低风险更新脏状态/减少重复/模拟渲染解耦。若写库并非瓶颈，不擅自牺牲持久性；如实测需检查点则材料即时事务，暂停/断线/完成/正常退出立即保存，明确崩溃最大进度损失。不删内容/测试、不大改引擎、不无限优化。headless/软件GPU结果不可外推Mac。

## 轻量独立服务端模型适配
OpenAI-compatible Chat Completions，配置至少LLM_ENABLED/BASE_URL/API_KEY/MODEL/TIMEOUT_MS/MAX_OUTPUT_TOKENS/MAX_REQUESTS_PER_MINUTE/MAX_REQUESTS_PER_SESSION，合理输入/总请求/Token/金额预算，完整.env.example及中文说明。不锁供应商，async fetch+Abort/timeout，不盲发thinking/response_format，不让玩家指定URL/模型工具/外部请求。
本轮没有任何游戏模型API Key或真实调用/付费额度授权。严禁搜借其他凭据、开发工具登录/订阅、内部接口；不读无关env秘密。无key默认Mock可玩；Live配置好但真实待用户授权配置验证，不阻塞离线交付，不标全Phase2 PASS。测试仅本地HTTP假供应商与dummy sentinel，清楚不是live供应商。

## 唯一生成角色岑砚
独立人格配置：木匠，谨慎务实重承诺，想改善生活修自家漏雨屋顶，公共事务考虑个人利益条件，友善有所保留；背景/表达/知识/能力边界。真实模式应生成自介、谷地问答、性格观点、修桥意见、理解建议/请求并拒绝不合理、依据真状态、近期多轮一致。仍固定位置，无自主计划/移动/采集/施工；阿禾洛舟不接模型。
独立上下文：身份目标/世界知识/可感知服务器真实状态/玩家输入/约6–10有效轮且字符与估算Token总上限/能力边界。客观事实、背景与玩家声称分开；玩家说桥好不改事实。不能dump DB/私有背包/其他NPC记忆/不可感知事件。桥进度可用明确公开告示为合理信息来源。系统要求保持角色、不宣称执行游戏行动、不泄露提示密钥实现；密钥不入context。模型仅文本，无tools、无action执行器路径。历史按NPC/world session隔离，重开清空；失败超时取消旧结果不记经历，不跨重启长期持久，不摘要/向量。

## UI和生命周期
近岑砚E或原按钮打开像素风自由中文对话：头像姓名职业、多轮文本、输入/发送、thinking、失败重试/关闭、明确真实/模拟标识；少量建议不替代自由输入。用textContent等安全渲染，不执行HTML。输入WASDE不移动/交互，正确IME composition及候选Enter不误发，打开清移动输入，关闭恢复。等待模型不阻渲染/暂停/普通UI，窄屏可用。
服务端验证有效当前连接、交互距离、唯一NPC、输入长度、单NPC在途、预算。requestID绑定dialog+world session；关闭、离距、暂停、重开、断线、标签接管、超时取消/失效；旧答不覆盖新对话/复活旧会话。取消仍可能收费，保守记账；无自动重试也可。HTTP网络/401/key/URL/model/429/5xx/timeout/空/非法/取消/预算耗尽明确，不能伪装live。故障不影响原玩法和存档。

## 统计预算持久且轻量
每次时间NPC/model/status/耗时，供应商usage输入输出及其他计费Token。usage缺失未知，不伪造；费用只可靠显式配置价格估。分钟/会话/总预算、输入输出、单在途。金额预算调用前保守预留上限，usage后结算，不能准确算则保留占用；失败取消不能无限免费重试，启动遗留reservations不能释放成免费。重开/重启不可简单绕限，Mock与Live分开统计，不自动后台调用。不建计费平台/Redis/Agent框架。日志不含密钥或供应商未经净化的原始错误/请求头；配置错误不能让基础游戏启动失败。

## 验证和交付
实际npm ci/typecheck/test/test:e2e/build/生产冒烟。保留全部Phase1有效测试（目前14单元+7浏览器）和真实空包键盘/UI六木两石/交材/14秒施工/桥前阻挡桥后过河/遗迹/刷新+真实服务重启。不可用DB/背包注入替代正常试玩（隔离性能负载fixture只能用于性能，必须标识）。新增至少14类覆盖：近开、远拒、中文自由IME、多轮上下文、真实桥事实、输出不改库存工程、pending渲染普通玩法、重复并发、超时429等、HTTP假供应商预算停止、关闭/暂停/断线/重开/接管/离距旧结果丢弃、dummy sentinel不入客户端、无key可玩、旧完整玩法。Mock可控延迟和故障供离线测；HTTP桩真实网络测适配层但不是live验收。
真实截图：dialog、多轮、thinking、失败/预算、窄屏dialog、优化场景；必须Read视觉检查并修。项目本地Playwright允许，不能操纵已登录桌面。
更新README/AGENTS/ROADMAP/DECISIONS/.env.example及docs/PHASE2_REPORT.md。报告分工程实现/离线通过/Live待用户配置/真实性能前后/未验阻塞；测试真实数量、每命令退出码/日志/截图路径。本地提交记录基线和最终commit，工作树干净。完整源码锁文件、人格配置、本地素材、原PDF、历史和新证据，附件每件<25,000,000字节，必要拆证据包/可选bundle，不含secret/用户存档/node_modules/未用大原ZIP。不进Phase3、不付费、不push/部署。
