import { createServer } from "node:http";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { loadServerConfig } from "./config/environment.js";
import { initializeFirebaseAdmin } from "./integrations/firebaseAdmin.js";
import { createAuthentication } from "./middleware/authentication.js";
import { createLogger } from "./observability/logger.js";
import { createRealtimeHub } from "./realtime/hub.js";
import { createSocketServer } from "./sockets/index.js";

dotenv.config({ override: false });

const logger = createLogger();
const config = loadServerConfig();
const serverStartedAt = Date.now();
const firebase = await initializeFirebaseAdmin(config.firebase, logger);
const authentication = createAuthentication(firebase);
const realtime = createRealtimeHub();
const app = createApp({ config, firebase, authentication, realtime, logger, serverStartedAt });
const server = createServer(app);
const io = createSocketServer(server, { config, firebase, authentication, realtime, logger });

let shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("server_shutdown_started", { signal });
  const forceExit = setTimeout(() => {
    logger.error("server_shutdown_timed_out", { signal, timeoutMs: config.shutdownTimeoutMs });
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceExit.unref();

  await new Promise((resolve) => io.close(resolve));
  await new Promise((resolve) => {
    if (!server.listening) return resolve();
    return server.close(resolve);
  });
  clearTimeout(forceExit);
  logger.info("server_shutdown_completed", { signal });
  process.exitCode = exitCode;
}

server.on("error", (error) => {
  logger.error("server_listen_failed", error);
  process.exitCode = 1;
});

server.listen(config.port, () => {
  logger.info("server_started", {
    port: config.port,
    apiVersion: config.apiVersion,
    firebaseReady: firebase.enabled,
    allowedOrigins: config.allowedOrigins
  });
});

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("uncaughtException", (error) => {
  logger.error("uncaught_exception", error);
  void shutdown("uncaughtException", 1);
});
process.once("unhandledRejection", (error) => {
  logger.error("unhandled_rejection", error instanceof Error ? error : new Error(String(error)));
  void shutdown("unhandledRejection", 1);
});
