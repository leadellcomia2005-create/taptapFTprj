import { Router } from "express";
import { archiveCompletedOrdersRecord } from "../application/orders.js";
import {
  accountSuspensionSchema,
  adminMessageSchema,
  archiveOrdersSchema,
  managedAccountSchema,
  recordIdParams,
  roleChangeSchema
} from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import { createNotification } from "../notifications.js";
import { HttpError, requireRoles } from "../security.js";
import { resetTwoFactor, unlockTwoFactor } from "../twoFactor.js";

function normalizeManagedAccount(input) {
  return {
    name: input.name.trim().replace(/\s+/g, " "),
    email: input.email.trim().toLowerCase(),
    role: input.role,
    staffRole: input.staffRole || "manager",
    temporaryPassword: input.temporaryPassword
  };
}

async function protectLastOwner(db, targetUid, currentRole, nextRole) {
  if (currentRole !== "owner" || nextRole === "owner") return;
  const profiles = (await db.ref("users").once("value")).val() || {};
  const otherOwners = Object.entries(profiles)
    .filter(([uid, profile]) => uid !== targetUid && profile?.role === "owner");
  if (otherOwners.length === 0) {
    throw new HttpError(409, "Assign another owner before removing the final owner account.", { code: "LAST_OWNER_REQUIRED" });
  }
}

async function listAllUsers(auth) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

export function createAdminRouter({ firebase, authentication }) {
  const router = Router();
  const { authenticate } = authentication;

  router.post("/admin/archive-orders", authenticate, requireRoles("owner"), validateBody(archiveOrdersSchema), asyncRoute(async (req, res) => {
    res.json(await archiveCompletedOrdersRecord(firebase.db(), req.user, req.body));
  }));

  router.post("/admin/roles", authenticate, requireRoles("owner"), validateBody(roleChangeSchema), asyncRoute(async (req, res) => {
    const auth = firebase.auth();
    const profileRef = firebase.db().ref(`users/${req.body.uid}`);
    const [profileSnapshot, userRecord] = await Promise.all([
      profileRef.once("value"),
      auth.getUser(req.body.uid)
    ]);
    const profile = profileSnapshot.val() || {};
    const currentRole = userRecord.customClaims?.role || profile.role || "customer";
    const staffRole = req.body.role === "staff" ? req.body.staffRole || profile.staffRole || "manager" : null;
    await protectLastOwner(firebase.db(), req.body.uid, currentRole, req.body.role);

    await auth.setCustomUserClaims(req.body.uid, {
      ...(userRecord.customClaims || {}),
      role: req.body.role
    });
    await auth.revokeRefreshTokens(req.body.uid);

    const createdAt = Date.now();
    await firebase.db().ref().update({
      [`users/${req.body.uid}/role`]: req.body.role,
      [`users/${req.body.uid}/staffRole`]: staffRole,
      [`users/${req.body.uid}/sessionRevokedAt`]: createdAt,
      [`auditLogs/AUD-${createdAt}-${req.body.uid}-role`]: {
        action: "role_changed",
        targetUserId: req.body.uid,
        actorId: req.user.uid,
        actorName: req.user.name || req.user.email,
        actorRole: req.user.role,
        details: {
          before: { role: currentRole, staffRole: profile.staffRole || null },
          after: { role: req.body.role, staffRole, sessionsRevoked: true }
        },
        createdAt
      }
    });
    res.json({ updated: true, reauthenticationRequired: true });
  }));

  router.post("/admin/users", authenticate, requireRoles("owner"), validateBody(managedAccountSchema), asyncRoute(async (req, res) => {
    const input = normalizeManagedAccount(req.body);
    const auth = firebase.auth();
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email: input.email,
        password: input.temporaryPassword,
        displayName: input.name,
        emailVerified: false,
        disabled: false
      });
    } catch (error) {
      if (error.code === "auth/email-already-exists") {
        throw new HttpError(409, "This email already has an account. Assign the role or reset security instead.");
      }
      throw error;
    }

    try {
      await auth.setCustomUserClaims(userRecord.uid, { role: input.role });
      const createdAt = Date.now();
      const profile = {
        uid: userRecord.uid,
        name: input.name,
        email: input.email,
        role: input.role,
        staffRole: input.role === "staff" ? input.staffRole : null,
        phone: "",
        phoneVerified: false,
        smsNotifications: false,
        createdAt,
        updatedAt: createdAt,
        createdByOwnerId: req.user.uid,
        securitySetupRequired: true
      };
      await firebase.db().ref().update({
        [`users/${userRecord.uid}`]: profile,
        [`auditLogs/AUD-${createdAt}-${userRecord.uid}-created`]: {
          action: "admin_user_created",
          targetUserId: userRecord.uid,
          actorId: req.user.uid,
          actorName: req.user.name || req.user.email,
          actorRole: req.user.role,
          details: { after: { role: input.role, staffRole: profile.staffRole } },
          createdAt
        }
      });
      res.status(201).json({
        uid: userRecord.uid,
        email: input.email,
        name: input.name,
        role: input.role,
        staffRole: profile.staffRole
      });
    } catch (error) {
      await auth.deleteUser(userRecord.uid).catch(() => {});
      throw error;
    }
  }));

  router.get("/admin/users", authenticate, requireRoles("owner"), asyncRoute(async (_req, res) => {
    const [authUsers, profilesSnapshot, twoFactorSnapshot] = await Promise.all([
      listAllUsers(firebase.auth()),
      firebase.db().ref("users").once("value"),
      firebase.db().ref("twoFactor").once("value")
    ]);
    const profiles = profilesSnapshot.val() || {};
    const security = twoFactorSnapshot.val() || {};
    const users = authUsers.map((record) => {
      const profile = profiles[record.uid] || {};
      const status = security[record.uid] || {};
      return {
        uid: record.uid,
        email: record.email || profile.email || "",
        name: profile.name || record.displayName || record.email || record.uid,
        role: record.customClaims?.role || profile.role || "customer",
        staffRole: profile.staffRole || "manager",
        suspended: Boolean(record.disabled || profile.suspended),
        twoFactorEnabled: Boolean(status.enabled),
        twoFactorMethod: status.method || null,
        twoFactorLocked: Boolean(status.locked)
      };
    });
    res.json({ users });
  }));

  router.patch("/admin/users/:uid/suspension", authenticate, requireRoles("owner"), validateParams(recordIdParams("uid")), validateBody(accountSuspensionSchema), asyncRoute(async (req, res) => {
    const auth = firebase.auth();
    const profileRef = firebase.db().ref(`users/${req.params.uid}`);
    const [profileSnapshot, userRecord] = await Promise.all([
      profileRef.once("value"),
      auth.getUser(req.params.uid)
    ]);
    const profile = profileSnapshot.val() || {};
    const currentRole = userRecord.customClaims?.role || profile.role || "customer";
    if (req.body.suspended) await protectLastOwner(firebase.db(), req.params.uid, currentRole, "suspended");

    await auth.updateUser(req.params.uid, { disabled: req.body.suspended });
    await auth.revokeRefreshTokens(req.params.uid);
    const createdAt = Date.now();
    await firebase.db().ref().update({
      [`users/${req.params.uid}/suspended`]: req.body.suspended,
      [`users/${req.params.uid}/suspensionReason`]: req.body.suspended ? req.body.reason || "Owner action" : null,
      [`users/${req.params.uid}/sessionRevokedAt`]: createdAt,
      [`auditLogs/AUD-${createdAt}-${req.params.uid}-suspension`]: {
        action: req.body.suspended ? "account_suspended" : "account_reactivated",
        targetUserId: req.params.uid,
        actorId: req.user.uid,
        actorName: req.user.name || req.user.email,
        actorRole: req.user.role,
        details: {
          before: { suspended: Boolean(userRecord.disabled || profile.suspended) },
          after: { suspended: req.body.suspended, sessionsRevoked: true }
        },
        createdAt
      }
    });
    res.json({ updated: true, suspended: req.body.suspended, reauthenticationRequired: true });
  }));

  router.post("/admin/users/:uid/2fa/reset", authenticate, requireRoles("owner"), validateParams(recordIdParams("uid")), asyncRoute(async (req, res) => {
    await resetTwoFactor(firebase.db(), req.user, req.params.uid);
    res.json({ reset: true });
  }));

  router.post("/admin/users/:uid/2fa/unlock", authenticate, requireRoles("owner"), validateParams(recordIdParams("uid")), asyncRoute(async (req, res) => {
    await unlockTwoFactor(firebase.db(), req.user, req.params.uid);
    res.json({ unlocked: true });
  }));

  router.post("/admin/users/:uid/message", authenticate, requireRoles("owner"), validateParams(recordIdParams("uid")), validateBody(adminMessageSchema), asyncRoute(async (req, res) => {
    const result = await createNotification(firebase.db(), req.user, {
      targetUserId: req.params.uid,
      title: req.body.title || "Message from administrator",
      message: req.body.message,
      type: "admin"
    });
    res.status(201).json(result);
  }));

  return router;
}
