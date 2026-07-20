import { Router } from "express";
import {
  cleanupExpiredNotifications,
  clearNotifications,
  createNotification,
  dismissNotification,
  markAllNotificationsRead
} from "../notifications.js";
import { notificationCreateSchema, recordIdParams } from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody, validateParams } from "../middleware/validation.js";

export function createNotificationsRouter({ firebase, authentication }) {
  const router = Router();
  const { authenticate } = authentication;

  router.post("/notifications", authenticate, validateBody(notificationCreateSchema), asyncRoute(async (req, res) => {
    res.status(201).json(await createNotification(firebase.db(), req.user, req.body));
  }));

  router.post("/notifications/read-all", authenticate, asyncRoute(async (req, res) => {
    await markAllNotificationsRead(firebase.db(), req.user.uid);
    res.json({ updated: true });
  }));

  router.post("/notifications/cleanup", authenticate, asyncRoute(async (req, res) => {
    res.json({ deleted: await cleanupExpiredNotifications(firebase.db(), req.user.uid) });
  }));

  router.delete("/notifications", authenticate, asyncRoute(async (req, res) => {
    await clearNotifications(firebase.db(), req.user.uid);
    res.json({ cleared: true });
  }));

  router.delete("/notifications/:notificationId", authenticate, validateParams(recordIdParams("notificationId")), asyncRoute(async (req, res) => {
    await dismissNotification(firebase.db(), req.user.uid, req.params.notificationId);
    res.json({ dismissed: true });
  }));

  return router;
}
