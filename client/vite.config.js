import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const buildId = `1.0.0-${Date.now()}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __TAPTAP_BUILD_ID__: JSON.stringify(buildId)
  },
  server: {
    port: 5173,
    allowedHosts: [".trycloudflare.com", "localhost", "127.0.0.1", "192.168.1.7"],
    proxy: {
      "/api": "http://localhost:8080",
      "/socket.io": {
        target: "http://localhost:8080",
        ws: true
      }
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        quietDeps: true,
        silenceDeprecations: ["import"]
      }
    }
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        "service-worker": fileURLToPath(new URL("./src/service-worker.js", import.meta.url))
      },
      output: {
        entryFileNames: (chunk) => chunk.name === "service-worker"
          ? "service-worker.js"
          : "assets/[name]-[hash].js",
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          const moduleId = id.replaceAll("\\", "/");
          if (moduleId.includes("/node_modules/firebase/analytics") || moduleId.includes("/node_modules/@firebase/analytics")) {
            return "firebase-analytics";
          }
          if (moduleId.includes("/node_modules/firebase/storage") || moduleId.includes("/node_modules/@firebase/storage")) {
            return "firebase-storage";
          }
          if (
            moduleId.includes("/node_modules/firebase/app") ||
            moduleId.includes("/node_modules/firebase/auth") ||
            moduleId.includes("/node_modules/firebase/database") ||
            moduleId.includes("/node_modules/@firebase/app") ||
            moduleId.includes("/node_modules/@firebase/auth") ||
            moduleId.includes("/node_modules/@firebase/database")
          ) {
            return "firebase";
          }
          return undefined;
        }
      }
    }
  }
});
