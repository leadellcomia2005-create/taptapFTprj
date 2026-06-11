import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080"
    }
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth", "firebase/database", "firebase/storage", "firebase/analytics"],
          maps: ["leaflet", "react-leaflet"],
          charts: ["chart.js", "react-chartjs-2"]
        }
      }
    }
  }
});
