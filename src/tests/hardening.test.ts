import test from "node:test";
import assert from "node:assert/strict";
import { runScraper } from "../pipeline/run-scraper.js";
import type { IJobAdapter } from "../adapters/base.adapter.js";
import type { IJobStorage } from "../storage/storage.interface.js";
import type { AdapterKind, Job, RawJob, SaveOptions, SourceConfig, StorageSaveResult } from "../types/job.types.js";
import { Logger } from "../pipeline/logger.js";

test("Hardening — 0-results markup change detection and anti-wipeout safeguard", async (t) => {
  const silentLogger = new Logger({ level: "error" });

  const testSource: SourceConfig = {
    id: "broken-markup-source",
    displayName: "Broken Markup Source",
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
  };

  class ZeroResultsAdapter implements IJobAdapter {
    readonly adapterId = "getro" as const;
    async scrape(): Promise<RawJob[]> {
      // Returns 0 jobs (simulating broken DOM selectors)
      return [];
    }
  }

  let lastSaveOptions: SaveOptions | undefined;

  const mockStorage: IJobStorage = {
    loadExisting: async () => [],
    save: async (freshJobs: Job[], options?: SaveOptions): Promise<StorageSaveResult> => {
      lastSaveOptions = options;
      return {
        totalRows: 10,
        totalActive: 10,
        newJobs: 0,
        updatedJobs: 0,
        deactivatedJobs: 0,
        alreadyInactive: 0,
      };
    },
  };

  await t.test("records ZERO_RESULTS alert and activates anti-wipeout safeguard", async () => {
    const adapters = new Map<AdapterKind, IJobAdapter>([
      ["getro", new ZeroResultsAdapter()],
    ]);

    const result = await runScraper({
      sources: [testSource],
      adapters,
      storage: mockStorage,
      logger: silentLogger,
      dryRun: false,
    });

    // 1. Alert recorded
    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0]!.kind, "ZERO_RESULTS");
    assert.equal(result.alerts[0]!.sourceId, "broken-markup-source");

    // 2. Not counted in scrapedSources to prevent storage deactivation
    assert.deepEqual(result.scrapedSources, []);
    assert.deepEqual(result.failedSources, []);

    // 3. Summary text contains warning alert banner
    assert.ok(result.summaryText.includes("[ZERO_RESULTS]"));
    assert.ok(result.summaryText.includes("broken-markup-source"));

    // 4. Storage save was NOT called with this source as scraped, protecting existing active jobs
    assert.equal(lastSaveOptions, undefined);
  });
});
