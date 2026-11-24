import React from "react";
import ReactDOM from "react-dom/client";
import "./bootstrap.scss";
import App from "./App";
import WebsiteUpdateNotice from "./components/WebsiteUpdateNotice";
import { initializePerformanceMonitoring } from "./services/performance";
import { registerWebsiteServiceWorker } from "./services/pwa";
import "./styles.css";
import "./ui-polish.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <WebsiteUpdateNotice />
  </React.StrictMode>
);

initializePerformanceMonitoring();
registerWebsiteServiceWorker();
