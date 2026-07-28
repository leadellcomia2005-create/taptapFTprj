import { createHash } from "node:crypto";
import { updateOrderRecord } from "../business.js";
import { manilaDateKey, retentionTimestamp } from "../domain/orderIntegrity.js";
import { HttpError, validRecordId } from "../security.js";

const actionableTypes = new Set([
  "incomplete_cancellation",
  "stock_projection_mismatch",
  "stale_idempotency_claim"
]);

function assertOwner(user) {
  if (user?.role !== "owner") throw new HttpError(403, "Owner access required.");
}

function safeReason(value) {
  return String(value || "")
    .trim()
    .slice(0, 240)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(?:\+?63|0)?9\d{9}/g, "[redacted-phone]");
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function encodeIssue(type, target) {
  return Buffer.from(JSON.stringify({ type, target }), "utf8").toString("base64url");
}

function decodeIssue(issueId) {
  try {
    const issue = JSON.parse(Buffer.from(issueId, "base64url").toString("utf8"));
    if (typeof issue?.type !== "string" || !issue.target) throw new Error("invalid issue");
    if (typeof issue.target === "string" && !validRecordId(issue.target)) throw new Error("invalid target");
    if (typeof issue.target === "object") {
      if (!validRecordId(issue.target.userId) || !validRecordId(issue.target.key)) throw new Error("invalid target");
    }
    return issue;
  } catch {
    throw new HttpError(400, "Invalid recovery issue ID.", { code: "INVALID_RECOVERY_ISSUE" });
  }
}

function recoveryIssue(type, target, summary, severity = "warning") {
  return {
    id: encodeIssue(type, target),
    type,
    recordId: typeof target === "string" ? target : target.key,
    summary,
    severity,
    actionable: actionableTypes.has(type)
  };
}

async function recentIdempotencyClaims(db, limit, now) {
  const users = Object.keys((await db.ref("users").orderByKey().limitToLast(Math.min(25, limit)).once("value")).val() || {});
  const entries = [];
  await Promise.all(users.map(async (userId) => {
    const claims = (await db.ref(`idempotency/orderCreation/${userId}`)
      .orderByKey()
      .limitToLast(Math.min(25, limit))
      .once("value")).val() || {};
    for (const [key, claim] of Object.entries(claims)) {
      if (claim?.status === "processing" && Number(claim.expiresAt || 0) <= now) {
        entries.push({ userId, key, claim });
      }
    }
  }));
  return { entries: entries.slice(0, limit), userCount: users.length };
}

export async function scanRecoveryIssues(db, user, options = {}) {
  assertOwner(user);
  const now = Date.now();
  const limit = Math.max(20, Math.min(500, Number(options.limit || 200)));
  const [ordersSnapshot, inventorySnapshot, menuSnapshot, aggregatesSnapshot, notificationsSnapshot] = await Promise.all([
    db.ref("orders").orderByChild("createdAt").limitToLast(limit).once("value"),
    db.ref("inventory").once("value"),
    db.ref("public/menu").once("value"),
    db.ref("reportAggregates/daily").orderByKey().limitToLast(180).once("value"),
    db.ref("notifications").orderByChild("createdAt").limitToLast(limit).once("value")
  ]);
  const orders = ordersSnapshot.val() || {};
  const inventory = inventorySnapshot.val() || {};
  const menu = menuSnapshot.val() || {};
  const aggregates = aggregatesSnapshot.val() || {};
  const notifications = notificationsSnapshot.val() || {};
  const proofOrderIds = Object.entries(orders)
    .filter(([, order]) => order?.status === "delivered")
    .map(([orderId]) => orderId);
  const proofs = Object.fromEntries(await Promise.all(proofOrderIds.map(async (orderId) => [
    orderId,
    (await db.ref(`deliveryProofs/${orderId}`).once("value")).val()
  ])));
  const staleClaims = await recentIdempotencyClaims(db, limit, now);
  const issues = [];
  const aggregateDates = new Set();

  for (const [orderId, order] of Object.entries(orders)) {
    if (order?.status === "cancelled" && order.cancellationRecoveryId && !order.inventoryRestoredAt) {
      issues.push(recoveryIssue(
        "incomplete_cancellation",
        orderId,
        `Order ${orderId} is cancelled but inventory restoration is incomplete.`,
        "critical"
      ));
    }

    const invalidItems = !Array.isArray(order?.items) || order.items.some((item) => (
      !validRecordId(item?.id) || !Number.isInteger(Number(item?.qty)) || Number(item.qty) <= 0 || !inventory[item.id]
    ));
    if (invalidItems) {
      issues.push(recoveryIssue(
        "order_quantity_mismatch",
        orderId,
        `Order ${orderId} has invalid quantities or an inventory item that no longer exists.`,
        "critical"
      ));
    }

    if (Number.isFinite(Number(order?.createdAt))) {
      const date = manilaDateKey(Number(order.createdAt));
      if (!aggregates[date] && !aggregateDates.has(date)) {
        aggregateDates.add(date);
        issues.push(recoveryIssue(
          "missing_order_aggregate",
          date,
          `Daily order aggregate ${date} is missing and requires reconciliation.`
        ));
      }
    }

    if (order?.status === "delivered" && order.paymentMethod === "cod" && !order.codRemittedAt) {
      issues.push(recoveryIssue(
        "unresolved_cod_handoff",
        orderId,
        `COD order ${orderId} still requires owner cash verification.`
      ));
    }

    if (order?.status === "delivered") {
      const hasRemoteProof = typeof order.proofOfDeliveryUrl === "string" && order.proofOfDeliveryUrl.startsWith("https://");
      const hasStoredProof = order.proofOfDeliveryRef === `deliveryProofs/${orderId}` && Boolean(proofs[orderId]);
      if (!hasRemoteProof && !hasStoredProof) {
        issues.push(recoveryIssue(
          "missing_delivery_proof",
          orderId,
          `Delivered order ${orderId} has no verifiable proof record.`,
          "critical"
        ));
      }
    }
  }

  for (const [itemId, item] of Object.entries(inventory)) {
    if (itemId.startsWith("__") || !validRecordId(itemId) || !menu[itemId]) continue;
    const inventoryStock = Number(item?.stock);
    const publicStock = Number(menu[itemId]?.stock);
    if (Number.isFinite(inventoryStock) && inventoryStock !== publicStock) {
      issues.push(recoveryIssue(
        "stock_projection_mismatch",
        itemId,
        `${item.name || itemId} has different operational and public stock values.`
      ));
    }
  }

  for (const [notificationId, notification] of Object.entries(notifications)) {
    if (notification?.deliveryStatus === "failed" || notification?.failedAt || notification?.errorCode) {
      issues.push(recoveryIssue(
        "failed_notification_delivery",
        notificationId,
        `Notification ${notificationId} reports a failed delivery attempt.`
      ));
    }
  }

  for (const { userId, key } of staleClaims.entries) {
    issues.push(recoveryIssue(
      "stale_idempotency_claim",
      { userId, key },
      `Expired order request claim ${key} is still marked as processing.`
    ));
  }

  const summary = Object.fromEntries([...new Set(issues.map((issue) => issue.type))]
    .map((type) => [type, issues.filter((issue) => issue.type === type).length]));
  return {
    generatedAt: now,
    issues: issues.slice(0, limit),
    summary,
    scanned: {
      orders: Object.keys(orders).length,
      inventoryItems: Object.keys(inventory).filter((key) => !key.startsWith("__")).length,
      notifications: Object.keys(notifications).length,
      idempotencyUsers: staleClaims.userCount
    },
    truncated: issues.length > limit
  };
}

async function inspectAction(db, issue) {
  if (issue.type === "incomplete_cancellation") {
    const order = (await db.ref(`orders/${issue.target}`).once("value")).val();
    if (!order || order.status !== "cancelled" || !order.cancellationRecoveryId || order.inventoryRestoredAt) {
      throw new HttpError(409, "This cancellation no longer requires recovery.", { code: "RECOVERY_STATE_CHANGED" });
    }
    return {
      state: {
        status: order.status,
        cancellationRecoveryId: order.cancellationRecoveryId,
        inventoryRestoredAt: order.inventoryRestoredAt || null,
        updatedAt: order.updatedAt || null
      },
      changes: ["Resume the existing transaction-protected inventory restoration."]
    };
  }
  if (issue.type === "stock_projection_mismatch") {
    const [inventory, menu] = await Promise.all([
      db.ref(`inventory/${issue.target}`).once("value"),
      db.ref(`public/menu/${issue.target}`).once("value")
    ]);
    const inventoryItem = inventory.val();
    const menuItem = menu.val();
    if (!inventoryItem || !menuItem || !Number.isFinite(Number(inventoryItem.stock)) || Number(inventoryItem.stock) === Number(menuItem.stock)) {
      throw new HttpError(409, "This stock projection no longer requires recovery.", { code: "RECOVERY_STATE_CHANGED" });
    }
    return {
      state: { inventoryStock: Number(inventoryItem.stock), publicStock: Number(menuItem.stock) },
      changes: ["Set the public menu stock projection to the current operational inventory stock."]
    };
  }
  if (issue.type === "stale_idempotency_claim") {
    const path = `idempotency/orderCreation/${issue.target.userId}/${issue.target.key}`;
    const claim = (await db.ref(path).once("value")).val();
    if (!claim || claim.status !== "processing" || Number(claim.expiresAt || 0) > Date.now()) {
      throw new HttpError(409, "This order request claim is no longer stale.", { code: "RECOVERY_STATE_CHANGED" });
    }
    return {
      state: {
        status: claim.status,
        requestHash: claim.requestHash || null,
        expiresAt: Number(claim.expiresAt || 0)
      },
      changes: ["Mark the expired processing claim as released while preserving its request fingerprint."]
    };
  }
  throw new HttpError(409, "This finding is review-only and cannot be changed automatically.", { code: "RECOVERY_REVIEW_ONLY" });
}

export async function previewRecoveryAction(db, user, input) {
  assertOwner(user);
  const issue = decodeIssue(input.issueId);
  if (!actionableTypes.has(issue.type)) {
    throw new HttpError(409, "This finding is review-only and cannot be changed automatically.", { code: "RECOVERY_REVIEW_ONLY" });
  }
  const inspection = await inspectAction(db, issue);
  return {
    issueId: input.issueId,
    type: issue.type,
    recordId: typeof issue.target === "string" ? issue.target : issue.target.key,
    previewHash: digest({ issueId: input.issueId, state: inspection.state }),
    changes: inspection.changes,
    dryRun: true
  };
}

async function claimRecoveryRequest(db, user, input, fingerprint) {
  const path = `recoveryRequests/${user.uid}/${input.requestId}`;
  const reference = db.ref(path);
  const now = Date.now();
  let conflict;
  const transaction = await reference.transaction((current) => {
    conflict = null;
    if (current?.fingerprint && current.fingerprint !== fingerprint) {
      conflict = new HttpError(409, "This recovery request ID was already used for another action.", { code: "RECOVERY_ID_CONFLICT" });
      return undefined;
    }
    if (current?.status === "complete") return undefined;
    if (current?.status === "processing" && Number(current.expiresAt || 0) > now) {
      conflict = new HttpError(409, "This recovery request is already processing.", { code: "RECOVERY_IN_PROGRESS" });
      return undefined;
    }
    return {
      status: "processing",
      fingerprint,
      issueId: input.issueId,
      actorId: user.uid,
      createdAt: current?.createdAt || now,
      updatedAt: now,
      expiresAt: now + 2 * 60 * 1000
    };
  });
  if (!transaction.committed) {
    const current = (await reference.once("value")).val();
    if (current?.status === "complete" && current.fingerprint === fingerprint) {
      return { path, replay: current.result || { status: "complete" } };
    }
    throw conflict || new HttpError(409, "The recovery request could not be claimed.");
  }
  return { path, replay: null };
}

async function applyRecoveryAction(db, user, input, issue) {
  if (issue.type === "incomplete_cancellation") {
    await updateOrderRecord(db, user, issue.target, {
      cancel: true,
      cancelReason: "Owner recovery of an incomplete cancellation"
    });
    return { status: "cancellation_recovered", recordId: issue.target };
  }
  if (issue.type === "stock_projection_mismatch") {
    const inventory = (await db.ref(`inventory/${issue.target}`).once("value")).val();
    const stock = Number(inventory?.stock);
    if (!Number.isFinite(stock)) throw new HttpError(409, "Operational inventory is unavailable.");
    await db.ref(`public/menu/${issue.target}/stock`).transaction(() => stock);
    return { status: "stock_projection_synchronized", recordId: issue.target };
  }
  if (issue.type === "stale_idempotency_claim") {
    const path = `idempotency/orderCreation/${issue.target.userId}/${issue.target.key}`;
    let stateChanged = false;
    const now = Date.now();
    await db.ref(path).transaction((current) => {
      if (!current || current.status !== "processing" || Number(current.expiresAt || 0) > now) return undefined;
      stateChanged = true;
      return {
        ...current,
        status: "released",
        releasedAt: now,
        releasedBy: user.uid,
        recoveryRequestId: input.requestId
      };
    });
    if (!stateChanged) throw new HttpError(409, "The order request claim changed before recovery.");
    return { status: "idempotency_claim_released", recordId: issue.target.key };
  }
  throw new HttpError(409, "This finding is review-only.");
}

async function resolvedRecoveryResult(db, issue, requestId) {
  if (issue.type === "incomplete_cancellation") {
    const order = (await db.ref(`orders/${issue.target}`).once("value")).val();
    return order?.inventoryRestoredAt
      ? { status: "cancellation_recovered", recordId: issue.target }
      : null;
  }
  if (issue.type === "stock_projection_mismatch") {
    const [inventory, menu] = await Promise.all([
      db.ref(`inventory/${issue.target}`).once("value"),
      db.ref(`public/menu/${issue.target}`).once("value")
    ]);
    const inventoryStock = Number(inventory.val()?.stock);
    const publicStock = Number(menu.val()?.stock);
    return Number.isFinite(inventoryStock) && inventoryStock === publicStock
      ? { status: "stock_projection_synchronized", recordId: issue.target }
      : null;
  }
  if (issue.type === "stale_idempotency_claim") {
    const claim = (await db.ref(`idempotency/orderCreation/${issue.target.userId}/${issue.target.key}`).once("value")).val();
    return claim?.status === "released" && claim.recoveryRequestId === requestId
      ? { status: "idempotency_claim_released", recordId: issue.target.key }
      : null;
  }
  return null;
}

async function completeRecoveryRequest(db, user, input, issue, fingerprint, reason, result) {
  const completedAt = Date.now();
  const requestPath = `recoveryRequests/${user.uid}/${input.requestId}`;
  await db.ref().update({
    [requestPath]: {
      status: "complete",
      fingerprint,
      issueId: input.issueId,
      result,
      actorId: user.uid,
      completedAt,
      expiresAt: retentionTimestamp(completedAt, 30)
    },
    [`auditLogs/REC-${input.requestId}`]: {
      action: "recovery_action_applied",
      recoveryType: issue.type,
      targetId: result.recordId,
      reason,
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      details: { after: { status: result.status, idempotent: true } },
      createdAt: completedAt
    }
  });
  return result;
}

export async function executeRecoveryAction(db, user, input) {
  assertOwner(user);
  if (input.confirmation !== "APPLY_RECOVERY") throw new HttpError(400, "Recovery confirmation is required.");
  const issue = decodeIssue(input.issueId);
  const reason = safeReason(input.reason);
  const fingerprint = digest({ issueId: input.issueId, reason });
  const requestPath = `recoveryRequests/${user.uid}/${input.requestId}`;
  const existingRequest = (await db.ref(requestPath).once("value")).val();
  if (existingRequest?.fingerprint && existingRequest.fingerprint !== fingerprint) {
    throw new HttpError(409, "This recovery request ID was already used for another action.", { code: "RECOVERY_ID_CONFLICT" });
  }
  if (existingRequest?.status === "complete" && existingRequest.fingerprint === fingerprint) {
    return { ...(existingRequest.result || { status: "complete" }), idempotent: true };
  }
  if (existingRequest?.status === "failed" && existingRequest.fingerprint === fingerprint) {
    const resolved = await resolvedRecoveryResult(db, issue, input.requestId);
    if (resolved) {
      await completeRecoveryRequest(db, user, input, issue, fingerprint, reason, resolved);
      return { ...resolved, idempotent: true };
    }
  }

  const inspection = await inspectAction(db, issue);
  const previewHash = digest({ issueId: input.issueId, state: inspection.state });
  if (input.previewHash !== previewHash) {
    throw new HttpError(409, "The record changed after the dry run. Run the preview again.", { code: "RECOVERY_PREVIEW_STALE" });
  }
  const claim = await claimRecoveryRequest(db, user, input, fingerprint);
  if (claim.replay) return { ...claim.replay, idempotent: true };

  try {
    const result = await applyRecoveryAction(db, user, input, issue);
    await completeRecoveryRequest(db, user, input, issue, fingerprint, reason, result);
    return { ...result, idempotent: false };
  } catch (error) {
    const failedAt = Date.now();
    await db.ref(claim.path).update({
      status: "failed",
      failedAt,
      expiresAt: failedAt
    }).catch(() => {});
    throw error;
  }
}
