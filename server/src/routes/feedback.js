import { Router } from "express";
import {
  createComplaintRecord,
  listComplaintsRecord,
  updateComplaintRecord,
  updateReviewRecord
} from "../application/feedback.js";
import {
  complaintCreateSchema,
  complaintUpdateSchema,
  recordIdParams,
  reviewUpdateSchema
} from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import { requireRoles } from "../security.js";

export function createFeedbackRouter({ firebase, authentication, realtime }) {
  const router = Router();
  const { authenticate } = authentication;

  router.patch("/reviews/:reviewId", authenticate, requireRoles("owner", "staff"), validateParams(recordIdParams("reviewId")), validateBody(reviewUpdateSchema), asyncRoute(async (req, res) => {
    res.json(await updateReviewRecord(firebase.db(), req.user, req.params.reviewId, req.body));
  }));

  router.get("/complaints", authenticate, requireRoles("owner", "staff", "customer"), asyncRoute(async (req, res) => {
    res.json(await listComplaintsRecord(firebase.db(), req.user));
  }));

  router.post("/complaints", authenticate, requireRoles("customer"), validateBody(complaintCreateSchema), asyncRoute(async (req, res) => {
    const result = await createComplaintRecord(firebase.db(), req.user, req.body);
    realtime.emit(["role:owner", "role:staff"], "complaint:created", result);
    res.status(201).json(result);
  }));

  router.patch("/complaints/:complaintId", authenticate, requireRoles("owner", "staff"), validateParams(recordIdParams("complaintId")), validateBody(complaintUpdateSchema), asyncRoute(async (req, res) => {
    const result = await updateComplaintRecord(firebase.db(), req.user, req.params.complaintId, req.body);
    realtime.emit([`user:${result.complaint.customerId}`, "role:owner", "role:staff"], "complaint:updated", result);
    res.json(result);
  }));

  return router;
}
