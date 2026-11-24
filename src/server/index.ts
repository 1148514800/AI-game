import { resolve } from "node:path";
import { createApp } from "./app.js";

const savePath = process.env.MISTSEA_SAVE;
const app = createApp({ savePath: savePath ? resolve(savePath) : undefined });
try {
  const address = await app.listen({
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 3001),
  });
  console.log(`雾灯谷 · ${address}`);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void app.close().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    });
  }
} catch (error) {
  console.error(error);
  await app.close();
  process.exitCode = 1;
}
