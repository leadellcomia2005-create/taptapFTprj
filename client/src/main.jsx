import React from "react";
import ReactDOM from "react-dom/client";
import "./bootstrap.scss";
import App from "./App";
import { initializePerformanceMonitoring } from "./services/performance";
import { registerWebsiteServiceWorker } from "./services/pwa";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

initializePerformanceMonitoring();
registerWebsiteServiceWorker();
