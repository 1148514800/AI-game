import { defineConfig } from "vite";

const backend = `127.0.0.1:${process.env.PORT ?? 3001}`;
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.MISTSEA_VITE_PORT ?? 5173),
    strictPort: true,
    // Evidence HTML traces and generated builds are not application source.
    // Watching them causes unsolicited reloads that interrupt normal play.
    watch: {
      ignored: ["**/evidence/**", "**/release/**", "**/saves/**", "**/assets/source/**"],
    },
    proxy: {
      "/health": `http://${backend}`,
      "/ws": { target: `ws://${backend}`, ws: true },
    },
  },
});
