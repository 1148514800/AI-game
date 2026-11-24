import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocketServer } from "ws";
import { DatabaseSync } from "node:sqlite";
import { pingSchema } from "../shared/protocol.js";
export function createApp() {
  const app = Fastify({ logger: false });
  const db = new DatabaseSync(":memory:");
  const staticRoot = resolve("release/client");
  if (existsSync(staticRoot)) app.register(fastifyStatic, { root: staticRoot });
  app.get("/health", () => ({
    status: "ok",
    phase: 0,
    sqlite: db.prepare("SELECT 1 AS value").get(),
    modelApi: false,
  }));
  const ws = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  app.server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    ws.handleUpgrade(req, socket, head, (s) => ws.emit("connection", s, req));
  });
  ws.on("connection", (socket) =>
    socket.on("message", (raw) => {
      try {
        const msg = pingSchema.parse(JSON.parse(raw.toString()));
        socket.send(JSON.stringify({ type: "pong", sequence: msg.sequence }));
      } catch {
        socket.send(JSON.stringify({ type: "error", code: "INVALID_MESSAGE" }));
      }
    }),
  );
  app.addHook("onClose", async () => {
    for (const client of ws.clients) client.terminate();
    ws.close();
    db.close();
  });
  return app;
}
