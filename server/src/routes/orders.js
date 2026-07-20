import { Router } from "express";
import {
  createOrderRecord,
  listOrdersPageForUser,
  listOrdersForUser,
  updateOrderRecord
} from "../application/orders.js";
import { canAccessOrder, HttpError, validRecordId } from "../security.js";
import { sendOrderReceiptEmail } from "../services.js";
import { createOrderSchema, orderListQuerySchema, recordIdParams, updateOrderSchema } from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.js";

export function createOrdersRouter({ firebase, authentication, realtime }) {
  const router = Router();
  const { authenticate } = authentication;

  router.get("/orders", authenticate, validateQuery(orderListQuerySchema), asyncRoute(async (req, res) => {
    if (req.validatedQuery.limit) {
      return res.json(await listOrdersPageForUser(firebase.db(), req.user, req.validatedQuery));
    }
    res.json({ orders: await listOrdersForUser(firebase.db(), req.user) });
  }));

  router.post("/orders", authenticate, validateBody(createOrderSchema), asyncRoute(async (req, res) => {
    const headerKey = String(req.headers["idempotency-key"] || "").trim();
    if (headerKey && req.body.idempotencyKey && headerKey !== req.body.idempotencyKey) {
      throw new HttpError(409, "The order request key does not match the request header.", { code: "IDEMPOTENCY_KEY_MISMATCH" });
    }
    const result = await createOrderRecord(firebase.db(), req.user, {
      ...req.body,
      ...(headerKey ? { idempotencyKey: headerKey } : {})
    });
    const receiptEmail = result.idempotent
      ? { sent: false, skipped: "idempotent-replay" }
      : await sendOrderReceiptEmail({ id: result.id, ...result.order }).catch(() => ({ sent: false }));
    realtime.emit(["role:owner", "role:staff", `user:${req.user.uid}`], "order:created", result);
    res.status(result.idempotent ? 200 : 201).json({ ...result, receiptEmail });
  }));

  router.patch("/orders/:orderId", authenticate, validateParams(recordIdParams("orderId")), validateBody(updateOrderSchema), asyncRoute(async (req, res) => {
    const result = await updateOrderRecord(firebase.db(), req.user, req.params.orderId, req.body);
    realtime.emit([
      `order:${req.params.orderId}`,
      "role:owner",
      "role:staff",
      `user:${result.order.customerId}`
    ], "order:status-updated", { id: req.params.orderId, ...result });
    if (result.changes.riderId) {
      realtime.emit(`user:${result.changes.riderId}`, "order:assigned", { id: req.params.orderId, order: result.order });
    }
    res.json({ id: req.params.orderId, ...result });
  }));

  router.post("/orders/:orderId/receipt-email", authenticate, validateParams(recordIdParams("orderId")), asyncRoute(async (req, res) => {
    if (!validRecordId(req.params.orderId)) throw new HttpError(400, "Invalid order ID.");
    const order = (await firebase.db().ref(`orders/${req.params.orderId}`).once("value")).val();
    if (!canAccessOrder(req.user, order)) throw new HttpError(403, "You cannot access this receipt.");
    const result = await sendOrderReceiptEmail({ id: req.params.orderId, ...order });
    res.json({ sent: Boolean(result?.sent ?? result), result });
  }));

  return router;
}
