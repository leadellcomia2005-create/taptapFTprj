import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createAdminRouter } from "./routes/admin.js";
import { createAuthRouter } from "./routes/auth.js";
import { createCatalogRouter } from "./routes/catalog.js";
import { createDeliveryRouter } from "./routes/delivery.js";
import { createFeedbackRouter } from "./routes/feedback.js";
import { registerHealthRoutes } from "./routes/health.js";
import { createIntegrationsRouter } from "./routes/integrations.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import { createOrdersRouter } from "./routes/orders.js";
import { createWorkforceRouter } from "./routes/workforce.js";
import { createErrorHandler, notFoundHandler } from "./middleware/errors.js";
import { requestContext } from "./middleware/requestContext.js";

export function createApp({ config, firebase, authentication, realtime, logger, serverStartedAt = Date.now() }) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy !== false) app.set("trust proxy", config.trustProxy);

  app.use(requestContext(logger));
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: config.allowedOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: "draft-8" }));

  registerHealthRoutes(app, { config, firebase, serverStartedAt });
  const dependencies = { config, firebase, authentication, realtime, logger };
  app.use("/api", createAuthRouter(dependencies));
  app.use("/api", createIntegrationsRouter(dependencies));
  app.use("/api", createNotificationsRouter(dependencies));
  app.use("/api", createOrdersRouter(dependencies));
  app.use("/api", createCatalogRouter(dependencies));
  app.use("/api", createFeedbackRouter(dependencies));
  app.use("/api", createDeliveryRouter(dependencies));
  app.use("/api", createWorkforceRouter(dependencies));
  app.use("/api", createAdminRouter(dependencies));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
