import { bearerToken, hasVerifiedEmail } from "../security.js";

export function createAuthentication(firebase, { logger, metrics } = {}) {
  async function verifyUserToken(token) {
    const decoded = await firebase.auth().verifyIdToken(token, true);
    const profile = (await firebase.db().ref(`users/${decoded.uid}`).once("value")).val() || {};
    if (profile.suspended === true) throw new Error("Account suspended");
    return { ...decoded, role: profile.role || decoded.role || "customer", name: profile.name || decoded.name };
  }

  function requireFirebaseAdmin(_req, res, next) {
    if (!firebase.enabled) {
      metrics?.increment("readinessFailures");
      return res.status(503).json({ error: "Account service is unavailable. Please try again later." });
    }
    return next();
  }

  async function authenticateBootstrap(req, res, next) {
    if (!firebase.enabled) return requireFirebaseAdmin(req, res, next);
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      logger?.warn("authentication_rejected", {
        requestId: req.context?.requestId || null,
        reason: "missing_token"
      });
      return res.status(401).json({ error: "Authentication required." });
    }
    try {
      req.authToken = token;
      req.user = await verifyUserToken(token);
      return next();
    } catch {
      logger?.warn("authentication_rejected", {
        requestId: req.context?.requestId || null,
        reason: "invalid_or_revoked_token"
      });
      return res.status(401).json({ error: "Invalid or expired authentication token." });
    }
  }

  async function authenticate(req, res, next) {
    return authenticateBootstrap(req, res, () => {
      if (!hasVerifiedEmail(req.user)) {
        return res.status(403).json({
          error: "Verify your email address before accessing the POS.",
          code: "EMAIL_VERIFICATION_REQUIRED"
        });
      }
      if (req.user.mfaSession !== true) {
        return res.status(403).json({
          error: "Complete account security before accessing the POS.",
          code: "TWO_FACTOR_REQUIRED"
        });
      }
      return next();
    });
  }

  return { authenticate, authenticateBootstrap, requireFirebaseAdmin, verifyUserToken };
}
