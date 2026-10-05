import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteSupportConversation,
  getSupportConversation,
  replyToSupportConversation,
  requestSupportStaff,
  resumeSupportAssistant
} from "../src/application/support.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

const initialData = () => ({
  users: {
    "staff-1": { role: "staff", name: "Mika" },
    "owner-1": { role: "owner", name: "Owner" },
    "customer-1": { role: "customer", name: "Juan" }
  },
  messages: {
    support: {
      first: {
        customerId: "customer-1",
        customerName: "Juan Customer",
        senderId: "customer-1",
        senderName: "Juan Customer",
        senderRole: "customer",
        text: "I need help",
        createdAt: 1
      }
    }
  }
});

test("customer staff requests pause the assistant and notify support once", async () => {
  const db = new FakeRealtimeDatabase(initialData());
  const first = await requestSupportStaff(db, { uid: "customer-1", role: "customer", name: "Juan" }, "customer-1", { reason: "Need help" });
  const second = await requestSupportStaff(db, { uid: "customer-1", role: "customer", name: "Juan" }, "customer-1", { reason: "Again" });
  assert.equal(first.conversation.mode, "waiting");
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(Object.values(db.read("notifications")).length, 2);
  assert.equal(Object.values(db.read("auditLogs")).length, 1);
  await assert.rejects(
    requestSupportStaff(db, { uid: "customer-2", role: "customer" }, "customer-1"),
    (error) => error.status === 403
  );
});

test("first staff reply claims a waiting conversation", async () => {
  const db = new FakeRealtimeDatabase(initialData());
  await requestSupportStaff(db, { uid: "customer-1", role: "customer" }, "customer-1");
  const result = await replyToSupportConversation(db, { uid: "staff-1", role: "staff", name: "Mika" }, "customer-1", { text: "I can help" });
  assert.equal(result.conversation.mode, "staff");
  assert.equal(result.conversation.assignedStaffId, "staff-1");
});

test("the first staff reply claims the conversation and records the handoff", async () => {
  const db = new FakeRealtimeDatabase(initialData());
  const result = await replyToSupportConversation(db, { uid: "staff-1", role: "staff", name: "Mika" }, "customer-1", {
    text: "I can help with that.",
    customerName: "Juan Customer"
  });

  assert.equal(result.conversation.mode, "staff");
  assert.equal(result.conversation.assignedStaffId, "staff-1");
  assert.equal(db.read("supportConversations/customer-1/assignedStaffName"), "Mika");
  assert.equal(Object.values(db.read("messages/support")).at(-1).text, "I can help with that.");
  assert.equal(Object.values(db.read("auditLogs"))[0].action, "support_takeover_started");
  assert.equal(Object.values(db.read("notifications"))[0].targetUserId, "customer-1");
});

test("simultaneous staff replies cannot create competing assignments", async () => {
  const db = new FakeRealtimeDatabase(initialData());
  const replies = await Promise.allSettled([
    replyToSupportConversation(db, { uid: "staff-1", role: "staff", name: "Mika" }, "customer-1", { text: "First reply" }),
    replyToSupportConversation(db, { uid: "staff-2", role: "staff", name: "Ana" }, "customer-1", { text: "Second reply" })
  ]);

  assert.equal(replies.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(replies.filter((result) => result.status === "rejected").length, 1);
  assert.equal(db.read("supportConversations/customer-1/assignedStaffId"), "staff-1");
});

test("only assigned staff or an owner can resume assistant replies", async () => {
  const db = new FakeRealtimeDatabase(initialData());
  await replyToSupportConversation(db, { uid: "staff-1", role: "staff", name: "Mika" }, "customer-1", { text: "Taking over" });

  await assert.rejects(
    resumeSupportAssistant(db, { uid: "staff-2", role: "staff", name: "Ana" }, "customer-1"),
    (error) => error.status === 403
  );
  const resumed = await resumeSupportAssistant(db, { uid: "owner-1", role: "owner", name: "Owner" }, "customer-1");
  assert.equal(resumed.mode, "assistant");
  assert.equal(resumed.assignedStaffId, null);
  assert.equal((await getSupportConversation(db, "customer-1")).mode, "assistant");
});

test("staff can delete a complete customer support conversation", async () => {
  const data = initialData();
  data.messages.support.other = {
    customerId: "customer-2",
    customerName: "Other Customer",
    senderId: "customer-2",
    senderName: "Other Customer",
    senderRole: "customer",
    text: "Keep this chat",
    createdAt: 2
  };
  data.supportConversations = {
    "customer-1": { customerId: "customer-1", mode: "staff", assignedStaffId: "staff-1", updatedAt: 2 }
  };
  const db = new FakeRealtimeDatabase(data);
  const result = await deleteSupportConversation(db, { uid: "staff-1", role: "staff", name: "Mika" }, "customer-1");

  assert.deepEqual(result, { deleted: true, customerId: "customer-1", deletedMessageCount: 1 });
  assert.equal(db.read("supportConversations/customer-1"), undefined);
  assert.equal(db.read("messages/support/first"), undefined);
  assert.equal(db.read("messages/support/other/text"), "Keep this chat");
  assert.equal(Object.values(db.read("auditLogs"))[0].action, "support_conversation_deleted");
});
