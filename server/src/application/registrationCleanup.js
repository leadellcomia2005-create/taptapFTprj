import { randomUUID } from "node:crypto";

export async function cleanupExpiredCustomerRegistrations({ db, auth, logger, now = Date.now(), limit = 100 }) {
  const snapshot = await db.ref("users")
    .orderByChild("registration/cleanupEligibleAt")
    .endAt(now)
    .limitToLast(limit)
    .once("value");
  const candidates = Object.entries(snapshot.val() || {}).filter(([, profile]) => {
    const deadline = Number(profile?.registration?.cleanupEligibleAt || 0);
    return profile?.role === "customer"
      && profile?.securitySetupRequired !== false
      && deadline > 0
      && deadline <= now;
  });
  const result = { checked: candidates.length, deleted: 0, verified: 0, preserved: 0, failed: 0 };

  for (const [uid, profile] of candidates) {
    try {
      let userRecord;
      try {
        userRecord = await auth.getUser(uid);
      } catch (error) {
        if (error?.code !== "auth/user-not-found") throw error;
      }

      if (userRecord?.emailVerified) {
        await db.ref(`users/${uid}/registration`).update({
          verificationExpiresAt: null,
          verificationSessionExpiresAt: null,
          cleanupEligibleAt: null,
          verificationStatus: "verified",
          emailVerifiedAt: now
        });
        result.verified += 1;
        continue;
      }

      const orders = (await db.ref("orders").orderByChild("customerId").equalTo(uid).limitToLast(1).once("value")).val() || {};
      if (Object.keys(orders).length > 0 || profile?.demoAccount === true) {
        await db.ref(`users/${uid}/registration`).update({ cleanupEligibleAt: null });
        result.preserved += 1;
        continue;
      }

      if (userRecord) await auth.deleteUser(uid);
      await db.ref().update({
        [`users/${uid}`]: null,
        [`twoFactor/${uid}`]: null
      });
      const auditKey = `REG-CLEANUP-${now}-${randomUUID().slice(0, 8)}`;
      await db.ref(`auditLogs/${auditKey}`).set({
        action: "abandoned_registration_removed",
        actorId: "registration-cleanup",
        actorName: "Registration cleanup",
        actorRole: "system",
        createdAt: now
      }).catch(() => {});
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      logger?.warn("registration_cleanup_failed", {
        userId: uid,
        errorCode: error?.code || "CLEANUP_ERROR"
      });
    }
  }

  if (result.deleted || result.verified || result.preserved || result.failed) {
    logger?.info("registration_cleanup_completed", result);
  }
  return result;
}
