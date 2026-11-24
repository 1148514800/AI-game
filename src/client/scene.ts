import Phaser from "phaser";
import animations from "../../data/animations.json";
import manifest from "../../assets/manifest.json";
import type { Snapshot } from "../shared/protocol.js";
import {
  distance,
  mapHeight,
  mapWidth,
  nearbyTarget,
  valley,
  type Direction,
} from "../shared/world.js";

const spritesheets = new Set([
  "player-walk",
  "player-idle",
  ...valley.residents.map((actor) => `${actor.asset}-idle`),
]);
const variants = new Map(valley.resources.map((entry) => [entry.id, entry]));

export class ValleyScene extends Phaser.Scene {
  private player?: Phaser.GameObjects.Sprite;
  private shadow?: Phaser.GameObjects.Ellipse;
  private marker?: Phaser.GameObjects.Image;
  private bridge?: Phaser.GameObjects.Image;
  private nodeSprites = new Map<string, Phaser.GameObjects.Image>();
  private failed: string[] = [];
  private current?: Snapshot;
  private overview = false;
  private halted = true;
  private view?: HTMLElement;
  private music?: Phaser.Sound.BaseSound;

  constructor(private readonly onAssets: (failures: string[]) => void) {
    super("foglamp-valley");
  }

  preload() {
    this.load.on("loaderror", (file: { key: string }) =>
      this.failed.push(file.key),
    );
    const uses = new Set([
      "valley-ground",
      "valley-river",
      "bridge-broken",
      "bridge-open",
      "player-face",
      "wood",
      "stone",
      "food",
      "toolbox",
      "letter",
      "arrow",
      "village",
      "alert",
      ...spritesheets,
      ...valley.props.map((object) => object.asset),
      ...valley.residents.map((resident) => `${resident.asset}-face`),
      ...valley.resources.flatMap((resource) => [
        resource.asset,
        resource.spent,
      ]),
    ]);
    for (const { assetId } of manifest.assets) {
      const key = assetId.replace(/\.[^.]+$/, "");
      if (!uses.delete(key)) continue;
      const path = `/assets/${assetId}`;
      if (spritesheets.has(key)) {
        this.load.spritesheet(key, path, {
          frameWidth: animations.frameWidth,
          frameHeight: animations.frameHeight,
        });
      } else if (assetId.endsWith(".png")) {
        this.load.image(key, path);
      } else {
        this.load.audio(key, path);
      }
    }
    this.failed.push(...uses);
  }

  create() {
    this.view = document.querySelector<HTMLElement>("#game")!;
    const size = new ResizeObserver(() => this.resizeView());
    size.observe(this.view);
    this.events.once("shutdown", () => size.disconnect());
    this.resizeView();
    if (this.failed.length) {
      this.onAssets(this.failed);
      return;
    }

    this.drawTerrain();
    const { left, top } = valley.bridge;
    this.bridge = this.add
      .image(left, top, "bridge-broken")
      .setOrigin(0)
      .setDepth(-500);
    for (const prop of valley.props) {
      this.add
        .image(prop.x, prop.y, prop.asset)
        .setOrigin(0.5, 1)
        .setDepth(prop.ground ? -800 : prop.y);
    }
    for (const resource of valley.resources) {
      this.nodeSprites.set(
        resource.id,
        this.add
          .image(resource.x, resource.y, resource.asset)
          .setOrigin(0.5, 1)
          .setDepth(resource.y),
      );
      const label = resource.item === "wood" ? "wood" : "stone";
      this.add
        .image(resource.x, resource.y - 21, label)
        .setOrigin(0.5)
        .setDepth(850)
        .setScale(0.7);
    }
    for (const resident of valley.residents) {
      this.drawShadow(resident.x, resident.y);
      this.add
        .sprite(
          resident.x,
          resident.y,
          `${resident.asset}-idle`,
          animations.directionColumns[resident.facing],
        )
        .setOrigin(0.5, 1)
        .setDepth(resident.y);
      this.nameplate(resident.x, resident.y, resident.name);
    }
    for (const direction of Object.keys(
      animations.walk.framesByDirection,
    ) as Direction[]) {
      this.anims.create({
        key: `walk-${direction}`,
        frames: animations.walk.framesByDirection[direction].map((frame) => ({
          key: "player-walk",
          frame,
        })),
        frameRate: animations.walk.frameRate,
        repeat: -1,
      });
    }
    const start = this.current?.state.player ?? valley.spawn;
    this.shadow = this.drawShadow(start.x, start.y);
    this.player = this.add
      .sprite(start.x, start.y, "player-idle", 0)
      .setOrigin(0.5, 1)
      .setDepth(start.y);
    this.marker = this.add
      .image(0, 0, "arrow")
      .setOrigin(0.5, 1)
      .setDepth(990)
      .setVisible(false);
    this.setOverview(this.overview);
    if (this.current) this.apply(this.current);
    this.onAssets([]);
  }

  setOverview(active: boolean) {
    this.overview = active;
    if (!this.player) return;
    const camera = this.cameras.main;
    if (active) {
      camera.stopFollow();
      camera.removeBounds();
      camera.setZoom(
        Math.min(camera.width / mapWidth, camera.height / mapHeight) * 0.98,
      );
      camera.centerOn(mapWidth / 2, mapHeight / 2);
    } else {
      camera.setZoom(1);
      camera.setBounds(0, 0, mapWidth, mapHeight);
      camera.startFollow(this.player, true);
    }
  }

  setHalted(value: boolean) {
    this.halted = value;
  }

  apply(snapshot: Snapshot) {
    const player = this.player;
    this.current = snapshot;
    if (!player || !this.view) return;
    this.view.dataset.x = snapshot.state.player.x.toFixed(4);
    this.view.dataset.y = snapshot.state.player.y.toFixed(4);
    if (distance(player, snapshot.state.player) > 48)
      player.setPosition(snapshot.state.player.x, snapshot.state.player.y);
    this.bridge?.setTexture(
      snapshot.state.bridge.repaired ? "bridge-open" : "bridge-broken",
    );
    for (const [id, node] of this.nodeSprites) {
      const resource = variants.get(id)!;
      const spent = (snapshot.state.cooldowns[id] ?? 0) > snapshot.now;
      node.setAlpha(spent ? 0.61 : 1);
      if (resource.item === "wood")
        node.setTexture(spent ? resource.spent : resource.asset);
    }
  }

  playSound() {
    this.sound.play("alert", { volume: 0.2 });
  }

  async toggleMusic() {
    this.music ??= this.sound.add("village", { loop: true, volume: 0.16 });
    if (this.music.isPlaying) {
      this.music.stop();
      return false;
    }
    if (
      this.sound instanceof Phaser.Sound.WebAudioSoundManager &&
      this.sound.context.state === "suspended"
    )
      await this.sound.context.resume();
    if (!this.music.play()) throw Error("音频未启动");
    return true;
  }

  update(_time: number, elapsed: number) {
    if (
      !this.player ||
      !this.shadow ||
      !this.view ||
      !this.current ||
      !this.marker
    )
      return;
    const { state, moving, working } = this.current;
    const { x, y, facing } = state.player;
    const sprite = this.player;
    const remaining = Math.pow(0.08, elapsed / 50);
    sprite
      .setPosition(
        x + (sprite.x - x) * remaining,
        y + (sprite.y - y) * remaining,
      )
      .setDepth(sprite.y);
    this.shadow.setPosition(sprite.x, sprite.y - 1).setDepth(sprite.y - 0.5);
    if (!this.halted && moving) sprite.play(`walk-${facing}`, true);
    else {
      sprite.stop();
      sprite.setTexture("player-idle", animations.directionColumns[facing]);
    }

    const target = nearbyTarget(state.player);
    if (working && !this.halted && !this.overview) {
      this.marker
        .setTexture("toolbox")
        .setPosition(sprite.x, sprite.y - 19)
        .setVisible(true);
    } else if (target && !this.halted && !this.overview) {
      const node = this.nodeSprites.get(target.id);
      const height =
        target.id === valley.ruin.id
          ? 56
          : target.id === valley.bridge.id
            ? 23
            : node
              ? node.height + 2
              : 36;
      this.marker
        .setTexture("arrow")
        .setPosition(target.x, target.y - height)
        .setVisible(true);
    } else this.marker.setVisible(false);

    const view = this.view.dataset;
    view.x = x.toFixed(4);
    view.y = y.toFixed(4);
    view.direction = facing;
    view.frame = String(sprite.frame.name);
    view.moving = String(moving);
    view.working = String(working);
    view.cameraX = this.cameras.main.scrollX.toFixed(2);
    view.cameraY = this.cameras.main.scrollY.toFixed(2);
  }

  private drawTerrain() {
    const texture = this.textures.createCanvas("terrain", mapWidth, mapHeight)!;
    const groundImage = this.textures
      .get("valley-ground")
      .getSourceImage() as CanvasImageSource;
    const riverImage = this.textures
      .get("valley-river")
      .getSourceImage() as CanvasImageSource;
    const side = valley.tileSize;
    for (let y = 0; y < valley.height; y++) {
      for (let x = 0; x < valley.width; x++) {
        const sx = x * side,
          sy = y * side;
        texture.context.drawImage(
          groundImage,
          valley.ground[y][x] * side,
          0,
          side,
          side,
          sx,
          sy,
          side,
          side,
        );
        const river = valley.river[y][x];
        if (river >= 0)
          texture.context.drawImage(
            riverImage,
            river * side,
            0,
            side,
            side,
            sx,
            sy,
            side,
            side,
          );
      }
    }
    texture.refresh();
    this.add.image(0, 0, "terrain").setOrigin(0).setDepth(-1000);
  }

  private resizeView() {
    if (!this.view || !this.game.canvas) return;
    const scale = 2;
    const width = Math.max(1, Math.floor(this.view.clientWidth / scale));
    const height = Math.max(1, Math.floor(this.view.clientHeight / scale));
    this.scale.resize(width, height);
    this.game.canvas.style.width = `${width * scale}px`;
    this.game.canvas.style.height = `${height * scale}px`;
    this.setOverview(this.overview);
  }

  private drawShadow(x: number, y: number) {
    return this.add.ellipse(x, y - 1, 12, 4, 0x29291e, 0.32).setDepth(y - 0.5);
  }

  private nameplate(x: number, y: number, name: string) {
    this.add
      .text(x, y - 19, name, {
        fontFamily:
          '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif',
        fontStyle: "bold",
        fontSize: "9px",
        color: "#f9ecce",
        backgroundColor: "#294039",
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setDepth(900);
  }
}
