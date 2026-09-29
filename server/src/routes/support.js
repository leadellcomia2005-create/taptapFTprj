import { Router } from "express";
import { getSupportConversation, replyToSupportConversation, requestSupportStaff, resumeSupportAssistant } from "../application/support.js";
import { recordIdParams, supportReplySchema, supportRequestSchema } from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import { HttpError, requireRoles } from "../security.js";

export function createSupportRouter({ firebase, authentication, realtime, metrics }) {
  const router = Router();
  const { authenticate } = authentication;

  router.get("/support/conversations/:customerId", authenticate, validateParams(recordIdParams("customerId")), asyncRoute(async (req, res) => {
    const canView = ["owner", "staff"].includes(req.user.role)
      || (req.user.role === "customer" && req.user.uid === req.params.customerId);
    if (!canView) {
      throw new HttpError(403, "You cannot view this support conversation.");
    }
    res.json(await getSupportConversation(firebase.db(), req.params.customerId));
  }));

  router.post("/support/conversations/:customerId/reply", authenticate, requireRoles("owner", "staff"), validateParams(recordIdParams("customerId")), validateBody(supportReplySchema), asyncRoute(async (req, res) => {
    const result = await replyToSupportConversation(firebase.db(), req.user, req.params.customerId, req.body);
    realtime.emit([`user:${req.params.customerId}`, "role:owner", "role:staff"], "support:updated", result);
    res.status(201).json(result);
  }));

  router.post("/support/conversations/:customerId/request-staff", authenticate, requireRoles("customer"), validateParams(recordIdParams("customerId")), validateBody(supportRequestSchema), asyncRoute(async (req, res) => {
    const result = await requestSupportStaff(firebase.db(), req.user, req.params.customerId, req.body);
    if (!result.duplicate) metrics?.increment("aiSupportEscalations");
    realtime.emit([`user:${req.params.customerId}`, "role:owner", "role:staff"], "support:updated", result);
    res.status(result.duplicate ? 200 : 201).json(result);
  }));

  router.post("/support/conversations/:customerId/resume-assistant", authenticate, requireRoles("owner", "staff"), validateParams(recordIdParams("customerId")), asyncRoute(async (req, res) => {
    const conversation = await resumeSupportAssistant(firebase.db(), req.user, req.params.customerId);
    realtime.emit([`user:${req.params.customerId}`, "role:owner", "role:staff"], "support:updated", { conversation });
    res.json({ conversation });
  }));

  return router;
}
