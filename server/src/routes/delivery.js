import { Router } from "express";
import { saveDeliveryProofRecord, saveRiderLocationRecord } from "../application/delivery.js";
import { deliveryProofSchema, recordIdParams, riderLocationSchema } from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import { requireRoles } from "../security.js";

export function createDeliveryRouter({ firebase, authentication, realtime, logger }) {
  const router = Router();
  const { authenticate } = authentication;

  router.post("/riders/location", authenticate, requireRoles("rider"), validateBody(riderLocationSchema), asyncRoute(async (req, res) => {
    const result = await saveRiderLocationRecord(firebase.db(), req.user, req.body.orderId, req.body);
    realtime.emit([`order:${req.body.orderId}`, "role:owner", "role:staff"], "rider:location", {
      riderId: req.user.uid,
      orderId: req.body.orderId,
      ...result.location
    });
    res.json({ location: result.location });
  }));

  router.post("/orders/:orderId/proof", authenticate, requireRoles("rider"), validateParams(recordIdParams("orderId")), validateBody(deliveryProofSchema), asyncRoute(async (req, res) => {
    res.status(201).json(await saveDeliveryProofRecord(firebase.db(), req.user, req.params.orderId, req.body, { logger }));
  }));

  return router;
}
