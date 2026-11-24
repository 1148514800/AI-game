# 雾海行纪 · Phase 0

仅工程与真实素材验证，不是完整游戏或正式雾灯谷地图。**Phase 0 交付后停止，等待用户验收。**

## 启动

环境：Node.js **24+**（本次 24.22.1）、npm。无需 API Key、数据库服务或 Python。

```bash
npm ci
npm run dev
```

浏览器打开 **http://127.0.0.1:5173/**。Fastify/SQLite 基础服务在 127.0.0.1:3001。两个端口都只绑定本机。`Ctrl+C` 退出。当前版本无存档及重置需求；刷新即可重置验证场景。

- WASD / 方向键：移动、四向行走动画；松开回到对应方向站立。
- Esc / 页面暂停按钮：暂停/继续（切到后台自动暂停）。
- 音乐按钮：用户点击后播放/关闭本地 CC0 环境音乐；默认关闭。
- NPC 仅原素材行走循环展示，没有自主决策、对话或记忆。树木是遮挡测试道具，小屋有最小不可穿越区域。无采集、修桥、战斗、经济和多人系统。
- 窄屏只验证显示与布局；当前仅键盘操作，不承诺触屏移动支持。

## 验证与构建

```bash
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm start
```

构建产物在 `release/`（避免使用可能被环境清理的 dist/build 目录名）。生产服务默认 http://127.0.0.1:3001/，启动前停止 dev 后端，或 `PORT=3002 npm start`。`npm start` 从本项目根目录执行。构建产物可重复生成，源码交付含锁文件和全部本地运行素材。

Linux 首次安装 Playwright 若提示系统库缺失，按其公开安装指南安装所需库；本次环境安装 Chromium 后可直接执行。测试不会登录任何账号或操纵已登录浏览器。

`npm run test:e2e` 会在需要时自动启动 dev，证据写入 `evidence/`；若你已有 dev 进程会复用。建议避免复用其他版本占用的 5173 端口。生产冒烟：`node scripts/production-smoke.mjs`（先 build），独立使用 3002 端口并在结束后停止其服务。

## 目录

```
src/client/       Phaser 场景、输入、HTML/CSS 界面
src/server/       单 Fastify 服务、SQLite 连通、WebSocket ping/pong
src/shared/       稳定 ID、边界常量、Zod 协议校验
data/             20×14 验证地图和四向动画映射
public/assets/    13 个经过准入的本地运行素材
assets/source/    原始官方 ZIP、完整文件分类索引
assets/licenses/  实际包内 CC0 许可
scripts/assets/   可复现获取/裁剪/地图与清单生成
tests/            单元/基础设施与真实浏览器验收
docs/             原 PDF、唯一完整设计基线、决策与阶段报告
evidence/         当前实测日志、JSON 结果及真实截图
```

## 素材复现（运行游戏不需要）

轻量交付包包含全部13个实际运行素材、原PDF、许可证、文档、锁文件、测试证据及构建产物，可直接 npm ci 后启动；**不包含约90MiB的完整官方原素材 ZIP**（其中大量资源尚未使用）。原包仍作为可选归档保留在研发电脑及旧完整包中，不是运行游戏的依赖，也不要求用户下载或裁剪。仅需重新加工素材时，以下 fetch 命令在原 ZIP 缺省时会自动从官方获取并核对固定哈希。Python3 + Pillow 的准确版本见 `scripts/assets/requirements.txt`。可在项目内建立虚拟环境，安装后将它加入 PATH，再执行：

```bash
npm run assets:fetch
npm run assets:prepare
```

fetch 在工作区已有原 ZIP 时校验它；轻量包默认没有原 ZIP，执行时会自动从官方免费来源下载同一版本并核对哈希，变化则停止。prepare 只筛选和无损裁剪，生成 manifest、Tiled 兼容小验证地图及动画数据。Ninja Adventure 作者 Pixel-Boy 与 AAA，CC0-1.0；具体版本、原图路径和 SHA-256 见 `assets/manifest.json` 与 `docs/ASSETS.md`。不依赖素材 CDN。

## 文档与验收

- `docs/AI_Game_Research_and_Design_v2.pdf`：29 页原报告，完整保留。
- `docs/GAME_DESIGN.md`：逐页完整文本基线，非空白字符核对一致；保留表格原布局。`docs/design-extracted.txt` 仅为 PDF 自动提取的核对中间产物，不单独维护。
- `docs/ROADMAP.md`：Phase 0–6 状态；后续未开始。
- `docs/DECISIONS.md`：实测版本、技术选择、Codex 网络阻塞与替代执行说明。
- `docs/PHASE0_REPORT.md`：当前实测状态、失败修复、截图与未验证项。

没有接入游戏内大模型 API，没有购买、付费、部署或推送远程。开发工具 Codex 仅进行授权的最小探针，网络路由失败，未假称该 CLI 已完成编码。

## 附件交付结构（25MB 限制）

- 推荐附件：`mistsea-phase0-core.zip`，单个小于25,000,000字节的完整可运行源码包。包括原PDF、全部设计与验收文档、全部运行素材、许可证/manifest、锁文件、源码/脚本/测试、真实截图和日志，以及 release 构建产物；不包括 node_modules、完整官方原素材ZIP、该原包解压副本和测试临时目录。
- 旧完整包 `mistsea-phase0-delivery.zip` 保留不变，约98.69MiB，超过聊天附件上限，不再作为聊天附件。
- 完整官方原素材ZIP仍保存在研发电脑 `assets/source/ninja-adventure-2026-03-29.zip`；需要时可由 `npm run assets:fetch` 自动恢复。它是可选加工源，不是游戏运行素材的缺失文件。
- 包装自检见 `docs/PACKAGING.md` 和 `evidence/packaging-check.json`。本次仅修正文档与交付包装，不新增开发，不重跑未改变的代码测试。
