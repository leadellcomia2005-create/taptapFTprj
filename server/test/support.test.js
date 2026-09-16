import assert from "node:assert/strict";
import test from "node:test";
import {
  getSupportConversation,
  replyToSupportConversation,
  resumeSupportAssistant
} from "../src/application/support.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

const initialData = () => ({
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
