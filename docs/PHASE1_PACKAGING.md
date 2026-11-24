# AG-2 / Phase1 交付包装

主附件：mistsea-phase1-AG-2-core.zip；本地Git历史：mistsea-phase1-AG-2.bundle。每件严格检查小于25,000,000字节。

源码ZIP包含原29页PDF、全部设计/阶段文档、完整代码/地图/动画/运行素材、许可/manifest、package-lock、全部正式测试脚本及运行日志/结果JSON/真实截图；不含node_modules、.git目录、用户SQLite存档、完整官方原素材ZIP及调试trace.zip。构建产物可用npm run build再生，不作为源码完整性的依赖。

完整官方原包在研发电脑 assets/source/ 下保留，不是运行依赖。需要重新加工时npm run assets:fetch自动恢复同一官方版本、校验哈希；assets:prepare独立且不覆盖地图/动画和扩展manifest。

Git bundle只保留本地提交，不向远程推送。可用 `git clone mistsea-phase1-AG-2.bundle AI-game-phase1` 获得有历史的源码，再 npm ci / npm run dev。源码ZIP便于直接解压运行，两件为替代获取源码方式，不要求用户把bundle放进项目运行。

旧Phase0工作区和各归档保留不变。Phase0历史证据在原evidence位置；本次最终证据在 evidence/phase1/verification-20261124-224732-873553/。失败调试trace保留本地但不打入附件，真实失败日志、错误上下文和全部截图仍保留。
