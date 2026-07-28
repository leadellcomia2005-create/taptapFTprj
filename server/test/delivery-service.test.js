import test from "node:test";
import assert from "node:assert/strict";
import {
  saveDeliveryProofRecord,
  saveRiderLocationRecord
} from "../src/application/delivery.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

const rider = {
  uid: "rider-1",
  role: "rider",
  name: "Rider One",
  email: "rider@example.com"
};

test("stores rider GPS only on the assigned active order", async () => {
  const db = new FakeRealtimeDatabase({
    orders: {
      "order-1": {
        riderId: rider.uid,
        status: "out_for_delivery"
      }
    }
  });

  const result = await saveRiderLocationRecord(db, rider, "order-1", {
    lat: 14.4509,
    lng: 120.9764,
    accuracy: 8
  });

  assert.equal(result.location.lat, 14.4509);
  assert.equal(result.location.lng, 120.9764);
  assert.equal(result.location.accuracy, 8);
  assert.equal(typeof result.location.updatedAt, "number");
  assert.deepEqual(db.read(`riderLocations/${rider.uid}`), {
    ...result.location,
    orderId: "order-1"
  });
  assert.deepEqual(db.read("orders/order-1/riderLocation"), result.location);

  await assert.rejects(
    () => saveRiderLocationRecord(db, { ...rider, uid: "rider-2" }, "order-1", {
      lat: 14.4509,
      lng: 120.9764,
      accuracy: 8
    }),
    /not assigned/i
  );
});

test("stores validated delivery proof metadata with a retention timestamp", async (t) => {
  const previousBucket = process.env.FIREBASE_STORAGE_BUCKET;
  const previousClientBucket = process.env.VITE_FIREBASE_STORAGE_BUCKET;
  delete process.env.FIREBASE_STORAGE_BUCKET;
  delete process.env.VITE_FIREBASE_STORAGE_BUCKET;
  t.after(() => {
    if (previousBucket === undefined) delete process.env.FIREBASE_STORAGE_BUCKET;
    else process.env.FIREBASE_STORAGE_BUCKET = previousBucket;
    if (previousClientBucket === undefined) delete process.env.VITE_FIREBASE_STORAGE_BUCKET;
    else process.env.VITE_FIREBASE_STORAGE_BUCKET = previousClientBucket;
  });

  const db = new FakeRealtimeDatabase({
    orders: {
      "order-1": {
        riderId: rider.uid,
        status: "arrived",
        handoffOtp: "123456"
      }
    }
  });

  const result = await saveDeliveryProofRecord(db, rider, "order-1", {
    dataUrl: "data:image/jpeg;base64,/9j/2Q==",
    handoff: {
      customerName: "Juan Dela Cruz",
      otp: "123456"
    }
  });
  const stored = db.read("deliveryProofs/order-1");

  assert.equal(result.proofOfDeliveryRef, "deliveryProofs/order-1");
  assert.equal(result.proofOfDeliveryMeta.customerName, "Juan Dela Cruz");
  assert.equal(result.proofOfDeliveryMeta.otpVerified, true);
  assert.equal(stored.riderId, rider.uid);
  assert.equal(stored.storageMode, "database");
  assert.equal(stored.handoff.otpVerified, true);
  assert.ok(stored.expiresAt > stored.createdAt);

  await assert.rejects(
    () => saveDeliveryProofRecord(db, { ...rider, uid: "rider-2" }, "order-1", {
      dataUrl: "data:image/jpeg;base64,/9j/2Q==",
      handoff: { customerName: "Juan Dela Cruz" }
    }),
    /not assigned/i
  );
});
