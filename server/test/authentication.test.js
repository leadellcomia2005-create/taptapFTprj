import assert from "node:assert/strict";
import test from "node:test";
import { createAuthentication } from "../src/middleware/authentication.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

test("checks Firebase token revocation before accepting an API session", async () => {
  const calls = [];
  const database = new FakeRealtimeDatabase({
    users: { "staff-1": { role: "staff", name: "Test Staff" } }
  });
  const firebase = {
    enabled: true,
    db: () => database,
    auth: () => ({
      async verifyIdToken(token, checkRevoked) {
        calls.push({ token, checkRevoked });
        return { uid: "staff-1", email_verified: true };
      }
    })
  };

  const user = await createAuthentication(firebase).verifyUserToken("valid-token");
  assert.deepEqual(calls, [{ token: "valid-token", checkRevoked: true }]);
  assert.equal(user.role, "staff");
  assert.equal(user.name, "Test Staff");
});

test("rejects a suspended profile even when its token is otherwise valid", async () => {
  const database = new FakeRealtimeDatabase({
    users: { "staff-1": { role: "staff", name: "Suspended Staff", suspended: true } }
  });
  const firebase = {
    enabled: true,
    db: () => database,
    auth: () => ({
      async verifyIdToken() {
        return { uid: "staff-1", role: "staff", email_verified: true, mfaSession: true };
      }
    })
  };

  await assert.rejects(createAuthentication(firebase).verifyUserToken("valid-but-suspended"), /suspended/i);
});
