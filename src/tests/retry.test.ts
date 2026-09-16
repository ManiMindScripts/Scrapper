import test from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../utils/retry.js";

test("withRetry — exponential backoff and retry behavior", async (t) => {
  await t.test("succeeds on first attempt without retrying", async () => {
    let attempts = 0;
    const res = await withRetry(async () => {
      attempts++;
      return "OK";
    });

    assert.equal(res, "OK");
    assert.equal(attempts, 1);
  });

  await t.test("retries and succeeds on second attempt", async () => {
    let attempts = 0;
    const res = await withRetry(
      async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("Temporary network timeout");
        }
        return "SUCCESS_AFTER_RETRY";
      },
      { maxRetries: 2, delayMs: 10, backoffFactor: 1 },
    );

    assert.equal(res, "SUCCESS_AFTER_RETRY");
    assert.equal(attempts, 2);
  });

  await t.test("throws error when max retries are exceeded", async () => {
    let attempts = 0;
    await assert.rejects(
      async () => {
        await withRetry(
          async () => {
            attempts++;
            throw new Error("Persistent 500 error");
          },
          { maxRetries: 2, delayMs: 10, backoffFactor: 1 },
        );
      },
      /Persistent 500 error/,
    );

    assert.equal(attempts, 3); // 1 initial + 2 retries = 3 attempts total
  });
});
