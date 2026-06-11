import "dotenv/config";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import admin from "firebase-admin";
import helmet from "helmet";
import { Server as SocketServer } from "socket.io";
import {
  askOpenAI,
  createPayMongoCheckout,
  detectDialogflowIntent,
  generateInsights,
  sendTwilioSms,
  serviceStatus
} from "./services.js";

const app = express();
const server = createServer(app);
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",").map((value) => value.trim());

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: "draft-8" }));

let firebaseAdminEnabled = false;
try {
  if (process.env.FIREBASE_DATABASE_URL) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    firebaseAdminEnabled = true;
  }
} catch (error) {
  console.warn("Firebase Admin is disabled:", error.message);
}

async function authenticate(req, res, next) {
  if (!firebaseAdminEnabled) {
    req.user = { uid: "local-demo", role: "owner" };
    return next();
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    req.user = await admin.auth().verifyIdToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid authentication token." });
  }
}

app.get("/api/status", (_req, res) => res.json({ services: serviceStatus() }));

app.post("/api/assistant", authenticate, async (req, res) => {
  try {
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
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post("/api/insights", authenticate, async (req, res) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "Owner access required." });
  try {
    const text = await generateInsights(req.body);
    return res.json({ text: text || "OpenAI is not configured. Add OPENAI_API_KEY to enable live operational insights." });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post("/api/payments/checkout", authenticate, async (req, res) => {
  try {
    const result = await createPayMongoCheckout(req.body);
    if (!result) return res.status(503).json({ error: "PayMongo is not configured." });
    return res.json(result);
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post("/api/notifications/sms", authenticate, async (req, res) => {
  try {
    const result = await sendTwilioSms(req.body);
    return res.json({ sent: Boolean(result), sid: result?.sid || null });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post("/api/admin/roles", authenticate, async (req, res) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "Owner access required." });
  if (!firebaseAdminEnabled) return res.status(503).json({ error: "Firebase Admin is not configured." });
  const allowed = ["owner", "staff", "rider", "customer"];
  if (!allowed.includes(req.body.role)) return res.status(400).json({ error: "Unsupported role." });
  await admin.auth().setCustomUserClaims(req.body.uid, { role: req.body.role });
  await admin.database().ref(`users/${req.body.uid}/role`).set(req.body.role);
  return res.json({ updated: true });
});

const io = new SocketServer(server, { cors: { origin: allowedOrigins, credentials: true } });

io.use(async (socket, next) => {
  if (!firebaseAdminEnabled) {
    socket.user = { uid: "local-rider", role: "rider" };
    return next();
  }
  try {
    socket.user = await admin.auth().verifyIdToken(socket.handshake.auth?.token);
    return next();
  } catch {
    return next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.on("order:join", (orderId) => socket.join(`order:${orderId}`));
  socket.on("rider:location", async (payload) => {
    if (!["rider", "owner", "staff"].includes(socket.user.role)) return;
    const location = {
      lat: Number(payload.lat),
      lng: Number(payload.lng),
      accuracy: Number(payload.accuracy || 0),
      updatedAt: Date.now()
    };
    if (firebaseAdminEnabled) await admin.database().ref(`riderLocations/${socket.user.uid}`).set(location);
    io.emit("rider:location", { riderId: socket.user.uid, ...location });
  });
  socket.on("order:status", (payload) => io.to(`order:${payload.orderId}`).emit("order:status", payload));
});

const port = Number(process.env.PORT || 8080);
server.listen(port, () => console.log(`Taptap integration server running on http://localhost:${port}`));
