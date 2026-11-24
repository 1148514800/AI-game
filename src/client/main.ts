import Phaser from "phaser";
import "./style.css";
import map from "../../data/preview-map.json";
import animationData from "../../data/animations.json";
import { WORLD, clampPosition } from "../shared/protocol";
type Direction = "down" | "up" | "left" | "right";
type DebugState = {
  ready: boolean;
  x: number;
  y: number;
  direction: Direction;
  moving: boolean;
  paused: boolean;
  assetsLoaded: number;
  animationFrame: number;
  npcFrame: number;
};
declare global {
  interface Window {
    __PHASE0__: DebugState;
  }
}
const debug: DebugState = (window.__PHASE0__ = {
  ready: false,
  x: 160,
  y: 144,
  direction: "down",
  moving: false,
  paused: false,
  assetsLoaded: 0,
  animationFrame: 0,
  npcFrame: 0,
});
const assetStatus = document.querySelector<HTMLElement>("#asset-status")!;
const position = document.querySelector<HTMLElement>("#position")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;
let paused = false;
let held: Phaser.Types.Input.Keyboard.CursorKeys;
let wasd: Record<string, Phaser.Input.Keyboard.Key>;
let player: Phaser.GameObjects.Sprite;
let npc: Phaser.GameObjects.Sprite;
let sceneRef: Phaser.Scene;
let dir: Direction = "down";
let music: Phaser.Sound.BaseSound | undefined;
const solids = [{ x: 46, y: 48, w: 60, h: 45 }];
function setPaused(value: boolean) {
  paused = value;
  debug.paused = value;
  pauseButton.textContent = value ? "继续 · Esc" : "暂停 · Esc";
  if (value) {
    player?.anims.pause();
    npc?.anims.pause();
    music?.pause();
  } else {
    player?.anims.resume();
    npc?.anims.resume();
    if (music?.isPaused) music.resume();
  }
}
pauseButton.addEventListener("click", () => setPaused(!paused));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.repeat) {
    event.preventDefault();
    setPaused(!paused);
  }
});
class Preview extends Phaser.Scene {
  preload() {
    this.load.on("filecomplete", () => debug.assetsLoaded++);
    this.load.on("loaderror", () => {
      assetStatus.textContent = "素材加载失败";
      assetStatus.style.color = "#f4a38b";
    });
    for (const actor of ["player", "npc"])
      for (const anim of ["walk", "idle"])
        this.load.spritesheet(
          `${actor}-${anim}`,
          `/assets/${actor}-${anim}.png`,
          { frameWidth: 16, frameHeight: 16 },
        );
    for (const name of [
      "grass",
      "path",
      "tree",
      "house",
      "flowers",
      "letter",
      "arrow",
    ])
      this.load.image(name, `/assets/${name}.png`);
    this.load.audio("village", "/assets/village.ogg");
    this.load.audio("alert", "/assets/alert.wav");
  }
  create() {
    sceneRef = this;
    for (const [i, gid] of map.layers[0]!.data!.entries()) {
      this.add
        .image(
          (i % 20) * 16,
          Math.floor(i / 20) * 16,
          gid === 1 ? "grass" : "path",
        )
        .setOrigin(0);
    }

    for (const object of map.layers[1]!.objects!) {
      if (object.type === "tree" || object.type === "house")
        this.add
          .image(object.x, object.y, object.type)
          .setOrigin(0.5, 1)
          .setDepth(object.y);
    }
    for (const [x, y] of [
      [114, 45],
      [226, 44],
      [121, 196],
      [250, 181],
      [25, 144],
      [279, 154],
    ])
      this.add.image(x!, y!, "flowers").setDepth(y!);
    for (const actor of ["player", "npc"])
      for (const direction of Object.keys(
        animationData.walk.framesByDirection,
      ) as Direction[]) {
        this.anims.create({
          key: `${actor}-${direction}`,
          frames: animationData.walk.framesByDirection[direction].map(
            (frame) => ({ key: `${actor}-walk`, frame }),
          ),
          frameRate: 8,
          repeat: -1,
        });
      }
    player = this.add
      .sprite(debug.x, debug.y, "player-idle", 0)
      .setOrigin(0.5, 1)
      .setDepth(debug.y);
    npc = this.add
      .sprite(218, 133, "npc-walk", 0)
      .setOrigin(0.5, 1)
      .setDepth(133);
    npc.play("npc-down");
    this.add
      .text(204, 139, "NPC", {
        fontFamily: "monospace",
        fontSize: "6px",
        color: "#39442c",
        backgroundColor: "#dce0a9",
        padding: { x: 2, y: 2 },
      })
      .setDepth(500);
    held = this.input.keyboard!.createCursorKeys();
    wasd = this.input.keyboard!.addKeys("W,A,S,D") as typeof wasd;

    this.input.keyboard!.addCapture(["UP", "DOWN", "LEFT", "RIGHT", "SPACE"]);
    assetStatus.textContent = `${debug.assetsLoaded} / 13 已就绪`;
    debug.ready = true;
    document.querySelector("#game")!.addEventListener("pointerdown", () => {
      (document.querySelector("#game") as HTMLElement).focus();
    });
    this.game.events.on("blur", () => this.input.keyboard?.resetKeys());
  }
  update(_time: number, delta: number) {
    if (!player || paused) return;
    let dx =
      (held.right.isDown || wasd.D!.isDown ? 1 : 0) -
      (held.left.isDown || wasd.A!.isDown ? 1 : 0);
    let dy =
      (held.down.isDown || wasd.S!.isDown ? 1 : 0) -
      (held.up.isDown || wasd.W!.isDown ? 1 : 0);
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      if (dx) dir = dx < 0 ? "left" : "right";
      else dir = dy < 0 ? "up" : "down";
      const length = Math.hypot(dx, dy);
      dx /= length;
      dy /= length;
      const step = (58 * Math.min(delta, 50)) / 1000;
      let next = clampPosition(player.x + dx * step, player.y + dy * step);
      const collides = (x: number, y: number) =>
        solids.some(
          (s) =>
            x + 5 > s.x && x - 5 < s.x + s.w && y > s.y && y - 5 < s.y + s.h,
        );
      if (!collides(next.x, player.y)) player.x = next.x;
      if (!collides(player.x, next.y)) player.y = next.y;
      player.play(`player-${dir}`, true);
    } else {
      player.stop();
      player.setTexture("player-idle", animationData.directionColumns[dir]);
    }
    debug.npcFrame = Number(npc.frame.name);
    player.setDepth(player.y);
    debug.x = player.x;
    debug.y = player.y;
    debug.direction = dir;
    debug.moving = moving;
    debug.animationFrame = Number(player.frame.name);
    position.textContent = `X ${Math.round(player.x).toString().padStart(3, "0")} / Y ${Math.round(player.y).toString().padStart(3, "0")} · ${moving ? "行走" : "站立"}`;
  }
}
const game = new Phaser.Game({
  type: Phaser.CANVAS,
  width: WORLD.width,
  height: WORLD.height,
  parent: "game",
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  backgroundColor: "#a0ba39",
  scene: Preview,
  audio: { disableWebAudio: false },
  banner: false,
});
function resize() {
  const container = document.querySelector<HTMLElement>("#game")!;
  const scale = Math.max(1, Math.floor(container.clientWidth / WORLD.width));
  game.canvas.style.width = `${WORLD.width * scale}px`;
  game.canvas.style.height = `${WORLD.height * scale}px`;
}
new ResizeObserver(resize).observe(document.querySelector("#game")!);
resize();
document
  .querySelector<HTMLButtonElement>("#music")!
  .addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (!debug.ready) return;
    if (!music) {
      music = sceneRef.sound.add("village", { loop: true, volume: 0.15 });
    }
    if (music.isPlaying || music.isPaused) {
      music.stop();
      button.innerHTML = "开启环境音乐 <span>♪</span>";
      button.setAttribute("aria-pressed", "false");
    } else {
      if (paused) return;
      music.play();
      button.innerHTML = "关闭环境音乐 <span>♪</span>";
      button.setAttribute("aria-pressed", "true");
    }
  });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) setPaused(true);
});
fetch("/health")
  .then((res) => {
    if (!res.ok) throw Error();
    return res.json();
  })
  .then(() => {
    document.querySelector("#service-status")!.textContent =
      "Fastify / SQLite 就绪";
  })
  .catch(() => {
    document.querySelector("#service-status")!.textContent = "服务未连接";
  });
