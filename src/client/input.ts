import type { ClientMessage } from "../shared/protocol.js";

const movement = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
} as const;
type Key = keyof typeof movement;
type Direction = (typeof movement)[Key];

export function bindInput(callbacks: {
  canMove: () => boolean;
  send: (message: ClientMessage) => boolean;
  interact: () => void;
  pause: () => void;
  blurred: () => void;
}) {
  const held = new Set<Key>();
  const pointers = new Map<number, Direction>();
  function send() {
    if (!callbacks.canMove()) return;
    const directions = new Set([
      ...Array.from(held, (key) => movement[key]),
      ...pointers.values(),
    ]);
    callbacks.send({
      type: "move",
      dx: (Number(directions.has("right")) - Number(directions.has("left"))) as
        -1 | 0 | 1,
      dy: (Number(directions.has("down")) - Number(directions.has("up"))) as
        -1 | 0 | 1,
    });
  }
  function clear() {
    held.clear();
    pointers.clear();
    callbacks.send({ type: "move", dx: 0, dy: 0 });
  }
  function keyIsMovement(code: string): code is Key {
    return Object.hasOwn(movement, code);
  }
  window.addEventListener("keydown", (event) => {
    if (
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      document.querySelector("dialog[open]")
    )
      return;
    const code = event.code;
    if (!event.repeat && code === "Escape") {
      event.preventDefault();
      callbacks.pause();
    } else if (!event.repeat && code === "KeyE") {
      event.preventDefault();
      callbacks.interact();
    } else if (keyIsMovement(code) && callbacks.canMove()) {
      event.preventDefault();
      if (!event.repeat) {
        held.add(code);
        send();
      }
    }
  });
  window.addEventListener("keyup", (event) => {
    if (keyIsMovement(event.code) && held.delete(event.code)) {
      event.preventDefault();
      send();
    }
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-move]",
  )) {
    button.addEventListener("pointerdown", (event) => {
      if (!callbacks.canMove()) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, button.dataset.move as Direction);
      send();
    });
    function release(event: PointerEvent) {
      if (pointers.delete(event.pointerId)) send();
    }
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  }
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clear();
      callbacks.blurred();
    }
  });
  window.setInterval(() => {
    if (held.size || pointers.size) send();
  }, 130);
  return { clear };
}
