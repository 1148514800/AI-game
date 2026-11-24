# 素材准入与处理
来源：[Ninja Adventure 官方](https://pixel-boy.itch.io/ninja-adventure-asset-pack)，作者 Pixel-Boy 与 AAA。下载包标记 2026-03-29（Update 8），itch upload 16981275，获取日 2026-11-24（Asia/Shanghai）。官方页面、实际包 README、LICENSE 均为 CC0 1.0 Universal，无冲突；未购买、未捐款。
许可证：assets/licenses/NinjaAdventure-CC0.txt；可选完整原包在研发电脑：assets/source/ninja-adventure-2026-03-29.zip（轻量交付包不内含；运行素材13个文件全部包含；需要重加工时用 assets:fetch 自动恢复）。SHA-256：`95a06f4fdcfd1882f061a45ff313b7c905dbe2de1e8512b281d7937df62a7b15`。
## 分类与本地输出
|输出|分类|原始路径|修改|
|---|---|---|---|
|public/assets/player-walk.png|characters/animation|Ninja Adventure - Asset Pack/Actor/Character/NinjaBlue/SeparateAnim/Walk.png|None; exact bytes|
|public/assets/player-idle.png|characters/animation|Ninja Adventure - Asset Pack/Actor/Character/NinjaBlue/SeparateAnim/Idle.png|None; exact bytes|
|public/assets/npc-walk.png|characters/animation|Ninja Adventure - Asset Pack/Actor/Character/OldMan/SeparateAnim/Walk.png|None; exact bytes|
|public/assets/npc-idle.png|characters/animation|Ninja Adventure - Asset Pack/Actor/Character/OldMan/SeparateAnim/Idle.png|None; exact bytes|
|public/assets/grass.png|terrain|Ninja Adventure - Asset Pack/Backgrounds/Tilesets/TilesetFloor.png|Lossless crop (0, 192, 16, 208)|
|public/assets/path.png|terrain|Ninja Adventure - Asset Pack/Backgrounds/Tilesets/TilesetFloor.png|Lossless crop (16, 128, 32, 144)|
|public/assets/tree.png|plants|Ninja Adventure - Asset Pack/Backgrounds/Tilesets/TilesetNature.png|Lossless crop (0, 0, 32, 32)|
|public/assets/house.png|buildings|Ninja Adventure - Asset Pack/Backgrounds/Tilesets/TilesetHouse.png|Lossless crop (0, 0, 64, 48)|
|public/assets/flowers.png|plants|Ninja Adventure - Asset Pack/Backgrounds/Tilesets/TilesetNature.png|Lossless crop (0, 160, 16, 176)|
|public/assets/letter.png|items|Ninja Adventure - Asset Pack/Items/Other/Letter.png|None; exact bytes|
|public/assets/arrow.png|ui|Ninja Adventure - Asset Pack/Ui/Arrow.png|None; exact bytes|
|public/assets/village.ogg|music|Ninja Adventure - Asset Pack/Audio/Musics/36 - Village.ogg|None; exact bytes|
|public/assets/alert.wav|sound-effects|Ninja Adventure - Asset Pack/Audio/Sounds/Alert/Alert.wav|None; exact bytes|

精确逐文件原始及输出哈希、来源版本、授权在 assets/manifest.json；全包分类索引为 assets/source/inventory.json。未把整个包打入客户端；音乐默认关闭，alert.wav 与 arrow.png 已入库并加载，用于下一步资源验证但当前无业务音效/UI事件。
## 动画核对
人物帧 16×16；Walk 图 64×64：列从左到右是下、上、左、右；行是四帧时间序列，因此向右帧为 3,7,11,15，而不是连续 12–15。Idle 图 64×16 为四方向各一帧。映射 data/animations.json；脚底锚点 (.5,1)，按脚底 Y 排序，动画 8fps，nearest-neighbor 整数倍显示。样例没有工作动作（属于后续玩法），不伪造。原图预览见 evidence/NinjaBlue-Walk.png / OldMan-Walk.png。
## 可复现
`npm run assets:fetch` 在已有原 ZIP 时校验它；轻量包默认不含原 ZIP，此时通过官方公开免费文件接口获取同一 upload 并验证 SHA。`npm run assets:prepare` 从 ZIP 直接无损裁剪、生成地图及动画 JSON 和 manifest；要求 Python3 + Pillow，推荐项目内 `python3 -m venv .venv` 然后 `.venv/bin/pip install -r scripts/assets/requirements.txt` 并让 PATH 优先该虚拟环境。运行游戏不依赖 Python。原包不改写。若官方更新导致 SHA 不同，脚本停止，必须重新授权与视觉审查。
## 备选调研
[Kenney Tiny Town](https://kenney.nl/assets/tiny-town) 为官方备选；本次已打开调研，主包足够，未下载或使用 Kenney，避免仅因同为16像素而混搭。不使用 LPC、Sprout Lands、Tiny Swords 等授权复杂或画风不一致资源。
