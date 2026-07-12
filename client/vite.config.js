import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
      output: {
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
