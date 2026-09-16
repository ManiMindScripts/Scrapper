import path from "node:path";
import { sources } from "./config/sources.js";
import type { AdapterKind } from "./types/job.types.js";
import type { IJobAdapter } from "./adapters/base.adapter.js";
import { StubAdapter } from "./adapters/stub.adapter.js";
import { GetroAdapter } from "./adapters/getro.adapter.js";
import { ClimatebaseAdapter } from "./adapters/climatebase.adapter.js";
import { GenericHtmlAdapter } from "./adapters/generic-html.adapter.js";
import { ConsiderAdapter } from "./adapters/consider.adapter.js";
import { CsvStorage } from "./storage/csv-storage.js";
import { BrowserManager } from "./browser/browser-manager.js";
import { Logger } from "./pipeline/logger.js";
import { runScraper } from "./pipeline/run-scraper.js";
import { Scheduler } from "./scheduler/scheduler.js";

async function main(): Promise<void> {
  const logger = new Logger({ level: "info" });
  const csvPath = path.resolve(process.cwd(), "data", "jobs.csv");
  const storage = new CsvStorage(csvPath);

  // Register all live platform adapters
  const adapters = new Map<AdapterKind, IJobAdapter>([
    ["getro", new GetroAdapter()],
    ["consider", new ConsiderAdapter()],
    ["climatebase", new ClimatebaseAdapter()],
    ["generic-html", new GenericHtmlAdapter()],
    ["large-aggregator", new StubAdapter("large-aggregator")],
  ]);

  const browserManager = new BrowserManager({ headless: true });

  const isLiveFlag = process.argv.includes("--live");
  const sourceArg = process.argv
    .find((arg) => arg.startsWith("--source="))
    ?.replace("--source=", "");
  const sourceIds = sourceArg ? [sourceArg] : undefined;

  // Check for scheduling flags
  const scheduleArg = process.argv.find((arg) => arg.startsWith("--schedule"));
  const hasNowFlag =
    process.argv.includes("--now") || process.argv.includes("--run-on-start");

  const runTask = async (): Promise<void> => {
    await runScraper({
      sources,
      adapters,
      storage,
      browserManager,
      logger,
      dryRun: !isLiveFlag,
      sourceIds,
    });
  };

  if (scheduleArg) {
    // Scheduled daemon mode
    let cronExpr = "0 6 * * *"; // Default daily at 06:00
    if (scheduleArg.includes("=")) {
      cronExpr = scheduleArg.split("=")[1]?.replace(/^["']|["']$/g, "") || cronExpr;
    }

    const scheduler = new Scheduler({
      cronExpression: cronExpr,
      runOnStart: hasNowFlag,
      onTick: runTask,
      logger,
    });

    const shutdown = async () => {
      logger.info("Received shutdown signal. Tearing down...", "main");
      scheduler.stop();
      await browserManager.close();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await scheduler.start();
  } else {
    // One-off single execution mode
    try {
      await runTask();
      logger.info("One-off scrape run finished.", "main");
    } finally {
      await browserManager.close();
    }
  }
}

main().catch((err) => {
  console.error("Fatal error during pipeline execution:", err);
  process.exit(1);
});
