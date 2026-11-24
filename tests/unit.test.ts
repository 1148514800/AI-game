import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { WebSocket } from "ws";
import { createApp } from "../src/server/app.js";
import { pingSchema, clampPosition } from "../src/shared/protocol.js";
test("protocol rejects extra fields and invalid sequence", () => {
  assert.equal(
    pingSchema.safeParse({ type: "ping", sequence: 1 }).success,
    true,
  );
  for (const x of [
    { type: "ping", sequence: -1 },
    { type: "ping", sequence: 1, evil: true },
    {},
  ])
    assert.equal(pingSchema.safeParse(x).success, false);
});
test("world bounds clamp positions", () => {
  assert.deepEqual(clampPosition(-30, 900), { x: 8, y: 220 });
  assert.deepEqual(clampPosition(160, 144), { x: 160, y: 144 });
});
test("all local runtime assets have matching checksums and CC0 license", () => {
  const manifest = JSON.parse(readFileSync("assets/manifest.json", "utf8"));
  assert.equal(manifest.assets.length, 13);
  assert.equal(readdirSync("public/assets").length, 13);
  for (const asset of manifest.assets) {
    assert.equal(asset.license, "CC0-1.0");
    assert.equal(
      createHash("sha256").update(readFileSync(asset.outputPath)).digest("hex"),
      asset.sha256,
    );
  }
});
test("animation directions are columns, temporal frames are rows", () => {
  const a = JSON.parse(readFileSync("data/animations.json", "utf8"));
  assert.deepEqual(a.walk.framesByDirection.right, [3, 7, 11, 15]);
  assert.deepEqual(a.walk.framesByDirection.up, [1, 5, 9, 13]);
});
test("Fastify SQLite and validated WebSocket infrastructure", async () => {
  const app = createApp();
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const health = await app.inject("/health");
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().sqlite.value, 1);
    const address = app.server.address();
    assert.ok(address && typeof address === "object");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () =>
        socket.send(JSON.stringify({ type: "ping", sequence: 7 })),
      );
      socket.on("message", (raw) => {
        assert.deepEqual(JSON.parse(raw.toString()), {
          type: "pong",
          sequence: 7,
        });
        socket.close();
        resolve();
      });
      socket.on("error", reject);
    });
  } finally {
    await app.close();
  }
});
