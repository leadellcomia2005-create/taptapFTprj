export async function cleanupExpiredCustomerRegistrations({ db, auth, logger, now = Date.now(), limit = 100 }) {
  const snapshot = await db.ref("users")
    .orderByChild("registration/verificationExpiresAt")
    .endAt(now)
    .limitToLast(limit)
    .once("value");
  const candidates = Object.entries(snapshot.val() || {}).filter(([, profile]) => {
    const deadline = Number(profile?.registration?.verificationExpiresAt || 0);
    return profile?.role === "customer" && deadline > 0 && deadline <= now;
  });
  const result = { checked: candidates.length, deleted: 0, verified: 0, failed: 0 };

  for (const [uid] of candidates) {
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
          emailVerifiedAt: now
        });
        result.verified += 1;
        continue;
      }

      if (userRecord) await auth.deleteUser(uid);
      await db.ref().update({
        [`users/${uid}`]: null,
        [`twoFactor/${uid}`]: null
      });
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      logger?.warn("registration_cleanup_failed", {
        userId: uid,
        errorCode: error?.code || "CLEANUP_ERROR"
      });
    }
  }

  if (result.deleted || result.verified || result.failed) {
    logger?.info("registration_cleanup_completed", result);
  }
  return result;
}
