import test from "node:test";
import assert from "node:assert/strict";
import { RunSummary } from "../pipeline/run-summary.js";
import type { SourceConfig } from "../types/job.types.js";

test("RunSummary — formatting and metric computation", async (t) => {
  const dummySources: SourceConfig[] = [
    {
      id: "rubio",
      displayName: "Rubio",
      url: "https://rubio.getro.com/jobs",
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
      id: "climatetechlist",
      displayName: "ClimateTechList",
      url: "https://climatetechlist.com/jobs",
      adapter: "large-aggregator",
      platform: "custom",
      pagination: "unknown",
      jsonApi: { status: "none", notes: "" },
      viewJob: "on_site",
      jobDescPolicy: "board_or_ats",
      robots: { url: "", listingAllowed: true, notes: "" },
      enabled: false,
      concurrencyGroup: "default",
      notes: "",
    },
  ];

  await t.test("formats full summary banner with posting dynamics", () => {
    const summary = RunSummary.format({
      startTime: new Date("2026-09-16T10:00:00.000Z"),
      endTime: new Date("2026-09-16T10:00:15.500Z"),
      sources: dummySources,
      sourceStats: [
        {
          sourceId: "rubio",
          displayName: "Rubio",
          adapter: "getro",
          status: "SUCCESS",
          jobsCount: 40,
        },
        {
          sourceId: "climatetechlist",
          displayName: "ClimateTechList",
          adapter: "large-aggregator",
          status: "SKIPPED",
          jobsCount: 0,
          errorMessage: "Disabled in config",
        },
      ],
      storageResult: {
        totalRows: 523,
        totalActive: 520,
        newJobs: 15,
        updatedJobs: 40,
        deactivatedJobs: 3,
        alreadyInactive: 0,
      },
      dryRun: false,
    });

    assert.ok(summary.includes("JOB SCRAPER RUN SUMMARY (LIVE RUN)"));
    assert.ok(summary.includes("15.50s"));
    assert.ok(summary.includes("New Postings        :     15"));
    assert.ok(summary.includes("Still-Active        :     40"));
    assert.ok(summary.includes("Closed Postings     :      3"));
    assert.ok(summary.includes("Total Active Jobs   :    520"));
    assert.ok(summary.includes("Total Tracked Jobs  :    523"));
    assert.ok(summary.includes("rubio"));
    assert.ok(summary.includes("climatetechlist"));
    assert.ok(summary.includes("Disabled in config"));
  });
});
