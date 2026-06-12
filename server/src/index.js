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
  createOrderRecord,
  listOrdersForUser,
  saveDeliveryProofRecord,
  saveRiderLocationRecord,
  saveShiftLogRecord,
  updateOrderRecord
} from "./business.js";
import {
  bearerToken,
  canAccessOrder,
  errorResponse,
  HttpError,
  requireRoles,
  validRecordId
} from "./security.js";
import {
  askOpenAI,
  createPayMongoCheckout,
  detectDialogflowIntent,
  generateInsights,
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
  sendSmsCode,
  twoFactorStatus,
  unlockTwoFactor,
  verifyChallenge
} from "./twoFactor.js";

dotenv.config({ override: true });

const app = express();
const server = createServer(app);
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",").map((value) => value.trim());

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: "draft-8" }));

let firebaseAdminEnabled = false;
let firebaseAdminError = "Firebase Admin credentials are not configured.";
if (process.env.FIREBASE_DATABASE_URL) {
  try {
    const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")))
      : applicationDefault();
    await credential.getAccessToken();
    initializeApp({
      credential,
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    firebaseAdminEnabled = true;
    firebaseAdminError = "";
  } catch (error) {
    firebaseAdminError = error.message;
    console.warn("Firebase Admin is unavailable:", error.message);
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
    return res.status(503).json({ error: "Firebase Admin is unavailable. Configure server credentials before using protected operations." });
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
    if (req.user.mfaSession !== true) {
      return res.status(403).json({ error: "Complete two-factor authentication before accessing the POS.", code: "TWO_FACTOR_REQUIRED" });
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
  services: { ...serviceStatus(), firebase: firebaseAdminEnabled, socket: firebaseAdminEnabled },
  firebaseAdminError: firebaseAdminEnabled ? null : firebaseAdminError
}));

app.get("/api/2fa/status", authenticateBootstrap, asyncRoute(async (req, res) => {
  res.json(await twoFactorStatus(db(), req.user, serviceStatus().twilio, req.authToken));
}));

app.post("/api/2fa/setup/totp", authenticateBootstrap, asyncRoute(async (req, res) => {
  res.json(await beginTotpSetup(db(), req.user));
}));

app.post("/api/2fa/sms/send", authenticateBootstrap, asyncRoute(async (req, res) => {
  res.json(await sendSmsCode(db(), req.user, sendTwoFactorSms, req.body.purpose === "setup" ? "setup" : "challenge"));
}));

app.post("/api/2fa/setup/verify", authenticateBootstrap, asyncRoute(async (req, res) => {
  res.json(await finishEnrollment(db(), req.user, req.body.method, req.body.code, req.authToken));
}));

app.post("/api/2fa/challenge", authenticateBootstrap, asyncRoute(async (req, res) => {
  res.json(await verifyChallenge(db(), req.user, req.body, req.authToken));
}));

app.post("/api/assistant", authenticate, asyncRoute(async (req, res) => {
  const detected = await detectDialogflowIntent(req.body);
  if (detected && detected.intent !== "Default Fallback Intent" && detected.confidence >= 0.55) {
    return res.json({ text: detected.text, source: "Dialogflow", intent: detected.intent });
  }
  const generated = await askOpenAI(req.body);
  if (generated) return res.json({ text: generated, source: "OpenAI" });
  return res.json({
    text: detected?.text || "The AI services are ready in code but need Dialogflow and OpenAI credentials.",
    source: detected ? "Dialogflow fallback" : "demo"
  });
}));

app.post("/api/insights", authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  const text = await generateInsights(req.body);
  res.json({ text: text || "OpenAI is not configured. Add OPENAI_API_KEY to enable live operational insights." });
}));

app.post("/api/payments/checkout", authenticate, asyncRoute(async (req, res) => {
  if (!validRecordId(req.body.orderId)) throw new HttpError(400, "Invalid order ID.");
  const order = (await db().ref(`orders/${req.body.orderId}`).once("value")).val();
  if (!canAccessOrder(req.user, order)) throw new HttpError(403, "You cannot create a payment for this order.");
  const result = await createPayMongoCheckout({ ...order, orderId: req.body.orderId, successUrl: req.body.successUrl, cancelUrl: req.body.cancelUrl });
  if (!result) throw new HttpError(503, "PayMongo is not configured.");
  res.json(result);
}));

app.post("/api/notifications/sms", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  if (!validRecordId(req.body.orderId)) throw new HttpError(400, "Invalid order ID.");
  const order = (await db().ref(`orders/${req.body.orderId}`).once("value")).val();
  if (!order) throw new HttpError(404, "Order not found.");
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
  io.to("role:owner").to("role:staff").to(`user:${req.user.uid}`).emit("order:created", result);
  res.status(201).json(result);
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

app.get("/api/inventory", authenticate, requireRoles("owner", "staff"), asyncRoute(async (_req, res) => {
  res.json({ inventory: (await db().ref("inventory").once("value")).val() || {} });
}));

app.patch("/api/inventory/:itemId", authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  const result = await adjustInventoryRecord(db(), req.user, req.params.itemId, req.body);
  io.to("role:owner").to("role:staff").emit("inventory:updated", result);
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

app.post("/api/admin/roles", authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  if (!validRecordId(req.body.uid)) throw new HttpError(400, "Invalid user UID.");
  if (!["owner", "staff", "rider", "customer"].includes(req.body.role)) throw new HttpError(400, "Unsupported role.");
  await getAuth().setCustomUserClaims(req.body.uid, { role: req.body.role });
  await db().ref(`users/${req.body.uid}/role`).set(req.body.role);
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
  if (!firebaseAdminEnabled) return next(new Error("Firebase Admin is unavailable."));
  try {
    socket.user = await verifyUserToken(socket.handshake.auth?.token);
    if (socket.user.mfaSession !== true) throw new Error("Two-factor authentication required.");
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
    acknowledge({ ok: false, error: "Order status changes must use the authenticated API." });
  });
});

const port = Number(process.env.PORT || 8080);
server.listen(port, () => console.log(`Taptap integration server running on http://localhost:${port}`));
