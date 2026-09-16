import test from "node:test";
import assert from "node:assert/strict";
import { Scheduler } from "../scheduler/scheduler.js";
import { Logger } from "../pipeline/logger.js";

test("Scheduler — validation, execution, and overlapping guard", async (t) => {
  const silentLogger = new Logger({ level: "error" });

  await t.test("throws on invalid cron expression", () => {
    assert.throws(
      () =>
        new Scheduler({
          cronExpression: "invalid-cron",
          onTick: async () => {},
          logger: silentLogger,
        }),
      /Invalid cron expression/,
    );
  });

  await t.test("runs on start when runOnStart is true", async () => {
    let tickCount = 0;
    const scheduler = new Scheduler({
      cronExpression: "0 6 * * *",
      runOnStart: true,
      onTick: async () => {
        tickCount++;
      },
      logger: silentLogger,
    });

    await scheduler.start();
    assert.equal(tickCount, 1);
    scheduler.stop();
  });

  await t.test("overlapping run guard prevents simultaneous tick execution", async () => {
    let executionStarts = 0;
    let finishResolve: (() => void) | null = null;
    const longRunningPromise = new Promise<void>((resolve) => {
      finishResolve = resolve;
    });

    const scheduler = new Scheduler({
      cronExpression: "0 6 * * *",
      onTick: async () => {
        executionStarts++;
        await longRunningPromise;
      },
      logger: silentLogger,
    });

    // Start tick 1 (which will block on longRunningPromise)
    const tick1 = scheduler.executeTick();
    assert.equal(executionStarts, 1);
    assert.equal(scheduler.isExecuting(), true);

    // Trigger tick 2 while tick 1 is still executing
    await scheduler.executeTick();
    assert.equal(executionStarts, 1); // Should still be 1 because tick 2 was skipped!

    // Finish tick 1
    finishResolve!();
    await tick1;
    assert.equal(scheduler.isExecuting(), false);
  });
});
