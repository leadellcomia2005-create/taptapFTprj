import test from "node:test";
import assert from "node:assert/strict";
import { decodeServiceAccount } from "../src/integrations/firebaseAdmin.js";

test("decodes a complete hosted Firebase service account", () => {
  const account = {
    project_id: "example-project",
    client_email: "firebase-admin@example-project.iam.gserviceaccount.com",
    private_key: "private-key"
  };
  const encoded = Buffer.from(JSON.stringify(account), "utf8").toString("base64");

  assert.deepEqual(decodeServiceAccount(encoded), account);
});

test("rejects incomplete hosted Firebase service accounts", () => {
  const encoded = Buffer.from(JSON.stringify({ project_id: "example-project" }), "utf8").toString("base64");

  assert.throws(() => decodeServiceAccount(encoded), /incomplete/);
});
