"""Reproduce the admitted CC0 assets without changing world or animation data."""
import hashlib
import io
import json
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PREFIX = "Ninja Adventure - Asset Pack/"
ARCHIVE = ROOT / "assets/source/ninja-adventure-2026-03-29.zip"
ARCHIVE_SHA = "95a06f4fdcfd1882f061a45ff313b7c905dbe2de1e8512b281d7937df62a7b15"
LICENSE_PATH = "assets/licenses/NinjaAdventure-CC0.txt"
MANIFEST = ROOT / "assets/manifest.json"
FLOOR = "Backgrounds/Tilesets/TilesetFloor.png"
NATURE = "Backgrounds/Tilesets/TilesetNature.png"
HOUSE = "Backgrounds/Tilesets/TilesetHouse.png"
WATER = "Backgrounds/Tilesets/TilesetWater.png"
ELEMENT = "Backgrounds/Tilesets/TilesetElement.png"
DETAIL = "Backgrounds/Tilesets/TilesetFloorDetail.png"
ABANDONED = "Backgrounds/Tilesets/TilesetVillageAbandoned.png"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def region(column, row, width=1, height=1):
    return (16 * column, 16 * row, 16 * (column + width), 16 * (row + height))


def strip(image, cells):
    output = Image.new("RGBA", (len(cells) * 16, 16))
    for index, (column, row) in enumerate(cells):
        output.paste(image.crop(region(column, row)), (index * 16, 0))
    return output


def river_art(image):
    # Soften only the blue water palette, retaining the original foam and grass.
    sheet = strip(image, [(0, 7), (2, 7), (1, 7), (11, 1), (11, 3), (11, 4)])
    pixels = sheet.load()
    for y in range(sheet.height):
        for x in range(sheet.width):
            r, g, b, a = pixels[x, y]
            if b > r + 24 and g > r + 14:
                pixels[x, y] = (max(0, r - 12), int(g * 0.84), int(b * 0.9), a)
    result = Image.new("RGBA", (16 * 14, 16))
    result.paste(sheet)
    # Where the bank shifts by one tile, round the shoreline with the same foam pixels.
    for side in range(2):
        for index, (above, shift) in enumerate(((True, -8), (True, 10), (False, -8), (False, 10))):
            for y in range(16):
                t = max(0, (8 - y) / 8) if above else max(0, (y - 7) / 8)
                offset = round(shift * t * t) if side == 0 else -round(shift * t * t)
                for x in range(16):
                    source_x = x - offset
                    if 0 <= source_x < 16:
                        pixel = sheet.getpixel((source_x + side * 16, y))
                    elif (side == 0 and source_x >= 16) or (side == 1 and source_x < 0):
                        pixel = sheet.getpixel((39, y))
                    else:
                        pixel = (0, 0, 0, 0)
                    result.putpixel(((6 + side * 4 + index) * 16 + x, y), pixel)
    return result


def bridge_art(image, broken):
    # The pack has planks, borders and bolts. Join them into a horizontal deck.
    deck = Image.new("RGBA", (112, 32))
    boards = image.crop((66, 195, 82, 222))
    bottom_rail = image.crop((17, 237, 33, 242))
    cap = image.crop((62, 194, 67, 223))
    for x in range(0, 112, 16):
        deck.alpha_composite(boards, (x, 2))
        deck.alpha_composite(bottom_rail.transpose(Image.Transpose.FLIP_TOP_BOTTOM), (x, 0))
        deck.alpha_composite(bottom_rail, (x, 27))
    deck.alpha_composite(cap, (0, 1))
    deck.alpha_composite(cap.transpose(Image.Transpose.FLIP_LEFT_RIGHT), (107, 1))
    if broken:
        left_edge = [27, 26, 26, 29, 38, 33, 31, 36, 35, 24, 28, 28, 24, 25, 25, 22]
        right_edge = [91, 89, 90, 85, 78, 81, 87, 76, 81, 82, 88, 86, 90, 90, 91, 90]
        for y in range(32):
            for x in range(left_edge[y // 2], right_edge[y // 2]):
                deck.putpixel((x, y), (0, 0, 0, 0))
    return deck


def prepare():
    if sha(ARCHIVE.read_bytes()) != ARCHIVE_SHA:
        raise SystemExit("Original archive checksum changed; a new license review is required")
    manifest = json.loads(MANIFEST.read_text())
    records = {entry["assetId"]: entry for entry in manifest["assets"]}
    if len(records) != len(manifest["assets"]):
        raise SystemExit("Duplicate asset IDs in manifest")
    with zipfile.ZipFile(ARCHIVE) as archive:
        license_text = archive.read(PREFIX + "LICENSE.txt")
        if not license_text.startswith(b"CC0 1.0 Universal"):
            raise SystemExit("Original license is not CC0 1.0")
        license_file = ROOT / LICENSE_PATH
        license_file.parent.mkdir(parents=True, exist_ok=True)
        license_file.write_bytes(license_text)

        def emit(name, src, category, recipe=None, transform=None, crop=None):
            original = archive.read(PREFIX + src)
            output_path = f"public/assets/{name}"
            target = ROOT / output_path
            if any(entry["outputPath"] == output_path and asset_id != name
                   for asset_id, entry in records.items()):
                raise SystemExit(f"Conflicting output path: {output_path}")
            target.parent.mkdir(parents=True, exist_ok=True)
            if crop or transform:
                with Image.open(io.BytesIO(original)) as image:
                    result = image.crop(crop) if crop else transform(image.convert("RGBA"))
                    result.save(target)
            else:
                target.write_bytes(original)
            entry = records.get(name, {})
            entry.update(
                assetId=name, pack="Ninja Adventure", authors=["Pixel-Boy", "AAA"],
                sourceUrl="https://pixel-boy.itch.io/ninja-adventure-asset-pack",
                version="itch upload 16981275 / 2026-03-29 (Update 8)",
                acquired="2026-11-24 Asia/Shanghai", license="CC0-1.0",
                originalPath=PREFIX + src, outputPath=output_path,
                originalSha256=sha(original), sha256=sha(target.read_bytes()),
                modifications=recipe or (f"Lossless crop {crop}" if crop else "None; exact bytes"),
                category=category,
            )
            records[name] = entry

        for actor, key in [("NinjaBlue", "player"), ("OldMan", "npc"),
                           ("Woman", "ahe"), ("Hunter", "luozhou")]:
            # Residents use fixed facing while the traveler uses the walk sheet.
            for anim in (("Walk", "Idle") if key in ("player", "npc") else ("Idle",)):
                emit(f"{key}-{anim.lower()}.png",
                     f"Actor/Character/{actor}/SeparateAnim/{anim}.png", "characters/animation")
            emit(f"{key}-face.png", f"Actor/Character/{actor}/Faceset.png", "characters/portrait")

        for name, src, category, crop in [
            ("grass", FLOOR, "terrain", region(0, 12)),
            ("path", FLOOR, "terrain", region(1, 8)),
            ("tree", NATURE, "plants", region(0, 0, 2, 2)),
            ("pine", NATURE, "plants", region(2, 0, 2, 2)),
            ("grove", NATURE, "plants", region(0, 18, 3, 3)),
            ("house", HOUSE, "buildings", region(0, 0, 4, 3)),
            ("house-sage", HOUSE, "buildings", region(19, 0, 4, 3)),
            ("house-amber", HOUSE, "buildings", region(8, 0, 4, 3)),
            ("flowers", NATURE, "plants", region(0, 10)),
            ("bush", NATURE, "plants", region(1, 10)),
            ("reeds", NATURE, "plants", region(7, 11)),
            ("leaf", DETAIL, "plants", region(6, 2)),
            ("petals", DETAIL, "plants", region(2, 0)),
            ("wood-node", NATURE, "resource", region(2, 8, 2, 2)),
            ("rock-node", NATURE, "resource", region(17, 14, 4, 3)),
            ("boulders", NATURE, "plants", region(16, 5, 4, 3)),
            ("log-stump", NATURE, "plants", region(12, 17)),
            ("pebbles", NATURE, "terrain", region(17, 18)),
            ("ruin-arch", HOUSE, "ruins", region(29, 20, 3, 3)),
            ("ruin-stone", HOUSE, "ruins", region(1, 19, 2, 3)),
            ("ruin-wall", ABANDONED, "ruins", region(17, 3, 3, 2)),
            ("supply-crate", ELEMENT, "props", region(0, 0)),
            ("signpost", ELEMENT, "props", region(7, 2)),
        ]:
            emit(f"{name}.png", src, category, crop=crop)
        ground_cells = [(0, 12), (1, 12), (2, 12), (3, 12), (4, 12),
                        (12, 12), (13, 12), (14, 12), (15, 12),
                        *[(x, y) for y in range(7, 10) for x in range(3)]]
        emit("valley-ground.png", FLOOR, "terrain", f"16px cells in order: {ground_cells}",
             transform=lambda image: strip(image, ground_cells))
        emit("valley-river.png", WATER, "terrain",
             "16px cells (0,7) (2,7) (1,7) (11,1) (11,3) (11,4); muted original blue pixels; eight rounded banks shift original foam pixels and reuse base water",
             transform=river_art)
        for state in ("open", "broken"):
            emit(f"bridge-{state}.png", WATER, "buildings",
                 "112x32 deck repeating original boards (66,195,82,222), rails (17,237,33,242) and mirrored end caps (62,194,67,223)"
                 + ("; jagged transparent gap mask" if state == "broken" else ""),
                 transform=lambda image: bridge_art(image, broken=state == "broken"))

        for name, src, category in [
            ("letter.png", "Items/Other/Letter.png", "items"),
            ("arrow.png", "Ui/Arrow.png", "ui"),
            ("wood.png", "Items/Resource/Branch.png", "items"),
            ("stone.png", "Items/Resource/Rock.png", "items"),
            ("food.png", "Items/Food/Onigiri.png", "items"),
            ("toolbox.png", "Items/Object/CrateEmpty.png", "items"),
            ("village.ogg", "Audio/Musics/36 - Village.ogg", "music"),
            ("alert.wav", "Audio/Sounds/Alert/Alert.wav", "sound-effects"),
        ]:
            emit(name, src, category)
    manifest.update(archiveSha256=ARCHIVE_SHA, licenseFile=LICENSE_PATH, assets=list(records.values()))
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"Verified CC0 archive and prepared {len(records)} registered runtime assets")


if __name__ == "__main__":
    prepare()
