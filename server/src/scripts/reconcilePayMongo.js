import dotenv from "dotenv";
import { confirmPayMongoPayment } from "../application/payments.js";
import { loadServerConfig } from "../config/environment.js";
import { initializeFirebaseAdmin } from "../integrations/firebaseAdmin.js";
import {
  checkoutPaymentFromSession,
  retrievePayMongoCheckoutSession
} from "../integrations/paymongo.js";
import { createLogger } from "../observability/logger.js";

dotenv.config({ override: false });

const logger = createLogger();
const config = loadServerConfig();
const firebase = await initializeFirebaseAdmin(config.firebase, logger);
if (!firebase.enabled) throw new Error("Firebase Admin is unavailable.");

const db = firebase.db();
const orders = (await db.ref("orders").once("value")).val() || {};
const candidates = Object.entries(orders).filter(([, order]) => (
  order?.paymentMethod === "gcash" &&
  order?.paymentStatus !== "paid" &&
  typeof order?.providerSessionId === "string"
));

let reconciled = 0;
let stillPending = 0;
let failed = 0;

for (const [orderId, order] of candidates) {
  try {
    const session = await retrievePayMongoCheckoutSession(order.providerSessionId);
    const paid = session.payments.some((payment) => payment?.attributes?.status === "paid");
    if (!paid) {
      stillPending += 1;
      continue;
    }
    if (session.referenceNumber !== orderId) throw new Error("Checkout reference does not match the order.");
    await confirmPayMongoPayment(db, checkoutPaymentFromSession(session));
    reconciled += 1;
    console.log(`Reconciled paid order ${orderId}.`);
  } catch (error) {
    failed += 1;
    console.error(`Could not reconcile ${orderId}: ${error?.code || error?.message || "unknown error"}`);
  }
}

console.log(`PayMongo reconciliation complete: ${reconciled} paid, ${stillPending} pending, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
