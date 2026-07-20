import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { io as createClient } from "socket.io-client";
import { createNoopLogger } from "../src/observability/logger.js";
import { createRealtimeHub } from "../src/realtime/hub.js";
import { createSocketServer } from "../src/sockets/index.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

function clientFor(baseUrl, token) {
  return createClient(baseUrl, {
    auth: { token },
    forceNew: true,
    reconnection: false,
    timeout: 2_000,
    transports: ["websocket"]
  });
}

function waitForConnect(client) {
  return new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("connect_error", reject);
  });
}

function joinOrder(client, orderId) {
  return new Promise((resolve) => client.emit("order:join", orderId, resolve));
}

function sendLocation(client, payload) {
  return new Promise((resolve) => client.emit("rider:location", payload, resolve));
}

test("authorizes Socket.IO connections and order rooms", { timeout: 10_000 }, async () => {
  const database = new FakeRealtimeDatabase({
    orders: {
      "order-1": { customerId: "customer-1", status: "received" },
      "order-2": { customerId: "customer-2", status: "received" },
      "delivery-1": { customerId: "customer-2", riderId: "rider-1", status: "out-for-delivery", deliveryType: "delivery" },
      "delivery-2": { customerId: "customer-2", riderId: "rider-2", status: "out-for-delivery", deliveryType: "delivery" }
    }
  });
  const users = {
    customer: { uid: "customer-1", role: "customer", email_verified: true, mfaSession: true },
    owner: { uid: "owner-1", role: "owner", email_verified: true, mfaSession: true },
    rider: { uid: "rider-1", role: "rider", email_verified: true, mfaSession: true }
  };
  const firebase = { enabled: true, db: () => database };
  const authentication = {
    async verifyUserToken(token) {
      if (!users[token]) throw new Error("Invalid token");
      return users[token];
    }
  };
  const server = createServer();
  const realtime = createRealtimeHub();
  const io = createSocketServer(server, {
    config: { allowedOrigins: ["http://localhost:5173"] },
    firebase,
    authentication,
    realtime,
    logger: createNoopLogger()
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const clients = [];

  try {
    const invalid = clientFor(baseUrl, "invalid");
    clients.push(invalid);
    const connectError = await new Promise((resolve) => invalid.once("connect_error", resolve));
    assert.equal(connectError.message, "Unauthorized");
    invalid.close();

    const customer = clientFor(baseUrl, "customer");
    clients.push(customer);
    await waitForConnect(customer);
    assert.deepEqual(await joinOrder(customer, "order-2"), {
      ok: false,
      error: "You cannot join this order."
    });
    assert.deepEqual(await joinOrder(customer, "order-1"), { ok: true });

    const owner = clientFor(baseUrl, "owner");
    clients.push(owner);
    await waitForConnect(owner);
    assert.deepEqual(await joinOrder(owner, "order-2"), { ok: true });

    const rider = clientFor(baseUrl, "rider");
    clients.push(rider);
    await waitForConnect(rider);
    assert.deepEqual(await sendLocation(rider, { orderId: "delivery-2", lat: 14.45, lng: 120.98, accuracy: 10 }), {
      ok: false,
      error: "This delivery is not assigned to you."
    });
    assert.deepEqual(await sendLocation(rider, { orderId: "delivery-1", lat: 14.45, lng: 120.98, accuracy: 10 }), { ok: true });
    assert.equal(database.read("orders/delivery-1/riderLocation/lat"), 14.45);
  } finally {
    for (const client of clients) client.close();
    await new Promise((resolve) => io.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});
