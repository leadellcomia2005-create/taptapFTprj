import { serviceStatus } from "../services.js";

export function registerHealthRoutes(app, { config, firebase, serverStartedAt }) {
  const statusPayload = () => ({
    apiVersion: config.apiVersion,
    serverStartedAt,
    uptimeSeconds: Math.round((Date.now() - serverStartedAt) / 1000),
    services: { ...serviceStatus(), firebase: firebase.enabled, socket: firebase.enabled },
    firebaseAdminError: firebase.enabled ? null : firebase.publicError
  });

  app.get("/health/live", (_req, res) => {
    res.json({ status: "ok", apiVersion: config.apiVersion, uptimeSeconds: statusPayload().uptimeSeconds });
  });

  app.get("/health/ready", (_req, res) => {
    const ready = firebase.enabled;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not-ready",
      services: { firebase: firebase.enabled, socket: firebase.enabled }
    });
  });

  app.get("/api/status", (_req, res) => res.json(statusPayload()));
}
