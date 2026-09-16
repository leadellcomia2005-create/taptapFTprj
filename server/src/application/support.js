import { notificationUpdates } from "../notifications.js";
import { HttpError, validRecordId } from "../security.js";

const defaultConversation = (customerId) => ({
  customerId,
  mode: "assistant",
  assignedStaffId: null,
  assignedStaffName: null,
  updatedAt: 0
});

export async function getSupportConversation(db, customerId) {
  if (!validRecordId(customerId)) throw new HttpError(400, "Invalid customer ID.");
  const value = (await db.ref(`supportConversations/${customerId}`).once("value")).val();
  return value ? { ...defaultConversation(customerId), ...value, customerId } : defaultConversation(customerId);
}

export async function replyToSupportConversation(db, actor, customerId, input) {
  if (!validRecordId(customerId)) throw new HttpError(400, "Invalid customer ID.");
  const latestMessages = (await db.ref("messages/support")
    .orderByChild("customerId")
    .equalTo(customerId)
    .limitToLast(1)
    .once("value")).val() || {};
  if (Object.keys(latestMessages).length === 0) throw new HttpError(404, "Customer conversation not found.");

  const now = Date.now();
  let previous = null;
  const stateRef = db.ref(`supportConversations/${customerId}`);
  const transaction = await stateRef.transaction((current) => {
    previous = current || defaultConversation(customerId);
    if (previous.mode === "staff" && previous.assignedStaffId !== actor.uid && actor.role !== "owner") {
      return undefined;
    }
    return {
      customerId,
      mode: "staff",
      assignedStaffId: actor.uid,
      assignedStaffName: actor.name || (actor.role === "owner" ? "Owner" : "Support team"),
      assignedStaffRole: actor.role,
      takenOverAt: previous.mode === "staff" ? previous.takenOverAt || now : now,
      lastStaffReplyAt: now,
      updatedAt: now
    };
  });
  if (!transaction.committed) {
    throw new HttpError(409, `This conversation is already assigned to ${previous?.assignedStaffName || "another staff member"}.`, {
      code: "SUPPORT_ALREADY_ASSIGNED"
    });
  }

  const conversation = transaction.snapshot.val();
  const messageId = db.ref("messages/support").push().key;
  const auditId = db.ref("auditLogs").push().key;
  const message = {
    text: input.text,
    senderId: actor.uid,
    senderName: actor.name || "Support team",
    senderRole: actor.role,
    customerId,
    customerName: input.customerName || Object.values(latestMessages)[0]?.customerName || "Customer",
    conversationId: customerId,
    channel: "support",
    createdAt: now
  };
  const takeoverAction = previous?.mode !== "staff"
    ? "support_takeover_started"
    : previous.assignedStaffId !== actor.uid
      ? "support_reassigned"
      : "support_staff_replied";
  const updates = {
    [`messages/support/${messageId}`]: message,
    [`auditLogs/${auditId}`]: {
      action: takeoverAction,
      customerId,
      actorId: actor.uid,
      actorName: actor.name || "Support team",
      actorRole: actor.role,
      previousMode: previous?.mode || "assistant",
      mode: "staff",
      createdAt: now
    },
    ...notificationUpdates(db, [customerId], {
      title: "Support team replied",
      message: `${actor.name || "Support team"}: ${input.text}`,
      type: "chat",
      entityType: "chat",
      entityId: customerId,
      actionView: "orders"
    })
  };
  try {
    await db.ref().update(updates);
  } catch (error) {
    await stateRef.transaction((current) => current?.lastStaffReplyAt === now && current?.assignedStaffId === actor.uid
      ? previous
      : undefined);
    throw error;
  }
  return { conversation, message: { id: messageId, ...message } };
}

export async function resumeSupportAssistant(db, actor, customerId) {
  if (!validRecordId(customerId)) throw new HttpError(400, "Invalid customer ID.");
  let previous = null;
  const now = Date.now();
  const stateRef = db.ref(`supportConversations/${customerId}`);
  const transaction = await stateRef.transaction((current) => {
    previous = current || defaultConversation(customerId);
    if (previous.mode !== "staff") return undefined;
    if (previous.assignedStaffId !== actor.uid && actor.role !== "owner") return undefined;
    return {
      customerId,
      mode: "assistant",
      assignedStaffId: null,
      assignedStaffName: null,
      assignedStaffRole: null,
      resumedAt: now,
      updatedAt: now
    };
  });
  if (!transaction.committed) {
    throw new HttpError(403, "Only the assigned staff member or an owner can return this conversation to the assistant.", {
      code: "SUPPORT_RELEASE_FORBIDDEN"
    });
  }
  const conversation = transaction.snapshot.val();
  const auditId = db.ref("auditLogs").push().key;
  await db.ref().update({
    [`auditLogs/${auditId}`]: {
      action: "support_assistant_resumed",
      customerId,
      actorId: actor.uid,
      actorName: actor.name || "Support team",
      actorRole: actor.role,
      previousMode: "staff",
      mode: "assistant",
      createdAt: now
    }
  });
  return conversation;
}
