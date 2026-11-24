"""Build the fixed, data-driven Foglamp Valley from authored landmarks and routes."""
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SIZE = 48
TILE = 16

# West bank neighborhoods, quarry trail, and east bank trail. Coordinates are tiles.
TRAILS = [
    (1.1, [(0, 29), (4, 28), (7, 26), (11, 24), (14, 22), (17, 22),
           (20, 23), (24, 23), (26, 22.5), (29, 22.5)]),
    (1.0, [(9, 25), (9, 22), (10, 20), (13, 20), (15, 18), (16, 16),
           (15, 13), (12, 11), (9, 11), (7, 9), (5, 8), (1, 9)]),
    (0.75, [(11, 11), (11, 8), (13, 6), (15, 5)]),
    (1.0, [(17, 22), (18, 25), (19, 27), (21, 29), (22, 32), (21, 36), (20, 42)]),
    (0.9, [(21, 23), (22, 21), (24, 21)]),
    (1.1, [(33, 22.5), (35, 22.5), (38, 23), (40, 22), (43, 20), (43, 18)]),
    (0.75, [(39, 22), (39, 26), (41, 29), (44, 30), (47, 31)]),
]

# Inclusive west edge by row, continuing to both world boundaries.
BANK = [
    28, 28, 28, 29, 29, 30, 30, 31, 31, 31, 31, 30,
    30, 29, 29, 28, 28, 27, 27, 28, 28, 29, 29, 29,
    29, 29, 28, 28, 27, 27, 27, 27, 28, 28, 29, 29,
    30, 30, 31, 31, 31, 30, 30, 29, 29, 28, 28, 28,
]


def distance_to_segment(x, y, start, end):
    vx, vy = end[0] - start[0], end[1] - start[1]
    t = ((x - start[0]) * vx + (y - start[1]) * vy) / (vx * vx + vy * vy)
    t = min(1, max(0, t))
    return math.hypot(x - start[0] - t * vx, y - start[1] - t * vy)


def road(x, y):
    if ((x - 15) / 3.5) ** 2 + ((y - 21.5) / 2.4) ** 2 < 1:
        return True
    if ((x - 42.5) / 2.6) ** 2 + ((y - 19) / 2.2) ** 2 < 1:
        return True
    return any(distance_to_segment(x, y, a, b) < radius + 0.45
               for radius, points in TRAILS for a, b in zip(points, points[1:]))


def in_water(x, y):
    return BANK[y] <= x < BANK[y] + 5


def ground_tile(x, y, rng):
    if road(x, y):
        left, right = road(x - 1, y), road(x + 1, y)
        top, bottom = road(x, y - 1), road(x, y + 1)
        column = 0 if not left else 2 if not right else 1
        row = 0 if not top else 2 if not bottom else 1
        return 9 + row * 3 + column
    shade = (math.sin(x * 0.36 + y * 0.12) + math.cos(y * 0.39 - x * 0.15) * 0.7
             + math.sin((x + y) * 0.16) * 0.5)
    if shade > (0.96 if x < 24 and y < 16 else 1.65):
        return rng.choices([5, 6, 7, 8], [8, 2, 2, 2])[0]
    return rng.choices([0, 1, 2, 3, 4], [15, 2, 2, 2, 1])[0]


def river_tile(x, y, rng):
    if not in_water(x, y):
        return -1
    offset = x - BANK[y]
    if offset in (0, 4):
        side = 0 if offset == 0 else 1
        turn = 6 + side * 4
        if y > 0 and BANK[y - 1] != BANK[y]:
            return turn + (BANK[y - 1] > BANK[y])
        if y < SIZE - 1 and BANK[y + 1] != BANK[y]:
            return turn + 2 + (BANK[y + 1] > BANK[y])
        return side
    return rng.choices([2, 3, 4, 5], [45, 4, 1, 2])[0]


props = []
actors = [
    dict(id="cenyan", name="岑砚", role="木匠", asset="npc", x=255, y=299, range=31, facing="down",
         intro="修得慢一点也好。答应修好的桥，得经得住下一次雾潮。"),
    dict(id="ahe", name="阿禾", role="采集者", asset="ahe", x=149, y=356, range=31, facing="right",
         intro="北边林地有倒木，南坡的石头也好找。取够用的就好，留些给下一个人。"),
    dict(id="luozhou", name="洛舟", role="探路人", asset="luozhou", x=368, y=369, range=31, facing="left",
         intro="过了河，顺着石阶往北走。我从岸上见过那里有一块刻着星纹的石头。"),
]
resources = [
    *(dict(id=f"fallen-wood-{i:02}", name="林间倒木", item="wood", asset="wood-node",
           spent="log-stump", x=x, y=y, range=30, yieldCount=1, cooldownMs=22000)
      for i, (x, y) in enumerate([(105, 211), (160, 195), (203, 188), (243, 149),
                                  (211, 117), (160, 132)], 1)),
    *(dict(id=f"quarry-stone-{i:02}", name="河谷岩簇", item="stone", asset="rock-node",
           spent="pebbles", x=x, y=y, range=37, yieldCount=1, cooldownMs=26000)
      for i, (x, y) in enumerate([(308, 475), (366, 517), (294, 550)], 1)),
]


def prop(id, asset, x, y, size=None, ground=False):
    item = dict(id=id, asset=asset, x=x, y=y)
    if size:
        w, h = size
        item["solid"] = dict(x=x - w / 2, y=y - h, w=w, h=h)
    if ground:
        item["ground"] = True
    props.append(item)


prop("house-carpenter", "house-amber", 247, 267, (59, 27))
prop("house-forager", "house", 132, 330, (58, 28))
prop("house-scout", "house-sage", 373, 340, (59, 28))
prop("sign-square", "signpost", 229, 356)
prop("sign-bridge", "signpost", 421, 347)
prop("camp-supplies", "supply-crate", 166, 410, (12, 8))
prop("workshop-supplies", "supply-crate", 281, 276, (12, 8))
prop("ruin-entry", "ruin-arch", 683, 350)
props[-1]["solids"] = [dict(x=x, y=337, w=11, h=11) for x in (661, 694)]
prop("ruin-beacon", "ruin-stone", 683, 294, (26, 15))
prop("ruin-west-wall", "ruin-wall", 633, 291, (36, 13))
prop("ruin-east-wall", "ruin-wall", 732, 303, (36, 13))
for i, (x, y) in enumerate([(669, 304), (699, 306), (657, 319), (707, 325),
                              (670, 279), (723, 320), (682, 329)]):
    prop(f"ruin-pebbles-{i}", "pebbles", x, y, ground=True)
for item in resources:
    half_width = 9 if item["item"] == "wood" else 23
    item["solid"] = dict(x=item["x"] - half_width, y=item["y"] - 11,
                         w=half_width * 2, h=13)

rng = random.Random(961)
anchors = [(p["x"], p["y"]) for p in [*props, *actors, *resources]]
anchors.extend([(184, 384), (445, 368), (683, 317)])
for i, (x, y, asset) in enumerate([
    (68, 263, "grove"), (102, 286, "tree"), (53, 353, "grove"), (87, 399, "tree"),
    (183, 276, "tree"), (294, 325, "tree"), (318, 294, "grove"),
    (399, 397, "tree"), (71, 453, "pine"), (166, 455, "grove"),
    (127, 506, "tree"), (199, 545, "tree"), (255, 499, "pine"),
    (414, 470, "tree"), (567, 337, "tree"), (591, 398, "grove"),
    (727, 366, "pine"), (748, 267, "grove"), (601, 261, "pine"),
]):
    prop(f"landmark-tree-{i:02}", asset, x, y, (18 if asset == "grove" else 11, 10))
    anchors.append((x, y))
for i, (x, y) in enumerate([(280, 432), (385, 466), (406, 509), (337, 576),
                             (383, 593), (630, 249), (729, 246), (655, 393)]):
    prop(f"boulders-{i:02}", "boulders", x, y, (36, 22))
    anchors.append((x, y))

for y in range(SIZE):
    for x in range(SIZE):
        if road(x, y) or in_water(x, y):
            continue
        px, py = (x + 0.5) * TILE + rng.randrange(-5, 6), (y + 0.5) * TILE + rng.randrange(-5, 6)
        if min(math.hypot(px - ax, py - ay) for ax, ay in anchors) < 23:
            continue
        density = 0.19 if x < 19 and y < 16 else 0.11 if x > 35 or y > 34 else 0.055
        if rng.random() < density and x not in [BANK[y] - 1, BANK[y] + 5]:
            asset = rng.choices(["tree", "pine", "grove"], [7, 5, 1])[0]
            prop(f"canopy-{x:02}-{y:02}", asset, px, py, (12, 9))
            anchors.append((px, py))
        elif rng.random() < 0.15:
            bank = x in [BANK[y] - 1, BANK[y] + 5]
            asset = rng.choice(["reeds", "reeds", "bush"]) if bank else rng.choice(
                ["flowers", "bush", "leaf", "petals", "leaf"])
            prop(f"flora-{x:02}-{y:02}", asset, px, py, ground=True)

terrain_random = random.Random(875)
map_data = {
    "id": "foglamp-valley",
    "contentVersion": 1,
    "width": SIZE,
    "height": SIZE,
    "tileSize": TILE,
    "spawn": {"id": "traveler-01", "name": "旅人", "x": 184, "y": 384, "asset": "player"},
    "ground": [[ground_tile(x, y, terrain_random) for x in range(SIZE)] for y in range(SIZE)],
    "river": [[river_tile(x, y, terrain_random) for x in range(SIZE)] for y in range(SIZE)],
    "props": props,
    "residents": actors,
    "resources": resources,
    "bridge": {"id": "old-river-bridge", "name": "雾灯旧桥", "x": 443, "y": 368,
               "range": 32, "left": 448, "top": 352,
               "crossing": {"column": 29, "row": 22, "width": 5, "height": 2},
               "required": {"wood": 6, "stone": 2}, "workMs": 14000},
    "ruin": {"id": "beacon-ruin", "name": "航标遗迹", "x": 683, "y": 303, "range": 31,
             "clue": "风化的石面留下一行浅刻：雾潮平息时，沿三盏航灯向北。你把星纹拓进了行囊。"},
    "regions": [
        {"name": "航标遗迹", "x": 679, "y": 302, "radius": 70},
        {"name": "旧桥渡口", "x": 500, "y": 368, "radius": 78},
        {"name": "南坡岩场", "x": 345, "y": 534, "radius": 110},
        {"name": "北坡林地", "x": 175, "y": 164, "radius": 120},
        {"name": "谷地聚落", "x": 246, "y": 328, "radius": 154},
    ],
}
# Keep layers compact enough to inspect while making landmark records easy to edit.
output = json.dumps(map_data, ensure_ascii=False, indent=2)
for key in ("ground", "river"):
    full = json.dumps(map_data[key], indent=2)
    indented = "\n".join("  " + line for line in full.splitlines())[2:]
    rows = ",\n".join("    " + json.dumps(row, separators=(",", ":")) for row in map_data[key])
    output = output.replace(indented, "[\n" + rows + "\n  ]")
(ROOT / "data/foglamp-valley.json").write_text(output + "\n")
print(f"{SIZE}x{SIZE} Foglamp Valley; {len(props)} props; {len(resources)} resource nodes")
