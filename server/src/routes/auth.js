import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration
} from "../passkeys.js";
import { createCustomerRegistration, verifyTurnstileToken } from "../registration.js";
import { requireVerifiedEmail } from "../security.js";
import { sendCustomerVerificationEmail, sendTwoFactorEmail, sendTwoFactorSms, serviceStatus } from "../services.js";
import {
  beginTotpSetup,
  finishEnrollment,
  sendEmailCode,
  sendSmsCode,
  twoFactorStatus,
  verifyChallenge
} from "../twoFactor.js";
import {
  registrationSchema,
  twoFactorChallengeSchema,
  twoFactorSendSchema,
  twoFactorVerifySchema
} from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody } from "../middleware/validation.js";

export function createAuthRouter({ config, firebase, authentication }) {
  const router = Router();
  const registrationLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: "draft-8" });
  const { authenticateBootstrap, requireFirebaseAdmin } = authentication;

  router.post("/auth/register", registrationLimiter, requireFirebaseAdmin, validateBody(registrationSchema), asyncRoute(async (req, res) => {
    const result = await createCustomerRegistration({
      db: firebase.db(),
      auth: firebase.auth(),
      input: req.body,
      req,
      sendVerificationEmail: serviceStatus().emailOtp ? sendCustomerVerificationEmail : null,
      appBaseUrl: config.appBaseUrl,
      verifyHuman: config.turnstile?.bypass
        ? null
        : config.turnstile?.secret
          ? (token, request) => verifyTurnstileToken({
            secret: config.turnstile.secret,
            token,
            req: request,
            expectedAction: config.turnstile.expectedAction,
            allowedHostnames: config.turnstile.allowedHostnames
          })
        : null
    });
    res.status(201).json(result);
  }));

  router.get("/2fa/status", authenticateBootstrap, asyncRoute(async (req, res) => {
    const status = serviceStatus();
    res.json(await twoFactorStatus(firebase.db(), req.user, status.twilio, status.emailOtp, req.authToken));
  }));

  router.post("/2fa/setup/totp", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
    res.json(await beginTotpSetup(firebase.db(), req.user));
  }));

  router.post("/2fa/sms/send", authenticateBootstrap, requireVerifiedEmail, validateBody(twoFactorSendSchema), asyncRoute(async (req, res) => {
    res.json(await sendSmsCode(firebase.db(), req.user, sendTwoFactorSms, req.body.purpose === "setup" ? "setup" : "challenge"));
  }));

  router.post("/2fa/email/send", authenticateBootstrap, requireVerifiedEmail, validateBody(twoFactorSendSchema), asyncRoute(async (req, res) => {
    res.json(await sendEmailCode(firebase.db(), req.user, sendTwoFactorEmail, req.body.purpose === "setup" ? "setup" : "challenge"));
  }));

  router.post("/2fa/setup/verify", authenticateBootstrap, requireVerifiedEmail, validateBody(twoFactorVerifySchema), asyncRoute(async (req, res) => {
    res.json(await finishEnrollment(firebase.db(), req.user, req.body.method, req.body.code, req.authToken));
  }));

  router.post("/2fa/challenge", authenticateBootstrap, requireVerifiedEmail, validateBody(twoFactorChallengeSchema), asyncRoute(async (req, res) => {
    res.json(await verifyChallenge(firebase.db(), req.user, req.body, req.authToken));
  }));

  router.post("/passkeys/register/options", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
    res.json(await beginPasskeyRegistration(firebase.db(), req.user, req));
  }));

  router.post("/passkeys/register/verify", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
    res.json(await verifyPasskeyRegistration(firebase.db(), req.user, req.body, req));
  }));

  router.post("/passkeys/authenticate/options", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
    res.json(await beginPasskeyAuthentication(firebase.db(), req.user, req));
  }));

  router.post("/passkeys/authenticate/verify", authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
    res.json(await verifyPasskeyAuthentication(firebase.db(), req.user, req.body, req));
  }));

  return router;
}
