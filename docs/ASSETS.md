# 素材准入与处理

采用 Pixel-Boy 与 AAA 的 Ninja Adventure Update 8，itch upload 16981275，原包标记 2026-03-29。官方页面、原包 README 和包内 LICENSE 使用 CC0 1.0 Universal。Phase 1 使用已入库的同一原包并核对哈希。[Ninja Adventure 官方发布页](https://pixel-boy.itch.io/ninja-adventure-asset-pack)

- 许可原件 `assets/licenses/NinjaAdventure-CC0.txt`
- 本地可选原包 `assets/source/ninja-adventure-2026-03-29.zip`
- 原包 SHA-256 `95a06f4fdcfd1882f061a45ff313b7c905dbe2de1e8512b281d7937df62a7b15`
- 全包文件索引 `assets/source/inventory.json`
- 运行素材逐文件记录 [assets/manifest.json](../assets/manifest.json)

## 本地输出

| 用途 | 来源及加工 |
|---|---|
| 角色、头像 | NinjaBlue 是旅人，OldMan 是岑砚，Woman 是阿禾，Hunter 是洛舟。头像和动画采用原始 PNG |
| 草地、小径、河岸 | TilesetFloor 裁剪排列为 16 像素地块。TilesetWater 保留原图的岸线和泡沫，对蓝色水面调色并用原岸线像素组合转弯 |
| 旧桥与修复桥 | TilesetWater 的板材、边框和端头组合成同一尺寸的两个图块。按破损轮廓清除中段像素，破桥下可见河水 |
| 住宅、林地、岩场和遗迹 | 从 TilesetHouse、TilesetNature、TilesetElement 及 TilesetVillageAbandoned 裁剪各自的实体和装饰 |
| 背包、交互 | 木枝、石块、饭团、木箱、箭头和信件 PNG |
| 环境音乐及操作音 | Village.ogg 与 Alert.wav 原始文件，音乐默认关闭 |

清单随附 45 个本地素材输出，包括历史预览的草地、路面和 OldMan 行走帧。游戏关键素材按使用场景加载，缺图或解码失败会显示具体资源名。角色站立方向由 `data/animations.json` 指定，旅人行走的方向在列、时间帧在行。脚底锚点和 Y 遮挡结合资产透明边缘使用。

## 重建

Python 3 和 `scripts/assets/requirements.txt` 锁定的 Pillow 用于离线开发。已有原 ZIP 时 fetch 只校验；缺包时 fetch 从已登记的官方上传获取同一文件，同名包哈希变化便停止。原包约 90 MiB，留在本地素材目录。

```bash
npm run assets:fetch && npm run assets:prepare
npm run world:generate
```

`assets:prepare` 只更新已登记素材配方和许可，保留清单扩展字段及其他条目。地图、动画配置和旧预览地图由独立文件管理。
