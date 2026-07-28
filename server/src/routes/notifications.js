import { Router } from "express";
import {
  cleanupExpiredNotifications,
  clearReadNotifications,
  clearNotifications,
  createNotification,
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead
} from "../notifications.js";
import {
  notificationCreateSchema,
  pushTokenRemovalSchema,
  pushTokenSchema,
  recordIdParams
} from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import {
  pushStatus,
  registerPushToken,
  removePushTokens
} from "../pushNotifications.js";

export function createNotificationsRouter({ firebase, authentication }) {
  const router = Router();
  const { authenticate } = authentication;

  router.post("/notifications", authenticate, validateBody(notificationCreateSchema), asyncRoute(async (req, res) => {
    res.status(201).json(await createNotification(firebase.db(), req.user, req.body));
  }));

  router.get("/notifications/push/status", authenticate, asyncRoute(async (req, res) => {
    res.json(await pushStatus(firebase.db(), firebase, req.user.uid));
  }));

  router.post("/notifications/push-tokens", authenticate, validateBody(pushTokenSchema), asyncRoute(async (req, res) => {
    res.status(201).json(await registerPushToken(firebase.db(), firebase, req.user, req.body.token));
  }));

  router.delete("/notifications/push-tokens", authenticate, validateBody(pushTokenRemovalSchema), asyncRoute(async (req, res) => {
    res.json(await removePushTokens(firebase.db(), req.user, req.body));
  }));

  router.post("/notifications/read-all", authenticate, asyncRoute(async (req, res) => {
    await markAllNotificationsRead(firebase.db(), req.user.uid);
    res.json({ updated: true });
  }));

  router.post("/notifications/:notificationId/read", authenticate, validateParams(recordIdParams("notificationId")), asyncRoute(async (req, res) => {
    const updated = await markNotificationRead(firebase.db(), req.user.uid, req.params.notificationId);
    res.json({ updated });
  }));

  router.post("/notifications/cleanup", authenticate, asyncRoute(async (req, res) => {
    res.json({ deleted: await cleanupExpiredNotifications(firebase.db(), req.user.uid) });
  }));

  router.delete("/notifications", authenticate, asyncRoute(async (req, res) => {
    await clearNotifications(firebase.db(), req.user.uid);
    res.json({ cleared: true });
  }));

  router.delete("/notifications/read", authenticate, asyncRoute(async (req, res) => {
    res.json({ cleared: await clearReadNotifications(firebase.db(), req.user.uid) });
  }));

  router.delete("/notifications/:notificationId", authenticate, validateParams(recordIdParams("notificationId")), asyncRoute(async (req, res) => {
    await dismissNotification(firebase.db(), req.user.uid, req.params.notificationId);
    res.json({ dismissed: true });
  }));

  return router;
}
