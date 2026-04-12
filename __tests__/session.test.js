/* eslint-disable @typescript-eslint/no-require-imports */
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const { createSessionToken, verifySessionToken } = require("../src/lib/session-core.ts");

(async () => {
  const token = await createSessionToken({
    userId: "u1",
    role: "admin",
    username: "root",
  });

  const decoded = await verifySessionToken(token);

  assert.equal(decoded.userId, "u1");
  assert.equal(decoded.role, "admin");
  assert.equal(decoded.username, "root");

  const guestToken = await createSessionToken({
    userId: "u2",
    role: "guest",
    username: "visitor",
  });

  const parts = guestToken.split(".");
  const tampered = `${parts[0]}.broken`;

  await assert.rejects(() => verifySessionToken(tampered), /Invalid session signature/);

  console.log("session.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
