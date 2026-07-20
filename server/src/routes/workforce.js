import { Router } from "express";
import {
  closeActiveShiftRecord,
  createApprovalRequestRecord,
  getActiveShiftRecord,
  listApprovalRequestsRecord,
  resolveApprovalRequestRecord,
  saveShiftLogRecord,
  startShiftRecord
} from "../application/workforce.js";
import {
  approvalCreateSchema,
  approvalResolutionSchema,
  recordIdParams,
  shiftCloseSchema,
  shiftLogSchema,
  shiftStartSchema
} from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import { requireRoles } from "../security.js";

export function createWorkforceRouter({ firebase, authentication, realtime }) {
  const router = Router();
  const { authenticate } = authentication;

  router.post("/shift-logs", authenticate, requireRoles("owner", "staff"), validateBody(shiftLogSchema), asyncRoute(async (req, res) => {
    const result = await saveShiftLogRecord(firebase.db(), req.user, req.body);
    realtime.emit(["role:owner", "role:staff"], "shift:closed", result);
    res.status(201).json(result);
  }));

  router.get("/shifts/active", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
    res.json(await getActiveShiftRecord(firebase.db(), req.user));
  }));

  router.post("/shifts/start", authenticate, requireRoles("owner", "staff"), validateBody(shiftStartSchema), asyncRoute(async (req, res) => {
    const result = await startShiftRecord(firebase.db(), req.user, req.body);
    realtime.emit(["role:owner", "role:staff"], "shift:started", result);
    res.status(201).json(result);
  }));

  router.post("/shifts/close", authenticate, requireRoles("owner", "staff"), validateBody(shiftCloseSchema), asyncRoute(async (req, res) => {
    const result = await closeActiveShiftRecord(firebase.db(), req.user, req.body);
    realtime.emit(["role:owner", "role:staff"], "shift:closed", result);
    res.status(201).json(result);
  }));

  router.get("/approvals", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
    res.json(await listApprovalRequestsRecord(firebase.db(), req.user));
  }));

  router.post("/approvals", authenticate, requireRoles("owner", "staff"), validateBody(approvalCreateSchema), asyncRoute(async (req, res) => {
    res.status(201).json(await createApprovalRequestRecord(firebase.db(), req.user, req.body));
  }));

  router.patch("/approvals/:requestId", authenticate, requireRoles("owner"), validateParams(recordIdParams("requestId")), validateBody(approvalResolutionSchema), asyncRoute(async (req, res) => {
    res.json(await resolveApprovalRequestRecord(firebase.db(), req.user, req.params.requestId, req.body));
  }));

  return router;
}
