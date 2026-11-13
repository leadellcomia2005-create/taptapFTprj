import { Router } from "express";
import { saveDeliveryProofRecord, saveRiderLocationRecord } from "../application/delivery.js";
import { fetchDeliveryRoute } from "../application/routing.js";
import { deliveryProofSchema, deliveryRouteSchema, recordIdParams, riderLocationSchema } from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import { canAccessOrder, HttpError, requireRoles } from "../security.js";

export function createDeliveryRouter({ config, firebase, authentication, realtime, logger }) {
  const router = Router();
  const { authenticate } = authentication;

  router.post("/delivery/route", authenticate, validateBody(deliveryRouteSchema), asyncRoute(async (req, res) => {
    let origin = [req.body.origin.lat, req.body.origin.lng];
    let destination = [req.body.destination.lat, req.body.destination.lng];
    if (req.body.orderId) {
      const order = (await firebase.db().ref(`orders/${req.body.orderId}`).once("value")).val();
      if (!order) throw new HttpError(404, "Order not found.");
      if (!canAccessOrder(req.user, order)) throw new HttpError(403, "You cannot access this delivery route.");
      if (order.deliveryLocation?.lat != null && order.deliveryLocation?.lng != null) {
        destination = [Number(order.deliveryLocation.lat), Number(order.deliveryLocation.lng)];
      }
      if (order.riderLocation?.lat != null && order.riderLocation?.lng != null) {
        origin = [Number(order.riderLocation.lat), Number(order.riderLocation.lng)];
      }
    }
    const route = await fetchDeliveryRoute({ origin, destination, config: config.routing });
    res.set("Cache-Control", "private, max-age=30").json(route);
  }));

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
