# 轻量交付包装

本次只补做交付包装，不新增功能，不进入 Phase 1。聊天附件硬限制为25MB；按更保守的25,000,000字节检查，而不是此前误用的100MiB文件传输上限。

## 推荐包

`/workspace/mistsea-phase0-core.zip` 是单个完整可运行源码包，目录根为 mistsea-phase0/。保留全部 src/data/public/assets、package.json/package-lock.json、原PDF与全部 docs、AGENTS/README、许可证与 manifest、获取/加工脚本、全部正式测试证据和真实截图，以及 release 构建产物。

只排除 node_modules、完整官方原素材ZIP、其展开副本、测试临时目录和临时签名下载响应。没有删除或压缩降质任何运行素材、原PDF或截图。完整原包中未使用的大量资源不是运行依赖，13个实际运行素材全已本地包含。

## 原包与旧包

- 完整官方原素材：`/workspace/mistsea-phase0/assets/source/ninja-adventure-2026-03-29.zip`，仍原样保留。
- 旧完整交付包：`/workspace/mistsea-phase0-delivery.zip`，保留不变；只作为电脑端完整备份，不符合聊天附件大小上限。
- `npm run assets:fetch` 不要求预先存在原素材ZIP；在缺省时自动请求官方免费文件并核对 manifest 中的固定 SHA-256。运行游戏完全不需要 fetch/prepare、Python 或原素材ZIP。

## 包装自检

本次校验ZIP CRC、全部正式内容哈希、13个运行素材逐文件哈希、原PDF哈希、必须文件/目录、已排除的原素材ZIP，以及小于25,000,000字节限制，并将原包缺省情形放到独立验证目录执行官方fetch。具体退出状态见 evidence/packaging-check.json、evidence/packaging-fetch-check.log。未更改游戏代码和锁文件，因此未重复运行代码测试；原测试日志完整保留。
