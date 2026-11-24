import { createApp } from "./app.js";
const app = createApp();
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3001),
});
console.log("Phase 0 infrastructure http://127.0.0.1:3001");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => void app.close());
