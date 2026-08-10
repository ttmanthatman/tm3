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
    },
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            // Stable libraries change far less often than app code; pinning
            // them into their own chunk keeps their content hash (and the
            // year-long immutable cache hit) across most releases.
            { name: "vendor", test: /node_modules[\\/](marked|dompurify|socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser|lucide-vue-next|debug|ms)[\\/]/ }
          ]
        }
      }
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
