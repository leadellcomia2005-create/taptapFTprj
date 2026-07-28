import { Server as SocketServer } from "socket.io";
import { saveRiderLocationRecord } from "../application/delivery.js";
import { canAccessOrder, HttpError, validRecordId } from "../security.js";

function acknowledge(callback, payload) {
  if (typeof callback === "function") callback(payload);
}

function publicSocketError(error) {
  if (error instanceof HttpError && error.status < 500) {
    return { error: error.message, ...(error.code ? { code: error.code } : {}) };
  }
  return { error: "The server could not complete the request.", code: "INTERNAL_ERROR" };
}

function logSocketFailure(logger, event, socket, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const details = {
    event,
    socketId: socket.id,
    userId: socket.user?.uid || null,
    role: socket.user?.role || null,
    status,
    errorCode: error?.code || (status >= 500 ? "INTERNAL_ERROR" : "SOCKET_REQUEST_REJECTED")
  };
  if (status >= 500) logger.error("socket_event_failed", details);
  else logger.warn("socket_event_rejected", details);
}

export function createSocketServer(server, { config, firebase, authentication, realtime, logger, metrics }) {
  const io = new SocketServer(server, {
    cors: { origin: config.allowedOrigins, credentials: true },
    maxHttpBufferSize: 100_000
  });
  realtime.attach(io);

  io.use(async (socket, next) => {
    if (!firebase.enabled) return next(new Error("Account service is unavailable."));
    try {
      socket.user = await authentication.verifyUserToken(socket.handshake.auth?.token);
      if (socket.user.email_verified !== true) throw new Error("Email verification required.");
      if (socket.user.mfaSession !== true) throw new Error("Account security required.");
      return next();
    } catch {
      metrics?.increment("authorizationFailures");
      logger.warn("socket_authentication_rejected", { socketId: socket.id || null });
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.user.uid}`);
    if (socket.user.role) socket.join(`role:${socket.user.role}`);
    logger.info("socket_connected", { socketId: socket.id, userId: socket.user.uid, role: socket.user.role || null });

    socket.on("order:join", async (orderId, callback) => {
      try {
        if (!validRecordId(orderId)) throw new HttpError(400, "Invalid order ID.");
        const order = (await firebase.db().ref(`orders/${orderId}`).once("value")).val();
        if (!canAccessOrder(socket.user, order)) throw new HttpError(403, "You cannot join this order.");
        await socket.join(`order:${orderId}`);
        acknowledge(callback, { ok: true });
      } catch (error) {
        logSocketFailure(logger, "order:join", socket, error);
        acknowledge(callback, { ok: false, ...publicSocketError(error) });
      }
    });

    socket.on("rider:location", async (payload = {}, callback) => {
      try {
        const now = Date.now();
        if (now - Number(socket.data.lastLocationAt || 0) < 3_000) {
          throw new HttpError(429, "GPS updates are limited to one every 3 seconds.");
        }
        const result = await saveRiderLocationRecord(firebase.db(), socket.user, payload.orderId, payload);
        socket.data.lastLocationAt = now;
        realtime.emit([`order:${payload.orderId}`, "role:owner", "role:staff"], "rider:location", {
          riderId: socket.user.uid,
          orderId: payload.orderId,
          ...result.location
        });
        acknowledge(callback, { ok: true });
      } catch (error) {
        logSocketFailure(logger, "rider:location", socket, error);
        acknowledge(callback, { ok: false, ...publicSocketError(error) });
      }
    });

    socket.on("order:status", (_payload, callback) => {
      acknowledge(callback, { ok: false, error: "Please refresh and try updating the order again." });
    });

    socket.on("disconnect", (reason) => {
      metrics?.increment("socketDisconnections");
      logger.info("socket_disconnected", { socketId: socket.id, userId: socket.user.uid, reason });
    });
  });

  return io;
}
