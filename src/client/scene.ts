import Phaser from "phaser";
import animations from "../../data/animations.json";
import manifest from "../../assets/manifest.json";
import { npcIds, npcSchema, actorName, type NpcId } from "../shared/social.js";
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
  "npc-walk",
  ...valley.residents.map((actor) => `${actor.asset}-idle`),
]);
const variants = new Map(valley.resources.map((entry) => [entry.id, entry]));

export class ValleyScene extends Phaser.Scene {
  private player?: Phaser.GameObjects.Sprite;
  private readonly residents = new Map<
    NpcId,
    {
      sprite: Phaser.GameObjects.Sprite;
      shadow: Phaser.GameObjects.Ellipse;
      name: Phaser.GameObjects.Text;
      bubble: Phaser.GameObjects.Text;
    }
  >();
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
  private markerTarget?: ReturnType<typeof nearbyTarget>;

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
      const id = npcSchema.parse(resident.id);
      const actor = this.current?.state.actors[id] ?? resident;
      const shadow = this.drawShadow(actor.x, actor.y);
      const sprite = this.add
        .sprite(
          actor.x,
          actor.y,
          `${resident.asset}-idle`,
          animations.directionColumns[actor.facing],
        )
        .setOrigin(0.5, 1)
        .setDepth(actor.y);
      const name = this.nameplate(actor.x, actor.y, resident.name);
      const bubble = this.add
        .text(actor.x, actor.y - 30, "", {
          fontSize: "9px",
          color: "#edf2df",
          backgroundColor: "#253b30",
          wordWrap: { width: 120, useAdvancedWrap: true },
          padding: { x: 5, y: 3 },
        })
        .setOrigin(0.5, 1)
        .setDepth(995)
        .setVisible(false);
      this.residents.set(id, { sprite, shadow, name, bubble });
    }
    for (const direction of Object.keys(
      animations.walk.framesByDirection,
    ) as Direction[]) {
      for (const actor of ["player", "npc"]) {
        this.anims.create({
          key: `${actor}-walk-${direction}`,
          frames: animations.walk.framesByDirection[direction].map((frame) => ({
            key: `${actor}-walk`,
            frame,
          })),
          frameRate: animations.walk.frameRate,
          repeat: -1,
        });
      }
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
    this.setDebug("x", snapshot.state.player.x.toFixed(4));
    this.setDebug("y", snapshot.state.player.y.toFixed(4));
    if (distance(player, snapshot.state.player) > 48)
      player.setPosition(snapshot.state.player.x, snapshot.state.player.y);
    const actor = snapshot.state.cenyan;
    this.setDebug("cenyanX", actor.x.toFixed(4));
    this.setDebug("cenyanY", actor.y.toFixed(4));
    this.setDebug("cenyanActivity", snapshot.cenyan.activity);
    for (const id of npcIds) {
      const actor = snapshot.state.actors[id];
      const visual = this.residents.get(id);
      if (visual && distance(visual.sprite, actor) > 48)
        visual.sprite.setPosition(actor.x, actor.y);
      const speech =
        snapshot.bubbles.find((line) => line.actor === id)?.text ?? "";
      if (visual && visual.bubble.text !== speech)
        visual.bubble.setText(
          speech.length > 75 ? speech.slice(0, 74) + "…" : speech,
        );
    }
    this.markerTarget = nearbyTarget(
      snapshot.state.player,
      snapshot.state.actors,
    );
    const bridgeTexture = snapshot.state.bridge.repaired
      ? "bridge-open"
      : "bridge-broken";
    if (this.bridge && this.bridge.texture.key !== bridgeTexture)
      this.bridge.setTexture(bridgeTexture);
    for (const [id, node] of this.nodeSprites) {
      const resource = variants.get(id)!;
      const spent = (snapshot.state.cooldowns[id] ?? 0) > snapshot.now;
      const alpha = spent ? 0.61 : 1;
      if (node.alpha !== alpha) node.setAlpha(alpha);
      const texture =
        spent && resource.item === "wood" ? resource.spent : resource.asset;
      if (node.texture.key !== texture) node.setTexture(texture);
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
    const { facing } = state.player;
    const sprite = this.player;
    this.drawActor(
      sprite,
      this.shadow,
      state.player,
      "player",
      moving,
      elapsed,
    );
    for (const [id, { sprite: npc, shadow, name, bubble }] of this.residents) {
      const activity = this.current.actors[id].activity;
      const actor = state.actors[id];
      // The existing four-direction walk sheet depicts Cenyan. The other residents
      // keep their own art while moving via the same interpolation.
      const texture = id === "cenyan" ? "npc" : id;
      this.drawActor(
        npc,
        shadow,
        actor,
        texture,
        activity === "moving",
        elapsed,
      );
      if (name.x !== npc.x || name.y !== npc.y - 19)
        name.setPosition(npc.x, npc.y - 19);
      const captions: Partial<Record<typeof activity, string>> = {
        collecting: "采集",
        delivering: "交材",
        working: "施工",
        resting: "休息",
        talking: "交谈",
      };
      const caption =
        actorName(id) + (captions[activity] ? " · " + captions[activity] : "");
      if (name.text !== caption) name.setText(caption);
      bubble.setVisible(Boolean(bubble.text) && !this.overview && !this.halted);
      if (bubble.visible) bubble.setPosition(npc.x, npc.y - 34);
      if (id === "cenyan") {
        this.setDebug("cenyanDirection", actor.facing);
        this.setDebug("cenyanFrame", String(npc.frame.name));
      }
    }
    const target = this.markerTarget;
    const show = !this.halted && !this.overview && Boolean(working || target);
    if (this.marker.visible !== show) this.marker.setVisible(show);
    if (show && working) {
      if (this.marker.texture.key !== "toolbox")
        this.marker.setTexture("toolbox");
      if (this.marker.x !== sprite.x || this.marker.y !== sprite.y - 19)
        this.marker.setPosition(sprite.x, sprite.y - 19);
    } else if (show && target) {
      const node = this.nodeSprites.get(target.id);
      const height =
        target.id === valley.ruin.id
          ? 56
          : target.id === valley.bridge.id
            ? 23
            : node
              ? node.height + 2
              : 36;
      if (this.marker.texture.key !== "arrow") this.marker.setTexture("arrow");
      if (this.marker.x !== target.x || this.marker.y !== target.y - height)
        this.marker.setPosition(target.x, target.y - height);
    }

    this.setDebug("direction", facing);
    this.setDebug("frame", String(sprite.frame.name));
    this.setDebug("moving", String(moving));
    this.setDebug("working", String(working));
    this.setDebug("cameraX", this.cameras.main.scrollX.toFixed(2));
    this.setDebug("cameraY", this.cameras.main.scrollY.toFixed(2));
  }

  private drawActor(
    sprite: Phaser.GameObjects.Sprite,
    shadow: Phaser.GameObjects.Ellipse,
    target: { x: number; y: number; facing: Direction },
    asset: "player" | "npc" | "ahe" | "luozhou",
    moving: boolean,
    elapsed: number,
  ) {
    const { x, y, facing } = target;
    if (sprite.x !== x || sprite.y !== y) {
      const remaining = Math.pow(0.08, elapsed / 50);
      const settle = (actual: number, target: number) =>
        Math.abs(actual - target) < 0.01
          ? target
          : target + (actual - target) * remaining;
      sprite.setPosition(settle(sprite.x, x), settle(sprite.y, y));
    }
    if (shadow.x !== sprite.x || shadow.y !== sprite.y - 1)
      shadow.setPosition(sprite.x, sprite.y - 1);
    if (sprite.depth !== sprite.y) sprite.setDepth(sprite.y);
    if (shadow.depth !== sprite.y - 0.5) shadow.setDepth(sprite.y - 0.5);
    if (!this.halted && moving && (asset === "player" || asset === "npc")) {
      const key = `${asset}-walk-${facing}`;
      if (sprite.anims.currentAnim?.key !== key || !sprite.anims.isPlaying)
        sprite.play(key, true);
      return;
    }
    if (sprite.anims.isPlaying) sprite.stop();
    const frame = animations.directionColumns[facing];
    const texture = `${asset}-idle`;
    if (
      sprite.texture.key !== texture ||
      String(sprite.frame.name) !== String(frame)
    )
      sprite.setTexture(texture, frame);
  }

  private setDebug(key: string, value: string) {
    const data = this.view?.dataset;
    if (data && data[key] !== value) data[key] = value;
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
    return this.add
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
