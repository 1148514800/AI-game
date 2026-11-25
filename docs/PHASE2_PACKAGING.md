# AG-3 / Phase2 交付结构与自检

## 两个互补ZIP，每件严格小于25,000,000字节

- `mistsea-phase2-AG-3-core.zip`：可独立安装运行的全部源码、package-lock、地图/人物配置、45项本地实际运行素材及许可证、原始29页PDF、全部文档、测试与获取/加工/验证脚本。
- `mistsea-phase2-AG-3-evidence.zip`：`evidence/`下完整Phase0、Phase1和Phase2正式日志、原始性能JSON和真实PNG。成功与失败均保留。仅可重建且体积大的浏览器调试trace.zip不作为正式交付证据；正式退出码/日志/截图不删。
- 两个ZIP使用同一个根目录 `mistsea-phase2/`，在同一父目录依次解压即可合并。不是需要特殊软件的字节分卷。只有核心包也能运行，证据包补齐文档中的全部历史截图/日志链接。

```bash
unzip mistsea-phase2-AG-3-core.zip
unzip mistsea-phase2-AG-3-evidence.zip
cd mistsea-phase2
npm ci
npm run dev
# http://127.0.0.1:5173/
# 生产：npm run build && npm start
```

不随包分发：node_modules、可重建release、.git目录、机密.env、用户SQLite/账本、未使用完整官方原素材ZIP。**运行素材不是外链，全部已本地包含**。默认 `npm run assets:fetch` 可恢复官方原包，再用 `npm run assets:prepare` 按锁定配方重加工；运行游戏无需原包、Python或模型Key。原包和旧阶段大归档仍保留在原本电脑位置，不声称其包含于核心ZIP。

## 版本、测试与复现

- 实现与证据本地提交：`56f3b20818a14633ca874b5764a818f7f1fc1edf`；最终文档收口HEAD见DELIVERY_COMMIT.txt。
- 审核基线：`62c5c2a10dff3afc18dbe875341f3a274ca3b436`；本地分支ag-3-phase2。最终提交在zip根目录 `DELIVERY_COMMIT.txt` 和外部delivery-info.json记录；本地Git工作区保留历史，未推送。
- 最终应用验证：25单元+2本地HTTP/WS集成+10Playwright、安装/开发入口/两项类型/构建/secret sentinel/生产冒烟/after全部退出0，见 `evidence/phase2/verification-20261125-004035-665303/command-results.json`。
- 运行输入哈希见 `evidence/phase2/final-runtime-source-hashes.json`，收口未改变应用代码；后续只有文档、独立截屏与无Git元数据兼容工具修改，工具重新类型检查和独立无Git复现退出0。
- 解压包不含.git，after性能采样会诚实标记source-archive-no-git并记录当前源码哈希；before重现需要指定基线的Git checkout（现有before原始数据已随证据包包含），绝不把当前源码替作旧基线。
- 单元/浏览器重跑可用 `python3 scripts/verify.py`（需Python3、npm和Playwright Chromium，`npx playwright install chromium`）。测试全用临时存档。Live始终待授权专用配置，不因离线验证通过自动启用。

## 可复现打包

在保有本地Git历史且工作区已提交后，运行 `python3 scripts/package-phase2.py`。默认写入工程旁的 `mistsea-phase2-AG-3-*`，拒绝覆盖既有归档。要另作副本，可用 `--output-prefix /workspace/另一个交付名`。解压源码包无.git时不需重打包；直接运行即可。打包脚本只读取提交内容，不读取.env或个人存档。

## 实际归档自检

归档从最终本地Git提交列出的文件生成，另注入无机密DELIVERY_COMMIT元数据。记录每个ZIP准确字节数和SHA256；检查两包CRC、路径无穿越/重复、内容并集与提交逐字节相同、45项manifest运行文件哈希、原PDF哈希、原阶段证据不变、无被禁止文件、每件<25,000,000字节。结果在同名delivery-info.json和 `mistsea-phase2-AG-3-packaging-check.json`。实际压缩包哈希不能写回自身，故保留为外部元数据和.sha256文件，不伪造自引用校验和。

性能没有实测提升；无真实供应商调用、生成质量或账单验收。完整Phase2待用户Live配置验证；当前停Phase2，不进入Phase3。
