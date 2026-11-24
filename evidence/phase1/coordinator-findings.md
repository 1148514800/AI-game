# 原生验收协调记录

- 第一轮原生 npm ci/typecheck/test(13)/build 全部退出0，E2E 6通过1失败（重启后施工未完成）。保留 native-*.log。
- 第二轮独立日志测试发现真实Vite输出：trace生成的 evidence/**/traces/resources/*.html 会触发全页热重载；同时Codex在重建manifest/map/release也触发重载，因此这两轮不是稳定源码下的最终验收，不能据此直接认定服务端施工规则坏掉。保留 isolated-journey.log/trace。
- 协调代理最小修复：Vite watch忽略evidence/release/saves/assets/source生成目录，避免证据和存档/构建打断游戏；不忽略真实src/data/manifest。
- 等Codex完成所有源文件/素材生成后再重新做独立完整最终验收。当前没有宣称全部通过。
