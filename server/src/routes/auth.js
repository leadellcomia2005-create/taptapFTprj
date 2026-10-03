import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration
} from "../passkeys.js";
import {
  checkRegistrationEmail,
  checkCustomerRegistrationVerification,
  createCustomerRegistration,
  resendCustomerRegistrationVerification,
  verifyTurnstileToken
} from "../registration.js";
import { HttpError, requireVerifiedEmail } from "../security.js";
import { sendCustomerVerificationEmail, sendTwoFactorEmail, sendTwoFactorSms, serviceStatus } from "../services.js";
import { sendFirebaseVerificationEmail } from "../integrations/firebaseVerificationEmail.js";
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
  registrationEmailPrecheckSchema,
  registrationVerificationStatusSchema,
  twoFactorChallengeSchema,
  twoFactorSendSchema,
  twoFactorVerifySchema
} from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody } from "../middleware/validation.js";

export function createAuthRouter({ config, firebase, authentication }) {
  const router = Router();
  const registrationLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: "draft-8" });
  const emailPrecheckLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-8" });
  const verificationResendLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 8, standardHeaders: "draft-8" });
  const verificationStatusLimiter = rateLimit({ windowMs: 5 * 60_000, limit: 120, standardHeaders: "draft-8" });
  const { authenticateBootstrap, requireFirebaseAdmin } = authentication;
  const registrationEmailSender = serviceStatus().emailOtp
    ? sendCustomerVerificationEmail
    : config.firebase?.webApiKey
      ? (_email, _verificationLink, _name, context) => sendFirebaseVerificationEmail({
        auth: firebase.auth(),
        uid: context?.uid,
        webApiKey: config.firebase?.webApiKey,
        continueUrl: context?.continueUrl
      })
      : null;

  router.post("/auth/registration-email", emailPrecheckLimiter, validateBody(registrationEmailPrecheckSchema), asyncRoute(async (req, res) => {
    res.json(await checkRegistrationEmail(req.body.email));
  }));

  router.post("/auth/register", registrationLimiter, requireFirebaseAdmin, validateBody(registrationSchema), asyncRoute(async (req, res) => {
    const result = await createCustomerRegistration({
      db: firebase.db(),
      auth: firebase.auth(),
      input: req.body,
      req,
      sendVerificationEmail: registrationEmailSender,
      appBaseUrl: config.appBaseUrl,
      verificationTtlMs: config.registration?.verificationTtlMs,
      abandonedTtlMs: config.registration?.abandonedTtlMs,
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

  router.post("/auth/registration-verification/status", verificationStatusLimiter, requireFirebaseAdmin, validateBody(registrationVerificationStatusSchema), asyncRoute(async (req, res) => {
    res.json(await checkCustomerRegistrationVerification({
      db: firebase.db(),
      auth: firebase.auth(),
      uid: req.body.uid,
      statusToken: req.body.statusToken
    }));
  }));

  router.post("/auth/verification-email/resend", verificationResendLimiter, authenticateBootstrap, requireFirebaseAdmin, asyncRoute(async (req, res) => {
    const result = await resendCustomerRegistrationVerification({
      db: firebase.db(),
      auth: firebase.auth(),
      user: req.user,
      sendVerificationEmail: registrationEmailSender,
      appBaseUrl: config.appBaseUrl,
      verificationTtlMs: config.registration?.verificationTtlMs,
      abandonedTtlMs: config.registration?.abandonedTtlMs,
      cooldownMs: config.registration?.resendCooldownMs,
      dailyLimit: config.registration?.resendDailyLimit
    });
    res.json(result);
  }));

  router.get("/2fa/status", authenticateBootstrap, asyncRoute(async (req, res) => {
    const expectedRole = typeof req.query.expectedRole === "string" ? req.query.expectedRole.trim().toLowerCase() : "";
    const supportedRoles = new Set(["customer", "owner", "staff", "rider"]);
    if (expectedRole && !supportedRoles.has(expectedRole)) {
      throw new HttpError(400, "Choose a valid account type.", { code: "INVALID_LOGIN_ROLE" });
    }
    if (expectedRole && req.user.role !== expectedRole) {
      const message = req.user.role === "customer" && expectedRole !== "customer"
        ? "Customer accounts can only sign in through Customer ordering. Choose Customer ordering and try again."
        : `This account cannot use the ${expectedRole} sign-in. Choose the matching account type and try again.`;
      throw new HttpError(403, message, { code: "ROLE_LOGIN_MISMATCH" });
    }
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
