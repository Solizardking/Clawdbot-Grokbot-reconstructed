import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.CLAWD_UI_PORT || process.env.OMB_UI_PORT) || 5199,
    watch: {
      ignored: ["**/release/**", "**/build/**", "**/dist/**", "**/dist-ui/**", "**/electron/resources/**"],
    },
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.CLAWD_PORT || process.env.OMB_PORT || process.env.OGB_PORT || 8799}`,
      },
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist-ui", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
});
