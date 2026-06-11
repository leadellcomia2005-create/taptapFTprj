import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeOrderUpdate,
  bearerToken,
  canAccessOrder,
  HttpError,
  validRecordId,
  validateDeliveryProof,
  validateLocation,
  validateOrderItems
} from "../src/security.js";

const order = {
  customerId: "customer-1",
  riderId: "rider-1",
  status: "ready"
};

test("extracts only valid bearer tokens", () => {
  assert.equal(bearerToken("Bearer abc.def"), "abc.def");
  assert.equal(bearerToken("Basic abc"), "");
  assert.equal(bearerToken(""), "");
});

test("authorizes order access by verified ownership and role", () => {
  assert.equal(canAccessOrder({ uid: "owner-1", role: "owner" }, order), true);
  assert.equal(canAccessOrder({ uid: "customer-1", role: "customer" }, order), true);
  assert.equal(canAccessOrder({ uid: "customer-2", role: "customer" }, order), false);
  assert.equal(canAccessOrder({ uid: "rider-1", role: "rider" }, order), true);
  assert.equal(canAccessOrder({ uid: "rider-2", role: "rider" }, order), false);
});

test("allows riders to claim only ready unassigned orders", () => {
  const claim = authorizeOrderUpdate(
    { uid: "rider-2", role: "rider" },
    { ...order, riderId: null },
    { riderId: "rider-2" }
  );
  assert.equal(claim.riderId, "rider-2");
  assert.throws(
    () => authorizeOrderUpdate({ uid: "rider-2", role: "rider" }, order, { riderId: "rider-2" }),
    HttpError
  );
});

test("enforces sequential order status changes", () => {
  const staffUpdate = authorizeOrderUpdate(
    { uid: "staff-1", role: "staff" },
    { ...order, status: "received" },
    { status: "preparing" }
  );
  assert.equal(staffUpdate.status, "preparing");
  assert.throws(
    () => authorizeOrderUpdate({ uid: "staff-1", role: "staff" }, order, { status: "delivered" }),
    /next valid status/i
  );
  assert.throws(
    () => authorizeOrderUpdate({ uid: "rider-1", role: "rider" }, order, { status: "delivered" }),
    /next valid rider status/i
  );
});

test("requires secure proof for rider delivery completion", () => {
  const arrived = { ...order, status: "arrived" };
  assert.throws(
    () => authorizeOrderUpdate({ uid: "rider-1", role: "rider" }, arrived, { status: "delivered" }),
    /proof-of-delivery/i
  );
  const result = authorizeOrderUpdate(
    { uid: "rider-1", role: "rider" },
    arrived,
    { status: "delivered", proofOfDeliveryUrl: "https://example.com/proof.jpg" }
  );
  assert.equal(result.status, "delivered");
  const storedResult = authorizeOrderUpdate(
    { uid: "rider-1", role: "rider" },
    arrived,
    { status: "delivered", proofOfDeliveryRef: "deliveryProofs/order-1" }
  );
  assert.equal(storedResult.proofOfDeliveryRef, "deliveryProofs/order-1");
  assert.equal(validateDeliveryProof("data:image/jpeg;base64,/9j/2Q=="), "data:image/jpeg;base64,/9j/2Q==");
  assert.throws(() => validateDeliveryProof("data:image/png;base64,iVBORw0KGgo="), /JPEG/i);
});

test("validates record IDs, item quantities, and GPS coordinates", () => {
  assert.equal(validRecordId("TAP_123-abc"), true);
  assert.equal(validRecordId("../orders"), false);
  assert.deepEqual(validateOrderItems([{ id: "sisig", qty: 2 }]), [{ id: "sisig", qty: 2 }]);
  assert.throws(() => validateOrderItems([{ id: "sisig", qty: 0 }]), /quantities/i);
  assert.deepEqual(validateLocation({ lat: 14.45, lng: 120.97, accuracy: 8 }), {
    lat: 14.45,
    lng: 120.97,
    accuracy: 8
  });
  assert.throws(() => validateLocation({ lat: 100, lng: 120 }), /latitude/i);
});
