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
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth", "firebase/database"],
          "firebase-analytics": ["firebase/analytics"],
          "firebase-storage": ["firebase/storage"],
          maps: ["leaflet", "react-leaflet"],
          charts: ["chart.js", "react-chartjs-2"]
        }
      }
    }
  }
});
