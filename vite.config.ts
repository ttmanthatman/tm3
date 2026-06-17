import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  root: ".",
  publicDir: "public",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/client", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url))
    }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      input: "index.html"
    }
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3003",
      "/socket.io": {
        target: "http://127.0.0.1:3003",
        ws: true
      }
    }
  }
});
