# 协调代理原生复核

首次原生性能脚本未采到数据，原因：tsx/esbuild为浏览器回调内的具名函数生成__name助手，而Playwright隔离页面没有此Node侧助手。仅在性能观测页面自包含bootstrap中加入纯函数名称助手，生产代码未修改。失败日志保留 performance-before-native.log；复跑另存日志。

交付复现检查发现：源码ZIP按要求不带.git，但after性能工具最初无条件git rev-parse，导致解压包的verify最终一步失败。仅给测量工具增加“after无Git时明确记录source-archive-no-git且仍按源码哈希采样；before仍要求真实审核基线”的分支，不改变游戏代码、任何既有采样数据或测量算法。解包后的实际复现结果另存 delivery-reproduction 证据，不替换最终after实测。
