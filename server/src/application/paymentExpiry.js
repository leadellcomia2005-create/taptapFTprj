import { expirePendingPaymentOrder } from "../business.js";
import { isExpiredOnlineOrder } from "../domain/paymentExpiry.js";
import { checkoutPaymentFromSession, expirePayMongoCheckoutSession, retrievePayMongoCheckoutSession } from "../integrations/paymongo.js";
import { confirmPayMongoPayment } from "./payments.js";

export async function expirePendingOnlinePayments({ db, logger, now = Date.now(), provider = {} }) {
  const retrieve = provider.retrieve || retrievePayMongoCheckoutSession;
  const expire = provider.expire || expirePayMongoCheckoutSession;
  const confirm = provider.confirm || confirmPayMongoPayment;
  const cancel = provider.cancel || expirePendingPaymentOrder;
  const [snapshot, recoverySnapshot] = await Promise.all([
    db.ref("orders").orderByChild("status").equalTo("pending-payment").once("value"),
    db.ref("orders").orderByChild("status").equalTo("cancelled").once("value")
  ]);
  const candidates = [];
  for (const [id, order] of Object.entries(snapshot.val() || {})) {
    if (isExpiredOnlineOrder(order, now)) candidates.push({ id, order });
  }
  for (const [id, order] of Object.entries(recoverySnapshot.val() || {})) {
    if (order.cancelledBy === "payment-expiry" && order.paymentExpiredAt && !order.inventoryRestoredAt) {
      candidates.push({ id, order, recovery: true });
    }
  }
  const result = { checked: candidates.length, expired: 0, paid: 0, deferred: 0, failed: 0 };
  for (const { id, order, recovery } of candidates) {
    try {
      if (recovery) {
        const resumed = await cancel(db, id, now);
        if (resumed.expired) result.expired += 1;
        continue;
      }
      if (!order.providerSessionId && Number(order.checkoutStartingAt || 0) > now - 2 * 60 * 1000) {
        result.deferred += 1;
        continue;
      }
      if (order.providerSessionId) {
        let session = await retrieve(order.providerSessionId);
        if (session.id !== order.providerSessionId || session.referenceNumber !== id) {
          throw new Error("PayMongo checkout does not match the order.");
        }
        const paid = () => session.payments.some((payment) => payment?.attributes?.status === "paid");
        if (!paid() && session.status === "active") {
          try {
            session = await expire(order.providerSessionId);
          } catch (error) {
            // A payment may have completed or started after the first retrieval.
            session = await retrieve(order.providerSessionId);
            if (!paid() && session.status !== "expired") {
              logger?.warn("payment_expiry_deferred", { orderId: id, errorCode: error?.code || "PROVIDER_BUSY" });
              result.deferred += 1;
              continue;
            }
          }
        }
        if (paid()) {
          await confirm(db, checkoutPaymentFromSession(session));
          result.paid += 1;
          continue;
        }
        if (session.status !== "expired") {
          result.deferred += 1;
          continue;
        }
      }
      const cancelled = await cancel(db, id, now);
      if (cancelled.expired) result.expired += 1;
    } catch (error) {
      result.failed += 1;
      logger?.warn("payment_expiry_failed", { orderId: id, errorCode: error?.code || "EXPIRY_ERROR" });
    }
  }
  return result;
}
