import test from "node:test";
import assert from "node:assert/strict";
import { runScraper } from "../pipeline/run-scraper.js";
import { StubAdapter } from "../adapters/stub.adapter.js";
import type { IJobAdapter } from "../adapters/base.adapter.js";
import type { IJobStorage } from "../storage/storage.interface.js";
import type { AdapterKind, Job, RawJob, SourceConfig, StorageSaveResult } from "../types/job.types.js";
import { Logger } from "../pipeline/logger.js";

test("Pipeline Orchestrator — isolation, error handling, and dry-run", async (t) => {
  const dummySources: SourceConfig[] = [
    {
      id: "source-ok",
      displayName: "OK Source",
      url: "https://example.com/jobs",
      adapter: "getro",
      platform: "getro",
      pagination: "load_more",
      jsonApi: { status: "none", notes: "" },
      viewJob: "on_site",
      jobDescPolicy: "board_or_ats",
      robots: { url: "", listingAllowed: true, notes: "" },
      enabled: true,
      concurrencyGroup: "default",
      notes: "",
    },
    {
      id: "source-failing",
      displayName: "Failing Source",
      url: "https://example.com/fail",
      adapter: "getro",
      platform: "getro",
      pagination: "load_more",
      jsonApi: { status: "none", notes: "" },
      viewJob: "on_site",
      jobDescPolicy: "board_or_ats",
      robots: { url: "", listingAllowed: true, notes: "" },
      enabled: true,
      concurrencyGroup: "default",
      notes: "",
    },
    {
      id: "source-disabled",
      displayName: "Disabled Source",
      url: "https://example.com/disabled",
      adapter: "getro",
      platform: "getro",
      pagination: "load_more",
      jsonApi: { status: "none", notes: "" },
      viewJob: "on_site",
      jobDescPolicy: "board_or_ats",
      robots: { url: "", listingAllowed: true, notes: "" },
      enabled: false,
      concurrencyGroup: "default",
      notes: "",
    },
  ];

  class MockFailingGetroAdapter implements IJobAdapter {
    readonly adapterId = "getro" as const;
    async scrape(source: SourceConfig): Promise<RawJob[]> {
      if (source.id === "source-failing") {
        throw new Error("Simulated network timeout");
      }
      return [
        {
          source: source.id,
          jobTitle: "Software Engineer",
          jobUrl: "https://example.com/jobs/1",
          companyName: "CleanTech Corp",
        },
      ];
    }
  }

  const mockStorage: IJobStorage = {
    loadExisting: async () => [],
    save: async (freshJobs: Job[]): Promise<StorageSaveResult> => ({
      totalRows: freshJobs.length,
      totalActive: freshJobs.length,
      newJobs: freshJobs.length,
      updatedJobs: 0,
      deactivatedJobs: 0,
      alreadyInactive: 0,
    }),
  };

  const silentLogger = new Logger({ level: "error" });

  await t.test("dryRun mode logs would-scrape and skips live scrape calls", async () => {
    const adapters = new Map<AdapterKind, IJobAdapter>([
      ["getro", new StubAdapter("getro")],
    ]);

    const result = await runScraper({
      sources: dummySources,
      adapters,
      storage: mockStorage,
      logger: silentLogger,
      dryRun: true,
    });

    assert.equal(result.totalSources, 3);
    assert.deepEqual(result.scrapedSources, ["source-ok", "source-failing"]);
    assert.deepEqual(result.skippedSources, ["source-disabled"]);
    assert.deepEqual(result.failedSources, []);
    assert.equal(result.storageResult, undefined);
  });

  await t.test("live mode isolates failure per-source and continues run", async () => {
    const adapters = new Map<AdapterKind, IJobAdapter>([
      ["getro", new MockFailingGetroAdapter()],
    ]);

    const result = await runScraper({
      sources: dummySources,
      adapters,
      storage: mockStorage,
      logger: silentLogger,
      dryRun: false,
    });

    assert.equal(result.totalSources, 3);
    assert.deepEqual(result.scrapedSources, ["source-ok"]);
    assert.deepEqual(result.failedSources, ["source-failing"]);
    assert.deepEqual(result.skippedSources, ["source-disabled"]);
    assert.ok(result.storageResult);
    assert.equal(result.storageResult?.totalRows, 1);
  });
});
