import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import helmet from "helmet";
import { Server as SocketServer } from "socket.io";
import {
  adjustInventoryRecord,
  archiveCompletedOrdersRecord,
  closeActiveShiftRecord,
  createApprovalRequestRecord,
  createMenuItemRecord,
  createOrderRecord,
  getActiveShiftRecord,
  createComplaintRecord,
  listApprovalRequestsRecord,
  listComplaintsRecord,
  listOrdersForUser,
  resolveApprovalRequestRecord,
  saveDeliveryProofRecord,
  saveRiderLocationRecord,
  saveShiftLogRecord,
  startShiftRecord,
  updateMenuItemRecord,
  updateComplaintRecord,
  updateOrderRecord,
  updateReviewRecord
} from "./business.js";
import {
  bearerToken,
  canAccessOrder,
  errorResponse,
  hasVerifiedEmail,
  HttpError,
  requireRoles,
  requireVerifiedEmail,
  validRecordId
} from "./security.js";
import {
  askOpenAI,
  createPayMongoCheckout,
  detectDialogflowIntent,
  generateInsights,
  sendOrderReceiptEmail,
  sendTwoFactorEmail,
  sendTwoFactorSms,
  sendTwilioSms,
  serviceStatus
} from "./services.js";
import {
  cleanupExpiredNotifications,
  clearNotifications,
  createNotification,
  dismissNotification,
  markAllNotificationsRead
} from "./notifications.js";
import {
  beginTotpSetup,
  finishEnrollment,
  resetTwoFactor,
  sendEmailCode,
  sendSmsCode,
  twoFactorStatus,
  unlockTwoFactor,
  verifyChallenge
} from "./twoFactor.js";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration
} from "./passkeys.js";

dotenv.config({ override: true });

const app = express();
const server = createServer(app);
const serverStartedAt = Date.now();
const apiVersion = process.env.APP_VERSION || process.env.npm_package_version || "local";
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",").map((value) => value.trim());

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: "draft-8" }));

let firebaseAdminEnabled = false;
let firebaseAdminError = "Account service is not ready yet.";
if (process.env.FIREBASE_DATABASE_URL) {
  try {
    const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")))
      : applicationDefault();
    await credential.getAccessToken();
    const firebaseOptions = {
      credential,
      databaseURL: process.env.FIREBASE_DATABASE_URL
    };
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;
    if (storageBucket) firebaseOptions.storageBucket = storageBucket.replace(/^gs:\/\//, "");
    initializeApp(firebaseOptions);
    firebaseAdminEnabled = true;
    firebaseAdminError = "";
  } catch (error) {
    firebaseAdminError = error.message;
    console.warn("Account service is unavailable:", error.message);
  }
}

const db = () => getDatabase();

async function verifyUserToken(token) {
  const decoded = await getAuth().verifyIdToken(token);
  if (decoded.role) return decoded;
  const profile = (await db().ref(`users/${decoded.uid}`).once("value")).val() || {};
  return { ...decoded, role: profile.role || "customer", name: profile.name || decoded.name };
}

function requireFirebaseAdmin(_req, res, next) {
  if (!firebaseAdminEnabled) {
    return res.status(503).json({ error: "Account service is unavailable. Please try again later." });
  }
  return next();
}

async function authenticateBootstrap(req, res, next) {
  if (!firebaseAdminEnabled) return requireFirebaseAdmin(req, res, next);
  const token = bearerToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    req.authToken = token;
    req.user = await verifyUserToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid authentication token." });
  }
}

async function authenticate(req, res, next) {
  return authenticateBootstrap(req, res, () => {
    if (!hasVerifiedEmail(req.user)) {
      return res.status(403).json({ error: "Verify your email address before accessing the POS.", code: "EMAIL_VERIFICATION_REQUIRED" });
    }
    if (req.user.mfaSession !== true) {
      return res.status(403).json({ error: "Complete account security before accessing the POS.", code: "TWO_FACTOR_REQUIRED" });
    }
    return next();
  });
}

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const response = errorResponse(error);
      if (response.status >= 500) console.error(error);
      res.status(response.status).json({ error: response.message });
    }
  };
}

app.get("/api/status", (_req, res) => res.json({
  apiVersion,
  serverStartedAt,
  uptimeSeconds: Math.round((Date.now() - serverStartedAt) / 1000),
  services: { ...serviceStatus(), firebase: firebaseAdminEnabled, socket: firebaseAdminEnabled },
  firebaseAdminError: firebaseAdminEnabled ? null : firebaseAdminError
}));

app.get("/api/2fa/status", authenticateBootstrap, asyncRoute(async (req, res) => {
  const status = serviceStatus();
  res.json(await twoFactorStatus(db(), req.user, status.twilio, status.emailOtp, req.authToken));
}));

app.post("/api/2fa/setup/totp", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await beginTotpSetup(db(), req.user));
}));

app.post("/api/2fa/sms/send", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await sendSmsCode(db(), req.user, sendTwoFactorSms, req.body.purpose === "setup" ? "setup" : "challenge"));
}));

app.post("/api/2fa/email/send", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await sendEmailCode(db(), req.user, sendTwoFactorEmail, req.body.purpose === "setup" ? "setup" : "challenge"));
}));

app.post("/api/2fa/setup/verify", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await finishEnrollment(db(), req.user, req.body.method, req.body.code, req.authToken));
}));

app.post("/api/2fa/challenge", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await verifyChallenge(db(), req.user, req.body, req.authToken));
}));

app.post("/api/passkeys/register/options", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await beginPasskeyRegistration(db(), req.user, req));
}));

app.post("/api/passkeys/register/verify", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await verifyPasskeyRegistration(db(), req.user, req.body, req));
}));

app.post("/api/passkeys/authenticate/options", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await beginPasskeyAuthentication(db(), req.user, req));
}));

app.post("/api/passkeys/authenticate/verify", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await verifyPasskeyAuthentication(db(), req.user, req.body, req));
}));

app.post("/api/assistant", authenticate, asyncRoute(async (req, res) => {
  const detected = await detectDialogflowIntent(req.body);
  if (detected && detected.intent !== "Default Fallback Intent" && detected.confidence >= 0.55) {
    return res.json({ text: detected.text, source: "assistant", intent: detected.intent });
  }
  const generated = await askOpenAI(req.body);
  if (generated) return res.json({ text: generated, source: "assistant" });
  return res.json({
    text: detected?.text || "Live assistant answers are not ready yet.",
    source: "assistant"
  });
}));

app.post("/api/insights", authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  const text = await generateInsights(req.body);
  res.json({ text: text || "Business insight is not ready yet." });
}));

app.post("/api/payments/checkout", authenticate, asyncRoute(async (req, res) => {
  if (!validRecordId(req.body.orderId)) throw new HttpError(400, "Invalid order ID.");
  const order = (await db().ref(`orders/${req.body.orderId}`).once("value")).val();
  if (!canAccessOrder(req.user, order)) throw new HttpError(403, "You cannot create a payment for this order.");
  if (order.paymentMethod !== "gcash") throw new HttpError(409, "Only GCash orders use online checkout.");
  if (order.paymentStatus === "paid") throw new HttpError(409, "This order is already paid.");
  const result = await createPayMongoCheckout({ ...order, orderId: req.body.orderId });
  if (!result) throw new HttpError(503, "Online payment is not ready yet.");
  await db().ref(`orders/${req.body.orderId}`).update({
    paymentProvider: "paymongo",
    providerSessionId: result.id,
    checkoutCreatedAt: Date.now()
  });
  res.json(result);
}));

app.post("/api/notifications/sms", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  if (!validRecordId(req.body.orderId)) throw new HttpError(400, "Invalid order ID.");
  const order = (await db().ref(`orders/${req.body.orderId}`).once("value")).val();
  if (!order) throw new HttpError(404, "Order not found.");
  if (!order.phoneVerified || !order.smsNotifications) throw new HttpError(409, "SMS updates require a verified phone number and customer consent.");
  const result = await sendTwilioSms({ to: order.phone, orderId: req.body.orderId, status: order.status });
  res.json({ sent: Boolean(result), sid: result?.sid || null });
}));

app.post("/api/notifications", authenticate, asyncRoute(async (req, res) => {
  res.status(201).json(await createNotification(db(), req.user, req.body));
}));

app.post("/api/notifications/read-all", authenticate, asyncRoute(async (req, res) => {
  await markAllNotificationsRead(db(), req.user.uid);
  res.json({ updated: true });
}));

app.post("/api/notifications/cleanup", authenticate, asyncRoute(async (req, res) => {
  res.json({ deleted: await cleanupExpiredNotifications(db(), req.user.uid) });
}));

app.delete("/api/notifications", authenticate, asyncRoute(async (req, res) => {
  await clearNotifications(db(), req.user.uid);
  res.json({ cleared: true });
}));

app.delete("/api/notifications/:notificationId", authenticate, asyncRoute(async (req, res) => {
  await dismissNotification(db(), req.user.uid, req.params.notificationId);
  res.json({ dismissed: true });
}));

app.get("/api/orders", authenticate, asyncRoute(async (req, res) => {
  res.json({ orders: await listOrdersForUser(db(), req.user) });
}));

app.post("/api/orders", authenticate, asyncRoute(async (req, res) => {
  const result = await createOrderRecord(db(), req.user, req.body);
  const receiptEmail = await sendOrderReceiptEmail({ id: result.id, ...result.order }).catch((error) => {
    console.warn("Receipt email failed:", error.message);
    return { sent: false };
  });
  io.to("role:owner").to("role:staff").to(`user:${req.user.uid}`).emit("order:created", result);
  res.status(201).json({ ...result, receiptEmail });
}));

app.patch("/api/orders/:orderId", authenticate, asyncRoute(async (req, res) => {
  const result = await updateOrderRecord(db(), req.user, req.params.orderId, req.body);
  io.to(`order:${req.params.orderId}`)
    .to("role:owner")
    .to("role:staff")
    .to(`user:${result.order.customerId}`)
    .emit("order:status-updated", { id: req.params.orderId, ...result });
  if (result.changes.riderId) io.to(`user:${result.changes.riderId}`).emit("order:assigned", { id: req.params.orderId, order: result.order });
  res.json({ id: req.params.orderId, ...result });
}));

app.post("/api/orders/:orderId/receipt-email", authenticate, asyncRoute(async (req, res) => {
  if (!validRecordId(req.params.orderId)) throw new HttpError(400, "Invalid order ID.");
  const order = (await db().ref(`orders/${req.params.orderId}`).once("value")).val();
  if (!canAccessOrder(req.user, order)) throw new HttpError(403, "You cannot access this receipt.");
  const result = await sendOrderReceiptEmail({ id: req.params.orderId, ...order });
  res.json({ sent: Boolean(result?.sent ?? result), result });
}));

app.get("/api/inventory", authenticate, requireRoles("owner", "staff"), asyncRoute(async (_req, res) => {
  res.json({ inventory: (await db().ref("inventory").once("value")).val() || {} });
}));

app.patch("/api/inventory/:itemId", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  const result = await adjustInventoryRecord(db(), req.user, req.params.itemId, req.body);
  io.to("role:owner").to("role:staff").emit("inventory:updated", result);
  res.json(result);
}));

app.patch("/api/menu/:itemId", authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  const result = await updateMenuItemRecord(db(), req.user, req.params.itemId, req.body);
  io.to("role:owner").to("role:staff").emit("menu:updated", result);
  res.json(result);
}));

app.post("/api/menu", authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  const result = await createMenuItemRecord(db(), req.user, req.body);
  io.to("role:owner").to("role:staff").emit("menu:updated", result);
  res.status(201).json(result);
}));

app.patch("/api/reviews/:reviewId", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  res.json(await updateReviewRecord(db(), req.user, req.params.reviewId, req.body));
}));

app.get("/api/complaints", authenticate, requireRoles("owner", "staff", "customer"), asyncRoute(async (req, res) => {
  res.json(await listComplaintsRecord(db(), req.user));
}));

app.post("/api/complaints", authenticate, requireRoles("customer"), asyncRoute(async (req, res) => {
  const result = await createComplaintRecord(db(), req.user, req.body);
  io.to("role:owner").to("role:staff").emit("complaint:created", result);
  res.status(201).json(result);
}));

app.patch("/api/complaints/:complaintId", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  const result = await updateComplaintRecord(db(), req.user, req.params.complaintId, req.body);
  io.to(`user:${result.complaint.customerId}`).to("role:owner").to("role:staff").emit("complaint:updated", result);
  res.json(result);
}));

app.post("/api/riders/location", authenticate, requireRoles("rider"), asyncRoute(async (req, res) => {
  const result = await saveRiderLocationRecord(db(), req.user, req.body.orderId, req.body);
  io.to(`order:${req.body.orderId}`).to("role:owner").to("role:staff").emit("rider:location", {
    riderId: req.user.uid,
    orderId: req.body.orderId,
    ...result.location
  });
  res.json({ location: result.location });
}));

app.post("/api/orders/:orderId/proof", authenticate, requireRoles("rider"), asyncRoute(async (req, res) => {
  res.status(201).json(await saveDeliveryProofRecord(db(), req.user, req.params.orderId, req.body));
}));

app.post("/api/shift-logs", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  const result = await saveShiftLogRecord(db(), req.user, req.body);
  io.to("role:owner").to("role:staff").emit("shift:closed", result);
  res.status(201).json(result);
}));

app.get("/api/shifts/active", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  res.json(await getActiveShiftRecord(db(), req.user));
}));

app.post("/api/shifts/start", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  const result = await startShiftRecord(db(), req.user, req.body);
  io.to("role:owner").to("role:staff").emit("shift:started", result);
  res.status(201).json(result);
}));

app.post("/api/shifts/close", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  const result = await closeActiveShiftRecord(db(), req.user, req.body);
  io.to("role:owner").to("role:staff").emit("shift:closed", result);
  res.status(201).json(result);
}));

app.get("/api/approvals", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  res.json(await listApprovalRequestsRecord(db(), req.user));
}));

app.post("/api/approvals", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  res.status(201).json(await createApprovalRequestRecord(db(), req.user, req.body));
}));

app.patch("/api/approvals/:requestId", authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  res.json(await resolveApprovalRequestRecord(db(), req.user, req.params.requestId, req.body));
}));

app.post("/api/admin/archive-orders", authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  res.json(await archiveCompletedOrdersRecord(db(), req.user, req.body));
}));

app.post("/api/admin/roles", authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  if (!validRecordId(req.body.uid)) throw new HttpError(400, "Invalid account ID.");
  if (!["owner", "staff", "rider", "customer"].includes(req.body.role)) throw new HttpError(400, "Unsupported role.");
  const staffRole = ["manager", "cashier", "kitchen", "inventory"].includes(req.body.staffRole) ? req.body.staffRole : "manager";
  const currentRole = (await db().ref(`users/${req.body.uid}/role`).once("value")).val() || "customer";
  await getAuth().setCustomUserClaims(req.body.uid, { role: req.body.role });
  const createdAt = Date.now();
  await db().ref().update({
    [`users/${req.body.uid}/role`]: req.body.role,
    [`users/${req.body.uid}/staffRole`]: req.body.role === "staff" ? staffRole : null,
    [`auditLogs/AUD-${createdAt}-${req.body.uid}-role`]: {
      action: "role_changed",
      targetUserId: req.body.uid,
      actorId: req.user.uid,
      actorName: req.user.name || req.user.email,
      actorRole: req.user.role,
      details: { before: { role: currentRole }, after: { role: req.body.role, staffRole: req.body.role === "staff" ? staffRole : null } },
      createdAt
    }
  });
  res.json({ updated: true });
}));

app.get("/api/admin/users", authenticate, requireRoles("owner"), asyncRoute(async (_req, res) => {
  const [authResult, profilesSnapshot, twoFactorSnapshot] = await Promise.all([
    getAuth().listUsers(1000),
    db().ref("users").once("value"),
    db().ref("twoFactor").once("value")
  ]);
  const profiles = profilesSnapshot.val() || {};
  const security = twoFactorSnapshot.val() || {};
  const users = authResult.users.map((record) => {
    const profile = profiles[record.uid] || {};
    const status = security[record.uid] || {};
    return {
      uid: record.uid,
      email: record.email || profile.email || "",
      name: profile.name || record.displayName || record.email || record.uid,
      role: record.customClaims?.role || profile.role || "customer",
      staffRole: profile.staffRole || "manager",
      twoFactorEnabled: Boolean(status.enabled),
      twoFactorMethod: status.method || null,
      twoFactorLocked: Boolean(status.locked)
    };
  });
  res.json({ users });
}));

app.post("/api/admin/users/:uid/2fa/reset", authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  await resetTwoFactor(db(), req.user, req.params.uid);
  res.json({ reset: true });
}));

app.post("/api/admin/users/:uid/2fa/unlock", authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  await unlockTwoFactor(db(), req.user, req.params.uid);
  res.json({ unlocked: true });
}));

app.post("/api/admin/users/:uid/message", authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  const result = await createNotification(db(), req.user, {
    targetUserId: req.params.uid,
    title: req.body.title || "Message from administrator",
    message: req.body.message,
    type: "admin"
  });
  res.status(201).json(result);
}));

const io = new SocketServer(server, {
  cors: { origin: allowedOrigins, credentials: true },
  maxHttpBufferSize: 100_000
});

io.use(async (socket, next) => {
  if (!firebaseAdminEnabled) return next(new Error("Account service is unavailable."));
  try {
    socket.user = await verifyUserToken(socket.handshake.auth?.token);
    if (!hasVerifiedEmail(socket.user)) throw new Error("Email verification required.");
    if (socket.user.mfaSession !== true) throw new Error("Account security required.");
    return next();
  } catch {
    return next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.join(`user:${socket.user.uid}`);
  if (socket.user.role) socket.join(`role:${socket.user.role}`);

  socket.on("order:join", async (orderId, acknowledge = () => {}) => {
    try {
      if (!validRecordId(orderId)) throw new HttpError(400, "Invalid order ID.");
      const order = (await db().ref(`orders/${orderId}`).once("value")).val();
      if (!canAccessOrder(socket.user, order)) throw new HttpError(403, "You cannot join this order.");
      await socket.join(`order:${orderId}`);
      acknowledge({ ok: true });
    } catch (error) {
      acknowledge({ ok: false, error: error.message });
    }
  });

  socket.on("rider:location", async (payload = {}, acknowledge = () => {}) => {
    try {
      const now = Date.now();
      if (now - Number(socket.data.lastLocationAt || 0) < 3_000) throw new HttpError(429, "GPS updates are limited to one every 3 seconds.");
      const result = await saveRiderLocationRecord(db(), socket.user, payload.orderId, payload);
      socket.data.lastLocationAt = now;
      io.to(`order:${payload.orderId}`).to("role:owner").to("role:staff").emit("rider:location", {
        riderId: socket.user.uid,
        orderId: payload.orderId,
        ...result.location
      });
      acknowledge({ ok: true });
    } catch (error) {
      acknowledge({ ok: false, error: error.message });
    }
  });

  socket.on("order:status", (_payload, acknowledge = () => {}) => {
    acknowledge({ ok: false, error: "Please refresh and try updating the order again." });
  });
});

const port = Number(process.env.PORT || 8080);
server.listen(port, () => console.log(`Taptap integration server running on http://localhost:${port}`));
